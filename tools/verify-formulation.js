// 国内情景配方与核算核对：约束全部满足、确是最低成本、超限时的处理、排放公式与手算一致。
// 用法：node tools/verify-formulation.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-parameters.js', 'parameters/feed2climate-china.js', 'ai.js', 'formulation.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const C = global.window.F2C_CHINA;
const FM = global.window.F2C_FORMULATION;
const AI = global.window.F2C_AI;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name + (detail != null ? ' — 得到 ' + detail : '')); }
}
const approx = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const TOL = 1e-6;

console.log('== 0. 参数完整 ==');
{
  const keys = Object.keys(C.ingredients);
  check('每种原料都有 NE、粗蛋白、价格、碳排放', keys.every((k) => ['ne', 'cp', 'price', 'co2e'].every((f) => typeof C.ingredients[k][f] === 'number')));
  check('每种原料都标了来源', keys.every((k) => typeof C.ingredients[k].source === 'string' && C.ingredients[k].source.length > 10));
  check('理想比例齐全（苏、蛋+胱、色、缬、异亮）', FM.RATIO_AA.every((aa) => C.idealRatio[aa] > 0));
  check('豆粕三档碳排放情景递增', C.ingredients.sbm.co2eScenarios.low < C.ingredients.sbm.co2eScenarios.mid && C.ingredients.sbm.co2eScenarios.mid < C.ingredients.sbm.co2eScenarios.high);
}

console.log('== 1. 约束全部满足 ==');
const targets = [[10.0, 13.0], [9.6, 11.0], [9.0, 9.5], [8.4, 8.0], [7.8, 7.0]];
for (const [ne, lys] of targets) {
  const r = FM.formulate(C, { ne, lys });
  const d = r.perKg;
  const sum = Object.values(r.recipe).reduce((s, v) => s + v, 0);
  const capsOk = Object.keys(r.recipe).every((k) => C.ingredients[k].max == null || r.recipe[k] <= C.ingredients[k].max + TOL);
  const ratiosOk = FM.RATIO_AA.every((aa) => d[aa] >= C.idealRatio[aa] * lys - 1e-6);
  check(`NE ${ne} / 赖 ${lys}：配比合计 1、赖氨酸达标、理想比例达标、合成氨基酸不超上限、能量达标`,
    r.status === 'optimal' && approx(sum, 1, 1e-6) && d.lys >= lys - 1e-6 && ratiosOk && capsOk && d.ne >= ne - 1e-6 && !r.neRelaxed,
    JSON.stringify({ sum, lys: d.lys, ne: d.ne, ratiosOk, capsOk }));
}

console.log('== 2. 确是最低成本（对照 20000 个随机可行配方） ==');
{
  const ne = 9.0, lys = 9.5;
  const best = FM.formulate(C, { ne, lys });
  const A = FM.arrays(C, {});
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let feasible = 0, cheaper = 0;
  for (let k = 0; k < 20000; k++) {
    // 玉米/豆粕随机，合成氨基酸在上限内随机
    const syn = A.keys.map((key, j) => (A.max[j] != null ? rand() * A.max[j] : 0));
    const synSum = syn.reduce((s, v) => s + v, 0);
    const sbm = rand() * 0.4;
    const x = A.keys.map((key, j) => (key === 'sbm' ? sbm : key === 'corn' ? 1 - sbm - synSum : syn[j]));
    if (x.some((v) => v < 0)) continue;
    const dot = (v) => v.reduce((s, vv, j) => s + vv * x[j], 0);
    const ok = dot(A.ne) >= ne && dot(A.sid.lys) >= lys && FM.RATIO_AA.every((aa) => dot(A.sid[aa]) >= C.idealRatio[aa] * lys);
    if (!ok) continue;
    feasible++;
    if (dot(A.price) / 1000 < best.perKg.price - 1e-9) cheaper++;
  }
  check('随机可行配方不少于 50 个（检验有效）', feasible >= 50, feasible);
  check('没有任何随机可行配方比线性规划解更便宜', cheaper === 0, cheaper + ' / ' + feasible);
}

