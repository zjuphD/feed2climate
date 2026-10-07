// 生成展示页的单文件版：dist/feed2climate-story.html（数据内联，可直接双击打开）
// 以及发布用的片段版：dist/feed2climate-story.fragment.html（不含 doctype/html/head/body 外壳）。
// 用法：node tools/build-story.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'app', 'story.html'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'app', 'story-data.js'), 'utf8').trim();
const tag = '<script src="story-data.js"></script>';
if (!src.includes(tag)) throw new Error('未找到数据脚本标签');
const full = src.replace(tag, '<script>\n' + data + '\n</script>');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'feed2climate-story.html'), full);
// 片段：<title>、字体链接、<style> 放最前，然后是 body 内容
const head = full.slice(full.indexOf('<head>') + 6, full.indexOf('</head>'));
const body = full.slice(full.indexOf('<body>') + 6, full.lastIndexOf('</body>'));
const keep = head.split('\n').filter((l) => !/<meta /.test(l)).join('\n');
fs.writeFileSync(path.join(ROOT, 'dist', 'feed2climate-story.fragment.html'), keep.trim() + '\n' + body.trim() + '\n');
console.log('写入 dist/feed2climate-story.html（' + Math.round(full.length / 1024) + ' KB）与片段版');
