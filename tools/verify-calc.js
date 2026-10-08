// 手工算例核对（国内情景）：在 Node 中加载国内参数与工具引擎，逐项验证计算。
// 期望值只由参数文件中的原料表与公式独立复算（不调用被测代码），网格搜索用穷举对照。
// 用法：node tools/verify-calc.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-china.js', 'ai.js', 'formulation.js', 'engine.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const C = global.window.F2C_CHINA;
const E = global.window.F2C_ENGINE;
const FM = global.window.F2C_FORMULATION;
const ING = C.ingredients;
const RATIO_AA = ['thr', 'metcys', 'trp', 'val', 'ile'];

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name + (detail != null ? ' — 得到 ' + detail : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }
const sumOf = (rec) => Object.keys(rec).reduce((s, k) => s + rec[k], 0);

// 独立的每 kg 饲料属性：按配方质量占比加权原料表（不调用 formulation.js）
function handPerKg(recipe) {
  const sum = (sel) => Object.keys(recipe).reduce((s, k) => s + recipe[k] * sel(ING[k]), 0);
  return {
    ne: sum((i) => i.ne), cp: sum((i) => i.cp), lys: sum((i) => i.sid.lys || 0),
    thr: sum((i) => i.sid.thr || 0), metcys: sum((i) => i.sid.metcys || 0), trp: sum((i) => i.sid.trp || 0),
    val: sum((i) => i.sid.val || 0), ile: sum((i) => i.sid.ile || 0),
    price: sum((i) => i.price), // 元/吨
    co2e: sum((i) => i.co2e),   // kg CO2e/kg
  };
}
// 独立的营养要求（每头每天）
function handRequirement(bw, adg) {
  return {
    ne: 1.05 * 0.74 * Math.pow(bw, 0.6) + 9.0 * adg,
    lys: 0.036 * Math.pow(bw, 0.75) + 20.0 * adg,
  };
}

console.log('== 0. 参数完整性 ==');
{
  check('基础料 A 目标存在且为第 1 天', C.phaseTargets.A.day === 1 && C.phaseTargets.A.ne > 0 && C.phaseTargets.A.lys > 0);
  check('基础料 B 目标存在且为第 51 天', C.phaseTargets.B.day === 51 && C.phaseTargets.B.ne > 0 && C.phaseTargets.B.lys > 0);
  check('维持 NE 系数 = 1.05×0.74 = 0.777', approx(C.energy.maintenance_coefficient * C.energy.maintenance_net_availability, 0.777, 1e-9));
  check('要求：赖氨酸增重 20 g/kg、NE 增重 9 MJ/kg、ADG 0.90', C.requirements.lys_gain_g_per_kg === 20 && C.requirements.ne_gain_mj_per_kg === 9 && C.mechanism.adg_kg_day === 0.9);
  check('粪污情景含 slurry_nocrust 与 lagoon', !!C.manure.systems.slurry_nocrust && !!C.manure.systems.lagoon);
  check('气候区含 warm_moist 与 cool_moist', !!C.manure.mcf.warm_moist && !!C.manure.mcf.cool_moist);
  check('豆粕有三档碳排放情景', ING.sbm.co2eScenarios && ING.sbm.co2eScenarios.mid === 1.138);
}

console.log('== 1. 基础料 A/B（国内配方，手工复算） ==');
const base = E.baseDiets(C);
{
  check('A 配比合计 = 1', approx(sumOf(base.A.recipe), 1, 1e-6), sumOf(base.A.recipe));
  check('B 配比合计 = 1', approx(sumOf(base.B.recipe), 1, 1e-6), sumOf(base.B.recipe));
  const hA = handPerKg(base.A.recipe), hB = handPerKg(base.B.recipe);
  check('A 的 SID 赖氨酸 = 按原料表手工加权', approx(base.A.perKg.lys, hA.lys, 1e-6), base.A.perKg.lys + ' vs ' + hA.lys.toFixed(6));
  check('B 的 SID 赖氨酸 = 目标 9.041（后期）', approx(hB.lys, C.phaseTargets.B.lys, 1e-4), hB.lys);
  check('A 的合成氨基酸不超过配合上限（容差 1e-6，LP 数值误差）', Object.keys(base.A.recipe).every((k) => ING[k].max == null || base.A.recipe[k] <= ING[k].max + 1e-6));
  check('B 的合成氨基酸不超过配合上限（容差 1e-6）', Object.keys(base.B.recipe).every((k) => ING[k].max == null || base.B.recipe[k] <= ING[k].max + 1e-6));
  check('B 满足理想蛋白比例（相对赖氨酸）', RATIO_AA.every((aa) => hB[aa] >= C.idealRatio[aa] * hB.lys - 1e-6));
  check('A 满足理想蛋白比例（相对实际赖氨酸）', RATIO_AA.every((aa) => hA[aa] >= C.idealRatio[aa] * hA.lys - 1e-6), RATIO_AA.map((aa) => aa + ' ' + (hA[aa] / hA.lys).toFixed(3)).join(' '));
  check('A 的赖氨酸与第 1 天目标一致（理想比例不再抬高赖氨酸）', approx(hA.lys, C.phaseTargets.A.lys, 1e-3), hA.lys);
  check('A 能量放松（前期无油脂，NE 达不到标准）', base.A.neRelaxed === true && base.A.perKg.ne < C.phaseTargets.A.ne, base.A.perKg.ne);
  check('B 能量不放松（后期 NE 达标）', base.B.neRelaxed === false && hB.ne >= C.phaseTargets.B.ne - 1e-6, hB.ne);
}

