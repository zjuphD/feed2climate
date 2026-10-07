// 回放评估：13 批猪逐批留出（用其余 12 批当历史数据学群体规律），只用“当时看得到的数据”排饲料浓度，
// 再用完整逐头数据当标准答案逐头逐日打分。两类做法：
//   按批（不加硬件，同一栏吃同一种料）：P0 三阶段（现行）、P1 每周按日龄查表、P2 每周简单外推、P3 每周 AI、P4 每周事后真值（上限）
//   逐头（需要个体精准饲喂站）：      I2 逐头逐日滚动估计、I3 逐头逐日 AI、I4 逐头逐日事后真值（上限）
// 公平起见：能量浓度各做法一律按标准表，只比较蛋白（SID 赖氨酸）上的决定；营养不足按赖氨酸计（供给 < 需要的 97%）。
// 每种做法只有一个旋钮：安全余量 m（赖氨酸浓度 = 预测需要 × (1+m)）。把“营养不足的猪日”对齐到同一水平再比较。
// 用法：node tools/replay-eval.js [--reps 30] [--lead 3] [--weigh 1,22,43,64] [--json out.json]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-parameters.js', 'parameters/feed2climate-china.js', 'records.js', 'engine.js', 'ai.js', 'forecast.js', 'formulation.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const P = global.window.F2C_PARAMETERS;
const E = global.window.F2C_ENGINE;
const AI = global.window.F2C_AI;
const F = global.window.F2C_FORECAST;
const C = global.window.F2C_CHINA;
const FM = global.window.F2C_FORMULATION;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const REPS = Number(arg('reps', 30));
const LEGACY = argv.includes('--legacy');       // 旧引擎：原参数文件（欧元、粗蛋白下限 120 g/kg、只约束赖氨酸）
const SYSTEM = arg('system', 'slurry_nocrust');  // 粪污储存方式（IPCC 2019）
const CLIMATE = arg('climate', 'warm_moist');
const SBM = arg('sbm', 'mid');                   // 豆粕碳排放情景：low / mid / high（毁林）
const LAST = F.DEFAULTS.lastDay;
const BATCH_OPTS = {
  leadDays: Number(arg('lead', F.DEFAULTS.leadDays)),
  weighDays: arg('weigh', null) ? arg('weigh').split(',').map(Number) : F.DEFAULTS.weighDays,
};
// 逐头：个体饲喂站每天记录体重（秤的中位数）和采食；不额外加噪声；当天的料用前一天为止的数据定
const PIG_OPTS = {
  weighDays: Array.from({ length: LAST }, (_, k) => k + 1), weekLen: 1, leadDays: 0,
  weighCV: 0.012, feedCV: 0.10, addWeighCV: 0, addFeedCV: 0,
};
const TARGETS = [0.10, 0.15, 0.20];  // 营养不足猪日的比较水平（主结论用 10%）
const MAIN_TARGET = 0.10;
const TOL = 0.97;
const MARGINS = [];
for (let m = -0.20; m <= 0.8001; m += 0.01) MARGINS.push(Math.round(m * 100) / 100);
// “预测分位”做法的旋钮是 z：赖氨酸浓度 = 预测值 + z × 预测标准差（每个猪日的余量随不确定度变化）
const ZS = [];
for (let z = -1; z <= 12.0001; z += 0.1) ZS.push(Math.round(z * 100) / 100);
const gridOf = (spec) => (spec[0][0][0].sd != null ? ZS : MARGINS);

const POLICIES = [
  { id: 'P0', name: '三阶段（现行）', level: 'batch' },
  { id: 'P1', name: '每周·按日龄查表', level: 'batch' },
  { id: 'P2', name: '每周·简单外推', level: 'batch' },
  { id: 'P3', name: '每周·AI 预测', level: 'batch' },
  { id: 'P3u', name: '每周·AI 预测分位', level: 'batch' },
  { id: 'P4', name: '每周·事后真值', level: 'batch' },
  { id: 'I2', name: '逐头逐日·滚动估计', level: 'pig' },
  { id: 'I3', name: '逐头逐日·AI 预测', level: 'pig' },
  { id: 'I3u', name: '逐头逐日·AI 预测分位', level: 'pig' },
  { id: 'I4', name: '逐头逐日·事后真值', level: 'pig' },
];
const PHASES = [1, 26, 51]; // 三阶段：第 1–25、26–50、51–69 天

// ---------- 数据 ----------
const batches = F.groupBatches(global.window.F2C_RECORDS, LAST);
const truths = batches.map((b) => F.truthBatch(b, P));
const weeks = F.decisionWeeks(BATCH_OPTS);

