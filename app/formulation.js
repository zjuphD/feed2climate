// Feed2Climate 国内情景：配方与排放核算（无依赖，纯函数；线性规划复用 ai.js 的单纯形求解器）。
// 配方：玉米–豆粕 + 合成氨基酸，约束每 kg 饲料的 NE、SID 赖氨酸，以及按理想蛋白比例换算的苏、蛋+胱、色、缬、异亮；
//       合成氨基酸有配合上限。目标：最低原料成本（可加碳排放权重）。能量目标达不到时只放松能量，不动氨基酸。
// 核算：饲料碳排放 + 粪污 CH4 + 直接 N2O + 间接 N2O（挥发、淋失），参数见 parameters/feed2climate-china.js。
'use strict';
window.F2C_FORMULATION = (function () {
  const AA = ['lys', 'thr', 'metcys', 'trp', 'val', 'ile'];
  const RATIO_AA = ['thr', 'metcys', 'trp', 'val', 'ile'];
  const N2O_PER_N = 44 / 28;

  function arrays(C, opts) {
    const keys = Object.keys(C.ingredients);
    const ing = (k) => C.ingredients[k];
    const scenario = opts && opts.sbmScenario;
    return {
      keys,
      ne: keys.map((k) => ing(k).ne),
      cp: keys.map((k) => ing(k).cp),
      sid: AA.reduce((o, aa) => { o[aa] = keys.map((k) => (ing(k).sid[aa] || 0)); return o; }, {}),
      price: keys.map((k) => ing(k).price),
      co2e: keys.map((k) => (scenario && ing(k).co2eScenarios ? ing(k).co2eScenarios[scenario] : ing(k).co2e)),
      max: keys.map((k) => (ing(k).max == null ? null : ing(k).max)),
    };
  }
  const unit = (n, j) => { const a = new Array(n).fill(0); a[j] = 1; return a; };

  function constraints(A, C, ne, lys) {
    const n = A.keys.length;
    const cons = [{ a: new Array(n).fill(1), b: 1, type: '=' }];
    if (ne > 0) cons.push({ a: A.ne.map((v) => -v), b: -ne, type: '<=' });
    cons.push({ a: A.sid.lys.map((v) => -v), b: -lys, type: '<=' });
    for (const aa of RATIO_AA) cons.push({ a: A.sid[aa].map((v) => -v), b: -C.idealRatio[aa] * lys, type: '<=' });
    A.max.forEach((m, j) => { if (m != null) cons.push({ a: unit(n, j), b: m, type: '<=' }); });
    return cons;
  }

  function perKgOf(A, x) {
    const dot = (v) => v.reduce((s, vv, j) => s + vv * x[j], 0);
    const out = { ne: dot(A.ne), cp: dot(A.cp), price: dot(A.price) / 1000, co2e: dot(A.co2e) };
    for (const aa of AA) out[aa] = dot(A.sid[aa]);
    out.nG = out.cp / 6.25;
    return out;
  }

  // target: { ne, lys }（每 kg 饲料）；opts: { co2eWeight (0–1，默认 0 = 最低成本), sbmScenario: 'low'|'mid'|'high' }
  function formulate(C, target, opts) {
    const o = opts || {};
    const solveLP = window.F2C_AI.solveLP;
    const A = arrays(C, o);
    const n = A.keys.length;
    const w = o.co2eWeight || 0;
    // 成本以 元/kg 计；碳排放权重下把 kg CO2e 与元相加（w 只用来描绘取舍，不代表碳价）
    const c = A.keys.map((_, j) => (A.price[j] / 1000) * (1 - w) + A.co2e[j] * w);
    const feasible = (ne, lys) => solveLP(n, constraints(A, C, ne, lys), c).status === 'optimal';
    const highest = (ok, hi) => { let lo = 0; for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; } return lo; };
    // 赖氨酸目标超出这些原料能达到的上限（理想比例下）时，按上限配——如实记为营养不足，不降低其他目标
    let lys = target.lys, lysCapped = false;
    if (!feasible(0, lys)) { lys = highest((l) => feasible(0, l), lys); lysCapped = true; }
    // 能量达不到时只放松能量
    let ne = target.ne, neRelaxed = false;
    if (!feasible(ne, lys)) { ne = highest((e) => feasible(e, lys), ne); neRelaxed = true; }
    const sol = solveLP(n, constraints(A, C, ne, lys), c);
    if (sol.status !== 'optimal') return { status: 'infeasible', target };
    const recipe = {};
    A.keys.forEach((k, j) => { recipe[k] = sol.x[j]; });
    return { status: 'optimal', recipe, perKg: perKgOf(A, sol.x), neRelaxed, neTarget: target.ne, neUsed: ne, lysCapped, lysUsed: lys };
  }

  // 每头每天的排放核算。pig: { bw, adg, fi }；diet: perKg（含 nG、co2e）；opts: { system, climate }
  function account(C, diet, pig, opts) {
    const M = C.manure, o = opts || {};
    const sys = M.systems[o.system || 'slurry_nocrust'];
    const zone = M.mcf[o.climate || 'warm_moist'];
    const nIntake = diet.nG * pig.fi;                                // g N/天
    const nRetained = M.n_retention_g_per_kg_gain * pig.adg;          // g N/天
    const nExcreted = Math.max(0, nIntake - nRetained);               // g N/天
    const feed = diet.co2e * pig.fi;                                   // kg CO2e/天
    const vs = pig.fi * M.dry_matter_fraction * (1 - M.digestibility) * M.vs_fraction; // kg VS/天
    const mcf = o.system === 'lagoon' ? zone.lagoon : zone.liquid3m;
    const ch4 = vs * M.b0_m3_ch4_per_kg_vs * 0.67 * mcf;               // kg CH4/天
    const n2oDirect = (nExcreted / 1000) * sys.ef3 * N2O_PER_N;        // kg N2O/天
    const nVolatilised = (nExcreted / 1000) * sys.fracGas;
    const nLeached = (nExcreted / 1000) * sys.fracLeach;
    const n2oIndirect = (nVolatilised * M.ef4 + nLeached * M.ef5) * N2O_PER_N;
    return {
      nIntake, nRetained, nExcreted, nh3N: nVolatilised * 1000,
      feed, ch4: ch4 * M.gwp.ch4, n2oDirect: n2oDirect * M.gwp.n2o, n2oIndirect: n2oIndirect * M.gwp.n2o,
      total: feed + ch4 * M.gwp.ch4 + (n2oDirect + n2oIndirect) * M.gwp.n2o,
      mcf, system: sys.name, unit: 'kg CO2e/头/天（N 为 g/头/天）',
    };
  }

  return { AA, RATIO_AA, arrays, constraints, formulate, account };
})();