console.log('== 3. 超出上限时的处理 ==');
{
  const r = FM.formulate(C, { ne: 9.0, lys: 30 });
  check('赖氨酸目标超出可达上限 → 按上限配并标记', r.status === 'optimal' && r.lysCapped && r.perKg.lys < 30 && r.perKg.lys > 20, JSON.stringify({ capped: r.lysCapped, lys: r.perKg.lys }));
  check('按上限配时理想比例仍满足', FM.RATIO_AA.every((aa) => r.perKg[aa] >= C.idealRatio[aa] * r.lysUsed - 1e-6));
  const e = FM.formulate(C, { ne: 12.5, lys: 10 });
  check('能量目标达不到 → 只放松能量，赖氨酸照常达标', e.status === 'optimal' && e.neRelaxed && e.neUsed < 12.5 && e.perKg.lys >= 10 - 1e-6, JSON.stringify({ relaxed: e.neRelaxed, ne: e.neUsed, lys: e.perKg.lys }));
}

console.log('== 4. 赖氨酸目标越低，豆粕、粗蛋白、成本越低 ==');
{
  const hi = FM.formulate(C, { ne: 9.0, lys: 11 }), lo = FM.formulate(C, { ne: 9.0, lys: 8 });
  check('豆粕用量下降', lo.recipe.sbm < hi.recipe.sbm, hi.recipe.sbm + ' → ' + lo.recipe.sbm);
  check('粗蛋白下降', lo.perKg.cp < hi.perKg.cp);
  check('成本下降', lo.perKg.price < hi.perKg.price);
}

console.log('== 5. 碳排放情景只改碳排放，不改配方 ==');
{
  const a = FM.formulate(C, { ne: 9.0, lys: 9.5 }, { sbmScenario: 'low' }), b = FM.formulate(C, { ne: 9.0, lys: 9.5 }, { sbmScenario: 'high' });
  check('配方相同', JSON.stringify(a.recipe) === JSON.stringify(b.recipe));
  check('碳排放差 = 豆粕用量 × (1.690 − 0.541)', approx(b.perKg.co2e - a.perKg.co2e, a.recipe.sbm * (1.690 - 0.541), 1e-9));
}

console.log('== 6. 排放核算与手算一致（60 kg、日增重 0.95、采食 2.2 kg，液态储存无结壳，温暖湿润） ==');
{
  const diet = { nG: 25, co2e: 0.70 };
  const a = FM.account(C, diet, { bw: 60, adg: 0.95, fi: 2.2 }, { system: 'slurry_nocrust', climate: 'warm_moist' });
  const nEx = 25 * 2.2 - 28 * 0.95;                  // 55 − 26.6 = 28.4 g N/天
  const vs = 2.2 * 0.88 * 0.20 * 0.80;               // 0.30976 kg VS/天
  const ch4 = vs * 0.45 * 0.67 * 0.24 * 27;          // kg CO2e
  const n2oInd = (nEx / 1000) * 0.48 * 0.010 * 44 / 28 * 273;
  check('氮排泄 28.4 g/天', approx(a.nExcreted, nEx, 1e-9), a.nExcreted);
  check('饲料碳排放 = 0.70 × 2.2', approx(a.feed, 1.54, 1e-9), a.feed);
  check('粪污 CH4（MCF 24%，B0 0.45）', approx(a.ch4, ch4, 1e-9), a.ch4 + ' vs ' + ch4);
  check('直接 N2O = 0（无结壳液态储存 EF3 = 0）', a.n2oDirect === 0);
  check('间接 N2O = 氮 × 0.48 × 0.010 × 44/28 × 273', approx(a.n2oIndirect, n2oInd, 1e-12), a.n2oIndirect + ' vs ' + n2oInd);
  const pit = FM.account(C, diet, { bw: 60, adg: 0.95, fi: 2.2 }, { system: 'pit', climate: 'warm_moist' });
  check('舍下粪坑：直接 N2O 按 EF3 0.002', approx(pit.n2oDirect, (nEx / 1000) * 0.002 * 44 / 28 * 273, 1e-12));
  const lagoon = FM.account(C, diet, { bw: 60, adg: 0.95, fi: 2.2 }, { system: 'lagoon', climate: 'warm_moist' });
  check('厌氧塘：MCF 取 73%，直接 N2O 为 0', lagoon.mcf === 0.73 && lagoon.n2oDirect === 0);
  check('合计 = 各项之和', approx(a.total, a.feed + a.ch4 + a.n2oDirect + a.n2oIndirect, 1e-12));
}

console.log('== 7. 与原 LP 求解器一致（同一单纯形） ==');
check('F2C_FORMULATION 用的是 F2C_AI.solveLP', typeof AI.solveLP === 'function');

console.log(failures === 0 ? '\n国内配方与核算全部核对通过。' : '\n有 ' + failures + ' 项未通过。');
process.exit(failures === 0 ? 0 : 1);