// ---------- 配方：按目标浓度求最低成本配方（NE 取 0.05、赖氨酸向上取 0.02 后缓存） ----------
// 国内情景：玉米–豆粕 + 合成氨基酸、理想蛋白比例（formulation.js）；能量达不到时只放松能量。
// --legacy：旧引擎（原参数文件），超出可达上限时等比例降到可行。
const ceil = AI.maxAchievablePerKg(P);
const dietCache = new Map();
function dietFor(ne, lys) {
  const n0 = Math.round(ne / 0.05) * 0.05;
  const l0 = Math.ceil(lys / 0.02) * 0.02;
  const key0 = n0.toFixed(2) + '|' + l0.toFixed(2);
  if (dietCache.has(key0)) return dietCache.get(key0);
  let found = null;
  if (!LEGACY) {
    const r = FM.formulate(C, { ne: n0, lys: l0 }, { sbmScenario: SBM });
    if (r.status === 'optimal') found = { lys: r.perKg.lys, ne: r.perKg.ne, cp: r.perKg.cp, nG: r.perKg.nG, price: r.perKg.price, co2e: r.perKg.co2e, sbm: r.recipe.sbm };
  } else {
    const nn = Math.min(n0, ceil.maxNE * 0.999), ll = Math.min(l0, ceil.maxLys * 0.999);
    for (let s = 1; s > 0.5 && !found; s -= 0.005) {
      const res = AI.dietLP(P, { neReqPerKg: nn * s, lysReqPerKg: ll * s, co2eWeight: 0 });
      if (res.status === 'optimal') { const d = res.perKg; found = { lys: d.sidLys, ne: d.ne, cp: d.cp, nG: d.nG, price: d.price / 1000, co2e: d.feedCo2e, sbm: res.recipe.soybean_meal }; }
    }
  }
  if (!found) throw new Error('找不到可行配方: ' + ne + ' ' + lys);
  dietCache.set(key0, found);
  return found;
}
function emissions(d, x) {
  if (!LEGACY) {
    const a = FM.account(C, d, x, { system: SYSTEM, climate: CLIMATE });
    return { total: a.total, feed: a.feed, n2o: a.n2oDirect + a.n2oIndirect, nEx: a.nExcreted };
  }
  const em = E.manureAndEmissions({ nG: d.nG, feedCo2e: d.co2e }, x.bw, x.fi, x.adg, P, 'slurry', 'temperate');
  return { total: em.emissions.total, feed: em.emissions.feed, n2o: em.emissions.manureN2o, nEx: em.nExcreted };
}

// ---------- 规格表：specs[policy][批 i][头 p][第 t 天 − 1] = { ne, lys }（未加余量） ----------
const emptySpecs = () => batches.map((b) => b.pigs.map(() => new Array(LAST)));
function fillWeek(arr, i, wk, spec) { for (const pigArr of arr[i]) for (let t = wk.start; t <= wk.end; t++) pigArr[t - 1] = spec; }

const accBatch = { P1: [], P2: [], P3: [] };
function planBatch(obsAll) {
  const specs = { P0: emptySpecs(), P1: emptySpecs(), P2: emptySpecs(), P3: emptySpecs(), P3u: emptySpecs(), P4: emptySpecs() };
  const neByFold = [];
  batches.forEach((b, i) => {
    const pop = F.fitPopulation(obsAll.filter((_, j) => j !== i), P, BATCH_OPTS);
    neByFold[i] = pop.table.map((r) => r.ne);
    const tr = truths[i].days;
    const phaseLys = PHASES.map((d) => pop.table[d - 1].lys);
    for (const wk of weeks) {
      const t = wk.target, tt = tr[t - 1];
      const ne = pop.table[t - 1].ne; // 能量浓度一律按标准表
      const f1 = F.tableForecast(pop, P, t, BATCH_OPTS);
      const f2 = F.simpleForecast(obsAll[i], pop, P, wk.cutoff, t, BATCH_OPTS);
      const f3 = F.aiForecast(obsAll[i], pop, P, wk.cutoff, t, BATCH_OPTS);
      fillWeek(specs.P0, i, wk, { ne, lys: phaseLys[PHASES.filter((d) => d <= wk.start).length - 1] });
      fillWeek(specs.P1, i, wk, { ne, lys: f1.lys });
      fillWeek(specs.P2, i, wk, { ne, lys: f2.lys });
      fillWeek(specs.P3, i, wk, { ne, lys: f3.lys });
      fillWeek(specs.P3u, i, wk, { ne, lys: f3.lys, sd: f3.sdLys });
      fillWeek(specs.P4, i, wk, { ne, lys: tt.lys });
      for (const [id, f] of [['P1', f1], ['P2', f2], ['P3', f3]]) {
        accBatch[id].push({ week: wk.start, bwRel: f.bw / tt.bw - 1, fiRel: f.fi / tt.fi - 1, adgRel: f.adg / tt.adg - 1, lysRel: f.lys / tt.lys - 1 });
      }
    }
  });
  return { specs, neByFold };
}

