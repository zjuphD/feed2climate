// 预测区间的实测覆盖：13 批留一批，每批每个决策周的目标日，体重与采食的真值是否落在 ±1.96 倍标准差之内。
// 用于核对界面与文档中的覆盖率（体重约 86%、采食约 95%，130 个案例）。
// 用法：node tools/forecast-coverage.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-china.js', 'records.js', 'ai.js', 'forecast.js', 'formulation.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const P = global.window.F2C_CHINA;
const F = global.window.F2C_FORECAST;
const LAST = F.DEFAULTS.lastDay;
const BATCH_OPTS = { leadDays: F.DEFAULTS.leadDays, weighDays: F.DEFAULTS.weighDays };

const batches = F.groupBatches(global.window.F2C_RECORDS, LAST);
const obsAll = batches.map((b) => F.observeBatch(b, BATCH_OPTS, F.obsSeed(0, b.code)));
const truths = batches.map((b) => F.truthBatch(b, P));
const weeks = F.decisionWeeks(BATCH_OPTS);

let n = 0, inBw = 0, inFi = 0;
for (let i = 0; i < batches.length; i++) {
  const pop = F.fitPopulation(obsAll.filter((_, j) => j !== i), P, BATCH_OPTS);
  for (const wk of weeks) {
    const f = F.aiForecast(obsAll[i], pop, P, wk.cutoff, wk.target, BATCH_OPTS);
    const truth = truths[i].days[wk.target - 1];
    n++;
    if (Math.abs(truth.bw - f.bw) <= 1.96 * f.sdBw) inBw++;
    if (Math.abs(truth.fi - f.fi) <= 1.96 * f.sdFi) inFi++;
  }
}
console.log('案例数 ' + n + '；体重 95% 区间覆盖 ' + (100 * inBw / n).toFixed(1) + '%；采食 95% 区间覆盖 ' + (100 * inFi / n).toFixed(1) + '%');
