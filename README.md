# Feed2Climate · AI 驱动的精准饲喂与模型化减排

## Overview (English)

Feed2Climate is a transparent decision-support tool for pig nutritionists. It forecasts next week's body weight and feed intake for each batch, with uncertainty; computes the energy and digestible lysine each kilogram of feed must supply; and finds the least-cost corn–soybean meal ration that meets those needs under ideal-protein ratios. It reports feed cost and modeled emissions (feed, manure CH₄, direct and indirect N₂O), with the source of every input shown. It is read-only: a nutritionist makes every decision.

**Run it (no installation):** open `dist/feed2climate-standalone.html` in a browser. It works offline. The evidence story page is `dist/feed2climate-story.html`.

**Check it:**

```bash
node tools/verify-calc.js          # 65 hand-calculation checks
node tools/verify-ai.js            # 50 optimizer checks
node tools/verify-forecast.js      # 19 forecast checks
node tools/verify-formulation.js   # 28 formulation checks
node tools/replay-eval.js --json out.json   # 13-batch leave-one-batch-out replay, 30 replicates (about 1 minute)
```

**Main replay results** (matched 10% undernourished pig-days, relative to three-phase feeding): three-phase feeding supplies 20.0% excess lysine. A batch-level AI forecast gives the same decisions as a weekly lookup table (14.0% excess lysine; −10.0% nitrogen excretion; −2.1% modeled CO₂e). Per-pig AI forecasts do better (12.0%; −13.0%; −2.8%), but neither AI variant meets both pre-registered success criteria. See `docs/replay/README.md`, including the correction record for the ideal-protein calculation.

**Known limitations:** no farm data yet; requirements, inclusion caps and several conversion factors are not yet confirmed by a nutritionist; amino-acid prices are not verified; the 95% body-weight interval covers about 86% of observations; corn and soybean meal alone cannot meet the energy standard in the first feeding week (no added fat).

**Documentation:** `docs/project_statement.md`, `docs/data_ai_statement.md`, `docs/model_card.md`, `docs/validation_plan.md`, `docs/demo_video_script.md`.

**License:** code under the MIT license (`LICENSE`). The growth and feed records come from Zenodo 6626445 (Lenoir et al., 2022), CC BY 4.0; please cite them when you reuse the records.

---

## 中文说明


把 100 头育肥猪的真实生长/采食记录变成一个**可优化的减排变量**：无监督聚类划分饲喂组 → 原料级线性规划求最优配方 → 成本–排放 Pareto 前沿 → “分层饲喂 vs 一刀切”的栏舍成本与模型化排放差异。
首版包含下一周的体重与采食预测（用于定料，附不确定度）：已接入工具的“当前状态与营养检查”页，之后做条件情景比较。预测效果用历史回放验证，见 [docs/replay/README.md](docs/replay/README.md)（含“修正记录”）。范围见 [Feed2Climate-MVP-首版范围.md](Feed2Climate-MVP-首版范围.md)。

## 运行方式

纯静态页面，无构建步骤、无外部依赖、可离线使用：

```bash
# 任选一种
open app/index.html          # 直接用浏览器打开
python3 -m http.server 8000 --directory app   # 或起静态服务
```

核对计算引擎（65 项）、AI 层（50 项）、预测层（19 项）与国内配方（28 项）的断言：

```bash
node tools/verify-calc.js   # 引擎：混合、营养、排放、搜索、确定性
node tools/verify-ai.js     # AI 层：LP 求解器、最优性对照、聚类确定性、情景自洽、Pareto
node tools/verify-forecast.js     # 预测层：决策时点、提前量、不确定度随称重下降
node tools/verify-formulation.js  # 国内配方与排放核算（含间接 N2O）
```

生成单文件版（内联数据与引擎，便于分发或直接双击打开，也是预览用的版本）：

```bash
node tools/build-standalone.js   # 输出 dist/feed2climate-standalone.html
```

重新生成数据文件（仅当 CSV 更换时）：

```bash
node tools/prepare-records.js
```

## 目录结构

