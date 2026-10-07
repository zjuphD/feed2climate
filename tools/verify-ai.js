// AI 层核对：LP 求解器基础、配方最优性与约束满足、聚类确定性、Pareto 前沿、情景比较。
// 全部期望值独立手工构造或用暴力枚举对照。
// 用法：node tools/verify-ai.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'app', 'parameters', 'feed2climate-parameters.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'app', 'records.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'app', 'engine.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'app', 'ai.js'), 'utf8'));
const P = global.window.F2C_PARAMETERS;
const E = global.window.F2C_ENGINE;
const AI = global.window.F2C_AI;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name + (detail != null ? ' — 得到 ' + detail : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }
const sum = (a) => a.reduce((s, v) => s + v, 0);
const REC = global.window.F2C_RECORDS;

console.log('== 0. LP 求解器基础（独立可验的小算例） ==');
{
  let s1 = AI.solveLP(2, [{ a: [1, 1], b: 3, type: '>=' }], [1, 1]);
  check('简单下界约束：min x0+x1, x0+x1>=3 → 3', s1.status === 'optimal' && approx(s1.obj, 3, 1e-6), JSON.stringify(s1));

  let s2 = AI.solveLP(2, [
    { a: [1, 1], b: 4, type: '>=' },
    { a: [1, 0], b: 1, type: '<=' },
    { a: [0, 1], b: 5, type: '<=' },
  ], [2, 3]);
  check('混合不等式：→ x=(1,3), obj=11', s2.status === 'optimal' && approx(s2.obj, 11, 1e-6), JSON.stringify(s2));

  let s3 = AI.solveLP(1, [{ a: [1], b: 5, type: '>=' }, { a: [1], b: 5, type: '=' }], [1]);
  check('等式+不等式组合 → 5', s3.status === 'optimal' && approx(s3.obj, 5, 1e-6), JSON.stringify(s3));

  let s4 = AI.solveLP(1, [{ a: [1], b: 5, type: '>=' }, { a: [1], b: 2, type: '<=' }], [1]);
  check('检测不可行', s4.status === 'infeasible', JSON.stringify(s4));

  let s5 = AI.solveLP(1, [], [-1]);
  check('检测无界（min −x，x≥0）', s5.status === 'unbounded', JSON.stringify(s5));

  // 负 rhs 规范化：x0+x1<=-2 应规范化为 -x0-x1>=2 → 无解（x 非负）
  let s6 = AI.solveLP(2, [{ a: [1, 1], b: -2, type: '<=' }], [1, 1]);
  check('负 rhs 自动规范化', s6.status === 'infeasible', JSON.stringify(s6));

  // degenerate：min x0, x0>=1, 2x0>=2 → 1（两约束重复，检验退化处理）
  let s7 = AI.solveLP(1, [{ a: [1], b: 1, type: '>=' }, { a: [2], b: 2, type: '>=' }], [1]);
  check('退化约束 → 1', s7.status === 'optimal' && approx(s7.obj, 1, 1e-6), JSON.stringify(s7));

  // 运输式小算例（人工变量必须被正确清除）：min 2a+3b s.t. a+b=10, a<=6, b<=8
  let s8 = AI.solveLP(2, [{ a: [1, 1], b: 10, type: '=' }, { a: [1, 0], b: 6, type: '<=' }, { a: [0, 1], b: 8, type: '<=' }], [2, 3]);
  check('等式+上限：a=6,b=4 → 24', s8.status === 'optimal' && approx(s8.obj, 24, 1e-6), JSON.stringify(s8));
}

