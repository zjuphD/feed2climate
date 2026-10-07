# Zenodo 6626445

来源：https://zenodo.org/records/6626445

DOI：10.5281/zenodo.6626445

作者：Lenoir G.; Kashefifard K.; Chesnet C.; Flatres-Grall L.; Muñoz-Tamayo R.

数据名称：Dynamic data of body weight and feed intake in fattening pigs and the determination of energetic allocation factors using a dynamic linear model

Zenodo API 返回的数据许可：CC BY 4.0。

DataAxiom.CSV 原样下载，MD5 与来源匹配：18af2d0b87fe0d020c5190019cff921b。

本次结构检查：7,169 行，100 个猪只 ID，40 个批次—栏舍组合。每头猪 69–78 行记录，t 的全局范围为 1–78。未检出空白字段和重复的 ID-t 组合。本次未完成生物学异常值或原始预处理审计。

t 是进入育肥舍后的天数，Wt 是每天体重中位数，FIt 是日总采食量。数据集不含日粮干预、营养组成或实测温室气体字段。各栏舍组合仅含所公开样本，不能把这些猪只的合计采食直接当成完整栏舍采食。

作者提供的 DLM_script.R 使用全序列参数拟合及 dlmSmooth 平滑，应视为回顾性分析示例；直接把其拟合或平滑误差作为未来七天预测性能会产生不当评价。前瞻预测需要单独设计严格的时间截断与留出验证。

preview-data.json 仅选取数据中 ID 86、4、3 的历史记录，用于界面示意。2026-09-29 范围调整后，首版只展示截至所选日期的历史记录和当前状态，已移除未来预测区间。历史均值仅是描述统计；日粮组成与营养需求尚需补齐，营养诊断、方案优化和碳核算尚未实现。
