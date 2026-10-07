// 手工算例核对：在 Node 中加载 engine.js / parameters，逐项验证计算。
// 全部期望值按 parameters v2（原料表 + 配方质量占比）独立手工复算。
// 用法：node tools/verify-calc.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 模拟浏览器 window
global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'app', 'parameters', 'feed2climate-parameters.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'app', 'engine.js'), 'utf8'));
const P = global.window.F2C_PARAMETERS;
const E = global.window.F2C_ENGINE;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name + (detail != null ? ' — 得到 ' + detail : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }
function sumRecipe(rec) { return Object.keys(rec).reduce((s, k) => s + rec[k], 0); }

console.log('== 0. 参数文件完整性 ==');
{
  check('A 配方质量占比合计 = 1', approx(sumRecipe(P.diets.A.recipe), 1, 1e-9), sumRecipe(P.diets.A.recipe));
  check('B 配方质量占比合计 = 1', approx(sumRecipe(P.diets.B.recipe), 1, 1e-9), sumRecipe(P.diets.B.recipe));
  const both = [P.diets.A.recipe, P.diets.B.recipe];
  check('两配方原料键一致', JSON.stringify(Object.keys(both[0]).sort()) === JSON.stringify(Object.keys(both[1]).sort()));
  const keys = Object.keys(both[0]);
  check('配方引用的原料都在原料表中', keys.every((k) => P.ingredients[k]));
  check('维持 NE 系数 = 1.05×0.74 = 0.777', approx(P.energy.maintenance_coefficient * P.energy.maintenance_net_availability, 0.777, 1e-9));
}

console.log('== 1. 配方加权混合（手工复算） ==');
{
  // A: ne = .25×8.2+.05×6.6+.4925×10.6+.192×9.5+.01×28.5 = 9.7095
  //    lys = .25×28.7+.05×16.8+.4925×2.4+.192×3.2+.003×788 = 12.1754
  //    cp = .25×460+.05×350+.4925×85+.192×105 = 194.5225
  //    co2e = .25×.95+.05×.35+.4925×.38+.192×.40+.01×1.6+.003×3+.0025×3 = 0.55145
  //    price = .25×351+.05×220+.4925×190+.192×180+.01×800+.003×2000+.0025×2500 = 247.135
  // B: ne = .04×8.2+.03×6.6+.30×10.6+.624×9.5+.003×28.5 = 9.7195
  //    lys = .04×28.7+.03×16.8+.30×2.4+.624×3.2+.0005×788 = 4.7628
  //    cp = .04×460+.03×350+.30×85+.624×105 = 119.92
  //    co2e = .4259；price = .04×351+.03×220+.30×190+.624×180+.003×800+.0005×2000+.0025×2500 = 199.61
  const d1 = E.blendDiets(1, P);
  check('A 料 NE = 9.7095（引擎保留 3 位）', approx(d1.ne, 9.7095, 0.002), d1.ne);
  check('A 料 SID Lys = 12.1754', approx(d1.sidLys, 12.1754, 5e-3), d1.sidLys);
  check('A 料 CP = 194.5', approx(d1.cp, 194.5225, 0.06), d1.cp);
  check('A 料 feed CO2e = 0.55145', approx(d1.feedCo2e, 0.55145, 1e-4), d1.feedCo2e);
  check('A 料价格 = 247.135 €/t', approx(d1.price, 247.135, 0.02), d1.price);
  const d0 = E.blendDiets(0, P);
  check('B 料 NE = 9.7195（引擎保留 3 位）', approx(d0.ne, 9.7195, 0.002), d0.ne);
  check('B 料 SID Lys = 4.7628', approx(d0.sidLys, 4.7628, 5e-3), d0.sidLys);
  check('B 料 CP = 119.9', approx(d0.cp, 119.92, 0.06), d0.cp);
  check('B 料 feed CO2e = 0.4259', approx(d0.feedCo2e, 0.4259, 1e-4), d0.feedCo2e);
  check('B 料价格 = 199.61 €/t', approx(d0.price, 199.61, 0.02), d0.price);
  const d = E.blendDiets(0.5, P);
  check('50% 混合 NE = (9.7095+9.7195)/2 = 9.7145', approx(d.ne, 9.7145, 0.002), d.ne);
  check('50% 混合 SID Lys = (12.1754+4.7628)/2 = 8.4691', approx(d.sidLys, 8.4691, 0.005), d.sidLys);
  check('50% 混合 CP = 157.2', approx(d.cp, 157.22125, 0.06), d.cp);
  check('N 含量 = CP/6.25 = 25.16', approx(d.nG, 25.1554, 0.01), d.nG);
  check('50% 混合价格 = 223.37 €/t', approx(d.price, 223.3725, 0.02), d.price);
  check('50% 混合 feed CO2e = 0.4887', approx(d.feedCo2e, 0.488675, 1e-4), d.feedCo2e);
  check('50% 混合玉米占比 = (0.4925+0.30)/2 = 0.39625', approx(d.recipe.corn, 0.39625, 1e-5), d.recipe.corn);
  check('50% 混合大麦占比 = (0.192+0.624)/2 = 0.408', approx(d.recipe.barley, 0.408, 1e-5), d.recipe.barley);
  check('混合后配方占比合计仍 = 1', approx(sumRecipe(d.recipe), 1, 1e-4), sumRecipe(d.recipe));
}

