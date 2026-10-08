// 【已弃用】示范参数（2026-09-29 版）。工具与回放已统一到国内参数 feed2climate-china.js，本文件不再被加载。
// 保留仅供追溯：旧示范算例的原料表、A/B 配方与粪污参数均在此。不要在新代码中引用。
// 所有外部系数与来源标注集中在此。改参数即改场景，不改代码。
// 成分数值是示范值（量级参照 INRA-CIRAD-AFZ 表），正式使用前须逐项经营养师确认；
// 排放系数量级参照 ECOALIM v7（Wilfart 等 2016；经 de Quelen 等 2021 报道的全价料 0.338–0.518 kg CO2e/kg）。
'use strict';
window.F2C_PARAMETERS = {
  meta: {
    scenario_name: '法国育肥猪 A/B 精准饲喂示范算例',
    created: '2026-09-29',
    common_basis: '候选方案与当前方案使用相同采食量、营养要求与粪污管理；结果称为“给定条件下的可行方案”与“模型化排放差异”。',
  },

  // —— 来自原始数据作者的换算（DLM_script.R，随 Zenodo 6626445 发布）——
  energy: {
    ne_feed_mj_per_kg: 9.85, // 仅作参考：数据作者对记录日粮的净能取值
    maintenance_exponent: 0.6,
    maintenance_coefficient: 1.05, // 1.05 MJ ME/kg^0.6
    maintenance_net_availability: 0.74, // NE:ME 比例 → NE 维持 = 0.777 × W^0.6 MJ/天
    source: 'DLM_script.R（随 Zenodo 6626445 发布）：MRt = Wt^0.6 × 1.05 × 0.74',
    source_url: 'https://zenodo.org/records/6626445',
  },

  // —— 饲料原料组成与属性（示范值；正式使用应逐项换用 INRA-CIRAD-AFZ / ECOALIM 数值）——
  ingredients: {
    source: '示范值：营养量级参照 INRA-CIRAD-AFZ 表；排放量级参照 ECOALIM v7（Wilfart 等 2016，doi:10.1371/journal.pone.0167343）；价格为示范值（量级参照 de Quelen 等 2021 报道的 2018 年 IFIP 价：小麦 203、豆粕 351 €/t）',
    corn: { name: '玉米', ne: 10.6, sidLys: 2.4, cp: 85, co2e: 0.38, price: 190, unit: 'MJ NE/kg · g SID 赖氨酸/kg · g CP/kg · kg CO2e/kg · €/t' },
    barley: { name: '大麦', ne: 9.5, sidLys: 3.2, cp: 105, co2e: 0.40, price: 180 },
    soybean_meal: { name: '豆粕', ne: 8.2, sidLys: 28.7, cp: 460, co2e: 0.95, price: 351 },
    rapeseed_meal: { name: '菜籽粕', ne: 6.6, sidLys: 16.8, cp: 350, co2e: 0.35, price: 220 },
    soy_oil: { name: '豆油', ne: 28.5, sidLys: 0, cp: 0, co2e: 1.6, price: 800 },
    l_lysine_hcl: { name: 'L-赖氨酸盐酸盐', ne: 0, sidLys: 788, cp: 0, co2e: 3.0, price: 2000 },
    premix: { name: '预混料', ne: 0, sidLys: 0, cp: 0, co2e: 3.0, price: 2500 },
  },

  // —— A/B 基础料配方（质量占比，合计 = 1）——
  diets: {
    source: '两基础料混合模式参照 Llorens 等 2024 JAS 的精准饲喂结构；配方为示范值',
    A: {
      name: '基础料 A（蛋白浓缩型，配合全期早期需要）',
      recipe: { soybean_meal: 0.25, rapeseed_meal: 0.05, corn: 0.4925, barley: 0.192, soy_oil: 0.01, l_lysine_hcl: 0.003, premix: 0.0025 },
    },
    B: {
      name: '基础料 B（谷物型低蛋白，育肥后期平衡）',
      recipe: { soybean_meal: 0.04, rapeseed_meal: 0.03, corn: 0.30, barley: 0.624, soy_oil: 0.003, l_lysine_hcl: 0.0005, premix: 0.0025 },
    },
  },

  // —— 营养要求曲线（文献引用量级，显式录入；正式使用须经营养师确认或换用明确版本标准）——
  requirements: {
    source: '维持项与增重项分列：SID 赖氨酸 = 0.036 g/kg BW^0.75/天 + 20 g/kg 增重（K-State 育肥猪营养指南引 Rostagno 2017；0.036 为文献常用值）；NE = 0.777×BW^0.6（数据作者公式）+ 9.0 MJ/kg 增重（示范值，量级参照本数据集能量分配框架 alpha≈0.08–0.11 kg/MJ 及文献 9–14 MJ/kg）',
    lys_maint_g_per_kg75: 0.036,
    lys_gain_g_per_kg: 20.0,
    ne_gain_mj_per_kg: 9.0,
    cp_floor_g_per_kg: 120, // 防止过度稀释的保障性下限（示范假设；约束以 NE 与 SID 赖氨酸为主）
    adg_for_requirements_kg_day: 0.90, // 要求曲线使用的增重目标：显式设定，不由历史曲线推断
    notes: '公式与参数显式展示；增重目标为用户可改的显式假设，非预测。',
  },

  // —— 粪污氮平衡与 IPCC 排放（可核算项；公式结构 IPCC 2019，参数为示范默认值）——
  manure: {
    source: 'IPCC 2019 Refinement Vol.4 Ch.10 公式结构；B0、MCF、EF3 为示范默认值（正式使用应按地区与系统取 IPCC 表值）',
    source_url: 'https://www.ipcc-nggip.iges.or.jp/public/2019rf/vol4.html',
    n_retention_g_per_kg_gain: 28.0,
    vs_ash_fraction: 0.8,
    digestibility: 0.80,
    dry_matter_fraction: 0.88,
    urine_n_fraction_of_excreted: 0.35,
    b0_m3_ch4_per_kg_vs: 0.45,
    mcf_slurry_cool: 0.20,
    mcf_slurry_temperate: 0.30,
    mcf_anaerobic_lagoon: 0.65,
    n2o_ef3_slurry_kg_n2o_n_per_kg_n: 0.005,
    fraction_n2o_n_to_n2o: 44 / 28,
    ch4_gwp100_ar6: 27,
    n2o_gwp100_ar6: 273,
  },

  // —— 机制假设（首版确定性假设，非预测）——
  mechanism: {
    source: '首版固定假设：换料不改变采食量与增重（条件情景比较的共同条件）',
    notes: '满足营养约束不代表实际换料后采食/增重不变；正式决策前需现场验证。',
    adg_kg_day: 0.90,
  },
};