console.log('== 1. 配方 LP：约束满足与最优性（BW 99.5, ADG 0.9, FI 2.41） ==');
{
  const bw = 99.5, adg = 0.9, fi = 2.41;
  const res = AI.dietLP(P, { bw, adg, fi, co2eWeight: 0 });
  check('纯成本 LP 求解成功', res.status === 'optimal', res.status);
  check('配比合计 = 1（±0.001）', approx(sum(Object.values(res.recipe)), 1, 1e-3), sum(Object.values(res.recipe)));
  check('所有原料非负', Object.values(res.recipe).every((v) => v >= -1e-9));
  const pk = res.perKg;
  check('NE 满足（供应 ≥ 要求）', pk.ne * fi >= res.targets.neReq - 0.01, pk.ne * fi + ' vs ' + res.targets.neReq);
  check('Lys 满足', pk.sidLys * fi >= res.targets.lysReq - 0.01, pk.sidLys * fi + ' vs ' + res.targets.lysReq);
  check('CP 下限满足', pk.cp >= res.targets.cpFloor - 1e-6, pk.cp);
  check('豆油 ≤5%、赖氨酸 ≤1%、预混料 ≤0.5%',
    (res.recipe.soy_oil || 0) <= 0.05 + 1e-6 && (res.recipe.l_lysine_hcl || 0) <= 0.01 + 1e-6 && (res.recipe.premix || 0) <= 0.005 + 1e-6,
    JSON.stringify(res.recipe));

  // 最优性对照 1：手工可行配方的成本 ≥ LP 最优值
  const manual = { corn: 0.55, barley: 0.30, soybean_meal: 0.12, rapeseed_meal: 0.02, soy_oil: 0.005, l_lysine_hcl: 0.0025, premix: 0.0025 };
  const manualCost = sum(Object.entries(manual).map(([k, v]) => (P.ingredients[k].price / 1000) * v));
  const manualNE = sum(Object.entries(manual).map(([k, v]) => P.ingredients[k].ne * v)) * fi;
  const manualLys = sum(Object.entries(manual).map(([k, v]) => P.ingredients[k].sidLys * v)) * fi;
  const manualCP = sum(Object.entries(manual).map(([k, v]) => P.ingredients[k].cp * v));
  const neReq = 0.777 * Math.pow(bw, 0.6) + 9.0 * adg;   // 20.38
  const lysReq = 0.036 * Math.pow(bw, 0.75) + 20.0 * adg; // 19.13
  check('手工配方确实可行（前置检查）', manualNE >= neReq && manualLys >= lysReq && manualCP >= 120,
    JSON.stringify({ manualNE, neReq, manualLys, lysReq, manualCP }));
  check('手工可行配方成本 ≥ LP 最优值', manualCost >= res.objectiveValue - 1e-6, manualCost + ' vs ' + res.objectiveValue);

  // 最优性对照 2：随机可行点（拒绝采样）成本均 ≥ LP 最优值
  const rand = AI.mulberry32(123);
  let worst = Infinity, found = 0;
  for (let t = 0; t < 4000; t++) {
    let x = [rand(), rand(), rand(), rand(), rand() * 0.05, rand() * 0.01, 0.0025];
    const s = sum(x) || 1;
    x = x.map((v) => v / s);
    if (x[6] > 0.005) continue;
    const ne = sum(x.map((v, j) => [P.ingredients.corn, P.ingredients.barley, P.ingredients.soybean_meal, P.ingredients.rapeseed_meal, P.ingredients.soy_oil, P.ingredients.l_lysine_hcl, P.ingredients.premix][j].ne * v));
    const lys = sum(x.map((v, j) => [P.ingredients.corn, P.ingredients.barley, P.ingredients.soybean_meal, P.ingredients.rapeseed_meal, P.ingredients.soy_oil, P.ingredients.l_lysine_hcl, P.ingredients.premix][j].sidLys * v));
    if (ne * fi < neReq || lys * fi < lysReq) continue;
    found++;
    const cost = sum(x.map((v, j) => [P.ingredients.corn, P.ingredients.barley, P.ingredients.soybean_meal, P.ingredients.rapeseed_meal, P.ingredients.soy_oil, P.ingredients.l_lysine_hcl, P.ingredients.premix][j].price * v)) / 1000;
    if (cost < worst) worst = cost;
  }
  check('随机采样找到可行点（前置检查）', found > 100, found);
  check('4000 个随机可行点成本均 ≥ LP 最优值', worst >= res.objectiveValue - 1e-6, worst + ' vs ' + res.objectiveValue);

  // 纯排放 LP 与加权单调性
  const resE = AI.dietLP(P, { bw, adg, fi, co2eWeight: 1 });
  check('纯排放 LP 求解成功', resE.status === 'optimal', resE.status);
  check('纯排放解排放 ≤ 纯成本解排放', resE.perKg.feedCo2e <= res.perKg.feedCo2e + 1e-9, resE.perKg.feedCo2e + ' vs ' + res.perKg.feedCo2e);
  const resM = AI.dietLP(P, { bw, adg, fi, co2eWeight: 0.5 });
  check('加权 0.5 的成本在两端点之间', resM.perKg.price / 1000 >= res.perKg.price / 1000 - 1e-6 && resM.perKg.price / 1000 <= resE.perKg.price / 1000 + 1e-6,
    resM.perKg.price + ' vs [' + res.perKg.price + ', ' + resE.perKg.price + ']');
  check('加权 0.5 的排放 ≤ 纯成本解排放', resM.perKg.feedCo2e <= res.perKg.feedCo2e + 1e-9, resM.perKg.feedCo2e + ' vs ' + res.perKg.feedCo2e);

  // 极端要求 → 不可行
  const bad = AI.dietLP(P, { bw: 200, adg: 1.1, fi: 0.5, co2eWeight: 0 });
  check('极端要求检测为不可行', bad.status === 'infeasible', bad.status);
}