| 文件 | 作用 |
|---|---|
| [app/index.html](app/index.html) | 五页应用：总览（因果链图+AI 流水线）/ 状态与营养检查（含下一周定料预测）/ AI 方案设计 / A/B 对比 / 来源与验证 |
| [app/engine.js](app/engine.js) | 确定性计算引擎（纯函数）：完整性检查 → 营养供需 → 配比搜索 → 成本与排放 |
| [app/ai.js](app/ai.js) | AI 层（纯函数）：k-means 聚类分层、两阶段单纯形 LP、Pareto 前沿、情景比较；全种子化确定性 |
| [app/forecast.js](app/forecast.js) | 预测层（纯函数）：企业版观测降级、群体规律拟合、三种预测（查表 / 外推 / AI 滤波）、回放用真值 |
| [app/formulation.js](app/formulation.js) | 国内玉米–豆粕配方（理想蛋白约束）与排放核算（含间接 N₂O），供故事页与回放使用 |
| [app/story.html](app/story.html) | 故事页：把回放结果讲给评委看（单文件版见 dist/feed2climate-story.html） |
| [docs/replay/README.md](docs/replay/README.md) | 回放验证说明：13 批留一批、30 次重复，及格线与结果 |
| [app/parameters/feed2climate-china.js](app/parameters/feed2climate-china.js) | 全部系数与来源标注，集中管理（工具与回放共用）；改参数即改场景 |
| [app/records.js](app/records.js) | 100 头猪 × 前 76 天历史记录（自动生成，勿手改） |
| [tools/prepare-records.js](tools/prepare-records.js) | CSV → records.js 转换与完整性检查 |
| [tools/build-standalone.js](tools/build-standalone.js) | 生成内联单文件版 dist/feed2climate-standalone.html |
| [tools/verify-calc.js](tools/verify-calc.js) | 手工算例核对（基础料、配比混合、营养供需、氮平衡与排放、配比搜索对照穷举、群体换算） |
| [tools/derive-diets.js](tools/derive-diets.js) | 从三阶段第 1、51 天的群体营养密度求得 A/B 基础料的营养目标（写入参数文件） |
| [tools/verify-ai.js](tools/verify-ai.js) | AI 层核对（LP 求解器、随机可行配方对照、聚类确定性、情景比较、Pareto 前沿） |
| [demo_sources/zenodo_6626445/](demo_sources/zenodo_6626445/SOURCE.md) | 原始数据、来源说明与结构检查 |

## 五个页面

0. **总览** — 回答“这为什么和气候有关、AI 在哪”：配方→营养/N 排泄→粪污→CH₄/N₂O/饲料碳足迹的因果链图，四步 AI 流水线，以及实时计算的“分层 vs 一刀切”结果速览。
1. **当前状态与营养检查** — 选择公开样例或手动录入体重/采食量（含统计时间窗）、当前配方 A 料比例、粪污情景与气候区；历史图仅描述截至所选日的记录；营养表显示 NE、SID 赖氨酸、CP 的供应/要求/差额与公式。另有“下一周定料预测”卡片：按批次与定料周选择，显示预测体重与采食（±1.96 倍标准差；回放中体重区间实际覆盖约 86%、采食约 95%）、所需营养密度与最低成本配方。
2. **AI 方案设计** — 可调 k（2–5 组）、种子、约束口径（组均值+5% 边际 / 覆盖最严格个体）与成本↔排放权重滑块；输出聚类散点图、每组的原料级 LP 配方卡（含个体满足率）、一刀切对照卡、情景对比表与 11 点 Pareto 前沿图。保守口径无解时如实报告可达上限。
3. **A/B 混合对比（单栏）** — 基础料 A 为前期配方（第 1 天群体营养密度）、B 为后期配方（第 51 天），都是国内玉米–豆粕 + 合成氨基酸的最低成本解。在 0–100% 配比网格中搜索满足全部营养约束的 A/B 混合配比，输出成本最优与排放最优候选；附 MCF 与原料价格 ±20% 敏感性、群体换算与粪污管理情景对比。
4. **来源与验证** — 每个输入与系数的来源、版本、单位、口径、适用范围与未核算项清单。

## 范围边界（重要）

- 结果仅称为**“给定条件下的可行方案”**与**“模型化排放差异”**；满足营养约束不代表实际换料后采食、增重或健康表现不变。
- 候选方案与当前方案使用**相同**的采食量、营养要求与粪污管理假设；差异只来自 A/B 配比。
- 排放只核算有依据的项目：饲料生产 + 粪污 CH₄ + 粪污直接与间接 N₂O（IPCC 2019 结构，参数见参数文件）。农场能耗、运输等**未核算，不计为零**，不合成为完整碳足迹。
- 比较单位为每 kg 饲料价格与每头每天（基于共同采食情景）；不以未来增重为分母。
- 情景比较中两情景每头猪使用相同的体重、采食量与目标增重（历史均值夹到 0.7–1.1 kg/天），差异只来自配方；聚类与目标均为历史描述统计，不是预测。
- 无可行方案时显示冲突的约束与探针结果（AI 口径下还报告可达上限），不输出“最优配方”。

