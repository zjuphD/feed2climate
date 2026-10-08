// 国内情景参数：玉米–豆粕型育肥日粮 + 合成氨基酸，按理想蛋白比例配方；粪污排放按 IPCC 2019。
// 原料成分与碳排放：INRA-CIRAD-AFZ 饲料表（feedtables.com，按饲喂状态计；碳排放为 “Climate change (ILCD)”，数据来自 ECOALIM）。
// 价格：玉米、豆粕取农业农村部畜牧兽医局 2026 年 8 月第 3 周（采集日 8 月 20 日）全国集贸市场价；第 2 周官网原文已核实（玉米 2.46、豆粕 3.23 元/公斤），第 3 周数字来自转载，待核实；合成氨基酸的 2026-02-27 报价来源未核实（配置中的“华源证券 2026-03-01 报告转引”未找到原文），公开前需替换或核实。
// 不含矿物质、维生素预混料和加工费：各方案相同，不影响方案之间的差值；成本只比较能量、蛋白和氨基酸原料。
'use strict';
window.F2C_CHINA = {
  meta: {
    name: '国内玉米–豆粕型育肥日粮（合成氨基酸平衡）',
    created: '2026-10-07',
    price_unit: '元/吨',
    price_date: '玉米、豆粕 2026-08-20（第 3 周，待核实）；合成氨基酸 2026-02-27（来源未核实）',
    note: '原料只用玉米与豆粕两种大宗原料加合成氨基酸，是国内育肥料最常见的结构；未纳入豆油（未找到可靠的国内现价来源），能量浓度达不到目标的日子只放松能量约束、不动氨基酸约束。',
    common_basis: '候选方案与当前方案使用相同采食量、营养要求与粪污管理；结果称为“给定条件下的可行方案”与“模型化排放差异”。',
  },

  // 每 kg 原料（饲喂状态）：ne 生长猪净能 MJ/kg；cp 粗蛋白 g/kg；sid 标准回肠可消化氨基酸 g/kg；price 元/吨；co2e kg CO2e/kg；max 配合上限
  ingredients: {
    corn: {
      name: '玉米', ne: 11.0, cp: 76,
      sid: { lys: 1.9, thr: 2.4, metcys: 3.2, trp: 0.4, val: 3.3, ile: 2.5 },
      price: 2460, co2e: 0.443,
      source: 'INRA-CIRAD-AFZ: Maize；碳排放取法国产、仓储出库值（国内玉米暂无同口径数据）；价格：农业农村部畜牧兽医局 2026-08-20 周报 2.46 元/kg（第 2 周原文已核实，第 3 周待核实）',
    },
    sbm: {
      name: '豆粕（43.5% 粗蛋白）', ne: 8.2, cp: 435,
      sid: { lys: 24.2, thr: 14.5, metcys: 11.5, trp: 5.3, val: 18.4, ile: 17.7 },
      price: 3250, co2e: 1.138,
      co2eScenarios: { low: 0.541, mid: 1.138, high: 1.690 },
      source: 'INRA-CIRAD-AFZ: Soybean meal, oil < 5%, 46% protein + oil；碳排放取巴西大豆在进口国压榨的三档毁林情景（不涉毁林 0.541 / 平均 1.138 / 涉毁林 1.690，原表为 48% 豆粕）；价格：农业农村部畜牧兽医局 2026-08-20 周报 3.25 元/kg（第 3 周，待核实；第 2 周原文为 3.23）',
    },
    lys: { name: 'L-赖氨酸盐酸盐', ne: 14.2, cp: 954, sid: { lys: 798 }, price: 6600, co2e: 10.004, max: 0.006, source: 'INRA-CIRAD-AFZ: L-lysine HCl；98% 赖氨酸 6.4–6.85 元/kg' },
    thr: { name: 'L-苏氨酸', ne: 12.3, cp: 731, sid: { thr: 990 }, price: 7600, co2e: 10.004, max: 0.003, source: 'INRA-CIRAD-AFZ: L-threonine；7.4–7.8 元/kg' },
    met: { name: 'DL-蛋氨酸', ne: 17.3, cp: 584, sid: { metcys: 990 }, price: 19000, co2e: 2.969, max: 0.003, source: 'INRA-CIRAD-AFZ: DL-methionine；18.8–19.2 元/kg' },
    trp: { name: 'L-色氨酸', ne: 19.8, cp: 840, sid: { trp: 977 }, price: 32500, co2e: 20.008, max: 0.001, source: 'INRA-CIRAD-AFZ: L-tryptophan；31.5–33.5 元/kg' },
    val: { name: 'L-缬氨酸', ne: 17.7, cp: 721, sid: { val: 965 }, price: 13250, co2e: 12.121, max: 0.002, source: 'INRA-CIRAD-AFZ: L-valine；13.0–13.5 元/kg' },
  },
  synthetic_cap_note: '合成氨基酸配合上限为示范假设：赖 ≤0.6%、苏 ≤0.3%、蛋 ≤0.3%、色 ≤0.1%、缬 ≤0.2%；没有便宜的合成异亮氨酸，异亮氨酸只能来自玉米和豆粕，这一条约束自然限定了蛋白最低能降到多少。',

  // 理想蛋白：其余必需氨基酸按 SID 赖氨酸的比例给出（van Milgen & Dourmad 2015, J Anim Sci Biotechnol 6:15, doi:10.1186/s40104-015-0016-1）
  idealRatio: { thr: 0.65, metcys: 0.60, trp: 0.22, val: 0.70, ile: 0.52 },
  idealRatio_source: 'van Milgen & Dourmad 2015：SID 基础，赖氨酸 = 100 时 蛋+胱 60、苏 65、色 22、缬 70、异亮 52',

  // 粪污：IPCC 2019 Refinement 第 4 卷第 10、11 章
  manure: {
    source: 'IPCC 2019 Refinement Vol.4：表 10.17（MCF）、10.21（EF3）、10.22（FracGas/FracLeach）、11.3（EF4、EF5）',
    systems: {
      slurry_nocrust: { name: '液态储存（无自然结壳）', ef3: 0, fracGas: 0.48, fracLeach: 0 },
      slurry_crust: { name: '液态储存（有自然结壳）', ef3: 0.005, fracGas: 0.30, fracLeach: 0 },
      pit: { name: '舍下粪坑', ef3: 0.002, fracGas: 0.25, fracLeach: 0 },
      lagoon: { name: '厌氧塘（无覆盖）', ef3: 0, fracGas: 0.40, fracLeach: 0 },
    },
    // MCF：液态储存/舍下粪坑按储存 3 个月；厌氧塘单列
    mcf: {
      warm_moist: { name: '温暖湿润', liquid3m: 0.24, lagoon: 0.73 },
      cool_moist: { name: '凉爽湿润', liquid3m: 0.12, lagoon: 0.60 },
    },
    ef4: 0.010,  // kg N2O–N / kg (NH3–N + NOx–N) 挥发
    ef5: 0.011,  // kg N2O–N / kg 淋失 N
    gwp: { ch4: 27.0, n2o: 273 }, // IPCC AR6 GWP100（CH4 取非化石来源）
    n_retention_g_per_kg_gain: 28.0, // 示范值（沿用原参数文件）：每 kg 增重沉积约 28 g N
    // 挥发性固体 VS = 采食 × 干物质 × (1 − 消化率) × (1 − 灰分)：示范算法，沿用原参数文件，各方案相同
    dry_matter_fraction: 0.88,
    digestibility: 0.80,
    vs_fraction: 0.80,
    b0_m3_ch4_per_kg_vs: 0.45, // IPCC 2019 表 10.16A：猪，高生产力体系
  },

  // 能量：数据作者随 Zenodo 6626445 发布的换算（DLM_script.R）；维持 NE = 1.05 × 0.74 × BW^0.6
  energy: {
    ne_feed_mj_per_kg: 9.85, // 仅作参考：数据作者对记录日粮的净能取值（预测层用它把采食换算为能量）
    maintenance_exponent: 0.6,
    maintenance_coefficient: 1.05, // 1.05 MJ ME/kg^0.6
    maintenance_net_availability: 0.74, // NE:ME 比例 → NE 维持 = 0.777 × W^0.6 MJ/天
    source: 'DLM_script.R（随 Zenodo 6626445 发布）：MRt = Wt^0.6 × 1.05 × 0.74',
    source_url: 'https://zenodo.org/records/6626445',
  },

  // 营养要求（每头每天）：维持 + 沉积。增重目标是显式假设，不由历史曲线推断。
  requirements: {
    source: '维持项与增重项分列：SID 赖氨酸 = 0.036 g/kg BW^0.75/天 + 20 g/kg 增重（K-State 育肥猪营养指南引 Rostagno 2017；0.036 为文献常用值）；NE = 0.777×BW^0.6（数据作者公式）+ 9.0 MJ/kg 增重（示范值，量级参照本数据集能量分配框架 alpha≈0.08–0.11 kg/MJ 及文献 9–14 MJ/kg）',
    lys_maint_g_per_kg75: 0.036,
    lys_gain_g_per_kg: 20.0,
    ne_gain_mj_per_kg: 9.0,
    cp_floor_g_per_kg: 120, // 粗蛋白保障性下限：只作检查项，不作配方约束（示范假设）
    adg_for_requirements_kg_day: 0.90, // 要求曲线使用的增重目标：显式设定，不由历史曲线推断
    notes: '公式与参数显式展示；增重目标为用户可改的显式假设，非预测。',
  },

  // 工具的两种基础料（A/B）：营养目标取三阶段（回放“三阶段（现行）”）的第一、第三阶段，
  // 即全部 13 批观测拟合的群体曲线在第 1、51 天的营养密度（每 kg 饲料）。
  // 配方由 formulation.js 在这两个目标下求最低成本解（能量达不到时只放松能量）。
  // 由 tools/derive-diets.js 生成；第 26 天参照：NE 8.649、赖氨酸 9.869。
  phaseTargets: {
    A: { name: '基础料 A（前期，第 1 天营养密度）', day: 1, ne: 10.867, lys: 13.817 },
    B: { name: '基础料 B（后期，第 51 天营养密度）', day: 51, ne: 8.108, lys: 9.041 },
  },

  // 首版机制假设（确定性，非预测）
  mechanism: {
    source: '首版固定假设：换料不改变采食量与增重（条件情景比较的共同条件）',
    notes: '满足营养约束不代表实际换料后采食/增重不变；正式决策前需现场验证。',
    adg_kg_day: 0.90,
  },
};
