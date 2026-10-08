// Feed2Climate AI 层（无依赖，纯函数，完全确定性）。
// 三个能力：
//   1) k-means 聚类：把 100 头猪的真实采食/增重曲线分为若干饲喂组（k-means++ + 多重启，全种子化，结果可复现）；
//   2) 原料级线性规划：以营养要求与原料配合上限为约束，求最低成本 / 最低排放 / 双目标加权配方（两阶段单纯形，Bland 规则）；
//   3) 情景比较：分层饲喂 vs 一刀切饲喂。两个情景都保证每头猪的营养要求得到满足：
//      分层配方按“组内最严格个体”求解，一刀切配方按“全群最严格个体”求解；
//      两情景对每头猪使用相同的体重、采食量与目标增重（各自历史均值夹值），差异只来自配方 → 公平比较。
// 边界与引擎一致：不做未来预测，组目标取组内历史均值的描述统计；结果称“给定条件下的可行方案”。
'use strict';
window.F2C_AI = (function () {
  const EPS = 1e-9;

  function r(x, d) { const p = Math.pow(10, d == null ? 4 : d); return Math.round(x * p) / p; }

  // ---------- 确定性伪随机数（Mulberry32） ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================= 1. 特征工程（描述统计，截至所选日） ================= */
  // 每头猪：初始/当前体重、平均日增重、平均采食量、采食变异系数、料重比。
  function featureVectors(records, cutoff) {
    return records.map((rec) => {
      const pts = rec.points.filter((p) => p.day <= cutoff);
      const bw0 = pts[0].weight;
      const bw1 = pts[pts.length - 1].weight;
      const days = Math.max(1, pts[pts.length - 1].day - pts[0].day);
      const adg = (bw1 - bw0) / days;
      const n = pts.length;
      const totalFeed = pts.reduce((s, p) => s + p.feed, 0);
      const avgFI = totalFeed / n;
      const varr = pts.reduce((s, p) => s + Math.pow(p.feed - avgFI, 2), 0) / n;
      const cvFI = avgFI > 0 ? Math.sqrt(varr) / avgFI : 0;
      const gain = bw1 - bw0;
      const fcr = gain > 0.5 ? totalFeed / gain : NaN; // 增重过小时料重比无意义
      return { id: rec.id, pen: rec.pen, bw0: r(bw0, 2), bw1: r(bw1, 2), adg, avgFI, cvFI, fcr, nDays: n };
    });
  }

  // 聚类用特征：ADG、平均采食量、采食变异（料重比与其共线，仅作展示）
  function clusteringMatrix(feats) {
    return feats.map((f) => [f.adg, f.avgFI, f.cvFI]);
  }

  function standardize(rows) {
    const n = rows.length, m = rows[0].length;
    const mean = [], sd = [];
    for (let j = 0; j < m; j++) {
      const mu = rows.reduce((s, x) => s + x[j], 0) / n;
      const va = rows.reduce((s, x) => s + Math.pow(x[j] - mu, 2), 0) / n;
      mean.push(mu); sd.push(Math.sqrt(va) || 1);
    }
    return {
      data: rows.map((x) => x.map((v, j) => (v - mean[j]) / sd[j])),
      mean, sd,
    };
  }

  /* ================= 2. k-means（k-means++ 初始化 + 多重启，全种子化） ================= */
  function kmeans(X, k, seed, opts) {
    const iters = (opts && opts.iters) || 100;
    const restarts = (opts && opts.restarts) || 12;
    const n = X.length, m = X[0].length;
    const dist2 = (a, b) => { let s = 0; for (let j = 0; j < m; j++) s += (a[j] - b[j]) * (a[j] - b[j]); return s; };

    function runOnce(rand) {
      // k-means++ 初始化
      const centers = [X[Math.floor(rand() * n)].slice()];
      while (centers.length < k) {
        const d = X.map((x) => Math.min(...centers.map((c) => dist2(x, c))));
        const sum = d.reduce((s, v) => s + v, 0);
        let target = rand() * sum, idx = n - 1;
        for (let i = 0; i < n; i++) { target -= d[i]; if (target <= 0) { idx = i; break; } }
        centers.push(X[idx].slice());
      }
      // Lloyd 迭代
      let assign = new Array(n).fill(-1);
      let inertia = 0;
      for (let it = 0; it < iters; it++) {
        let changed = false; inertia = 0;
        for (let i = 0; i < n; i++) {
          let best = 0, bd = Infinity;
          for (let c = 0; c < k; c++) { const d = dist2(X[i], centers[c]); if (d < bd) { bd = d; best = c; } }
          inertia += bd;
          if (assign[i] !== best) { assign[i] = best; changed = true; }
        }
        const sums = Array.from({ length: k }, () => new Array(m).fill(0));
        const cnt = new Array(k).fill(0);
        for (let i = 0; i < n; i++) { cnt[assign[i]]++; for (let j = 0; j < m; j++) sums[assign[i]][j] += X[i][j]; }
        for (let c = 0; c < k; c++) {
          if (cnt[c] > 0) for (let j = 0; j < m; j++) centers[c][j] = sums[c][j] / cnt[c];
          else { centers[c] = X[Math.floor(rand() * n)].slice(); } // 空簇：重新播种
        }
        if (!changed && it > 0) break;
      }
      return { assign, centers, inertia };
    }

    let best = null;
    for (let s = 0; s < restarts; s++) {
      const res = runOnce(mulberry32(seed * 1000 + s));
      if (!best || res.inertia < best.inertia - 1e-12) best = res;
    }
    return { assign: best.assign, centers: best.centers, inertia: best.inertia, k, seed, restarts };
  }

  /* ================= 3. 线性规划：两阶段单纯形（Bland 规则，确定性） ================= */
  // min c·x  s.t. cons: {a:[...], b, type:'<='|'>='|'='}, x >= 0
  function solveLP(nVars, cons, c) {
    const TOL = 1e-9, MAXIT = 2000;
    // 行规范化：rhs<0 时整行取负并翻转不等号
    const rowsSpec = cons.map(({ a, b, type }) => {
      let aa = a.slice(), bb = b, tt = type;
      if (bb < -TOL) { aa = aa.map((v) => -v); bb = -bb; tt = tt === '<=' ? '>=' : (tt === '>=' ? '<=' : '='); }
      return { a: aa, b: bb, type: tt };
    });

    // 列布局：nVars 个决策变量 + 每行松弛/剩余 + 每行人工
    const nRows = rowsSpec.length;
    let nCols = nVars;
    const slackIdx = [], artIdx = [];
    rowsSpec.forEach(({ type }) => {
      if (type === '<=') { slackIdx.push(nCols); nCols++; }
      else if (type === '>=') { slackIdx.push(nCols); nCols++; }
      else { slackIdx.push(-1); }
    });
    rowsSpec.forEach(({ type }, i) => {
      if (type === '=' || type === '>=') { artIdx[i] = nCols; nCols++; }
      else artIdx[i] = -1;
    });

    // 建表
    const T = rowsSpec.map(({ a, b, type }, i) => {
      const row = new Array(nCols + 1).fill(0);
      for (let j = 0; j < nVars; j++) row[j] = a[j];
      if (slackIdx[i] >= 0) row[slackIdx[i]] = type === '<=' ? 1 : -1;
      if (artIdx[i] >= 0) row[artIdx[i]] = 1;
      row[nCols] = b;
      return row;
    });
    // 初始基：<= 行用松弛，其余用人工
    let basis = rowsSpec.map(({ type }, i) => (type === '<=' ? slackIdx[i] : artIdx[i]));

    // 单纯形主循环（给定费用向量 cost，对当前基做迭代；banned 列禁止入基）
    // 目标行存约化成本 d_j = c_j - z_j（min 问题，d_j<0 可入基）
    function iterate(cost, banned) {
      const obj = new Array(nCols + 1).fill(0);
      for (let j = 0; j < nCols; j++) obj[j] = cost[j] || 0;
      obj[nCols] = 0;
      const cB = basis.map((bi) => cost[bi] || 0);
      // 归一化目标行：减去 c_B 与基行
      for (let i = 0; i < nRows; i++) {
        if (Math.abs(cB[i]) > TOL) {
          for (let j = 0; j <= nCols; j++) obj[j] -= cB[i] * T[i][j];
        }
      }
      let it = 0;
      while (it++ < MAXIT) {
        // Bland：选最小下标的入基列（跳过被封禁的列）
        let enter = -1;
        for (let j = 0; j < nCols; j++) {
          if (obj[j] < -1e-7 && !(banned && banned[j])) { enter = j; break; }
        }
        if (enter < 0) return { status: 'optimal', obj };
        // 最小比值检验（平局取基变量下标最小者，保 Bland 性质）
        let leave = -1, bestRatio = Infinity;
        for (let i = 0; i < nRows; i++) {
          if (T[i][enter] > TOL) {
            const ratio = T[i][nCols] / T[i][enter];
            if (ratio < bestRatio - 1e-12 || (Math.abs(ratio - bestRatio) <= 1e-12 && basis[i] < basis[leave])) {
              bestRatio = ratio; leave = i;
            }
          }
        }
        if (leave < 0) return { status: 'unbounded', obj };
        // 旋转变换
        const piv = T[leave][enter];
        for (let j = 0; j <= nCols; j++) T[leave][j] /= piv;
        for (let i = 0; i < nRows; i++) {
          if (i !== leave && Math.abs(T[i][enter]) > TOL) {
            const f = T[i][enter];
            for (let j = 0; j <= nCols; j++) T[i][j] -= f * T[leave][j];
          }
        }
        const f = obj[enter];
        if (Math.abs(f) > TOL) for (let j = 0; j <= nCols; j++) obj[j] -= f * T[leave][j];
        basis[leave] = enter;
      }
      return { status: 'maxiter', obj };
    }

    // 阶段一：最小化人工变量之和
    if (artIdx.some((v) => v >= 0)) {
      const phase1 = new Array(nCols).fill(0);
      artIdx.forEach((v) => { if (v >= 0) phase1[v] = 1; });
      const p1 = iterate(phase1);
      if (p1.status !== 'optimal') return { status: p1.status === 'maxiter' ? 'maxiter' : 'numerical' };
      const p1val = -p1.obj[nCols];
      if (p1val > 1e-7) return { status: 'infeasible' };
      // 把人工变量赶出基
      for (let i = 0; i < nRows; i++) {
        if (artIdx.includes(basis[i])) {
          for (let j = 0; j < nCols; j++) {
            if (Math.abs(T[i][j]) > 1e-8 && !artIdx.includes(j)) {
              const piv = T[i][j];
              for (let jj = 0; jj <= nCols; jj++) T[i][jj] /= piv;
              for (let ii = 0; ii < nRows; ii++) {
                if (ii !== i && Math.abs(T[ii][j]) > TOL) {
                  const f = T[ii][j];
                  for (let jj = 0; jj <= nCols; jj++) T[ii][jj] -= f * T[i][jj];
                }
              }
              basis[i] = j;
              break;
            }
          }
        }
      }
    }

    // 阶段二：以原费用向量迭代（人工列费用置 0 且封禁，不得重新入基）
    const cost2 = c.slice();
    artIdx.forEach((v) => { if (v >= 0) cost2[v] = 0; });
    const banned = new Array(nCols).fill(false);
    artIdx.forEach((v) => { if (v >= 0) banned[v] = true; });
    const p2 = iterate(cost2, banned);
    if (p2.status !== 'optimal') return { status: p2.status === 'unbounded' ? 'unbounded' : 'maxiter' };

    const x = new Array(nVars).fill(0);
    for (let i = 0; i < nRows; i++) if (basis[i] < nVars) x[basis[i]] = Math.max(0, T[i][nCols]);
    const objVal = c.reduce((s, cj, j) => s + cj * x[j], 0);
    return { status: 'optimal', x, obj: objVal };
  }

  /* ================= 4. 原料级配方 LP ================= */
  // 国内情景配方（玉米–豆粕 + 合成氨基酸）由 formulation.js 求解：能量达不到时只放松能量，不动氨基酸约束。
  // 要求可用两种方式给定：a) bw/adg/fi → 换成每 kg 饲料要求（要求/采食）；b) 直接给 neReqPerKg / lysReqPerKg。
  const CAP_NOTE = '合成氨基酸配合上限为示范假设（见参数文件 synthetic_cap_note）；能量达不到时只放松能量（neRelaxed）。';
  function dietLP(C, opts) {
    const w = opts.co2eWeight == null ? 0.5 : opts.co2eWeight;
    let neReqPerKg, lysReqPerKg, targets;
    if (opts.neReqPerKg != null && opts.lysReqPerKg != null) {
      neReqPerKg = opts.neReqPerKg; lysReqPerKg = opts.lysReqPerKg;
      targets = { neReqPerKg: r(neReqPerKg, 4), lysReqPerKg: r(lysReqPerKg, 4) };
    } else {
      const { bw, adg, fi } = opts;
      const R = C.requirements, En = C.energy;
      const neReq = En.maintenance_coefficient * En.maintenance_net_availability * Math.pow(bw, En.maintenance_exponent) + R.ne_gain_mj_per_kg * adg;
      const lysReq = R.lys_maint_g_per_kg75 * Math.pow(bw, 0.75) + R.lys_gain_g_per_kg * adg;
      neReqPerKg = neReq / fi; lysReqPerKg = lysReq / fi;
      targets = { bw, adg, fi, neReq: r(neReq, 2), lysReq: r(lysReq, 2), neReqPerKg: r(neReqPerKg, 4), lysReqPerKg: r(lysReqPerKg, 4) };
    }
    const res = window.F2C_FORMULATION.formulate(C, { ne: neReqPerKg, lys: lysReqPerKg }, { co2eWeight: w });
    if (res.status !== 'optimal') return { status: res.status, targets, w };
    const p = res.perKg;
    return {
      status: 'optimal',
      recipe: res.recipe,
      perKg: { ne: r(p.ne, 3), sidLys: r(p.lys, 2), cp: r(p.cp, 1), nG: r(p.nG, 2), price: r(p.price * 1000, 2), feedCo2e: r(p.co2e, 4) },
      keys: Object.keys(res.recipe), targets, w,
      neRelaxed: res.neRelaxed, neUsed: r(res.neUsed, 3), lysCapped: res.lysCapped,
      capNote: CAP_NOTE,
    };
  }

  /* ================= 5. 成本-排放 Pareto 前沿 ================= */
  // 对权重 w∈[0,1] 求解 min (1−w)·成本 + w·排放 → 得到成本-排放平面上的非支配点集。
  function paretoFront(C, opts) {
    const steps = (opts && opts.steps) || 11;
    const points = [];
    for (let s = 0; s <= steps; s++) {
      const w = s / steps;
      const res = dietLP(C, { ...opts, co2eWeight: w });
      if (res.status !== 'optimal') { points.push({ w, status: res.status }); continue; }
      points.push({
        w, status: 'optimal',
        costPerKg: r(res.perKg.price / 1000, 5),
        co2ePerKg: res.perKg.feedCo2e,
        recipe: res.recipe, perKg: res.perKg,
      });
    }
    const ok = points.filter((p) => p.status === 'optimal');
    const front = [];
    for (const p of ok) {
      const dominated = ok.some((q) => q !== p && q.costPerKg <= p.costPerKg + 1e-9 && q.co2ePerKg <= p.co2ePerKg - 1e-9);
      if (!dominated) front.push(p);
    }
    front.sort((a, b) => a.costPerKg - b.costPerKg);
    return { front, all: points, feasible: ok.length > 0 };
  }

  /* ================= 6. 情景比较：分层饲喂 vs 一刀切 ================= */
  const ADG_CLAMP = { min: 0.7, max: 1.1 };
  const clampADG = (x) => Math.min(ADG_CLAMP.max, Math.max(ADG_CLAMP.min, x));

  // 逐头“要求/采食”比（每头用自己的目标增重，夹值后）——两情景共用，保证生产假设一致。
  function perPigRequirements(f, C) {
    const En = C.energy, R = C.requirements;
    const adgT = clampADG(f.adg);
    const neReq = En.maintenance_coefficient * En.maintenance_net_availability * Math.pow(f.bw1, En.maintenance_exponent) + R.ne_gain_mj_per_kg * adgT;
    const lysReq = R.lys_maint_g_per_kg75 * Math.pow(f.bw1, 0.75) + R.lys_gain_g_per_kg * adgT;
    return { adgT, nePerFI: neReq / f.avgFI, lysPerFI: lysReq / f.avgFI };
  }

  // 每 kg 饲料可达的营养上限（同一套配方约束下，用于无解时报告冲突边界）。
  function maxAchievablePerKg(C) {
    const c = window.F2C_FORMULATION.ceilings(C);
    return { maxNE: r(c.maxNE, 3), maxLys: r(c.maxLys, 3) };
  }

  // 情景比较。requirementMode：
  //   'mean_margin'（默认）：按组/全群均值 + 安全边际（margin，默认 5%）求解 —— 行业常规口径；
  //   'strict'：覆盖组内/全群最严格个体 —— 最保守；若要求超出可达上限会如实报告无解。
  // 每种情景都报告“个体满足率”：该配方实际满足多少头猪自身的严格要求。
  function scenarioCompare(records, cutoff, C, opts) {
    const k = (opts && opts.k) || 3;
    const seed = (opts && opts.seed) != null ? opts.seed : 42;
    const co2eWeight = (opts && opts.co2eWeight) == null ? 0.5 : opts.co2eWeight;
    const requirementMode = (opts && opts.requirementMode) || 'mean_margin';
    const margin = (opts && opts.margin) != null ? opts.margin : 0.05;
    const manureSystem = (opts && opts.manureSystem) || 'slurry_nocrust';
    const climate = (opts && opts.climate) || 'warm_moist';

    const feats = featureVectors(records, cutoff).map((f) => ({ ...f, ...perPigRequirements(f, C) }));
    const mat = standardize(clusteringMatrix(feats));
    const km = kmeans(mat.data, k, seed);
    const pigs = feats.map((f, i) => ({ ...f, cluster: km.assign[i] }));

    const meanOf = (list, sel) => list.reduce((s, p) => s + sel(p), 0) / list.length;
    const reqTarget = (list) => requirementMode === 'strict'
      ? { ne: Math.max(...list.map((p) => p.nePerFI)), lys: Math.max(...list.map((p) => p.lysPerFI)) }
      : { ne: meanOf(list, (p) => p.nePerFI) * (1 + margin), lys: meanOf(list, (p) => p.lysPerFI) * (1 + margin) };

    // 组统计与组 LP
    const groups = [];
    for (let c = 0; c < k; c++) {
      const g = pigs.filter((p) => p.cluster === c);
      if (g.length === 0) continue;
      groups.push({
        cluster: c, members: g, n: g.length,
        meanBW: meanOf(g, (p) => p.bw1), meanADG: meanOf(g, (p) => p.adgT),
        meanFI: meanOf(g, (p) => p.avgFI), meanCV: meanOf(g, (p) => p.cvFI), meanFCR: meanOf(g, (p) => p.fcr),
        meanNePerFI: meanOf(g, (p) => p.nePerFI), meanLysPerFI: meanOf(g, (p) => p.lysPerFI),
        maxNePerFI: Math.max(...g.map((p) => p.nePerFI)), maxLysPerFI: Math.max(...g.map((p) => p.lysPerFI)),
      });
    }
    groups.sort((a, b) => b.meanADG - a.meanADG);
    groups.forEach((g, i) => {
      g.name = '组 ' + (i + 1);
      const t = reqTarget(g.members);
      g.lp = dietLP(C, { neReqPerKg: t.ne, lysReqPerKg: t.lys, co2eWeight });
    });

    // 一刀切 LP
    const uniformTarget = reqTarget(pigs);
    const uniformLP = dietLP(C, { neReqPerKg: uniformTarget.ne, lysReqPerKg: uniformTarget.lys, co2eWeight });

    // 个体满足率：配方营养浓度 ≥ 该头自身的严格“要求/采食”比
    function satisfaction(perKg, list) {
      if (!perKg) return null;
      let ok = 0;
      for (const p of list) if (perKg.ne >= p.nePerFI - 1e-9 && perKg.sidLys >= p.lysPerFI - 1e-9) ok++;
      return r(ok / list.length, 3);
    }

    // 逐头核算（两情景：相同的体重/采食/目标增重，只有配方不同）
    function perHead(perKg, p) {
      const em = window.F2C_ENGINE.manureAndEmissions(
        { nG: perKg.nG, feedCo2e: perKg.feedCo2e }, p.bw1, p.avgFI, p.adgT, C, manureSystem, climate
      );
      return {
        cost: (perKg.price / 1000) * p.avgFI,
        emissions: em.emissions.total,
        nExcreted: em.nExcreted,
      };
    }
    function totals(list) {
      let cost = 0, em = 0, nEx = 0;
      for (const t of list) { cost += t.cost; em += t.emissions; nEx += t.nExcreted / 1000; }
      return { headCount: list.length, costPerDay: r(cost, 2), emissionsPerDay: r(em, 2), nExcretedKgDay: r(nEx, 2) };
    }

    const groupedPerHead = pigs.map((p) => {
      const g = groups.find((gg) => gg.cluster === p.cluster);
      return g.lp.status === 'optimal' ? perHead(g.lp.perKg, p) : null;
    });
    const uniformPerHead = uniformLP.status === 'optimal' ? pigs.map((p) => perHead(uniformLP.perKg, p)) : null;

    const groupedTotals = groupedPerHead.every(Boolean) ? totals(groupedPerHead) : null;
    const uniformTotals = uniformPerHead ? totals(uniformPerHead) : null;
    const delta = groupedTotals && uniformTotals ? {
      costPerDay: r(groupedTotals.costPerDay - uniformTotals.costPerDay, 2),
      emissionsPerDay: r(groupedTotals.emissionsPerDay - uniformTotals.emissionsPerDay, 2),
      nExcretedKgDay: r(groupedTotals.nExcretedKgDay - uniformTotals.nExcretedKgDay, 2),
    } : null;

    const ceilings = maxAchievablePerKg(C);
    const modeNote = requirementMode === 'strict'
      ? '约束口径：覆盖组内/全群最严格个体（保守）'
      : '约束口径：组/全群均值 + ' + Math.round(margin * 100) + '% 安全边际（行业常规做法）';

    return {
      status: groupedTotals && uniformTotals ? 'ok' : 'partial',
      cutoff, k, seed, co2eWeight, requirementMode, margin, manureSystem, climate,
      ceilings,
      uniformTarget: { ne: r(uniformTarget.ne, 3), lys: r(uniformTarget.lys, 3) },
      method: {
        features: '平均日增重、平均日采食量、采食变异系数（截至所选日的描述统计，不做预测）',
        standardization: 'z-score 标准化后聚类',
        algorithm: `k-means++ 初始化 + Lloyd 迭代；种子 ${seed}，${km.restarts} 次重启取惯性最小；结果完全可复现`,
        requirement: '每头严格要求按其自身体重与目标增重（历史均值夹到 [' + ADG_CLAMP.min + '–' + ADG_CLAMP.max + '] kg/天）除以其自身采食量',
        mode: modeNote,
        satisfactionDef: '个体满足率 = 配方营养浓度 ≥ 该头严格“要求/采食”比的猪占比',
        compareBasis: '两情景每头猪使用相同的体重、采食量与目标增重，差异只来自配方',
        emissionNote: '栏舍排放 = 饲料生产 + 粪污 CH₄ + 粪污 N₂O（直接），情景：' + C.manure.systems[manureSystem].name + '/' + C.manure.mcf[climate].name,
        capNote: CAP_NOTE,
      },
      pigs: pigs.map((p) => ({
        id: p.id, pen: p.pen, cluster: p.cluster,
        bw1: r(p.bw1, 1), adg: r(p.adg, 4), avgFI: r(p.avgFI, 4), cvFI: r(p.cvFI, 4), fcr: isFinite(p.fcr) ? r(p.fcr, 3) : null,
      })),
      groups: groups.map((g) => ({
        name: g.name, cluster: g.cluster, n: g.n,
        meanBW: r(g.meanBW, 1), meanADG: r(g.meanADG, 3), meanFI: r(g.meanFI, 3),
        meanCV: r(g.meanCV, 3), meanFCR: isFinite(g.meanFCR) ? r(g.meanFCR, 3) : null,
        meanNePerFI: r(g.meanNePerFI, 3), meanLysPerFI: r(g.meanLysPerFI, 3),
        maxNePerFI: r(g.maxNePerFI, 3), maxLysPerFI: r(g.maxLysPerFI, 3),
        lp: g.lp,
        satisfaction: g.lp.status === 'optimal' ? satisfaction(g.lp.perKg, g.members) : null,
      })),
      uniform: {
        nePerFI: r(uniformTarget.ne, 3), lysPerFI: r(uniformTarget.lys, 3),
        lp: uniformLP,
        satisfaction: uniformLP.status === 'optimal' ? satisfaction(uniformLP.perKg, pigs) : null,
      },
      totals: { grouped: groupedTotals, uniform: uniformTotals },
      delta,
    };
  }

  return { mulberry32, featureVectors, clusteringMatrix, standardize, kmeans, solveLP, dietLP, paretoFront, scenarioCompare, maxAchievablePerKg, CAP_NOTE, ADG_CLAMP, perPigRequirements };
})();
