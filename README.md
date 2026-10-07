# Feed2Climate · AI 驱动的精准饲喂与模型化减排

把 100 头育肥猪的真实生长/采食记录变成一个**可优化的减排变量**：无监督聚类划分饲喂组 → 原料级线性规划求最优配方 → 成本–排放 Pareto 前沿 → “分层饲喂 vs 一刀切”的栏舍成本与模型化排放差异。
全流程为条件情景比较，不含未来生长、采食或营养需求预测（范围见 [Feed2Climate-MVP-首版范围.md](Feed2Climate-MVP-首版范围.md)）。

## 运行方式

纯静态页面，无构建步骤、无外部依赖、可离线使用：

```bash
# 任选一种
open app/index.html          # 直接用浏览器打开
python3 -m http.server 8000 --directory app   # 或起静态服务
```

核对计算引擎（73 项）与 AI 层（58 项）的断言：

```bash
node tools/verify-calc.js   # 引擎：混合、营养、排放、搜索、确定性
node tools/verify-ai.js     # AI 层：LP 求解器、最优性对照、聚类确定性、情景自洽、Pareto
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
| [app/index.html](app/index.html) | 五页应用：总览（因果链图+AI 流水线）/ 状态与营养检查 / AI 方案设计 / A/B 对比 / 来源与验证 |
| [app/engine.js](app/engine.js) | 确定性计算引擎（纯函数）：完整性检查 → 营养供需 → 配比搜索 → 成本与排放 |
| [app/ai.js](app/ai.js) | AI 层（纯函数）：k-means 聚类分层、两阶段单纯形 LP、Pareto 前沿、情景比较；全种子化确定性 |
| [app/parameters/feed2climate-parameters.js](app/parameters/feed2climate-parameters.js) | 全部系数与来源标注，集中管理；改参数即改场景 |
| [app/records.js](app/records.js) | 100 头猪 × 前 76 天历史记录（自动生成，勿手改） |
| [tools/prepare-records.js](tools/prepare-records.js) | CSV → records.js 转换与完整性检查 |
| [tools/build-standalone.js](tools/build-standalone.js) | 生成内联单文件版 dist/feed2climate-standalone.html |
| [tools/verify-calc.js](tools/verify-calc.js) | 手工算例核对（混合、营养、排放、搜索、确定性） |
| [tools/verify-ai.js](tools/verify-ai.js) | AI 层核对（LP 基础算例、4000 随机可行点最优性对照、聚类确定性、情景自洽、保守口径无解报告） |
| [demo_sources/zenodo_6626445/](demo_sources/zenodo_6626445/SOURCE.md) | 原始数据、来源说明与结构检查 |

## 五个页面

0. **总览** — 回答“这为什么和气候有关、AI 在哪”：配方→营养/N 排泄→粪污→CH₄/N₂O/饲料碳足迹的因果链图，四步 AI 流水线，以及实时计算的“分层 vs 一刀切”结果速览。
1. **当前状态与营养检查** — 选择公开样例或手动录入体重/采食量（含统计时间窗）、当前配方 A 料比例、粪污情景与气候区；历史图仅描述截至所选日的记录；营养表显示 NE、SID 赖氨酸、CP 的供应/要求/差额与公式。
2. **AI 方案设计** — 可调 k（2–5 组）、种子、约束口径（组均值+5% 边际 / 覆盖最严格个体）与成本↔排放权重滑块；输出聚类散点图、每组的原料级 LP 配方卡（含个体满足率）、一刀切对照卡、情景对比表与 11 点 Pareto 前沿图。保守口径无解时如实报告可达上限。
3. **A/B 混合对比（单栏）** — 在 0–100% 配比网格中搜索满足全部营养约束的 A/B 混合配比，输出成本最优与排放最优候选；附 MCF 与原料价格 ±20% 敏感性、群体换算与粪污管理情景对比。
4. **来源与验证** — 每个输入与系数的来源、版本、单位、口径、适用范围与未核算项清单。

## 范围边界（重要）

- 结果仅称为**“给定条件下的可行方案”**与**“模型化排放差异”**；满足营养约束不代表实际换料后采食、增重或健康表现不变。
- 候选方案与当前方案使用**相同**的采食量、营养要求与粪污管理假设；差异只来自 A/B 配比。
- 排放只核算有依据的项目：饲料生产 + 粪污 CH₄ + 粪污 N₂O（直接）。间接 N₂O、农场能耗、运输等**未核算，不计为零**，不合成为完整碳足迹。
- 比较单位为每 kg 饲料价格与每头每天（基于共同采食情景）；不以未来增重为分母。
- 情景比较中两情景每头猪使用相同的体重、采食量与目标增重（历史均值夹到 0.7–1.1 kg/天），差异只来自配方；聚类与目标均为历史描述统计，不是预测。
- 无可行方案时显示冲突的约束与探针结果（AI 口径下还报告可达上限），不输出“最优配方”。

## 数据与参数来源

| 项目 | 来源 | 状态 |
|---|---|---|
| 生长与采食记录 | [Zenodo 6626445](https://zenodo.org/records/6626445)（Lenoir 等，2022，CC BY 4.0，MD5 18af2d0b87fe0d020c5190019cff921b） | 已接入 |
| 能量维持换算 | 随数据集发布的 DLM_script.R（FIt×9.85；W^0.6×1.05×0.74） | 已接入 |
| SID 赖氨酸要求曲线 | K-State 育肥猪营养指南（引 Rostagno 2017）：20 g SID Lys/kg 增重；维持 0.036 g/kg BW^0.75/天 | 量级参照，待营养师确认 |
| 粪污 CH₄ / N₂O 公式 | IPCC 2019 Refinement Vol.4 Ch.10（Tier 2 / Tier 1 结构） | 结构已接入，参数为示范值 |
| GWP100 | IPCC AR6（CH₄=27，N₂O=273） | 已锁定版本 |
| 原料营养/价格/排放系数 | 示范值：营养量级参照 INRA-CIRAD-AFZ 表；排放量级参照 ECOALIM v7（Wilfart 等 2016，doi:10.1371/journal.pone.0167343）；价格量级参照 de Quelen 等 2021 报道的 IFIP 价 | **待逐项换用正式数据库接入** |
| A/B 基础料配方、营养要求的目标增重、CP 下限、粪污示范参数（B₀/MCF/EF₃ 等） | 示范算例输入 | **待营养师确认 / 正式标准接入** |

示范参数全部集中在 [feed2climate-parameters.js](app/parameters/feed2climate-parameters.js)，每项带 `source` 字段；替换为正式参数时不需要改引擎与界面代码。

## 验证记录

- 数据完整性：100 头猪 × 前 76 天、无重复日期、从第 1 天开始（转换脚本自动断言）。
- `node tools/verify-calc.js`：73 项手工复算断言全部通过（配方加权混合、供需检查、氮平衡、IPCC 公式、可行搜索、群体换算、无解提示、缺失输入提示、相同输入相同输出）。
- `node tools/verify-ai.js`：58 项断言全部通过（LP 求解器基础算例、配方最优性对照 4000 随机可行点与手工算例、聚类同种子逐位一致、情景合计自洽与 k=1 归零、Pareto 单调性、保守口径无解时如实报告可达上限）。
- 确定性：全部计算（含聚类随机性）种子化，相同输入逐位一致。
- 未完成：营养参数与排放系数的正式确认；实际换料后的生产表现与减排效果需现场验证；聚类分组落地需结合栏位结构与转群计划。
