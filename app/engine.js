// Feed2Climate 工具计算引擎（国内情景，无依赖，纯函数）。
// 流程：完整性检查 → 基础料 A/B（国内配方，见 formulation.js）→ 营养供需检查 → A/B 配比网格搜索 → 成本与排放核算（含间接 N2O）。
// 输出仅声称“给定条件下的可行方案”与“模型化排放差异”。
'use strict';
window.F2C_ENGINE = (function () {
  // 配方与排放核算模块在调用时再取，避免依赖脚本加载顺序
  const FM = () => window.F2C_FORMULATION;
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
    if (input.currentRatioA == null || isNaN(input.currentRatioA)) missing.push({ field: '当前基础料 A 比例', reason: '需要输入现用日粮中基础料 A 的比例' });
    if (!input.priceDate) missing.push({ field: '价格日期', reason: '饲料价格必须标注日期' });
    return { ok: missing.length === 0, missing };
  }

  // ---------- 基础料 A/B：按营养目标求得的最低成本配方与每 kg 饲料属性（按参数对象缓存） ----------
  const baseCache = new WeakMap();
  function baseDiets(C) {
    if (baseCache.has(C)) return baseCache.get(C);
    const out = {};
    for (const key of ['A', 'B']) {
      const t = C.phaseTargets[key];
      const res = FM().formulate(C, { ne: t.ne, lys: t.lys }, {});
      if (res.status !== 'optimal') throw new Error('基础料 ' + key + ' 在目标下无可行配方');
      out[key] = {
        key, name: t.name, day: t.day, target: { ne: t.ne, lys: t.lys },
        recipe: res.recipe, perKg: res.perKg,
        neRelaxed: res.neRelaxed, neUsed: res.neUsed, lysCapped: res.lysCapped,
      };
    }
    baseCache.set(C, out);
    return out;
  }

  // ---------- 混合日粮属性（配方与每 kg 饲料属性都是线性的，直接按比例混合） ----------
  function blendDiets(ratioA, C) {
    const B = baseDiets(C);
    const a = B.A.perKg, b = B.B.perKg;
    const mix = (k) => a[k] * ratioA + b[k] * (1 - ratioA);
    const recipe = {};
    Object.keys(B.A.recipe).forEach((k) => { recipe[k] = B.A.recipe[k] * ratioA + B.B.recipe[k] * (1 - ratioA); });
    const cp = mix('cp');
    return {
      ratioA: r(ratioA, 2),
      ratioB: r(1 - ratioA, 2),
      recipe: Object.keys(recipe).reduce((o, k) => { o[k] = r(recipe[k], 5); return o; }, {}),
      ne: r(mix('ne'), 3),                  // MJ NE/kg 饲料
      sidLys: r(mix('lys'), 2),             // g SID 赖氨酸/kg 饲料
      cp: r(cp, 1),                         // g CP/kg 饲料
      nG: r(cp / 6.25, 2),                  // 蛋白质含氮 16% → N = CP/6.25
      price: r(mix('price') * 1000, 0),     // 元/吨（原料价加权）
      feedCo2e: r(mix('co2e'), 4),          // kg CO2e/kg 饲料（原料排放加权）
    };
  }

  // ---------- 营养供需检查 ----------
  // NE 要求 = 维持（1.05 × 0.74 × BW^0.6，数据作者换算）+ 沉积（9.0 MJ/kg × 固定 ADG 假设）；
  // SID 赖氨酸要求 = 维持（0.036 × BW^0.75）+ 沉积（20 g/kg 增重 × ADG）。
  function nutritionCheck(diet, bwKg, feedKgDay, C) {
    const R = C.requirements;
    const En = C.energy;
    const adg = C.mechanism.adg_kg_day;
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
        formula: `防过度稀释的保障性下限 ${cpMin} g/kg（只作检查，不作配方约束）`,
      },
    };
  }

  // ---------- A/B 配比搜索 ----------
  // 在 [minA, maxA] 网格上找出全部满足营养约束的配比，按成本/排放排序。
  function searchFeasible(ctx) {
    const { bwKg, feedKgDay, C, minA, maxA } = ctx;
    const feasible = [];
    for (let a = minA; a <= maxA + 1e-9; a += GRID_STEP) {
      const ratioA = r(Math.min(a, 1), 2);
      const diet = blendDiets(ratioA, C);
      const check = nutritionCheck(diet, bwKg, feedKgDay, C);
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

  // ---------- 氮平衡与粪污排放（IPCC 2019，含直接与间接 N2O；核算本身在 formulation.js 的 account） ----------
  // 返回每头每天的 N（g/天）与排放（kg CO2e/头/天）。manureSystem 为 C.manure.systems 的键，climate 为 C.manure.mcf 的键。
  function manureAndEmissions(diet, bwKg, feedKgDay, adgKgDay, C, manureSystem, climate) {
    const a = FM().account(C, { nG: diet.nG, co2e: diet.feedCo2e }, { bw: bwKg, adg: adgKgDay, fi: feedKgDay }, { system: manureSystem, climate });
    return {
      nIntake: r(a.nIntake, 1), nRetention: r(a.nRetained, 1), nExcreted: r(a.nExcreted, 1), unit: 'g N/天',
      mcfUsed: a.mcf,
      systemName: a.system,
      emissions: {
        feed: r(a.feed, 3),
        manureCh4: r(a.ch4, 3),
        manureN2o: r(a.n2oDirect + a.n2oIndirect, 3),
        manureN2oDirect: r(a.n2oDirect, 3),
        manureN2oIndirect: r(a.n2oIndirect, 3),
        total: r(a.total, 3),
        unit: 'kg CO2e/头/天',
      },
    };
  }

  // ---------- 单方案完整评估 ----------
  function evaluate(input, ratioA, C) {
    const diet = blendDiets(ratioA, C);
    const check = nutritionCheck(diet, input.weightKg, input.feedIntakeKgDay, C);
    const adg = C.mechanism.adg_kg_day;
    const em = manureAndEmissions(diet, input.weightKg, input.feedIntakeKgDay, adg, C, input.manureSystem, input.climate);
    const fi = input.feedKgDayForCost != null ? input.feedKgDayForCost : input.feedIntakeKgDay;
    const costPerHeadDay = diet.price / 1000 * fi; // 元/头/天，按共同采食情景
    return { ratioA, diet, check, adg, feedKgDayUsed: fi, costPerHeadDay: r(costPerHeadDay, 3), ...em };
  }

  // ---------- 群体换算（栏舍合计，线性放大每头结果） ----------
  function herdTotals(ev, headCount) {
    const n = headCount;
    return {
      headCount: n,
      feedKgDay: r(ev.feedKgDayUsed * n, 1),
      feedTonnesDay: r(ev.feedKgDayUsed * n / 1000, 4),
      costPerDay: r(ev.costPerHeadDay * n, 2), // 元/天
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
  function run(input, C) {
    const completeness = checkCompleteness(input);
    if (!completeness.ok) return { status: 'incomplete', completeness };

    const minA = 0, maxA = 1; // 首版不额外限制混合比例；如有限制应来自用户显式录入
    const search = searchFeasible({ bwKg: input.weightKg, feedKgDay: input.feedIntakeKgDay, C, minA, maxA });

    const current = evaluate(input, input.currentRatioA, C);
    const currentAllPass = current.check.ne.pass && current.check.sidLys.pass && current.check.cp.pass;
    const bases = baseDiets(C);

    if (!search.feasible) {
      // 无可行方案：报告冲突，不输出“最优配方”
      const probes = [0, 0.5, 1].map((a) => {
        const e = evaluate(input, a, C);
        return { ratioA: a, nePass: e.check.ne.pass, lysPass: e.check.sidLys.pass, cpPass: e.check.cp.pass, neSupply: e.check.ne.supply, neRequirement: e.check.ne.requirement };
      });
      return {
        status: 'infeasible',
        current, currentAllPass, search, bases,
        conflict: {
          message: '在 0–100% 配比范围内未找到同时满足 NE、SID 赖氨酸与 CP 约束的配比。',
          probes,
          advice: '国内玉米–豆粕配方不含油脂，前期能量密度低于标准（见基础料说明）；能量不足时需加油脂或放宽能量要求，不能只靠调配比解决。',
        },
      };
    }

    const candidates = search.candidates.map((c) => evaluate(input, c.ratioA, C));
    return {
      status: 'ok',
      current, currentAllPass, bases,
      search: { attempted: search.attempted, feasibleCount: search.count },
      candidates,
      commonConditions: C.meta.common_basis,
    };
  }

  return { run, baseDiets, blendDiets, nutritionCheck, manureAndEmissions, evaluate, herdTotals, checkCompleteness };
})();
