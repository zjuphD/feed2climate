// 导出展示页（app/story.html）用的数据：一次回放（第 1 组观测噪声）里的逐头逐日需要与各做法的供给，
// 加上 30 次重复的汇总结果。余量取 30 次重复对齐到“营养不足猪日 10%”时的平均值。
// 用法：node tools/export-story.js  → 写入 app/story-data.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
for (const f of ['parameters/feed2climate-parameters.js', 'parameters/feed2climate-china.js', 'records.js', 'ai.js', 'forecast.js', 'formulation.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'));
}
const P = global.window.F2C_PARAMETERS;
const F = global.window.F2C_FORECAST;

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'replay', f), 'utf8'));
const main = read('results-cn.json');
const sens = {};
for (const sc of ['low', 'high']) {
  const f = path.join(ROOT, 'docs', 'replay', 'results-cn-sbm-' + sc + '.json');
  if (fs.existsSync(f)) sens[sc] = JSON.parse(fs.readFileSync(f, 'utf8'));
}
const T = '0.1';
const margin = (id) => main.summary[T][id].margin;

const LAST = F.DEFAULTS.lastDay;
const BATCH_OPTS = main.batchOpts;
const PIG_OPTS = { weighDays: Array.from({ length: LAST }, (_, k) => k + 1), weekLen: 1, leadDays: 0, weighCV: 0.012, feedCV: 0.10, addWeighCV: 0, addFeedCV: 0 };
const PHASES = [1, 26, 51];
const HERO = '202019';
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;

const batches = F.groupBatches(global.window.F2C_RECORDS, LAST);
const truths = batches.map((b) => F.truthBatch(b, P));
const weeks = F.decisionWeeks(BATCH_OPTS);
const obsAll = batches.map((b) => F.observeBatch(b, BATCH_OPTS, F.obsSeed(0, b.code)));
const pigObs = batches.map((b) => b.pigs.map((pig) => F.observeBatch({ code: b.code, pigs: [pig] }, PIG_OPTS, 1)));

const m = { P0: margin('P0'), P1: margin('P1'), I2: margin('I2'), I3: margin('I3') };
const pigs = [];        // 每头猪：批次、逐日需要、各做法供给（已加余量）
let hero = null, replay = null;

batches.forEach((b, i) => {
  const pop = F.fitPopulation(obsAll.filter((_, j) => j !== i), P, BATCH_OPTS);
  const popPig = F.fitPopulation(pigObs.filter((_, j) => j !== i).flat(), P, PIG_OPTS);
  // 按批：三阶段、每周查表（同一批所有猪吃同一种料）
  const p0 = new Array(LAST), p1 = new Array(LAST);
  const phaseLys = PHASES.map((d) => pop.table[d - 1].lys);
  for (const wk of weeks) {
    const f1 = F.tableForecast(pop, P, wk.target, BATCH_OPTS);
    for (let t = wk.start; t <= wk.end; t++) {
      p0[t - 1] = phaseLys[PHASES.filter((d) => d <= wk.start).length - 1] * (1 + m.P0);
      p1[t - 1] = f1.lys * (1 + m.P1);
    }
  }
  b.pigs.forEach((pig, p) => {
    const need = [], i2 = [], i3 = [];
    for (let t = 1; t <= LAST; t++) {
      need.push(r3(truths[i].pigs[p][t - 1].lys));
      i2.push(r3(F.rollingForecast(pigObs[i][p], popPig, P, t - 1, t, PIG_OPTS).lys * (1 + m.I2)));
      i3.push(r3(F.aiForecast(pigObs[i][p], popPig, P, t - 1, t, PIG_OPTS).lys * (1 + m.I3)));
    }
    pigs.push({ id: pig.id, batch: b.code, need, group: p1.map(r3), i2, i3 });
  });
  if (b.code === HERO) {
    hero = {
      batch: b.code, n: b.pigs.length,
      entryWeight: r2(truths[i].days[0].bw),
      meanNeed: truths[i].days.map((d) => r3(d.lys)),
      p0: p0.map(r3), p1: p1.map(r3),
      pigIds: b.pigs.map((x) => x.id),
    };
    // 回放：每个决策周，AI 只用当时看得到的数据，给出全程体重路径（均值 ± 标准差）与下一周的赖氨酸浓度
    replay = {
      batch: b.code,
      truthWeight: truths[i].days.map((d) => r2(d.bw)),
      truthLys: truths[i].days.map((d) => r3(d.lys)),
      weighings: obsAll[i].weighings.map((w) => ({ day: w.day, kg: r2(w.mean) })),
      weeks: weeks.map((wk) => {
        const res = F.aiForecast(obsAll[i], pop, P, wk.cutoff, [LAST], BATCH_OPTS);
        const f = F.aiForecast(obsAll[i], pop, P, wk.cutoff, wk.target, BATCH_OPTS);
        const f1 = F.tableForecast(pop, P, wk.target, BATCH_OPTS);
        return {
          start: wk.start, end: wk.end, cutoff: wk.cutoff, target: wk.target,
          seenWeighings: obsAll[i].weighings.filter((w) => w.day === 1 || w.day <= wk.cutoff).map((w) => w.day),
          seenFeedWeeks: obsAll[i].weeks.filter((x) => x.end <= wk.cutoff).length,
          path: res.path.map((d) => [r2(d.W), r2(d.sdW)]),
          aiLys: r3(f.lys), tableLys: r3(f1.lys), truthLys: r3(truths[i].days[wk.target - 1].lys),
          aiBw: r2(f.bw), truthBw: r2(truths[i].days[wk.target - 1].bw),
        };
      }),
    };
  }
});

const S = main.summary[T];
const pick = (id) => ({ excessLys: r3(S[id].excessLys), nEx: r3(S[id].nEx), nExSd: r3(S[id].nExSd), sbm: r3(S[id].sbm), co2e: r3(S[id].co2e), cost: r3(S[id].cost) });
const ladder = {};
for (const id of ['P0', 'P1', 'P3', 'P4', 'I2', 'I3', 'I4']) ladder[id] = pick(id);
const co2eByScenario = { mid: {} };
for (const id of Object.keys(ladder)) co2eByScenario.mid[id] = r3(S[id].co2e);
for (const sc of Object.keys(sens)) {
  co2eByScenario[sc] = {};
  for (const id of Object.keys(ladder)) co2eByScenario[sc][id] = r3(sens[sc].summary[T][id].co2e);
}
const base = { mid: S.P0.abs };
for (const sc of Object.keys(sens)) base[sc] = sens[sc].summary[T].P0.abs;

const out = {
  generated: 'tools/export-story.js',
  reps: main.reps, lastDay: LAST, target: 0.10,
  margins: m,
  hero, replay, pigs,
  ladder, co2eByScenario, base,
  errors: main.errors, verdicts: main.verdicts, decision: main.decision[T],
  setup: { system: main.system, climate: main.climate, lead: BATCH_OPTS.leadDays, weighDays: BATCH_OPTS.weighDays },
};
const file = path.join(ROOT, 'app', 'story-data.js');
fs.writeFileSync(file, '// 由 tools/export-story.js 生成，请勿手工编辑。\nwindow.F2C_STORY = ' + JSON.stringify(out) + ';\n');
console.log('写入 ' + file + '（' + Math.round(fs.statSync(file).size / 1024) + ' KB），场景：' + ['mid'].concat(Object.keys(sens)).join('/'));