console.log('== 2. 营养供需检查（手工复算，BW 99.5 kg、采食 2.41 kg/天） ==');
{
  const d = E.blendDiets(0.5, P);
  const bw = 99.5, fi = 2.41;
  const c = E.nutritionCheck(d, bw, fi, P);
  const adg = P.mechanism.adg_kg_day; // 0.90
  // NE 要求 = 0.777×BW^0.6 + 9.0×ADG = 0.777×15.8013 + 8.1 = 20.38
  const neReq = 1.05 * 0.74 * Math.pow(bw, 0.6) + 9.0 * adg;
  // Lys 要求 = 0.036×BW^0.75 + 20×ADG = 0.036×31.504 + 18 = 19.13
  const lysReq = 0.036 * Math.pow(bw, 0.75) + 20.0 * adg;
  check('NE 要求 = 0.777×BW^0.6 + 9×ADG ≈ 20.38', approx(c.ne.requirement, neReq, 0.01) && approx(c.ne.requirement, 20.38, 0.02), c.ne.requirement + ' vs ' + neReq.toFixed(3));
  check('NE 供应 = 9.7145×2.41 = 23.41', approx(c.ne.supply, 9.7145 * fi, 0.01), c.ne.supply);
  check('NE 满足', c.ne.pass === true);
  check('Lys 要求 = 0.036×BW^0.75 + 20×ADG ≈ 19.1', approx(c.sidLys.requirement, lysReq, 0.06) && approx(c.sidLys.requirement, 19.13, 0.1), c.sidLys.requirement + ' vs ' + lysReq.toFixed(3));
  check('Lys 供应 = 8.4691×2.41 = 20.41', approx(c.sidLys.supply, 8.4691 * fi, 0.06), c.sidLys.supply);
  check('Lys 满足', c.sidLys.pass === true);
  check('CP 供应 = 157.2（取整 157），下限 120，满足', c.cp.supply === 157 && c.cp.requirement === 120 && c.cp.margin === 37 && c.cp.pass === true, JSON.stringify(c.cp));
  check('要求公式说明存在', typeof c.ne.formula === 'string' && c.ne.formula.length > 0 && typeof c.sidLys.formula === 'string');
  // BW 变化敏感性：体重更大 → 要求更高
  const c130 = E.nutritionCheck(d, 130, fi, P);
  check('体重 130 时 NE 要求更高', c130.ne.requirement > c.ne.requirement, c130.ne.requirement);
}

