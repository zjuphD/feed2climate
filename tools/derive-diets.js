// 推导工具的 A/B 基础料营养目标。
//   A = 前期：第 1 天的群体营养密度（三阶段的第一阶段）
//   B = 后期：第 51 天的群体营养密度（三阶段的第三阶段）
// 取值与回放“三阶段（现行）”一致：用全部 13 批观测拟合的群体曲线，能量与赖氨酸密度都取该日的值。
// 输出的目标写入 app/parameters/feed2climate-china.js 的 phaseTargets；
// 配方由 formulation.js 在这两个目标下求最低成本解，不在此写死。
// 用法：node tools/derive-diets.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-china.js', 'records.js', 'ai.js', 'forecast.js', 'formulation.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const C = global.window.F2C_CHINA;
const F = global.window.F2C_FORECAST;
const FM = global.window.F2C_FORMULATION;

const round = (x, d) => { const p = Math.pow(10, d); return Math.round(x * p) / p; };
const LAST = F.DEFAULTS.lastDay;
const BATCH_OPTS = { leadDays: F.DEFAULTS.leadDays, weighDays: F.DEFAULTS.weighDays };

const batches = F.groupBatches(global.window.F2C_RECORDS, LAST);
const obsAll = batches.map((b) => F.observeBatch(b, BATCH_OPTS, F.obsSeed(0, b.code)));
const pop = F.fitPopulation(obsAll, C, BATCH_OPTS);

const out = { batches: batches.length, phaseTargets: {} };
for (const [key, day] of [['A', 1], ['B', 51]]) {
  const row = pop.table[day - 1];
  const ne = round(row.ne, 3), lys = round(row.lys, 3);
  const res = FM.formulate(C, { ne, lys }, {});
  out.phaseTargets[key] = {
    day, bw: round(row.bw, 2), adg: round(row.adg, 3), fi: round(row.fi, 3),
    ne, lys,
    status: res.status,
    recipe: res.recipe ? Object.fromEntries(Object.entries(res.recipe).map(([k, v]) => [k, round(v, 5)])) : null,
    perKg: res.perKg ? { ne: round(res.perKg.ne, 3), lys: round(res.perKg.lys, 3), cp: round(res.perKg.cp, 1), price_yuan_per_t: round(res.perKg.price * 1000, 0), co2e: round(res.perKg.co2e, 4) } : null,
    neRelaxed: res.neRelaxed, lysCapped: res.lysCapped,
  };
}
// 对照：回放三阶段第二阶段（第 26 天）的赖氨酸密度
out.reference = { day26: { ne: round(pop.table[25].ne, 3), lys: round(pop.table[25].lys, 3) } };
console.log(JSON.stringify(out, null, 2));
