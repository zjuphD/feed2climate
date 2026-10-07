// 读入 DataAxiom.CSV，按猪只 ID 分组，统一截取前 76 天，输出 app/records.js。
// 用法：node tools/prepare-records.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV = path.join(ROOT, 'demo_sources', 'zenodo_6626445', 'DataAxiom.CSV');
const OUT = path.join(ROOT, 'app', 'records.js');
const MAX_DAY = 76;

const text = fs.readFileSync(CSV, 'utf8');
const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = lines[0].split(',');
if (header[0] !== 'ID' || header[2] !== 't (day)' || header[3] !== 'Wt (kg)' || header[4] !== 'FIt (kg day-1)') {
  throw new Error('CSV 列名与预期不符: ' + header.join('|'));
}

const pigs = new Map();
let dropped = 0;
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',');
  const id = cols[0].trim();
  const pen = cols[1].trim();
  const day = Number(cols[2]);
  const weight = Number(cols[3]);
  const feed = Number(cols[4]);
  if (!id || !pen || !Number.isFinite(day) || !Number.isFinite(weight) || !Number.isFinite(feed)) {
    throw new Error('第 ' + (i + 1) + ' 行解析失败: ' + lines[i]);
  }
  if (day > MAX_DAY) { dropped++; continue; }
  if (!pigs.has(id)) pigs.set(id, { id, pen, points: [] });
  pigs.get(id).points.push({ day, weight, feed });
}

const records = [...pigs.values()]
  .map((p) => ({ ...p, points: p.points.sort((a, b) => a.day - b.day) }))
  .sort((a, b) => Number(a.id) - Number(b.id));

// 完整性检查：SOURCE.md 记录每头 69–78 行，截断后各猪天数可能不同。
// 要求：至少 56 天（覆盖界面全部截止日选项）、从第 1 天开始、无重复日期。
const MIN_DAYS = 56;
for (const rec of records) {
  if (rec.points.length < MIN_DAYS) throw new Error('猪只 ' + rec.id + ' 只有 ' + rec.points.length + ' 天记录，少于 ' + MIN_DAYS);
  const days = rec.points.map((p) => p.day);
  if (new Set(days).size !== days.length) throw new Error('猪只 ' + rec.id + ' 有重复日期');
  if (Math.min(...days) !== 1) throw new Error('猪只 ' + rec.id + ' 未从第 1 天开始');
}

const banner =
  '// 由 tools/prepare-records.js 自动生成，请勿手工编辑。\n' +
  '// 数据来源：Zenodo 6626445（Lenoir 等，2022），CC BY 4.0，MD5 18af2d0b87fe0d020c5190019cff921b。\n' +
  '// 每头猪截取入育肥舍第 1-' + MAX_DAY + ' 天（100 头均有完整记录），丢弃 ' + dropped + ' 行 t>' + MAX_DAY + ' 的记录。\n';
fs.writeFileSync(OUT, banner + 'window.F2C_RECORDS = ' + JSON.stringify(records) + ';\n');
console.log('写入 ' + OUT + '：' + records.length + ' 头猪 × ' + MAX_DAY + ' 天，丢弃 ' + dropped + ' 行。');