console.log('== 3. 氮平衡与粪污排放（手工复算，50% 混合、采食 2.41、slurry/temperate） ==');
{
  const d = E.blendDiets(0.5, P);
  const bw = 99.5, fi = 2.41, adg = 0.90;
  const em = E.manureAndEmissions(d, bw, fi, adg, P, 'slurry', 'temperate');
  const nIntake = 25.1554 * fi;      // g N/天 = 60.62
  const nRet = 28 * adg;             // 25.2
  const nExc = nIntake - nRet;       // 35.42
  const vs = fi * 0.88 * (1 - 0.80) * 0.8; // 2.41×0.88×0.16 = 0.339328
  const ch4 = vs * 0.45 * 0.67 * 0.30;     // kg/天
  const n2o = nExc / 1000 * 0.005 * 44 / 28; // kg/天
  check('N 摄入 = 25.1554×2.41 = 60.6 g/天', approx(em.nIntake, Math.round(nIntake * 10) / 10, 0.06), em.nIntake);
  check('N 保留 = 28×0.9 = 25.2 g/天', approx(em.nRetention, 25.2, 0.05), em.nRetention);
  check('N 排泄 = 摄入−保留 = 35.4', approx(em.nExcreted, Math.round(nExc * 10) / 10, 0.06), em.nExcreted);
  check('尿氮/粪氮 = 35%/65%', approx(em.nUrine, nExc * 0.35, 0.06) && approx(em.nFaeces, nExc * 0.65, 0.06), em.nUrine + '/' + em.nFaeces);
  check('VS = 2.41×0.88×0.16 = 0.3393 kg/天', approx(em.vsKgDay, 0.339328, 1e-3), em.vsKgDay);
  check('CH4 = VS×B0×0.67×MCF = 0.0307 kg/天', approx(em.ch4KgDay, 0.0306922, 1e-4), em.ch4KgDay);
  check('N2O = N排泄×EF3×44/28（引擎保留 5 位）', approx(em.n2oKgDay, 0.00027833, 5e-6), em.n2oKgDay);
  check('MCF 取温带 slurry 0.30', em.mcfUsed === 0.30, em.mcfUsed);
  const total = d.feedCo2e * fi + ch4 * 27 + n2o * 273;
  check('排放合计 = 饲料 + CH4×27 + N2O×273 ≈ 2.082', approx(em.emissions.total, total, 0.01) && approx(em.emissions.total, 2.082, 0.005), em.emissions.total + ' vs ' + total.toFixed(4));
  check('分项：饲料 1.178 / CH4 0.829 / N2O 0.076', em.emissions.feed === 1.178 && em.emissions.manureCh4 === 0.829 && em.emissions.manureN2o === 0.076, JSON.stringify(em.emissions));
  const emLagoon = E.manureAndEmissions(d, bw, fi, adg, P, 'lagoon', 'temperate');
  check('厌氧塘 MCF = 0.65 → CH4 更高', emLagoon.mcfUsed === 0.65 && emLagoon.ch4KgDay > em.ch4KgDay);
  const emCool = E.manureAndEmissions(d, bw, fi, adg, P, 'slurry', 'cool');
  check('凉爽 MCF = 0.20 → CH4 更低', emCool.mcfUsed === 0.20 && emCool.ch4KgDay < em.ch4KgDay);
  // 干物质占比改从参数文件读取
  const P2 = JSON.parse(JSON.stringify(P));
  P2.manure.dry_matter_fraction = 0.90;
  const emDM = E.manureAndEmissions(d, bw, fi, adg, P2, 'slurry', 'temperate');
  check('干物质占比来自参数（0.90 → VS = 0.3470）', approx(emDM.vsKgDay, 0.34704, 1e-4), emDM.vsKgDay);
  // CH4 只依赖 VS（采食），不随配比变化；N2O 随 N 排泄变化
  const d43 = E.blendDiets(0.43, P);
  const em43 = E.manureAndEmissions(d43, bw, fi, adg, P, 'slurry', 'temperate');
  check('CH4 不随配比变化（VS 相同）', approx(em43.ch4KgDay, em.ch4KgDay, 1e-9), em43.ch4KgDay);
  check('N2O 随 N 排泄减少而降低（0.43 混合）', em43.emissions.manureN2o < em.emissions.manureN2o, em43.emissions.manureN2o);
}

console.log('== 4. 可行性搜索与候选（默认情景：BW 99.5、采食 2.41） ==');
{
  const input = { weightKg: 99.5, feedIntakeKgDay: 2.41, feedWindowDays: 7, headCount: 100, currentRatioA: 0.5, manureSystem: 'slurry', climate: 'temperate', priceDate: '2026-09-29' };
  const res = E.run(input, P);
  check('状态 ok', res.status === 'ok', res.status);
  check('网格尝试 101 个配比', res.search.attempted === 101, res.search.attempted);
  // 手工推导：NE 全域满足；Lys ≥ 0.43；CP 除 a=0 外满足 → 可行域 0.43–1.00 = 58 个网格点
  check('可行解 58 个（A 43–100%）', res.search.feasibleCount === 58, res.search.feasibleCount);
  check('当前方案（50%）包含在评估内', res.current.ratioA === 0.5);
  // 成本与排放都随 A 单调上升 → 最优点同为 43%，只输出一个候选
  check('成本/排放最优同为 43%，单一候选', res.candidates.length === 1 && res.candidates[0].ratioA === 0.43, res.candidates.map((c) => c.ratioA).join(','));
  const cand = res.candidates[0];
  const chk = E.nutritionCheck(cand.diet, 99.5, 2.41, P);
  check('候选满足全部约束', chk.ne.pass && chk.sidLys.pass && chk.cp.pass);
  check('候选价格 = 199.61+47.525×0.43 = 220.05 €/t', approx(cand.diet.price, 220.04575, 0.02), cand.diet.price);
  check('候选成本 = 0.530 €/头/天', approx(cand.costPerHeadDay, 220.04575 / 1000 * 2.41, 0.002), cand.costPerHeadDay);
  check('当前成本 = 0.538 €/头/天', approx(res.current.costPerHeadDay, 223.3725 / 1000 * 2.41, 0.002), res.current.costPerHeadDay);
  check('候选排放合计 = 2.057', approx(cand.emissions.total, 2.057, 0.005), cand.emissions.total);
  check('当前排放合计 = 2.082', approx(res.current.emissions.total, 2.082, 0.005), res.current.emissions.total);
  check('候选排放更低（−0.025）', approx(cand.emissions.total - res.current.emissions.total, -0.025, 0.01), cand.emissions.total - res.current.emissions.total);
  check('候选饲料排放更低、粪污 N2O 更低', cand.emissions.feed < res.current.emissions.feed && cand.emissions.manureN2o < res.current.emissions.manureN2o);
  check('粪污 CH4 两方案相同', cand.emissions.manureCh4 === res.current.emissions.manureCh4);
}