console.log('== 2. 配比混合（线性，与手工加权对照） ==');
{
  const d = E.blendDiets(0.3, C);
  const recipe = {};
  Object.keys(base.A.recipe).forEach((k) => { recipe[k] = 0.3 * base.A.recipe[k] + 0.7 * base.B.recipe[k]; });
  const h = handPerKg(recipe);
  check('30% A 混合：配比合计 = 1', approx(sumOf(d.recipe), 1, 1e-4), sumOf(d.recipe));
  check('30% A 混合：NE = 手工加权（3 位）', approx(d.ne, h.ne, 0.0015), d.ne + ' vs ' + h.ne.toFixed(4));
  check('30% A 混合：SID 赖氨酸 = 手工加权（2 位）', approx(d.sidLys, h.lys, 0.006), d.sidLys + ' vs ' + h.lys.toFixed(4));
  check('30% A 混合：CP = 手工加权（1 位）', approx(d.cp, h.cp, 0.06), d.cp + ' vs ' + h.cp.toFixed(3));
  check('30% A 混合：价格 = 手工加权（元/吨）', approx(d.price, h.price, 0.6), d.price + ' vs ' + h.price.toFixed(2));
  check('30% A 混合：碳排放 = 手工加权', approx(d.feedCo2e, h.co2e, 6e-5), d.feedCo2e + ' vs ' + h.co2e.toFixed(6));
  check('N = CP/6.25', approx(d.nG, d.cp / 6.25, 0.01), d.nG);
  check('100% A 与基础料 A 一致', approx(E.blendDiets(1, C).sidLys, base.A.perKg.lys, 0.006));
  check('0% A（纯 B）与基础料 B 一致', approx(E.blendDiets(0, C).sidLys, base.B.perKg.lys, 0.006));
}

console.log('== 3. 营养供需检查（手工复算，BW 99.5 kg、采食 2.41 kg/天） ==');
{
  const d = E.blendDiets(0.5, C);
  const bw = 99.5, fi = 2.41;
  const c = E.nutritionCheck(d, bw, fi, C);
  const req = handRequirement(bw, 0.9);
  const h = handPerKg(d.recipe);
  check('NE 要求 = 0.777×BW^0.6 + 9×0.9', approx(c.ne.requirement, req.ne, 0.01), c.ne.requirement + ' vs ' + req.ne.toFixed(3));
  check('NE 供应 = NE 密度 × 采食（手工）', approx(c.ne.supply, h.ne * fi, 0.02), c.ne.supply + ' vs ' + (h.ne * fi).toFixed(3));
  check('SID 赖氨酸要求 = 0.036×BW^0.75 + 20×0.9', approx(c.sidLys.requirement, req.lys, 0.06), c.sidLys.requirement + ' vs ' + req.lys.toFixed(3));
  check('SID 赖氨酸供应 = 密度 × 采食（手工）', approx(c.sidLys.supply, h.lys * fi, 0.1), c.sidLys.supply + ' vs ' + (h.lys * fi).toFixed(3));
  check('CP 下限 120 g/kg，供应 = 手工加权（取整）', c.cp.requirement === 120 && approx(c.cp.supply, Math.round(h.cp), 1), c.cp.supply);
  check('判定与手工一致', c.ne.pass === (h.ne * fi >= req.ne - 1e-9) && c.sidLys.pass === (h.lys * fi >= req.lys - 1e-9));
  check('要求公式说明存在', typeof c.ne.formula === 'string' && typeof c.sidLys.formula === 'string');
  check('体重 130 kg 时 NE 要求更高', E.nutritionCheck(d, 130, fi, C).ne.requirement > c.ne.requirement);
}