console.log('== 2. k-means 聚类确定性 ==');
{
  // 合成数据：两团 + 一离群
  const rand = AI.mulberry32(9);
  const X = [];
  for (let i = 0; i < 30; i++) X.push([0 + rand() * 0.4, 0 + rand() * 0.4]);
  for (let i = 0; i < 30; i++) X.push([4 + rand() * 0.4, 4 + rand() * 0.4]);
  X.push([10, 10]);
  const km1 = AI.kmeans(X, 2, 42);
  const km2 = AI.kmeans(X, 2, 42);
  check('同种子两次结果一致', JSON.stringify(km1.assign) === JSON.stringify(km2.assign) && km1.inertia === km2.inertia);
  check('两团分开（前 30 与后 30 不同簇）', new Set(km1.assign.slice(0, 30)).size === 1 && new Set(km1.assign.slice(30, 60)).size === 1 && km1.assign[0] !== km1.assign[30]);
  const km3 = AI.kmeans(X, 2, 999);
  check('不同种子惯性不更差（重启机制）', km3.inertia >= km1.inertia - 1e-9, km3.inertia + ' vs ' + km1.inertia);
  const std = AI.standardize(X);
  const col0 = std.data.map((x) => x[0]);
  const m0 = sum(col0) / col0.length;
  const sd0 = Math.sqrt(sum(col0.map((v) => v * v)) / col0.length);
  check('标准化后列均值≈0、标准差≈1', approx(m0, 0, 1e-9) && approx(sd0, 1, 1e-9), m0 + '/' + sd0);
}