## 数据与参数来源

| 项目 | 来源 | 状态 |
|---|---|---|
| 生长与采食记录 | [Zenodo 6626445](https://zenodo.org/records/6626445)（Lenoir 等，2022，CC BY 4.0，MD5 18af2d0b87fe0d020c5190019cff921b） | 已接入 |
| 能量维持换算 | 随数据集发布的 DLM_script.R（FIt×9.85；W^0.6×1.05×0.74） | 已接入 |
| SID 赖氨酸要求曲线 | K-State 育肥猪营养指南（引 Rostagno 2017）：20 g SID Lys/kg 增重；维持 0.036 g/kg BW^0.75/天 | 量级参照，待营养师确认 |
| 粪污 CH₄ / N₂O 公式 | IPCC 2019 Refinement Vol.4 Ch.10、Ch.11 | 已接入；MCF、EF3、EF4、EF5 取 IPCC 表值（见参数文件 manure.source） |
| GWP100 | IPCC AR6（CH₄=27，N₂O=273） | 已锁定版本 |
| 国内原料成分与排放 | 成分：INRA-CIRAD-AFZ 饲料表；玉米、豆粕碳排放：ECOALIM（豆粕取巴西毁林三档情景）；合成氨基酸：INRA-CIRAD-AFZ | 已标注来源；价格：农业农村部畜牧兽医局 2026 年 8 月第 3 周集贸市场价（玉米、豆粕；第 2 周原文已核实，第 3 周待核实），合成氨基酸 2026-02-27 报价来源未核实；**待营养师确认** |
| 基础料 A/B 的营养目标 | 三阶段（现行）的第 1、51 天群体营养密度，由 `tools/derive-diets.js` 求得；配方由配方模块求最低成本解 | 已接入 |
| 理想氨基酸比例 | van Milgen & Dourmad 2015（J Anim Sci Biotechnol 6:15）；按实际 SID 赖氨酸计算 | 已接入（2026-10-08 修正，见回放说明的修正记录） |
| 增重目标、合成氨基酸配合上限、氮沉积与挥发性固体算法 | 增重目标 0.90 kg/天为显式假设；氨基酸上限、氮沉积 28 g/kg 增重、VS 算法为示范假设（参数文件中已标注） | **待营养师确认** |

参数全部集中在 [feed2climate-china.js](app/parameters/feed2climate-china.js)，每项带 `source` 字段；工具与回放共用这一套参数。旧的示范参数文件 [feed2climate-parameters.js](app/parameters/feed2climate-parameters.js) 已弃用，只保留供追溯。


## 验证记录

- 数据完整性：100 头猪 × 前 76 天、无重复日期、从第 1 天开始（转换脚本自动断言）。
- `node tools/verify-calc.js`：65 项手工算例核对（基础料与理想比例、配比混合、营养供需、氮平衡与排放、配比搜索对照穷举、群体换算、单项上限）全部通过。
- `node tools/verify-ai.js`：50 项（LP 求解器、配方 LP 与随机可行配方对照、k-means 确定性、情景比较、Pareto 前沿）全部通过。
- `node tools/verify-forecast.js`：19 项（决策时点、提前量、称重后不确定度下降等）全部通过。
- `node tools/verify-formulation.js`：28 项（国内配方、理想比例、粪污 MCF、间接 N₂O、与 LP 求解器一致）全部通过。
- 回放：`node tools/replay-eval.js`（13 批留一批、30 次重复）。理想比例修正后重跑，结果写入 `docs/replay/results-cn.json`（及两份豆粕情景文件）；修正前的结果保留在 `docs/replay/results-cn.pre-fix.json`，对照表见回放说明的“修正记录”。
- 界面：工具五个页面与预测卡片在无头 Chrome 中逐页测试（计算、不可行提示、能量放松提示、敏感性表、13 批 × 10 个定料周的预测卡片），页面没有运行时异常。
- 确定性：全部计算（含聚类随机性）种子化，相同输入逐位一致。
- 未解决（待决定）：
  - 预测区间覆盖率：130 个留一批案例中，体重 95% 区间实际覆盖约 86%（采食约 95%）。界面已如实注明；要达到 95%，需要校准预测的不确定度（未做）。
  - 两处 ADG 夹值不一致：预测层夹到 0.3–1.4 kg/天，AI 分组层夹到 0.7–1.1 kg/天。需要统一口径（未做）。
  - 营养参数与排放系数的正式确认；实际换料后的生产表现与减排效果需现场验证；聚类分组落地需结合栏位结构与转群计划。