console.log('== 4. 氮平衡与排放（IPCC 2019，手工复算，50% 混合、采食 2.41、slurry_nocrust、warm_moist） ==');
{
  const d = E.blendDiets(0.5, C);
  const bw = 99.5, fi = 2.41, adg = 0.9;
  const h = handPerKg(d.recipe);
  const em = E.manureAndEmissions(d, bw, fi, adg, C, 'slurry_nocrust', 'warm_moist');
  const nIntake = h.cp / 6.25 * fi;                  // g N/天
  const nRet = C.manure.n_retention_g_per_kg_gain * adg;
  const nExc = Math.max(0, nIntake - nRet);
  const vs = fi * C.manure.dry_matter_fraction * (1 - C.manure.digestibility) * C.manure.vs_fraction;
  const sys = C.manure.systems.slurry_nocrust, mcf = C.manure.mcf.warm_moist.liquid3m;
  const ch4 = vs * C.manure.b0_m3_ch4_per_kg_vs * 0.67 * mcf;          // kg CH4/天
  const n2oDirect = nExc / 1000 * sys.ef3 * 44 / 28;                  // kg N2O/天（无结壳液态储存 EF3 = 0）
  const n2oInd = (nExc / 1000 * sys.fracGas * C.manure.ef4 + nExc / 1000 * sys.fracLeach * C.manure.ef5) * 44 / 28;
  const feed = h.co2e * fi;
  const total = feed + ch4 * C.manure.gwp.ch4 + (n2oDirect + n2oInd) * C.manure.gwp.n2o;
  check('N 摄入 = CP/6.25 × 采食', approx(em.nIntake, Math.round(nIntake * 10) / 10, 0.06), em.nIntake);
  check('N 保留 = 28 × 0.9 = 25.2 g/天', approx(em.nRetention, 25.2, 0.05), em.nRetention);
  check('N 排泄 = 摄入 − 保留', approx(em.nExcreted, Math.round(nExc * 10) / 10, 0.06), em.nExcreted);
  check('VS = 采食 × 干物质 × (1−消化率) × VS 占比', approx(vs, fi * 0.88 * 0.2 * 0.8, 1e-9));
  check('MCF 取 slurry_nocrust × warm_moist = 0.24', em.mcfUsed === 0.24, em.mcfUsed);
  check('直接 N2O = 0（无结壳液态储存 EF3 = 0）', em.emissions.manureN2oDirect === 0, em.emissions.manureN2oDirect);
  check('间接 N2O > 0（挥发，FracGas 0.48 × EF4 0.010）', em.emissions.manureN2oIndirect > 0 && approx(em.emissions.manureN2oIndirect, Math.round(n2oInd * 273 * 1000) / 1000, 0.002), em.emissions.manureN2oIndirect + ' vs ' + (n2oInd * 273).toFixed(4));
  check('CH4（CO2e）= VS×B0×0.67×MCF×27', approx(em.emissions.manureCh4, Math.round(ch4 * 27 * 1000) / 1000, 0.002), em.emissions.manureCh4 + ' vs ' + (ch4 * 27).toFixed(4));
  check('饲料排放 = 碳排放密度 × 采食', approx(em.emissions.feed, Math.round(feed * 1000) / 1000, 0.002), em.emissions.feed + ' vs ' + feed.toFixed(4));
  check('合计 = 饲料 + CH4 + 直接 N2O + 间接 N2O', approx(em.emissions.total, Math.round(total * 1000) / 1000, 0.003), em.emissions.total + ' vs ' + total.toFixed(4));
  const emLagoon = E.manureAndEmissions(d, bw, fi, adg, C, 'lagoon', 'warm_moist');
  check('厌氧塘 MCF = 0.73，甲烷排放更高', emLagoon.mcfUsed === 0.73 && emLagoon.emissions.manureCh4 > em.emissions.manureCh4, emLagoon.mcfUsed);
  const emCool = E.manureAndEmissions(d, bw, fi, adg, C, 'slurry_nocrust', 'cool_moist');
  check('凉爽湿润 MCF = 0.12，甲烷排放更低', emCool.mcfUsed === 0.12 && emCool.emissions.manureCh4 < em.emissions.manureCh4, emCool.mcfUsed);
}

