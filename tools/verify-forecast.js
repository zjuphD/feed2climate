// 预测层核对：可复现、不偷看未来、留出批次不进训练、各方法输出合理。
// 用法：node tools/verify-forecast.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-parameters.js', 'records.js', 'engine.js', 'ai.js', 'forecast.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const P = global.window.F2C_PARAMETERS;
const F = global.window.F2C_FORECAST;
const AI = global.window.F2C_AI;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name + (detail != null ? ' — 得到 ' + detail : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));

const batches = F.groupBatches(global.window.F2C_RECORDS);
const obsOf = (bs, rep) => bs.map((b) => F.observeBatch(b, {}, F.obsSeed(rep, b.code)));

console.log('== 0. 数据分组 ==');
check('13 个批次、100 头猪', batches.length === 13 && batches.reduce((s, b) => s + b.pigs.length, 0) === 100);
check('每头猪截取第 1–69 天', batches.every((b) => b.pigs.every((p) => p.points.length === 69 && p.points[68].day === 69)));

console.log('== 1. 需要浓度与引擎同一公式 ==');
{
  const d = F.requirementDensity(60, 0.9, 2.2, P);
  const ref = AI.perPigRequirements({ bw1: 60, adg: 0.9, avgFI: 2.2 }, P); // ADG 0.9 在夹值范围内
  check('赖氨酸浓度一致', Math.abs(d.lys - ref.lysPerFI) < 1e-9, d.lys + ' vs ' + ref.lysPerFI);
  check('NE 浓度一致', Math.abs(d.ne - ref.nePerFI) < 1e-9, d.ne + ' vs ' + ref.nePerFI);
}

console.log('== 2. 可复现 ==');
{
  const a = obsOf(batches, 3), b = obsOf(batches, 3), c = obsOf(batches, 4);
  check('同一种子 → 观测逐位相同', same(a, b));
  check('不同种子 → 观测不同', !same(a, c));
  const pop1 = F.fitPopulation(a.slice(1), P), pop2 = F.fitPopulation(b.slice(1), P);
  const f1 = F.aiForecast(a[0], pop1, P, 30, 40), f2 = F.aiForecast(b[0], pop2, P, 30, 40);
  check('同一输入 → AI 预测逐位相同', same(f1, f2));
}

console.log('== 3. 不偷看未来 ==');
{
  const i = 5, cutoff = 30, target = 37;
  const obs = obsOf(batches, 7);
  const pop = F.fitPopulation(obs.filter((_, j) => j !== i), P);
  const before = {
    ai: F.aiForecast(obs[i], pop, P, cutoff, target),
    simple: F.simpleForecast(obs[i], pop, P, cutoff, target),
    rolling: F.rollingForecast(obs[i], pop, P, cutoff, target),
  };
  // 把第 cutoff 天以后的真实记录全部改掉，重新生成观测（同一种子）
  const altered = clone(batches[i]);
  for (const pig of altered.pigs) for (const p of pig.points) if (p.day > cutoff) { p.weight *= 1.5; p.feed *= 0.5; }
  const obs2 = F.observeBatch(altered, {}, F.obsSeed(7, altered.code));
  check('改动未来数据后，截止日以前的观测不变', same(F.visible(obs[i], cutoff), F.visible(obs2, cutoff)));
  check('AI 预测不变', same(before.ai, F.aiForecast(obs2, pop, P, cutoff, target)));
  check('简单外推不变', same(before.simple, F.simpleForecast(obs2, pop, P, cutoff, target)));
  check('滚动估计不变', same(before.rolling, F.rollingForecast(obs2, pop, P, cutoff, target)));
  check('改动后完整观测确实不同（检验有效）', !same(obs[i], obs2));
}

console.log('== 4. 留出批次不进训练 ==');
{
  const i = 2, obs = obsOf(batches, 1);
  const popA = F.fitPopulation(obs.filter((_, j) => j !== i), P);
  const altered = obs.map((o, j) => (j === i ? { ...clone(o), weeks: o.weeks.map((w) => ({ ...w, fi: w.fi * 2 })) } : o));
  const popB = F.fitPopulation(altered.filter((_, j) => j !== i), P);
  check('群体规律与留出批次无关', same(popA.table, popB.table) && popA.qW === popB.qW && popA.tauPhi2 === popB.tauPhi2);
  check('训练批次列表不含留出批次', !popA.trainCodes.includes(batches[i].code) && popA.trainCodes.length === 12);
}

console.log('== 5. 预测数值合理 ==');
{
  const obs = obsOf(batches, 0);
  let ok = true, worst = '';
  batches.forEach((b, i) => {
    const pop = F.fitPopulation(obs.filter((_, j) => j !== i), P);
    for (const wk of F.decisionWeeks()) {
      const f = F.aiForecast(obs[i], pop, P, wk.cutoff, wk.target);
      if (!(f.bw > 15 && f.bw < 160 && f.fi > 0.5 && f.fi < 5 && f.lys > 3 && f.lys < 30)) { ok = false; worst = b.code + ' 第' + wk.target + '天 ' + JSON.stringify(f); }
    }
  });
  check('全部批次、全部周的 AI 预测落在生理范围内', ok, worst);
  const pop = F.fitPopulation(obs.slice(1), P);
  check('群体增重/采食比随日龄下降（前 10 天均值 > 后 10 天）',
    pop.gfDay.slice(0, 10).reduce((s, v) => s + v, 0) > pop.gfDay.slice(-10).reduce((s, v) => s + v, 0), pop.gfDay[0] + ' / ' + pop.gfDay[68]);
  // 同一个目标日（第 46 天）：第 43 天的抽称到达之前（截止第 42 天）与之后（截止第 43 天）比较
  const before43 = F.aiForecast(obs[0], pop, P, 42, 46), after43 = F.aiForecast(obs[0], pop, P, 43, 46);
  check('新的抽称到达后，同一目标日的体重不确定度变小', after43.sdBw < before43.sdBw, before43.sdBw.toFixed(2) + ' → ' + after43.sdBw.toFixed(2));
}

console.log('== 6. 决策时点 ==');
{
  const w = F.decisionWeeks();
  check('10 个决策周覆盖第 1–69 天', w.length === 10 && w[0].start === 1 && w[9].end === 69);
  check('提前量 3 天：决策当天只看第 start−4 天以前', w.every((x) => x.cutoff === x.start - 4));
}

console.log(failures === 0 ? '\n预测层全部核对通过。' : '\n有 ' + failures + ' 项未通过。');
process.exit(failures === 0 ? 0 : 1);