console.log('== 5. 群体换算（100 头） ==');
{
  const input = { weightKg: 99.5, feedIntakeKgDay: 2.41, feedWindowDays: 7, headCount: 100, currentRatioA: 0.5, manureSystem: 'slurry', climate: 'temperate', priceDate: '2026-09-29' };
  const res = E.run(input, P);
  const hC = E.herdTotals(res.current, 100);
  const hK = E.herdTotals(res.candidates[0], 100);
  check('头数回显', hC.headCount === 100 && hK.headCount === 100);
  check('栏舍日耗料 = 2.41×100/1000 = 0.241 t/天', approx(hK.feedTonnesDay, 0.241, 1e-6), hK.feedTonnesDay);
  check('候选栏舍成本 = 0.530×100 = 53 €/天', approx(hK.costPerDay, 53, 0.02), hK.costPerDay);
  check('当前栏舍成本 = 53.8 €/天', approx(hC.costPerDay, 53.8, 0.02), hC.costPerDay);
  check('候选栏舍 N 排泄 = 33.4/1000×100 = 3.34 kg/天', approx(hK.nExcretedKgDay, 3.34, 0.02), hK.nExcretedKgDay);
  check('候选栏舍排放合计 = 2.057×100 = 205.7 kg CO2e/天', approx(hK.emissions.total, 205.7, 0.1), hK.emissions.total);
  // 线性：群体 = 每头 × 头数
  check('线性换算：群体排放 = 每头×100', approx(hC.emissions.total, res.current.emissions.total * 100, 0.02), hC.emissions.total);
  const h1 = E.herdTotals(res.current, 1);
  const h250 = E.herdTotals(res.current, 250);
  check('头数 250 与 1 的结果成比例', approx(h250.emissions.total, h1.emissions.total * 250, 0.6), h250.emissions.total);
}

console.log('== 6. 无可行方案与缺失输入 ==');
{
  // BW 130、采食 0.8：NE 供应上限 9.7195×0.8 = 7.78 << 要求 22.51 → 无解
  const input = { weightKg: 130, feedIntakeKgDay: 0.8, feedWindowDays: 7, headCount: 100, currentRatioA: 0.5, manureSystem: 'slurry', climate: 'temperate', priceDate: '2026-09-29' };
  const res = E.run(input, P);
  check('状态 infeasible', res.status === 'infeasible', res.status);
  check('给出冲突消息', typeof res.conflict.message === 'string' && res.conflict.message.length > 0);
  check('给出 0/50/100% 探针', res.conflict.probes.length === 3 && res.conflict.probes.every((p) => typeof p.nePass === 'boolean'));
  check('探针显示赖氨酸全不满足（0.8 kg 采食）', res.conflict.probes.every((p) => p.lysPass === false));
  // 缺失输入
  const bad = E.run({ weightKg: 0 }, P);
  check('缺输入时状态 incomplete', bad.status === 'incomplete');
  check('缺输入列出缺失字段', bad.completeness.missing.length >= 5);
}

console.log('== 7. 确定性：相同输入 → 相同输出 ==');
{
  const input = { weightKg: 99.5, feedIntakeKgDay: 2.41, feedWindowDays: 7, headCount: 100, currentRatioA: 0.5, manureSystem: 'slurry', climate: 'temperate', priceDate: '2026-09-29' };
  const a = JSON.stringify(E.run(input, P));
  const b = JSON.stringify(E.run(input, P));
  check('两次运行输出完全一致', a === b);
  const e1 = E.evaluate(input, 0.5, P);
  const e2 = E.evaluate(input, 0.5, P);
  check('同配方重复评估差异为零', JSON.stringify(e1) === JSON.stringify(e2));
  check('评估返回所用采食量', e1.feedKgDayUsed === 2.41, e1.feedKgDayUsed);
}

console.log(failures === 0 ? '\n全部核对通过。' : '\n有 ' + failures + ' 项核对失败。');
process.exit(failures === 0 ? 0 : 1);
