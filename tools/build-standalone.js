// 把 app/index.html 引用的 records.js / 参数 / 引擎内联，生成单文件 dist/feed2climate-standalone.html。
// 用法：node tools/build-standalone.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let html = read('app/index.html');

const inline = (srcPath) => '<script>\n' + read(srcPath).trim() + '\n</script>';

const replacements = [
  ['<script src="records.js"></script>', inline('app/records.js')],
  ['<script src="parameters/feed2climate-china.js"></script>', inline('app/parameters/feed2climate-china.js')],
  ['<script src="formulation.js"></script>', inline('app/formulation.js')],
  ['<script src="ai.js"></script>', inline('app/ai.js')],
  ['<script src="forecast.js"></script>', inline('app/forecast.js')],
  ['<script src="engine.js"></script>', inline('app/engine.js')],
];
for (const [tag, replacement] of replacements) {
  if (!html.includes(tag)) throw new Error('未找到待替换的脚本标签: ' + tag);
  html = html.replace(tag, replacement);
}
// 单文件版标注
html = html.replace('<title>', '<!-- 由 tools/build-standalone.js 生成的单文件版；源文件在 app/ 目录。 -->\n<title>');

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'feed2climate-standalone.html');
fs.writeFileSync(out, html);
console.log('写入 ' + out + '（' + Math.round(html.length / 1024) + ' KB）');