// 逐头规格不受观测噪声影响（不额外加噪声），只算一次。能量浓度用对应批次留出时的标准表（与按批做法一致）。
const accPig = { I2: [], I3: [] };
function planPig(neByFold) {
  const specs = { I2: emptySpecs(), I3: emptySpecs(), I3u: emptySpecs(), I4: emptySpecs() };
  const pigObs = batches.map((b) => b.pigs.map((pig) => F.observeBatch({ code: b.code, pigs: [pig] }, PIG_OPTS, 1)));
  batches.forEach((b, i) => {
    const pop = F.fitPopulation(pigObs.filter((_, j) => j !== i).flat(), P, PIG_OPTS);
    b.pigs.forEach((pig, p) => {
      const ob = pigObs[i][p];
      for (let t = 1; t <= LAST; t++) {
        const ne = neByFold[i][t - 1];
        const x = truths[i].pigs[p][t - 1];
        const f2 = F.rollingForecast(ob, pop, P, t - 1, t, PIG_OPTS);
        const f3 = F.aiForecast(ob, pop, P, t - 1, t, PIG_OPTS);
        specs.I2[i][p][t - 1] = { ne, lys: f2.lys };
        specs.I3[i][p][t - 1] = { ne, lys: f3.lys };
        specs.I3u[i][p][t - 1] = { ne, lys: f3.lys, sd: f3.sdLys };
        specs.I4[i][p][t - 1] = { ne, lys: x.lys };
        accPig.I2.push({ day: t, lysRel: f2.lys / x.lys - 1, fiRel: f2.fi / x.fi - 1, adgRel: f2.adg / x.adg - 1, bwRel: f2.bw / x.bw - 1 });
        accPig.I3.push({ day: t, lysRel: f3.lys / x.lys - 1, fiRel: f3.fi / x.fi - 1, adgRel: f3.adg / x.adg - 1, bwRel: f3.bw / x.bw - 1 });
      }
    });
  });
  return specs;
}

// ---------- 打分：给定余量 m，逐头逐日比较供给与需要 ----------
function score(spec, m, full) {
  let pigDays = 0, deficit = 0, lysSup = 0, lysNeed = 0, cost = 0, co2e = 0, nEx = 0, cp = 0, feedCo2e = 0, n2o = 0, sbm = 0;
  batches.forEach((b, i) => {
    truths[i].pigs.forEach((pig, p) => {
      for (let t = 1; t <= LAST; t++) {
        const s = spec[i][p][t - 1];
        const d = dietFor(s.ne, s.sd != null ? s.lys + m * s.sd : s.lys * (1 + m));
        const x = pig[t - 1];
        pigDays++;
        if (d.lys < TOL * x.lys) deficit++;
        lysSup += d.lys * x.fi; lysNeed += x.lysReq;
        if (full) {
          const em = emissions(d, x);
          cost += d.price * x.fi; co2e += em.total; nEx += em.nEx; cp += d.cp * x.fi;
          feedCo2e += em.feed; n2o += em.n2o; sbm += d.sbm * x.fi;
        }
      }
    });
  });
  const res = { m, deficit: deficit / pigDays, excessLys: lysSup / lysNeed - 1 };
  if (full) Object.assign(res, { costPerPigDay: cost / pigDays, co2ePerPigDay: co2e / pigDays, nExPerPigDay: nEx / pigDays, cpPerPigDay: cp / pigDays,
    feedCo2ePerPigDay: feedCo2e / pigDays, n2oPerPigDay: n2o / pigDays, sbmPerPigDay: sbm / pigDays });
  return res;
}
function scoreSpec(spec, m) {
  let pigDays = 0, deficit = 0, sup = 0, need = 0;
  batches.forEach((b, i) => {
    truths[i].pigs.forEach((pig, p) => {
      for (let t = 1; t <= LAST; t++) {
        const sp = spec[i][p][t - 1], lys = sp.sd != null ? sp.lys + m * sp.sd : sp.lys * (1 + m), x = pig[t - 1];
        pigDays++;
        if (lys < TOL * x.lys) deficit++;
        sup += lys * x.fi; need += x.lysReq;
      }
    });
  });
  return { m, deficit: deficit / pigDays, excessLys: sup / need - 1 };
}
function matchMargin(curve, target) {
  for (let k = 1; k < curve.length; k++) {
    const a = curve[k - 1], b = curve[k];
    if (a.deficit >= target && b.deficit <= target) {
      const f = a.deficit === b.deficit ? 0 : (a.deficit - target) / (a.deficit - b.deficit);
      return a.m + f * (b.m - a.m);
    }
  }
  return null;
}
function evaluate(spec) {
  const grid = gridOf(spec);
  const curve = grid.map((m) => score(spec, m, false));
  const matched = {};
  for (const target of TARGETS) { const m = matchMargin(curve, target); matched[target] = m == null ? null : score(spec, m, true); }
  const specCurve = grid.map((m) => scoreSpec(spec, m));
  const specMatched = {};
  for (const target of TARGETS) { const m = matchMargin(specCurve, target); specMatched[target] = m == null ? null : scoreSpec(spec, m); }
  return { grid, curve, matched, specCurve, specMatched };
}

