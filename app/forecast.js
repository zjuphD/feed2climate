// Feed2Climate 批次预测层（无依赖，纯函数，全种子化，结果可复现）。
// 要解决的问题：企业只有稀疏数据——进栏称重、每 3 周抽称一次、每周耗料；营养师要提前几天决定下一周送什么浓度的料。
// 本模块提供：
//   1) observeBatch：把逐头逐日的研究数据“降级”成企业版观测（加入抽称误差与耗料盘点误差）；
//   2) fitPopulation：从历史批次（同样是企业版观测）学群体规律——采食~体重曲线、能量分配系数 α 及其批间差异；
//   3) 三种预测方法：按日龄查表（tableForecast）、简单外推（simpleForecast）、
//      AI（aiForecast：分层先验 + 状态空间滤波，用耗料推算两次称重之间的体重，随新数据更新，并给出不确定度）；
//   4) truthBatch：用完整逐头数据算事后真值，只用于回放打分，任何预测方法都不读取它。
// 能量分配框架（增重 = α × (采食净能 − 维持净能)）取自数据作者随 Zenodo 6626445 发布的 DLM_script.R。
'use strict';
window.F2C_FORECAST = (function () {
  const DEFAULTS = {
    lastDay: 69,                 // 100 头猪都有记录的最后一天（每头 69–76 天）
    weighDays: [1, 22, 43, 64],  // 企业版：进栏称重 + 每 3 周抽称一次
    weighCV: 0.03,               // 抽称均值的相对误差（约等于从大批次里抽 10–15 头称重）；滤波按此设定称重误差
    feedCV: 0.04,                // 每周耗料盘点的相对误差
    addWeighCV: null,            // 生成观测时额外加的称重误差（null = 同 weighCV；逐头实验用 0，数据本身已含秤的误差）
    addFeedCV: null,             // 生成观测时额外加的耗料误差（null = 同 feedCV）
    weekLen: 7,
    leadDays: 3,                 // 饲料厂生产+配送提前量：第 d 天开始的那一周，第 d−3 天就要定料
    adgClamp: [0.3, 1.4],
    fiMode: 'day',               // AI 的群体采食曲线：'day' 按进栏天数，'weight' 按体重 × 适应系数
    gainMode: 'gf',              // AI 的增重模型：'gf' 增重 = κ × 采食 × 历史批次同期的增重/采食比；'energy' 增重 = κ × α(W) × 净能
  };

  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  function variance(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
  }

  // ---------- 确定性伪随机数（Mulberry32 + Box–Muller） ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    const u = Math.max(rand(), 1e-12), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // 每个（重复编号, 批次）一个独立种子
  function obsSeed(rep, code) { return (Math.imul(rep + 1, 1000003) + Number(code)) >>> 0; }

  // ---------- 小工具：最小二乘二次拟合 y = c0 + c1·x + c2·x² ----------
  function quadFit(xs, ys) {
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], T = [0, 0, 0];
    for (let i = 0; i < xs.length; i++) {
      const v = [1, xs[i], xs[i] * xs[i]];
      for (let r = 0; r < 3; r++) { T[r] += v[r] * ys[i]; for (let c = 0; c < 3; c++) S[r][c] += v[r] * v[c]; }
    }
    for (let i = 0; i < 3; i++) {
      for (let k = i + 1; k < 3; k++) {
        const f = S[k][i] / S[i][i];
        for (let j = i; j < 3; j++) S[k][j] -= f * S[i][j];
        T[k] -= f * T[i];
      }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) { let s = T[i]; for (let j = i + 1; j < 3; j++) s -= S[i][j] * x[j]; x[i] = s / S[i][i]; }
    return x;
  }

  // ---------- 营养需要（与 engine.js / ai.js 同一公式） ----------
  function neMaint(bw, P) {
    const En = P.energy;
    return En.maintenance_coefficient * En.maintenance_net_availability * Math.pow(bw, En.maintenance_exponent);
  }
  // 每 kg 饲料应含的营养浓度 = 每天需要 ÷ 每天采食
  function requirementDensity(bw, adg, fi, P) {
    const R = P.requirements;
    const neReq = neMaint(bw, P) + R.ne_gain_mj_per_kg * adg;
    const lysReq = R.lys_maint_g_per_kg75 * Math.pow(bw, 0.75) + R.lys_gain_g_per_kg * adg;
    return { neReq, lysReq, ne: neReq / fi, lys: lysReq / fi };
  }
  const clampAdg = (x, o) => Math.min(o.adgClamp[1], Math.max(o.adgClamp[0], x));

  // ---------- 按批次分组（批次号 = Fattening_group，形如 202019） ----------
  function groupBatches(records, lastDay) {
    const L = lastDay || DEFAULTS.lastDay;
    const map = new Map();
    for (const rec of records) {
      const code = rec.pen.split('-')[0];
      const pts = rec.points.filter((p) => p.day <= L);
      if (pts.length !== L || pts[0].day !== 1) throw new Error('猪只 ' + rec.id + ' 第 1–' + L + ' 天记录不完整');
      if (!map.has(code)) map.set(code, { code, pigs: [] });
      map.get(code).pigs.push({ id: rec.id, pen: rec.pen, points: pts });
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /* ================= 1. 事后真值（只用于打分） ================= */
  // 每头猪：体重用全程二次曲线平滑（回顾性），日增重取其导数，采食取以当天为中心的 7 天均值。
  function pigTruth(pig, o) {
    const pts = pig.points;
    const [a, b, c] = quadFit(pts.map((p) => p.day), pts.map((p) => p.weight));
    const out = [];
    for (let t = 1; t <= pts.length; t++) {
      const win = pts.slice(Math.max(0, t - 4), Math.min(pts.length, t + 3));
      out.push({ day: t, bw: a + b * t + c * t * t, adg: clampAdg(b + 2 * c * t, o), fi: mean(win.map((p) => p.feed)) });
    }
    return out;
  }
  function truthBatch(batch, P, opts) {
    const o = { ...DEFAULTS, ...opts };
    const pigs = batch.pigs.map((p) => pigTruth(p, o).map((d) => ({ ...d, ...requirementDensity(d.bw, d.adg, d.fi, P) })));
    const days = [];
    for (let t = 1; t <= o.lastDay; t++) {
      const rows = pigs.map((p) => p[t - 1]);
      const bw = mean(rows.map((r) => r.bw)), adg = mean(rows.map((r) => r.adg)), fi = mean(rows.map((r) => r.fi));
      days.push({ day: t, bw, adg, fi, ...requirementDensity(bw, adg, fi, P) });
    }
    return { code: batch.code, n: batch.pigs.length, pigs, days };
  }

  /* ================= 2. 企业版观测 ================= */
  // 先按固定顺序抽好全部噪声，噪声与数据取值无关：改动未来的数据不会改变过去的观测（回放不偷看的前提）。
  function observeBatch(batch, opts, seed) {
    const o = { ...DEFAULTS, ...opts };
    const rand = mulberry32(seed);
    const weighZ = o.weighDays.map(() => gaussian(rand));
    const nWeeks = Math.ceil(o.lastDay / o.weekLen);
    const feedZ = Array.from({ length: nWeeks }, () => gaussian(rand));
    const dayMean = (t, key) => mean(batch.pigs.map((p) => p.points[t - 1][key]));
    const addW = o.addWeighCV == null ? o.weighCV : o.addWeighCV;
    const addF = o.addFeedCV == null ? o.feedCV : o.addFeedCV;
    const weighings = o.weighDays
      .map((d, i) => ({ day: d, z: weighZ[i] }))
      .filter((w) => w.day <= o.lastDay)
      .map((w) => ({ day: w.day, mean: dayMean(w.day, 'weight') * (1 + addW * w.z) }));
    const weeks = [];
    for (let k = 0; k < nWeeks; k++) {
      const start = 1 + k * o.weekLen, end = Math.min(o.lastDay, start + o.weekLen - 1);
      let s = 0;
      for (let t = start; t <= end; t++) s += dayMean(t, 'feed');
      weeks.push({ start, end, fi: (s / (end - start + 1)) * (1 + addF * feedZ[k]) });
    }
    return { code: batch.code, n: batch.pigs.length, lastDay: o.lastDay, weighCV: o.weighCV, feedCV: o.feedCV, weighings, weeks };
  }

  // 截至第 c 天企业看得到的观测：进栏体重（转群前已知）+ 第 c 天及以前的抽称 + 已经结束的整周耗料。
  function visible(obs, cutoff) {
    return {
      weighings: obs.weighings.filter((w) => w.day === 1 || w.day <= cutoff),
      weeks: obs.weeks.filter((wk) => wk.end <= cutoff),
    };
  }

  // 已结束的历史批次：称重之间线性插值、最后一次称重之后按最后一段斜率外推；采食按周均值铺到每天。
  function reconstruct(obs) {
    const L = obs.lastDay, ws = obs.weighings;
    const W = new Array(L + 1).fill(NaN), ADG = new Array(L + 1).fill(NaN), FI = new Array(L + 1).fill(NaN);
    for (let t = 1; t <= L; t++) {
      let j = ws.length - 2;
      for (let i = 0; i < ws.length - 1; i++) if (t <= ws[i + 1].day) { j = i; break; }
      const a = ws[j], b = ws[j + 1];
      const slope = (b.mean - a.mean) / (b.day - a.day);
      W[t] = a.mean + slope * (t - a.day);
      ADG[t] = slope;
    }
    for (const wk of obs.weeks) for (let t = wk.start; t <= wk.end; t++) FI[t] = wk.fi;
    return { W, ADG, FI };
  }

  /* ================= 3. 从历史批次学群体规律 ================= */
  function fitPopulation(trainObs, P, opts) {
    const o = { ...DEFAULTS, ...opts };
    const NEf = P.energy.ne_feed_mj_per_kg;
    const recs = trainObs.map(reconstruct);

    // (a) 采食 = 体重曲线 fiW(W)（二次） × 进栏第 k 周的适应系数 adapt[k]（转群后头几周吃得少）。
    //     两者交替拟合两轮：先拟合体重曲线，再按周求实测/曲线的均值，再用去掉适应效应的数据重拟曲线。
    const wkRows = [];
    trainObs.forEach((ob, i) => {
      ob.weeks.forEach((wk, k) => {
        let s = 0;
        for (let t = wk.start; t <= wk.end; t++) s += recs[i].W[t];
        wkRows.push({ k, w: s / (wk.end - wk.start + 1), fi: wk.fi });
      });
    });
    const nWeeks = Math.max(...wkRows.map((r) => r.k)) + 1;
    let adapt = new Array(nWeeks).fill(1), fiCoef = [0, 0, 0];
    for (let iter = 0; iter < 2; iter++) {
      fiCoef = quadFit(wkRows.map((r) => r.w), wkRows.map((r) => r.fi / adapt[r.k]));
      const fw = (w) => fiCoef[0] + fiCoef[1] * w + fiCoef[2] * w * w;
      adapt = adapt.map((_, k) => mean(wkRows.filter((r) => r.k === k).map((r) => r.fi / fw(r.w))));
    }
    const fiW = (w) => fiCoef[0] + fiCoef[1] * w + fiCoef[2] * w * w;
    const weekIndex = (t) => Math.min(nWeeks - 1, Math.floor((t - 1) / o.weekLen));
    // 另一种群体采食曲线：按进栏天数（历史批次各周均值，在周中点之间线性插值）。
    // 回放比较表明本数据里采食更随进栏天数而不是体重变化，默认用这一种（fiMode: 'day'）。
    const wkMeans = trainObs[0].weeks.map((wk, k) => ({ mid: (wk.start + wk.end) / 2, fi: mean(trainObs.map((ob) => ob.weeks[k].fi)) }));
    const fiDay = (t) => {
      if (t <= wkMeans[0].mid) return wkMeans[0].fi;
      for (let k = 1; k < wkMeans.length; k++) {
        if (t <= wkMeans[k].mid) {
          const a = wkMeans[k - 1], b = wkMeans[k];
          return a.fi + (b.fi - a.fi) * (t - a.mid) / (b.mid - a.mid);
        }
      }
      return wkMeans[wkMeans.length - 1].fi;
    };
    const fiPop = o.fiMode === 'weight' ? (w, t) => fiW(w) * adapt[weekIndex(t)] : (w, t) => fiDay(t);

    // (d) 按日龄的标准表：历史批次逐日平均的体重、日增重、采食（营养师常用的“按日龄查表”）
    const table = [];
    for (let t = 1; t <= o.lastDay; t++) {
      const bw = mean(recs.map((r) => r.W[t]));
      const adg = clampAdg(mean(recs.map((r) => r.ADG[t])), o);
      const fi = mean(recs.map((r) => r.FI[t]));
      table.push({ day: t, bw, adg, fi, ...requirementDensity(bw, adg, fi, P) });
    }

    // (e) 增重/采食比（料重效率的倒数）按进栏天数：历史批次同期的平均，7 天滑动平滑
    const gfRaw = table.map((r) => r.adg / r.fi);
    const gfDay = gfRaw.map((_, k) => mean(gfRaw.slice(Math.max(0, k - 3), Math.min(gfRaw.length, k + 4))));


    // (b) 能量分配系数 α(W) = 增重 ÷ 净能（采食净能 − 维持净能），猪越大 α 越低：α = c·W^(−b)。
    //     对每个 b 求闭式最优 c，选误差平方和最小的 b（只用称重间隔的总增重，不依赖逐日体重）。
    const intervals = trainObs.map((ob, i) => {
      const ws = ob.weighings, list = [];
      for (let j = 0; j < ws.length - 1; j++) {
        const days = [];
        for (let t = ws[j].day; t < ws[j + 1].day; t++) days.push({ t, W: recs[i].W[t], FI: recs[i].FI[t], enet: recs[i].FI[t] * NEf - neMaint(recs[i].W[t], P) });
        list.push({ gain: ws[j + 1].mean - ws[j].mean, days, wbar: mean(days.map((d) => d.W)), len: days.length });
      }
      return list;
    });
    const all = intervals.flat();
    let best = null;
    for (let b = 0; b <= 1.2 + 1e-9; b += 0.01) {
      const xs2 = all.map((iv) => sum(iv.days.map((d) => Math.pow(d.W, -b) * d.enet)));
      const c = sum(all.map((iv, k) => iv.gain * xs2[k])) / sum(xs2.map((x) => x * x));
      const sse = sum(all.map((iv, k) => Math.pow(iv.gain - c * xs2[k], 2)));
      if (!best || sse < best.sse) best = { b, c, sse };
    }
    const alphaCoef = { c: best.c, b: best.b };
    const alphaPop = (w) => alphaCoef.c * Math.pow(w, -alphaCoef.b);
    // 每批一个乘数 κ（这批猪比群体“长得更省料”或“更费料”）：批内看每段的离散，批间看 κ 的方差扣掉批内噪声。
    // κ 的含义随增重模型而定：'gf' 时是相对“同期增重/采食比”的倍数，'energy' 时是相对 α(W) 的倍数。
    const expected = o.gainMode === 'energy'
      ? (iv) => sum(iv.days.map((d) => alphaPop(d.W) * d.enet))
      : (iv) => sum(iv.days.map((d) => d.FI * gfDay[d.t - 1]));
    const resid = [], within = [], kappas = [];
    for (const list of intervals) {
      const kB = sum(list.map((iv) => iv.gain)) / sum(list.map(expected));
      kappas.push(kB);
      for (const iv of list) {
        const e = expected(iv), r = iv.gain - kB * e;
        resid.push((r * r - 2 * Math.pow(o.weighCV * iv.wbar, 2)) / iv.len);
        within.push(Math.pow(iv.gain / e - kB, 2));
      }
    }
    const nInt = intervals[0].length;
    const withinVar = sum(within) / Math.max(1, within.length - intervals.length);
    const tauKappa2 = Math.max(variance(kappas) - withinVar / nInt, Math.pow(0.03, 2));
    const qW = Math.max(mean(resid), Math.pow(0.1, 2)); // 每天的体重过程噪声（kg²/天），下限 0.1 kg/天

    // (c) 采食系数 φ = 实测周采食 ÷ 群体曲线；第 1 周的批间差异作先验，周与周之间按随机游走
    const zs = trainObs.map((ob, i) => ob.weeks.map((wk) => {
      let s = 0;
      for (let t = wk.start; t <= wk.end; t++) s += recs[i].W[t];
      return wk.fi / fiPop(s / (wk.end - wk.start + 1), wk.start);
    }));
    // Var(z[k+L] − z[k]) = 2r + L·q：用 L = 1 与 L = Lg 两种间隔联立，解出白噪声 r 与随机游走 q
    const lagVar = (L) => { const d = []; zs.forEach((z) => { for (let k = L; k < z.length; k++) d.push(z[k] - z[k - L]); }); return mean(d.map((x) => x * x)); };
    const Lg = Math.min(7, zs[0].length - 1);
    const V1 = lagVar(1), VL = lagVar(Lg);
    const qPhi = Math.max((VL - V1) / (Lg - 1), 1e-5);
    const rPhi = Math.max((V1 - qPhi) / 2, 1e-4);
    // 第一期的批间差异（扣掉白噪声）作 φ 的先验方差；用前 3 期均值以免第一期噪声太大
    const head = zs.map((z) => mean(z.slice(0, Math.min(3, z.length))));
    const tauPhi2 = Math.max(variance(head) - rPhi / Math.min(3, zs[0].length), 1e-4);

    return {
      trainCodes: trainObs.map((ob) => ob.code),
      fiMode: o.fiMode, gainMode: o.gainMode, gfDay, fiCoef, adapt, alphaCoef, tauKappa2, qW, rPhi, qPhi, tauPhi2, table,
      fiPop, alphaPop,
    };
  }

  /* ================= 4. 三种预测方法 ================= */
  // 统一输出：目标日的体重、日增重、采食，以及每 kg 饲料应含的 NE / SID 赖氨酸浓度。
  function finish(bw, adg, fi, P, o, extra) {
    const a = clampAdg(adg, o);
    return { bw, adg: a, fi, ...requirementDensity(bw, a, fi, P), ...(extra || {}) };
  }

  // (1) 按日龄查表：不看这批猪自己的数据
  function tableForecast(pop, P, targetDay, opts) {
    const o = { ...DEFAULTS, ...opts };
    const row = pop.table[Math.min(o.lastDay, targetDay) - 1];
    return finish(row.bw, row.adg, row.fi, P, o);
  }

  // (2) 简单外推：最近一次称重 + 最近两次称重之间的日增重；采食取最近一整周；没有的数据用标准表补
  function simpleForecast(obs, pop, P, cutoff, targetDay, opts) {
    const o = { ...DEFAULTS, ...opts };
    const v = visible(obs, cutoff);
    const row = pop.table[Math.min(o.lastDay, targetDay) - 1];
    const ws = v.weighings, last = ws[ws.length - 1];
    const adg = ws.length >= 2 ? clampAdg((last.mean - ws[ws.length - 2].mean) / (last.day - ws[ws.length - 2].day), o) : row.adg;
    const fi = v.weeks.length ? v.weeks[v.weeks.length - 1].fi : row.fi;
    return finish(last.mean + adg * (targetDay - last.day), adg, fi, P, o);
  }

  // (2b) 逐头简单滚动估计（个体饲喂站研究中常用的基线）：最近 winW 天体重做线性回归得体重与日增重，
  //      采食取最近 winF 天平均；数据不够时用标准表补。
  function rollingForecast(obs, pop, P, cutoff, targetDay, opts) {
    const o = { winW: 14, winF: 7, ...DEFAULTS, ...opts };
    const v = visible(obs, cutoff);
    const row = pop.table[Math.min(o.lastDay, targetDay) - 1];
    const ws = v.weighings.filter((w) => w.day > cutoff - o.winW);
    const fs = v.weeks.filter((wk) => wk.end > cutoff - o.winF);
    let bw, adg;
    if (ws.length >= 5) {
      const xs = ws.map((w) => w.day), ys = ws.map((w) => w.mean), mx = mean(xs), my = mean(ys);
      let sxy = 0, sxx = 0;
      for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) * (xs[k] - mx); }
      adg = clampAdg(sxy / sxx, o);
      bw = my + (sxy / sxx) * (targetDay - mx);
    } else {
      const last = v.weighings[v.weighings.length - 1];
      adg = row.adg; bw = last.mean + adg * (targetDay - last.day);
    }
    const fi = fs.length ? mean(fs.map((wk) => wk.fi)) : row.fi;
    return finish(bw, adg, fi, P, o);
  }

  // (3) AI：状态 [体重 W, 批次乘数 κ] 的卡尔曼滤波 + 采食系数 φ 的随机游走滤波。
  //     日增重 = κ × 采食 × 历史批次同期的增重/采食比（gainMode 'energy' 时改为 κ × α(W) × 净能）；
  //     群体曲线与 κ、φ 的先验都来自历史批次（分层：群体曲线 + 批间方差），
  //     这批猪的称重和耗料一进来就更新；两次称重之间，用实测耗料推算体重（“用耗料推体重”）；
  //     对未来，用 φ × 群体采食曲线外推。
  function aiForecast(obs, pop, P, cutoff, targetDays, opts) {
    const o = { ...DEFAULTS, ...opts };
    const NEf = P.energy.ne_feed_mj_per_kg;
    const v = visible(obs, cutoff);
    const targets = Array.isArray(targetDays) ? targetDays : [targetDays];
    const horizon = Math.max(...targets);
    const weighAt = new Map(v.weighings.map((w) => [w.day, w.mean]));
    const lastSeenEnd = v.weeks.length ? v.weeks[v.weeks.length - 1].end : 0;
    const weekOf = (t) => v.weeks.find((wk) => t >= wk.start && t <= wk.end);

    const gfAt = (t) => pop.gfDay[Math.min(pop.gfDay.length, Math.max(1, t)) - 1];
    const gainOf = pop.gainMode === 'energy'
      ? (w, fi) => pop.alphaPop(w) * (fi * NEf - neMaint(w, P))
      : (w, fi, t) => fi * gfAt(t);
    // 初值：进栏称重；κ 从 1（群体平均）出发
    const y1 = weighAt.get(1);
    let W = y1, A = 1;
    let sWW = Math.pow(o.weighCV * y1, 2), sWA = 0, sAA = pop.tauKappa2;
    let phi = 1, pPhi = pop.tauPhi2, phiWeeks = 0;
    let wkSum = 0, wkDays = 0;
    const out = new Map();
    const path = [];

    for (let t = 1; t <= horizon; t++) {
      // 称重更新（第 1 天已作初值）
      if (t > 1 && weighAt.has(t)) {
        const y = weighAt.get(t), R = Math.pow(o.weighCV * y, 2), s = sWW + R;
        const kW = sWW / s, kA = sWA / s, innov = y - W;
        W += kW * innov; A += kA * innov;
        const nWW = sWW - sWW * sWW / s, nWA = sWA - sWW * sWA / s, nAA = sAA - sWA * sWA / s;
        sWW = nWW; sWA = nWA; sAA = Math.max(nAA, 1e-12);
      }
      // 当天采食：已结束的周用实测周均值，其余用 φ × 群体曲线
      const wk = t <= lastSeenEnd ? weekOf(t) : null;
      const fiForecast = phi * pop.fiPop(W, t);
      const fi = wk ? wk.fi : fiForecast;
      const g = gainOf(W, fi, t); // κ = 1 时这一天的增重
      path.push({ day: t, W, sdW: Math.sqrt(sWW), fi, observedFeed: !!wk });
      if (targets.includes(t)) {
        const fiT = phi * pop.fiPop(W, t);
        const adgT = A * gainOf(W, fiT, t);
        const sdFi = Math.sqrt(pPhi) * pop.fiPop(W, t);
        out.set(t, finish(W, adgT, fiT, P, o, { sdBw: Math.sqrt(sWW), sdFi, kappa: A, sdKappa: Math.sqrt(sAA), phi, sdPhi: Math.sqrt(pPhi) }));
      }
      // 周末：用这一周的实测采食更新 φ
      if (wk) {
        wkSum += W; wkDays++;
        if (t === wk.end) {
          const z = wk.fi / pop.fiPop(wkSum / wkDays, wk.start);
          if (phiWeeks > 0) pPhi += pop.qPhi;
          const K = pPhi / (pPhi + pop.rPhi);
          phi += K * (z - phi); pPhi *= (1 - K);
          phiWeeks++; wkSum = 0; wkDays = 0;
        }
      } else if (t > lastSeenEnd && (t - lastSeenEnd) % o.weekLen === 0) {
        pPhi += pop.qPhi; // 越往后越不确定
      }
      // 推进到下一天：W ← W + κ·g；协方差 F·S·Fᵀ + Q，F = [[1, g], [0, 1]]
      const nWW = sWW + 2 * g * sWA + g * g * sAA + pop.qW;
      const nWA = sWA + g * sAA;
      sWW = nWW; sWA = nWA;
      W += A * g;
    }
    return Array.isArray(targetDays) ? { forecasts: targets.map((t) => out.get(t)), path } : out.get(targetDays);
  }

  /* ================= 5. 每周的决策时点 ================= */
  // 第 k 周从 start 开始；料要提前 leadDays 天定，所以决策当天只能看到 start − leadDays − 1 天以前的数据。
  function decisionWeeks(opts) {
    const o = { ...DEFAULTS, ...opts };
    const weeks = [];
    for (let start = 1; start <= o.lastDay; start += o.weekLen) {
      const end = Math.min(o.lastDay, start + o.weekLen - 1);
      weeks.push({ start, end, cutoff: start - o.leadDays - 1, target: Math.min(end, start + 3) });
    }
    return weeks;
  }

  return {
    DEFAULTS, mulberry32, gaussian, obsSeed, quadFit, neMaint, requirementDensity,
    groupBatches, truthBatch, observeBatch, visible, reconstruct, fitPopulation,
    tableForecast, simpleForecast, rollingForecast, aiForecast, decisionWeeks,
  };
})();
