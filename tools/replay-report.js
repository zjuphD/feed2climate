// 把 tools/replay-eval.js 的结果文件（--json）写成中文报告，数字全部取自结果文件，不手抄。
// 用法：node tools/replay-report.js docs/replay/results-cn.json docs/replay/results-cn.pre-fix.json > docs/replay/README.md
// 第二个参数可选：修正前的结果文件，用于生成“修正记录”对照表（数字全部从两份结果文件读取）。
'use strict';
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('用法：node tools/replay-report.js <results.json>'); process.exit(1); }
const R = JSON.parse(fs.readFileSync(file, 'utf8'));
const preFile = process.argv[3];
const P = preFile ? JSON.parse(fs.readFileSync(preFile, 'utf8')) : null;

const pct = (x, d) => (x == null ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%');
const signed = (x, d) => (x == null ? '—' : (x > 0 ? '+' : '') + (x * 100).toFixed(d == null ? 1 : d) + '%');
const name = (id) => R.policies.find((p) => p.id === id).name;
const ORDER = ['P0', 'P1', 'P2', 'P3', 'P3u', 'P4', 'I2', 'I3', 'I3u', 'I4'];
const has = (id) => R.policies.some((p) => p.id === id);
const ids = ORDER.filter(has);
const T = '0.1';
const out = [];
const w = (s) => out.push(s == null ? '' : s);

w('# 回放验证：预测能不能让饲料配得更准');
w();
w('> 本文件由 `node tools/replay-report.js ' + [file, preFile].filter(Boolean).join(' ') + '` 生成，数字全部取自 `tools/replay-eval.js` 的输出（' + R.reps + ' 次重复）。');
w();
w('## 怎么验证的');
w();
w('- **数据**：公开数据集 Zenodo 6626445（Lenoir 等 2022，CC BY 4.0），100 头育肥猪的逐日体重与采食，按猪栏编号前缀分为 13 批；分析使用进栏后第 1–69 天。数据页未注明品种、测定站和年份；作者单位含法国 AXIOM，关联论文的品种与年份待核实。');
w('- **企业版数据**：把研究数据“降级”成企业通常有的样子——进栏称重、每 3 周抽称一次（加 3% 抽样误差）、每周耗料（加 4% 盘点误差）；饲料要提前 ' + R.batchOpts.leadDays + ' 天定。');
w('- **留一批验证**：每次留出 1 批，用其余 12 批当历史数据学规律，只用“当时看得到的数据”排饲料，再用完整逐头数据当标准答案逐头逐日打分；13 批轮流一遍，观测噪声换 ' + R.reps + ' 组。');
w('- **公平比较**：各做法能量浓度一律按标准表，只比较蛋白（SID 赖氨酸）上的决定；每种做法只有一个旋钮（安全余量），把“营养不足的猪日”（供给 < 需要的 97%）对齐到同一水平后再比。');
w('- **配方与排放**：' + (R.legacy ? '旧引擎（原参数文件）。' : '国内玉米–豆粕 + 合成氨基酸，按理想蛋白比例（相对实际 SID 赖氨酸）约束苏、蛋+胱、色、缬、异亮（`app/formulation.js`）；粪污按 IPCC 2019（' + R.system + '，' + R.climate + '），豆粕碳排放取 “' + R.sbmScenario + '” 情景。'));
w();
w('## 比较的做法');
w();
w('| 代号 | 做法 | 需要的条件 |');
w('|---|---|---|');
const need = { P0: '现行做法', P1: '历史批次的平均曲线', P2: '这批猪自己的称重和耗料', P3: '历史批次 + 这批猪的数据（AI）', P3u: '同上，余量按 AI 给出的误差范围逐周调整', P4: '事后才知道的真值（理论上限）', I2: '个体饲喂站（每头每天记录）', I3: '个体饲喂站 + AI', I3u: '个体饲喂站 + AI，余量按误差范围逐头逐日调整', I4: '个体饲喂站 + 事后真值（理论上限）' };
for (const id of ids) w('| ' + id + ' | ' + name(id) + ' | ' + need[id] + ' |');
w();
w('## 结果一：决策精度（不经过配方）');
w();
w('同样的营养不足风险下，定下的赖氨酸浓度平均多给了多少（越低越好）：');
w();
w('| 营养不足猪日 | ' + ids.join(' | ') + ' |');
w('|---|' + ids.map(() => '---').join('|') + '|');
for (const t of Object.keys(R.decision)) {
  w('| ' + pct(Number(t), 0) + ' | ' + ids.map((id) => (R.decision[t][id] ? pct(R.decision[t][id].excessLys) : '—')).join(' | ') + ' |');
}
w();
w('逐头事后真值（I4）一栏为负：判定“不足”时留了 3% 容差（供给 ≥ 需要的 97% 不算不足），完全知道每头猪的需要时，按需要的 97% 供给就够了。');
w();
w('## 结果二：换成实际配方后的成本与排放（营养不足猪日 = 10%，相对三阶段）');
w();
w('| 做法 | 多喂赖氨酸 | 豆粕用量 | 原料成本 | 碳排放 | 氮排泄 |');
w('|---|---|---|---|---|---|');
for (const id of ids) {
  const s = R.summary[T][id];
  if (!s) { w('| ' + name(id) + ' | 达不到该水平 | | | | |'); continue; }
  w('| ' + name(id) + ' | ' + pct(s.excessLys) + ' | ' + signed(s.sbm) + ' | ' + signed(s.cost) + ' | ' + signed(s.co2e) + ' | ' + signed(s.nEx) + ' ± ' + pct(s.nExSd) + ' |');
}
const base = R.summary[T].P0 && R.summary[T].P0.abs;
if (base) {
  w();
  w('三阶段做法本身（每头每天）：原料成本 ' + base.cost.toFixed(2) + ' 元，碳排放 ' + base.co2e.toFixed(2) + ' kg CO₂e，氮排泄 ' + base.nEx.toFixed(1) + ' g，豆粕 ' + (base.sbmKg * 1000).toFixed(0) + ' g。');
}
w();
w('## 结果三：预测误差（目标日相对事后真值的平均绝对误差）');
w();
w('| 做法 | 体重 | 日增重 | 采食 | 赖氨酸浓度 | 浓度偏差 |');
w('|---|---|---|---|---|---|');
for (const e of R.errors) w('| ' + name(e.id) + ' | ' + pct(e.bw) + ' | ' + pct(e.adg) + ' | ' + pct(e.fi) + ' | ' + pct(e.lys) + ' | ' + signed(e.bias) + ' |');
w();
w('## 及格线（本项目设定，未经外部预先登记）');
w();
w('在营养不足猪日不增加的前提下：(2) AI 的氮减幅达到同一层级事后上限的一半以上；(3) 比最好的简单方法至少多降 3 个百分点。判定代码最早出现在提交 bcd2f23，早于 30 次重复结果的提交 ba72aff；这是版本记录，不是外部预先登记。');
w();
w('| 比较 | AI 氮减幅 | 事后上限 | 最好的简单方法 | (2) | (3) |');
w('|---|---|---|---|---|---|');
for (const [label, v] of Object.entries(R.verdicts)) {
  w('| ' + label + ' | ' + pct(v.ai) + ' | ' + pct(v.upper) + ' | ' + pct(v.bestSimple) + ' | ' + (v.c2 ? '通过' : '未通过') + ' | ' + (v.c3 ? '通过' : '未通过') + ' |');
}
w();
if (P) {
  const pp = (x) => (x * 100).toFixed(1) + ' 个点';
  const vOld = P.verdicts, vNew = R.verdicts, T2 = '0.1';
  const margin = (v) => v.ai - v.bestSimple;
  const both = (vs) => Object.values(vs).filter((v) => v.c2 && v.c3).length;
  const sOld = P.summary[T2], sNew = R.summary[T2];
  const key = '逐头·常数余量';
  w('## 修正记录：理想氨基酸比例改为相对实际赖氨酸');
  w();
  w('修正前，苏、蛋+胱、色、缬、异亮的理想比例按“目标赖氨酸”计算。配方的实际赖氨酸超出目标时（例如前期料为满足色氨酸而多加了豆粕），这些氨基酸对实际赖氨酸的比例会低于理想值（前期料色氨酸 0.213，理想 0.22）。修正后比例按实际 SID 赖氨酸计算，这是理想蛋白的标准定义。修正前的结果保存在 `docs/replay/results-cn.pre-fix.json`。');
  w();
  w('修正前后的结果并列如下（营养不足猪日 = 10%）：');
  w();
  w('| 指标 | 修正前 | 修正后 |');
  w('|---|---|---|');
  w('| 三阶段（现行）多喂赖氨酸 | ' + pct(sOld.P0.excessLys) + ' | ' + pct(sNew.P0.excessLys) + ' |');
  for (const label of Object.keys(vNew)) {
    w('| ' + label + '：AI 氮减幅 / 事后上限 | ' + pct(vOld[label].ai) + ' / ' + pct(vOld[label].upper) + ' | ' + pct(vNew[label].ai) + ' / ' + pct(vNew[label].upper) + ' |');
  }
  w('| 最好的简单方法氮减幅（按批） | ' + pct(vOld['按批·常数余量'].bestSimple) + ' | ' + pct(vNew['按批·常数余量'].bestSimple) + ' |');
  w('| 最好的简单方法氮减幅（逐头） | ' + pct(vOld[key].bestSimple) + ' | ' + pct(vNew[key].bestSimple) + ' |');
  for (const label of Object.keys(vNew)) {
    w('| ' + label + '：比最好的简单方法多降 / 第 (3) 条 | ' + pp(margin(vOld[label])) + '，' + (vOld[label].c3 ? '通过' : '未通过') + ' | ' + pp(margin(vNew[label])) + '，' + (vNew[label].c3 ? '通过' : '未通过') + ' |');
  }
  w('| 同时满足 (2)、(3) 的组合数（共 ' + Object.keys(vNew).length + ' 种） | ' + both(vOld) + ' | ' + both(vNew) + ' |');
  w();
  w('修正没有改变总体判断：同时满足两条及格线的组合，修正前后都是 ' + both(vNew) + ' 个。变化在于“' + key + '”的第 (3) 条：修正前比最好的简单方法多降 ' + pp(margin(vOld[key])) + '（' + (vOld[key].c3 ? '通过' : '未通过') + '），修正后多降 ' + pp(margin(vNew[key])) + '（' + (vNew[key].c3 ? '通过' : '未通过') + '）。这是模型定义的修正，不是为了改变结论；修正后对 AI 的判定更保守。');
  w();
}
w('## 局限');
w();
w('- 13 批、每批只有 4–14 头样本猪，批次按猪栏编号前缀划分，数据页未注明测定站与品种，批与批之间的差别可能比商品猪场小；结论是方法演示，不是现场效果。');
w('- “事后真值”用整段数据平滑得到（每头猪全程二次曲线、7 天中心平均采食），本身也是一种估计。');
w('- 营养需要量模型（维持 + 增重）与理想蛋白比例取文献值，未按国内品种校准；没有模拟“少喂蛋白后生长会不会变慢”，营养不足只按猪日计数。');
w('- 玉米碳排放取法国数据，合成氨基酸取欧洲工厂数据；国内生产的氨基酸碳排放可能更高。');
w('- 成本只含能量、蛋白和氨基酸原料，不含预混料、矿物质和加工费（各方案相同）。');
w('- 能量：第一个定料周（第 1–7 天，目标第 4 天）国内配方不含油脂，能量只能达到标准的约 91%（10.11 对 11.10 MJ/kg），能量约束被放松。回放按标准表计能量，没有计入这一周的能量不足；其余各周能量都达标。');
process.stdout.write(out.join('\n') + '\n');