// ---------- 主循环 ----------
const t0 = Date.now();
const perRep = [];
let pigResult = null;
for (let rep = 0; rep < REPS; rep++) {
  const obsAll = batches.map((b) => F.observeBatch(b, BATCH_OPTS, F.obsSeed(rep, b.code)));
  const { specs, neByFold } = planBatch(obsAll);
  const out = {};
  for (const id of ['P0', 'P1', 'P2', 'P3', 'P3u', 'P4']) out[id] = evaluate(specs[id]);
  if (!pigResult) {
    // 逐头做法与观测噪声无关；能量浓度取第 1 次重复的标准表
    const pspecs = planPig(neByFold);
    pigResult = {};
    for (const id of ['I2', 'I3', 'I3u', 'I4']) pigResult[id] = evaluate(pspecs[id]);
  }
  Object.assign(out, pigResult);
  perRep.push(out);
  if (rep === 0) process.stderr.write('第 1 次重复（含逐头）用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s\n');
}

// ---------- 汇总 ----------
const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sdOf = (a) => { const m = meanOf(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length - 1)); };
const pct = (x, d) => (x * 100).toFixed(d == null ? 1 : d) + '%';
const mae = (rows, k) => meanOf(rows.map((x) => Math.abs(x[k])));

console.log('回放评估：13 批（100 头）× ' + REPS + ' 次重复，按批提前量 ' + BATCH_OPTS.leadDays + ' 天、称重日 ' + BATCH_OPTS.weighDays.join('/') + '，用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
console.log('配方：' + (LEGACY ? '旧引擎（原参数文件）' : '国内玉米–豆粕 + 合成氨基酸（理想蛋白），粪污 ' + C.manure.systems[SYSTEM].name + '，' + C.manure.mcf[CLIMATE].name + '，豆粕碳排放情景 ' + SBM));
console.log('\n== 预测误差（目标日相对事后真值的平均绝对误差） ==');
const errRows = [];
for (const [id, rows] of [['P1', accBatch.P1], ['P2', accBatch.P2], ['P3', accBatch.P3], ['I2', accPig.I2], ['I3', accPig.I3]]) {
  const r = { id, bw: mae(rows, 'bwRel'), adg: mae(rows, 'adgRel'), fi: mae(rows, 'fiRel'), lys: mae(rows, 'lysRel'), bias: meanOf(rows.map((x) => x.lysRel)) };
  errRows.push(r);
  console.log(POLICIES.find((p) => p.id === id).name.padEnd(16), '体重', pct(r.bw).padStart(6), ' 日增重', pct(r.adg).padStart(6), ' 采食', pct(r.fi).padStart(6), ' 赖氨酸浓度', pct(r.lys).padStart(6), ' 偏差', pct(r.bias).padStart(6));
}

console.log('\n== 决策精度：只看定下的赖氨酸浓度（不经过配方），营养不足猪日对齐后多喂了多少 ==');
const decision = {};
for (const target of TARGETS) {
  decision[target] = {};
  const line = POLICIES.map((p) => {
    const xs = perRep.map((r) => r[p.id].specMatched[target]).filter(Boolean);
    if (!xs.length) return p.id + ' —';
    decision[target][p.id] = { excessLys: meanOf(xs.map((x) => x.excessLys)), margin: meanOf(xs.map((x) => x.m)) };
    return p.id + ' ' + pct(decision[target][p.id].excessLys);
  });
  console.log('不足 ' + pct(target, 0) + '：' + line.join('  '));
}

const summary = {};
for (const target of TARGETS) {
  console.log('\n== 营养不足猪日 = ' + pct(target, 0) + ' 时（相对三阶段 P0；均值 ± 重复间标准差） ==');
  summary[target] = {};
  for (const p of POLICIES) {
    const rows = perRep.map((r) => ({ me: r[p.id].matched[target], base: r.P0.matched[target] })).filter((x) => x.me && x.base);
    if (!rows.length) { console.log(p.name.padEnd(16), '达不到该水平'); continue; }
    const rel = (k) => rows.map((x) => x.me[k] / x.base[k] - 1);
    const s = {
      margin: meanOf(rows.map((x) => x.me.m)), excessLys: meanOf(rows.map((x) => x.me.excessLys)),
      cost: meanOf(rel('costPerPigDay')), costSd: sdOf(rel('costPerPigDay')),
      co2e: meanOf(rel('co2ePerPigDay')), co2eSd: sdOf(rel('co2ePerPigDay')),
      nEx: meanOf(rel('nExPerPigDay')), nExSd: sdOf(rel('nExPerPigDay')),
      cp: meanOf(rel('cpPerPigDay')), sbm: meanOf(rel('sbmPerPigDay')),
      abs: { cost: meanOf(rows.map((x) => x.me.costPerPigDay)), co2e: meanOf(rows.map((x) => x.me.co2ePerPigDay)), nEx: meanOf(rows.map((x) => x.me.nExPerPigDay)), sbmKg: meanOf(rows.map((x) => x.me.sbmPerPigDay)) },
    };
    summary[target][p.id] = s;
    console.log(p.name.padEnd(16), p.id.endsWith('u') ? ('z ' + s.margin.toFixed(2)).padStart(8) : ('余量' + pct(s.margin, 0).padStart(5)), ' 多喂赖氨酸', pct(s.excessLys).padStart(6),
      ' 蛋白摄入', pct(s.cp).padStart(6), ' 豆粕', pct(s.sbm).padStart(6), ' 成本', pct(s.cost).padStart(6), ' CO2e', pct(s.co2e).padStart(6),
      ' 氮排泄', pct(s.nEx).padStart(6), '±' + pct(s.nExSd, 1));
  }
}

// ---------- 事先定好的及格线（主比较水平 10%） ----------
const S = summary[MAIN_TARGET];
const nred = (id) => (S[id] ? -S[id].nEx : null);
const verdicts = {};
console.log('\n== 及格线（营养不足猪日 = 10%；1) 按构造满足） ==');
for (const [label, ai, up, simple] of [['按批·常数余量', 'P3', 'P4', ['P1', 'P2']], ['按批·预测分位', 'P3u', 'P4', ['P1', 'P2']], ['逐头·常数余量', 'I3', 'I4', ['I2', 'P1']], ['逐头·预测分位', 'I3u', 'I4', ['I2', 'P1']]]) {
  if (nred(ai) == null || nred(up) == null) { console.log(label + '：数据不足'); continue; }
  const best = Math.max(...simple.map(nred).filter((x) => x != null));
  const c2 = nred(ai) >= 0.5 * nred(up), c3 = nred(ai) - best >= 0.03;
  verdicts[label] = { ai: nred(ai), upper: nred(up), bestSimple: best, c2, c3 };
  console.log(label + '：AI 氮减幅 ' + pct(nred(ai)) + '，上限 ' + pct(nred(up)) + ' → 2) ' + (c2 ? '通过' : '未通过') +
    '；最好的简单方法 ' + pct(best) + '，多降 ' + ((nred(ai) - best) * 100).toFixed(1) + ' 个百分点 → 3) ' + (c3 ? '通过' : '未通过'));
}

const jsonOut = arg('json', null);
if (jsonOut) {
  const curves = {};
  for (const p of POLICIES) curves[p.id] = perRep[0][p.id].grid.map((m, k) => ({ m, deficit: meanOf(perRep.map((r) => r[p.id].curve[k].deficit)), excessLys: meanOf(perRep.map((r) => r[p.id].curve[k].excessLys)) }));
  fs.writeFileSync(jsonOut, JSON.stringify({ generated: 'tools/replay-eval.js', reps: REPS, legacy: LEGACY, system: SYSTEM, climate: CLIMATE, sbmScenario: SBM, batchOpts: BATCH_OPTS, pigOpts: { leadDays: 0, weighCV: PIG_OPTS.weighCV }, policies: POLICIES, errors: errRows, decision, summary, verdicts, curves }, null, 1));
  console.log('\n写入 ' + jsonOut);
}