console.log('== 5. 配比搜索（与手工穷举对照） ==');
const inputOK = { weightKg: 60, feedIntakeKgDay: 2.1, feedWindowDays: 7, headCount: 12, manureSystem: 'slurry_nocrust', climate: 'warm_moist', currentRatioA: 0.5, priceDate: '2026-08' };
{
  const res = E.run(inputOK, C);
  check('BW 60 kg、采食 2.1 kg/天：有可行方案', res.status === 'ok', res.status);
  // 手工穷举 0–100% 网格（步长 0.01），找满足 NE、赖氨酸、CP 的最低价格
  const req = handRequirement(60, 0.9);
  let bestPrice = Infinity, feasibleN = 0;
  for (let k = 0; k <= 100; k++) {
    const rr = k / 100;
    const rec = {};
    Object.keys(base.A.recipe).forEach((key) => { rec[key] = rr * base.A.recipe[key] + (1 - rr) * base.B.recipe[key]; });
    const h = handPerKg(rec);
    const ok = h.ne * 2.1 >= req.ne - 1e-9 && h.lys * 2.1 >= req.lys - 1e-9 && h.cp >= 120;
    if (ok) { feasibleN++; bestPrice = Math.min(bestPrice, h.price); }
  }
  check('手工穷举的可行点数与引擎一致', res.search.feasibleCount === feasibleN, res.search.feasibleCount + ' vs ' + feasibleN);
  check('最低成本候选 = 手工穷举最低价（±0.5 元/吨）', res.status === 'ok' && approx(res.candidates[0].diet.price, bestPrice, 0.6), res.candidates[0].diet.price + ' vs ' + bestPrice.toFixed(2));
  check('候选方案均通过营养检查', res.candidates.every((c) => c.check.ne.pass && c.check.sidLys.pass && c.check.cp.pass));
  check('每头每天成本 = 价格/1000 × 采食', approx(res.candidates[0].costPerHeadDay, res.candidates[0].diet.price / 1000 * 2.1, 0.002), res.candidates[0].costPerHeadDay);
  check('共同条件说明随结果输出', typeof res.commonConditions === 'string' && res.commonConditions.length > 0);
  check('相同输入输出完全一致（确定性）', JSON.stringify(E.run(inputOK, C)) === JSON.stringify(res));
}
{
  const res = E.run({ ...inputOK, weightKg: 36.5, feedIntakeKgDay: 1.4 }, C);
  check('前期猪（36.5 kg）：无可行方案，如实报告', res.status === 'infeasible' && res.conflict.probes.length === 3, res.status);
  check('无解时给出能量冲突与建议（含油脂说明）', res.status === 'infeasible' && /油脂/.test(res.conflict.advice));
  check('无解时不输出“最优配方”', res.candidates === undefined);
}
{
  const res = E.run({ ...inputOK, priceDate: '' }, C);
  check('缺少价格日期：返回 incomplete 并列出缺失项', res.status === 'incomplete' && res.completeness.missing.some((m) => m.field === '价格日期'));
}

console.log('== 6. 群体换算 ==');
{
  const ev = E.evaluate(inputOK, 0.5, C);
  const herd = E.herdTotals(ev, 12);
  check('栏舍成本 = 每头 × 头数（元/天）', approx(herd.costPerDay, Math.round(ev.costPerHeadDay * 12 * 100) / 100, 0.01), herd.costPerDay);
  check('栏舍排放 = 每头 × 头数', approx(herd.emissions.total, Math.round(ev.emissions.total * 12 * 100) / 100, 0.01), herd.emissions.total);
  check('栏舍采食 = 每头 × 头数（kg/天）', approx(herd.feedKgDay, Math.round(ev.feedKgDayUsed * 12 * 10) / 10, 0.06), herd.feedKgDay);
}

console.log('== 7. 单项上限（可行边界） ==');
{
  const ceil = FM.ceilings(C);
  const lo = FM.formulate(C, { ne: 0, lys: ceil.maxLys - 0.05 }, {}), hi = FM.formulate(C, { ne: 0, lys: ceil.maxLys + 0.2 }, {});
  check('赖氨酸：上限以内不放松', lo.status === 'optimal' && lo.lysCapped === false);
  check('赖氨酸：超过上限时如实封顶（lysCapped，用量 ≈ 上限）', hi.lysCapped === true && Math.abs(hi.lysUsed - ceil.maxLys) < 1e-3, hi.lysUsed);
  const nlo = FM.formulate(C, { ne: ceil.maxNE - 0.05, lys: 0 }, {}), nhi = FM.formulate(C, { ne: ceil.maxNE + 0.2, lys: 0 }, {});
  check('能量：上限以内不放松', nlo.status === 'optimal' && nlo.neRelaxed === false);
  check('能量：超过上限时放松（neRelaxed，用量 ≈ 上限）', nhi.neRelaxed === true && Math.abs(nhi.neUsed - ceil.maxNE) < 1e-3, nhi.neUsed);
}

console.log(failures === 0 ? '\n手工算例全部核对通过。' : '\n有 ' + failures + ' 项未通过。');
process.exit(failures === 0 ? 0 : 1);