console.log('== 3. 情景比较（真实数据，截至第 42 天，默认均值+5%边际口径） ==');
{
  if (!REC) { check('需要 records（先运行 tools/prepare-records.js）', false); }
  else {
    const sc = AI.scenarioCompare(REC, 42, P, { k: 3, seed: 42 });
    check('状态 ok', sc.status === 'ok', sc.status);
    check('口径为均值+5%边际', sc.requirementMode === 'mean_margin' && sc.margin === 0.05);
    check('分组头数合计 = 100', sc.groups.reduce((s, g) => s + g.n, 0) === 100, sc.groups.map((g) => g.n).join(','));
    check('每头都有簇标签', sc.pigs.length === 100 && sc.pigs.every((p) => p.cluster >= 0));
    check('组按目标 ADG 降序命名', sc.groups.every((g, i) => i === 0 || g.meanADG <= sc.groups[i - 1].meanADG));
    check('组 LP 全部最优', sc.groups.every((g) => g.lp.status === 'optimal'), sc.groups.map((g) => g.lp.status).join(','));
    check('一刀切 LP 最优', sc.uniform.lp.status === 'optimal', sc.uniform.lp.status);
    check('均值+边际约束 ≤ 可达上限', sc.uniformTarget.ne <= sc.ceilings.maxNE && sc.uniformTarget.lys <= sc.ceilings.maxLys,
      JSON.stringify({ target: sc.uniformTarget, ceilings: sc.ceilings }));
    // 满足率在 [0,1]，且分层加权满足率不比一刀切差太多（分组本应更贴合个体）
    check('满足率定义并落在此 [0,1]', sc.groups.every((g) => g.satisfaction >= 0 && g.satisfaction <= 1) && sc.uniform.satisfaction >= 0 && sc.uniform.satisfaction <= 1,
      JSON.stringify(sc.groups.map((g) => g.satisfaction)) + ' vs ' + sc.uniform.satisfaction);
    const weightedSat = sc.groups.reduce((s, g) => s + g.n * g.satisfaction, 0) / 100;
    check('分层加权满足率 ≥ 一刀切 − 0.05', weightedSat >= sc.uniform.satisfaction - 0.05, weightedSat + ' vs ' + sc.uniform.satisfaction);
    // 成本单调性：仅当组目标 ≤ 全群目标时，组配方才应不贵于一刀切配方（LP 值对约束单调）
    check('组目标 ≤ 全群目标时组配方成本 ≤ 一刀切', sc.groups.every((g) =>
      (g.meanNePerFI * (1 + sc.margin) > sc.uniformTarget.ne + 1e-9 && g.meanLysPerFI * (1 + sc.margin) > sc.uniformTarget.lys + 1e-9)
      || g.lp.perKg.price <= sc.uniform.lp.perKg.price + 0.01),
      JSON.stringify(sc.groups.map((g) => [g.meanNePerFI, g.lp.perKg.price])) + ' vs ' + sc.uniform.lp.perKg.price);
    // 公平性与自洽
    check('差异只来自配方（口径声明存在）', typeof sc.method.compareBasis === 'string');
    const d = sc.delta;
    check('成本差自洽', approx(d.costPerDay, Math.round((sc.totals.grouped.costPerDay - sc.totals.uniform.costPerDay) * 100) / 100, 0.011), JSON.stringify(d));
    check('排放差自洽', approx(d.emissionsPerDay, Math.round((sc.totals.grouped.emissionsPerDay - sc.totals.uniform.emissionsPerDay) * 100) / 100, 0.011), JSON.stringify(d));
    check('栏舍头数 = 100', sc.totals.grouped.headCount === 100 && sc.totals.uniform.headCount === 100);
    // 确定性
    const sc2 = AI.scenarioCompare(REC, 42, P, { k: 3, seed: 42 });
    check('相同输入两次运行完全一致', JSON.stringify(sc2) === JSON.stringify(sc));
    const sc3 = AI.scenarioCompare(REC, 42, P, { k: 3, seed: 7 });
    check('不同种子聚类结果（几乎必然）不同', JSON.stringify(sc3.pigs.map((p) => p.cluster)) !== JSON.stringify(sc.pigs.map((p) => p.cluster)));
    // k=1：分层与一刀切用同一目标 → 差异为 0
    const scK1 = AI.scenarioCompare(REC, 42, P, { k: 1, seed: 42 });
    check('k=1 时分层=一刀切（差异为 0）', scK1.status === 'ok' && Math.abs(scK1.delta.costPerDay) < 0.01 && Math.abs(scK1.delta.emissionsPerDay) < 0.01,
      JSON.stringify(scK1.delta));

    // 保守口径：覆盖最严格个体。若超出可达上限，必须如实报告无解并给出上限
    const scStrict = AI.scenarioCompare(REC, 42, P, { k: 3, seed: 42, requirementMode: 'strict' });
    if (scStrict.uniform.lp.status !== 'optimal') {
      check('保守口径无解时如实报告 partial', scStrict.status === 'partial', scStrict.status);
      check('报告可达上限', scStrict.ceilings.maxNE > 0 && scStrict.ceilings.maxLys > 0, JSON.stringify(scStrict.ceilings));
      check('无解原因可解释（目标超出可达上限）', scStrict.uniformTarget.ne > scStrict.ceilings.maxNE || scStrict.uniformTarget.lys > scStrict.ceilings.maxLys,
        JSON.stringify({ target: scStrict.uniformTarget, ceilings: scStrict.ceilings }));
    } else {
      check('保守口径有解时状态 ok', scStrict.status === 'ok', scStrict.status);
    }
    console.log('  ℹ 默认口径：分层加权满足率 ' + (weightedSat * 100).toFixed(1) + '%，一刀切 ' + (sc.uniform.satisfaction * 100).toFixed(1) + '%；'
      + '成本差 ' + d.costPerDay + ' €/天，排放差 ' + d.emissionsPerDay + ' kg CO₂e/天');
  }
}

console.log('== 4. Pareto 前沿 ==');
{
  const pf = AI.paretoFront(P, { bw: 99.5, adg: 0.9, fi: 2.41, steps: 11 });
  check('前沿点 ≥ 2 个', pf.front.length >= 2, pf.front.length);
  const costs = pf.front.map((p) => p.costPerKg), ems = pf.front.map((p) => p.co2ePerKg);
  check('前沿按成本升序', costs.every((v, i) => i === 0 || v >= costs[i - 1] - 1e-9));
  check('前沿成本单调不降', costs.every((v, i) => i === 0 || v >= costs[i - 1] - 1e-9));
  check('前沿排放单调不增', ems.every((v, i) => i === 0 || v <= ems[i - 1] + 1e-9));
  check('前端点 = 纯成本解，尾端点 = 纯排放解', approx(costs[0], pf.all[0].costPerKg, 1e-6) && approx(ems[ems.length - 1], pf.all[pf.all.length - 1].co2ePerKg, 1e-6));
}

console.log(failures === 0 ? '\nAI 层全部核对通过。' : '\n有 ' + failures + ' 项核对失败。');
process.exit(failures === 0 ? 0 : 1);
