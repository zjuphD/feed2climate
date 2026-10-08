// 核对“开始分析”页的对比口径：本方案（每周预测 × (1 + 安全余量)）对三阶段（标准表 × (1 + 4%)）。
// 页面按“从进栏到所选这一周的累计”比较，因为单周的差别正负都有：三阶段刚换料时最贴近需要，阶段末最浪费。
// 这里用 13 批留一批（每批的群体规律取自其余 12 批）、单次观测噪声，复现两种口径：
//   单周快照：本方案比三阶段更便宜 / 排氮更少的批次周占多少；
//   全程累计：每头猪各周加总（总和之比），与回放 30 次重复的平均（docs/replay/README.md）对照方向与量级。
// 与回放的差别：这里只用一次观测噪声，并用预测的体重和采食评估，不是回放的逐头逐日打分，所以不会逐位相同。
// 用法：node tools/weekly-compare.js [安全余量，默认 14.5（%）]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-china.js', 'records.js', 'engine.js', 'ai.js', 'forecast.js', 'formulation.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const P = window.F2C_CHINA, F = window.F2C_FORECAST, FM = window.F2C_FORMULATION;

const MARGIN_AI = Number(process.argv[2] || 14.5) / 100;
const MARGIN_PHASE = 0.04;       // 与 app/index.html 的 GA_MARGIN_PHASE 一致
const PHASES = [1, 26, 51];      // 三阶段换料日，与回放一致
const SYS = { system: 'slurry_nocrust', climate: 'warm_moist' };
const opts = { leadDays: F.DEFAULTS.leadDays, weighDays: F.DEFAULTS.weighDays };

const batches = F.groupBatches(window.F2C_RECORDS, F.DEFAULTS.lastDay);
const weeks = F.decisionWeeks(opts);
const obsAll = batches.map((b) => F.observeBatch(b, opts, F.obsSeed(0, b.code)));
const pct = (x) => (x * 100).toFixed(1) + '%';

const cases = [];
batches.forEach((b, i) => {
  const pop = F.fitPopulation(obsAll.filter((_, j) => j !== i), P, opts);
  for (const wk of weeks) {
    const T = wk.target;
    const f = F.aiForecast(obsAll[i], pop, P, wk.cutoff, [T], opts).forecasts[0];
    const ne = pop.table[T - 1].ne, pd = PHASES.filter((d) => d <= wk.start).pop();
    const dA = FM.formulate(P, { ne, lys: f.lys * (1 + MARGIN_AI) }, { sbmScenario: 'mid' });
    const dB = FM.formulate(P, { ne, lys: pop.table[pd - 1].lys * (1 + MARGIN_PHASE) }, { sbmScenario: 'mid' });
    const days = wk.end - wk.start + 1, pig = { bw: f.bw, adg: f.adg, fi: f.fi };
    const side = (d) => { const a = FM.account(P, d.perKg, pig, SYS); return { lys: d.perKg.lys * f.fi * days, cost: d.perKg.price * f.fi * days, nEx: a.nExcreted * days, co2e: a.total * days }; };
    cases.push({ batch: i, code: b.code, start: wk.start, A: side(dA), B: side(dB) });
  }
});

const sum = (rows, k, m) => rows.reduce((s, r) => s + r[k][m], 0);
const ratio = (rows, m) => sum(rows, 'A', m) / sum(rows, 'B', m) - 1;
console.log('批次周数 ' + cases.length + '；本方案安全余量 ' + pct(MARGIN_AI) + '，三阶段 ' + pct(MARGIN_PHASE));
console.log('\n[单周快照] 本方案比三阶段更便宜的周：' + cases.filter((r) => r.A.cost < r.B.cost).length + ' / ' + cases.length +
  '；排氮更少的周：' + cases.filter((r) => r.A.nEx < r.B.nEx).length + ' / ' + cases.length);
console.log('\n[全程累计，13 批总和之比]  赖氨酸供给 ' + pct(ratio(cases, 'lys')) + '  料成本 ' + pct(ratio(cases, 'cost')) + '  氮排泄 ' + pct(ratio(cases, 'nEx')) + '  CO2e ' + pct(ratio(cases, 'co2e')));
console.log('\n[各批全程累计]');
batches.forEach((b, i) => {
  const rr = cases.filter((r) => r.batch === i);
  console.log('  ' + b.code + '  赖氨酸 ' + pct(ratio(rr, 'lys')).padStart(7) + '  成本 ' + pct(ratio(rr, 'cost')).padStart(6) + '  氮 ' + pct(ratio(rr, 'nEx')).padStart(7) + '  CO2e ' + pct(ratio(rr, 'co2e')).padStart(6));
});
console.log('\n对照：回放 30 次重复的平均（营养不足猪日同为 10%）——赖氨酸多喂 14.0% 对 20.0%（约 −5%），成本 −0.8%，氮 −10.0%，CO2e −2.1%。');
