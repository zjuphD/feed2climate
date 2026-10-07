// Feed2Climate 首版计算引擎（无依赖，纯函数）。
// 流程：完整性检查 → 营养供需检查 → A/B 配比网格搜索 → 成本与模型化排放核算。
// 输出仅声称“给定条件下的可行方案”与“模型化排放差异”。
'use strict';
window.F2C_ENGINE = (function () {
  const GRID_STEP = 0.01; // A 料配比网格 0–100%

  function r(x, d) { const p = Math.pow(10, d == null ? 3 : d); return Math.round(x * p) / p; }

  // ---------- 完整性与单位检查 ----------
  function checkCompleteness(input) {
    const missing = [];
    if (!input.weightKg || input.weightKg <= 0) missing.push({ field: '体重', reason: '需要正数 kg 的最近体重' });
    if (!input.feedIntakeKgDay || input.feedIntakeKgDay <= 0) missing.push({ field: '采食量', reason: '需要正数 kg/天 的平均日采食量及其统计时间窗' });
    if (!input.feedWindowDays || input.feedWindowDays <= 0) missing.push({ field: '采食统计时间窗', reason: '需要说明采食量均值覆盖的天数' });
    if (!input.headCount || input.headCount < 1) missing.push({ field: '头数', reason: '群体核算需要完整栏舍头数' });
    if (!input.manureSystem) missing.push({ field: '粪污管理情景', reason: '需要选择液态储存等明确情景' });
    if (!input.climate) missing.push({ field: '气候区', reason: 'MCF 依气候区取值' });
    if (input.currentRatioA == null || isNaN(input.currentRatioA)) missing.push({ field: '当前 A 料配比', reason: '需要输入现用配方中基础料 A 的比例' });
    if (!input.priceDate) missing.push({ field: '价格日期', reason: '饲料价格必须标注日期' });
    return { ok: missing.length === 0, missing };
  }

  // ---------- 混合日粮属性（按配方质量占比加权原料） ----------
  function blendDiets(ratioA, P) {
    const Ing = P.ingredients;
    const recipeKeys = Object.keys(P.diets.A.recipe);
    const recipe = {};
    recipeKeys.forEach((k) => {
      recipe[k] = P.diets.A.recipe[k] * ratioA + P.diets.B.recipe[k] * (1 - ratioA);
    });
    const mix = (sel) => recipeKeys.reduce((s, k) => s + recipe[k] * sel(Ing[k]), 0);
    const cp = mix((i) => i.cp);
    return {
      ratioA: r(ratioA, 2),
      ratioB: r(1 - ratioA, 2),
      recipe: recipeKeys.reduce((o, k) => { o[k] = r(recipe[k], 5); return o; }, {}),
      ne: r(mix((i) => i.ne), 3),
      sidLys: r(mix((i) => i.sidLys), 2),
      cp: r(cp, 1),
      nG: r(cp / 6.25, 2), // 蛋白质含氮 16% → N = CP/6.25
      price: r(mix((i) => i.price), 2), // 欧元/吨（原料价加权）
      feedCo2e: r(mix((i) => i.co2e), 4), // kg CO2e/kg 饲料（原料排放加权）
    };
  }

  // ---------- 营养供需检查 ----------
  // NE 要求 = 维持（0.777×BW^0.6，来自数据作者公式）+ 沉积（9.0 MJ/kg × 固定 ADG 假设）；
  // SID 赖氨酸要求 = 维持（0.036×BW^0.75）+ 沉积（20 g/kg 增重 × ADG）。
  function nutritionCheck(diet, bwKg, feedKgDay, P) {
    const R = P.requirements;
    const En = P.energy;
    const adg = P.mechanism.adg_kg_day;
    const neReq = En.maintenance_coefficient * En.maintenance_net_availability * Math.pow(bwKg, En.maintenance_exponent)
      + R.ne_gain_mj_per_kg * adg;
    const neSup = diet.ne * feedKgDay;
    const lysReq = R.lys_maint_g_per_kg75 * Math.pow(bwKg, 0.75) + R.lys_gain_g_per_kg * adg;
    const lysSup = diet.sidLys * feedKgDay;
    const cpMin = R.cp_floor_g_per_kg;
    return {
      ne: {
        supply: r(neSup, 2), requirement: r(neReq, 2),
        margin: r(neSup - neReq, 2),
        pass: neSup >= neReq - 1e-9,
        unit: 'MJ NE/天',
        formula: `维持 ${En.maintenance_coefficient}×${En.maintenance_net_availability}×BW^${En.maintenance_exponent} + 沉积 ${R.ne_gain_mj_per_kg}×ADG ${adg}`,
      },
      sidLys: {
        supply: r(lysSup, 1), requirement: r(lysReq, 1),
        margin: r(lysSup - lysReq, 1),
        pass: lysSup >= lysReq - 1e-9,
        unit: 'g SID 赖氨酸/天',
        formula: `维持 ${R.lys_maint_g_per_kg75}×BW^0.75 + 沉积 ${R.lys_gain_g_per_kg}×ADG ${adg}`,
      },
      cp: {
        supply: r(diet.cp, 0), requirement: cpMin,
        margin: r(diet.cp - cpMin, 0),
        pass: diet.cp >= cpMin,
        unit: 'g CP/kg 饲料',
        formula: `防过度稀释的保障性下限 ${cpMin} g/kg`,
      },
    };
  }

  // ---------- A/B 配比搜索 ----------
  // 在 [minA, maxA] 网格上找出全部满足营养约束的配比，按成本/排放排序。
  function searchFeasible(ctx) {
    const { bwKg, feedKgDay, P, minA, maxA } = ctx;
    const feasible = [];
    for (let a = minA; a <= maxA + 1e-9; a += GRID_STEP) {
      const ratioA = r(Math.min(a, 1), 2);
      const diet = blendDiets(ratioA, P);
      const check = nutritionCheck(diet, bwKg, feedKgDay, P);
      const allPass = check.ne.pass && check.sidLys.pass && check.cp.pass;
      feasible.push({ ratioA, diet, check, allPass });
    }
    const ok = feasible.filter((f) => f.allPass);
    if (ok.length === 0) return { feasible: false, attempted: feasible.length };
    const byCost = [...ok].sort((a, b) => a.diet.price - b.diet.price);
    const byCo2e = [...ok].sort((a, b) => a.diet.feedCo2e - b.diet.feedCo2e);
    return {
      feasible: true,
      attempted: feasible.length,
      count: ok.length,
      minCost: byCost[0],
      minCo2e: byCo2e[0],
      // 候选去重：成本最优与排放最优不同才输出两个
      candidates: byCost[0].ratioA === byCo2e[0].ratioA ? [byCost[0]] : [byCost[0], byCo2e[0]],
    };
  }

  // ---------- 氮平衡与粪污排放 ----------
  // 日尺度：N 摄入/保留/排泄 g/天；VS kg/天；CH4、N2O 及 kg CO2e/头/天。
  function manureAndEmissions(diet, bwKg, feedKgDay, adgKgDay, P, manureSystem, climate) {
    const M = P.manure;
    const nIntake = diet.nG * feedKgDay;                       // g N/天
    const nRetention = M.n_retention_g_per_kg_gain * adgKgDay; // g N/天
    const nExcreted = Math.max(0, nIntake - nRetention);       // g N/天
    const nUrine = nExcreted * M.urine_n_fraction_of_excreted;
    const nFaeces = nExcreted - nUrine;

    // IPCC Tier 2 结构（示范简化）：VS = 干物质采食 × (1 - 消化率) × VS 占粪比例
    const dmIntake = feedKgDay * M.dry_matter_fraction; // 干物质含量（参数文件）
    const vsKg = r(dmIntake * (1 - M.digestibility) * M.vs_ash_fraction, 4);

    const mcf = manureSystem === 'lagoon' ? M.mcf_anaerobic_lagoon
      : (climate === 'temperate' ? M.mcf_slurry_temperate : M.mcf_slurry_cool);
    // EF = VS × B0 × 0.67 × MCF → kg CH4/天
    const ch4KgDay = vsKg * M.b0_m3_ch4_per_kg_vs * 0.67 * mcf;
    const ch4Co2e = ch4KgDay * M.ch4_gwp100_ar6;

    // 直接 N2O：N 排泄 × EF3 × 44/28
    const n2oN = nExcreted / 1000 * M.n2o_ef3_slurry_kg_n2o_n_per_kg_n; // kg N2O-N/天
    const n2oKgDay = n2oN * M.fraction_n2o_n_to_n2o;
    const n2oCo2e = n2oKgDay * M.n2o_gwp100_ar6;

    const feedCo2eDay = diet.feedCo2e * feedKgDay;

    return {
      nIntake: r(nIntake, 1), nRetention: r(nRetention, 1), nExcreted: r(nExcreted, 1),
      nUrine: r(nUrine, 1), nFaeces: r(nFaeces, 1), unit: 'g N/天',
      vsKgDay: vsKg,
      mcfUsed: mcf,
      ch4KgDay: r(ch4KgDay, 4),
      n2oKgDay: r(n2oKgDay, 5),
      emissions: {
        feed: r(feedCo2eDay, 3),
        manureCh4: r(ch4Co2e, 3),
        manureN2o: r(n2oCo2e, 3),
        total: r(feedCo2eDay + ch4Co2e + n2oCo2e, 3),
        unit: 'kg CO2e/头/天',
      },
    };
  }

  // ---------- 单方案完整评估 ----------
  function evaluate(input, ratioA, P) {
    const diet = blendDiets(ratioA, P);
    const check = nutritionCheck(diet, input.weightKg, input.feedIntakeKgDay, P);
    const adg = P.mechanism.adg_kg_day;
    const em = manureAndEmissions(diet, input.weightKg, input.feedIntakeKgDay, adg, P, input.manureSystem, input.climate);
    const fi = input.feedKgDayForCost != null ? input.feedKgDayForCost : input.feedIntakeKgDay;
    const costPerHeadDay = diet.price / 1000 * fi; // 欧元/头/天，按共同采食情景
    return { ratioA, diet, check, adg, feedKgDayUsed: fi, costPerHeadDay: r(costPerHeadDay, 3), ...em };
  }

  // ---------- 群体换算（栏舍合计，线性放大每头结果） ----------
  function herdTotals(ev, headCount) {
    const n = headCount;
    return {
      headCount: n,
      feedKgDay: r(ev.feedKgDayUsed * n, 1),
      feedTonnesDay: r(ev.feedKgDayUsed * n / 1000, 4),
      costPerDay: r(ev.costPerHeadDay * n, 2), // €/天
      nExcretedKgDay: r(ev.nExcreted / 1000 * n, 2),
      emissions: {
        feed: r(ev.emissions.feed * n, 2),
        manureCh4: r(ev.emissions.manureCh4 * n, 2),
        manureN2o: r(ev.emissions.manureN2o * n, 2),
        total: r(ev.emissions.total * n, 2),
        unit: 'kg CO2e/天（栏舍）',
      },
      note: '线性换算：每头结果 × 头数；不含群体层面的额外相互作用。',
    };
  }

  // ---------- 主入口 ----------
  function run(input, P) {
    const completeness = checkCompleteness(input);
    if (!completeness.ok) return { status: 'incomplete', completeness };

    const minA = 0, maxA = 1; // 首版不额外限制混合比例；如有限制应来自用户显式录入
    const search = searchFeasible({ bwKg: input.weightKg, feedKgDay: input.feedIntakeKgDay, P, minA, maxA });

    const current = evaluate(input, input.currentRatioA, P);
    const currentAllPass = current.check.ne.pass && current.check.sidLys.pass && current.check.cp.pass;

    if (!search.feasible) {
      // 无可行方案：报告冲突，不输出“最优配方”
      const probes = [0, 0.5, 1].map((a) => {
        const e = evaluate(input, a, P);
        return { ratioA: a, nePass: e.check.ne.pass, lysPass: e.check.sidLys.pass, cpPass: e.check.cp.pass };
      });
      return {
        status: 'infeasible',
        current, currentAllPass, search,
        conflict: {
          message: '在 0–100% 配比范围内未找到同时满足 NE、SID 赖氨酸与 CP 约束的配比。',
          probes,
          advice: '请检查要求参数是否过严、采食量是否录入正确，或放宽使用约束。',
        },
      };
    }

    const candidates = search.candidates.map((c) => evaluate(input, c.ratioA, P));
    return {
      status: 'ok',
      current, currentAllPass,
      search: { attempted: search.attempted, feasibleCount: search.count },
      candidates,
      commonConditions: P.meta.common_basis,
    };
  }

  return { run, blendDiets, nutritionCheck, manureAndEmissions, evaluate, herdTotals, checkCompleteness };
})();
