// “开始分析”页的界面测试：无头 Chrome + DevTools 协议，逐项断言，失败时退出码非 0。
// 覆盖：默认打开的页面与结果、换批次、换定料周（含第一周无耗料、最后一周）、改数字后的“已改动”提示、
//       非法输入的报错与旧结果置灰、安全余量、其余五个页签仍可用、页面没有运行时异常、没有 NaN/undefined。
// 用法：node tools/ui-test-start.js [页面地址，默认 app/index.html]
//       环境变量 CHROME 指定 Chrome 可执行文件（默认 macOS 路径），PORT 指定调试端口（默认 9447）。
// 需要 Node 22（内置 fetch 与 WebSocket）。macOS 没有 timeout 命令，这里用 perl alarm 兜底，最长 100 秒。
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT || 9447);
const url = process.argv[2] || 'file://' + path.join(__dirname, '..', 'app', 'index.html');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'f2c-start-'));
const proc = spawn('perl', ['-e', 'alarm shift; exec @ARGV', '100', CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--window-size=1280,900', url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => { try { process.kill(proc.pid, 'SIGKILL'); } catch (e) { /* 已退出 */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ } };

(async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) { /* 等待 Chrome 启动 */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('Chrome 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const pageErrors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('CONSOLE ' + m.params.args.map((a) => a.value || a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result?.value;
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.reload'); await sleep(2500);

  const text = (sel) => ev(`(document.querySelector('${sel}') || {}).textContent`);
  const setSel = async (sid, v) => { await ev(`(() => { const s = document.getElementById('${sid}'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(500); };
  const setIn = async (key, v) => { await ev(`(() => { const e = document.querySelector('.ga-in[data-key="${key}"]'); e.value = '${v}'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150); };
  const setMargin = async (v) => { await ev(`(() => { const e = document.getElementById('ga-margin'); e.value = '${v}'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150); };
  const click = async (sel) => { await ev(`document.querySelector('${sel}').click()`); await sleep(600); };
  const headline = () => ev(`[...document.querySelectorAll('#ga-result .answer .n')].map((e) => e.textContent).join(' | ')`);
  const lys = async () => parseFloat((await headline()).split(' ')[0]);

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); };

  check('默认打开“开始分析”页', await ev(`!document.getElementById('view-start').hidden && document.getElementById('view-overview').hidden`));
  const h0 = await headline();
  check('默认示例有赖氨酸、净能、价格三个大数', /g\/kg.*MJ\/kg.*元\/吨/.test(h0), h0);
  check('默认标注为示例批次回放', (await text('#ga-result .answer .badge')).includes('公开数据回放'));
  check('结果含两张图、四行累计对比、下一步清单', await ev(`document.querySelectorAll('#ga-result svg.gachart').length === 2 && document.querySelectorAll('#ga-result .cb').length === 4 && !!document.querySelector('#ga-result ol.todo')`));
  check('配方 7 种原料', (await ev(`document.querySelectorAll('#ga-result .rec:not(.head)').length`)) === 7);
  check('初始没有“已改动”提示', await ev(`!document.getElementById('ga-stale').classList.contains('on')`));

  await setSel('ga-batch', '5');
  check('换批次后结果跟着换', (await text('#ga-result .answer .badge')).includes('202019'));
  await setSel('ga-week', '0');
  check('第一周：标题、无耗料提示、仍有结果', (await text('#ga-result .answer .ttl b')).includes('第 1–7 天') && await ev(`document.getElementById('ga-feed').textContent.includes('还没有耗料记录')`) && !!(await headline()));
  check('第一周：能量放松时显示提示', await ev(`document.getElementById('ga-result').textContent.includes('能量未达标')`));
  await setSel('ga-week', '9');
  check('最后一周：3 个称重行、8 个耗料行', JSON.stringify(await ev(`[document.querySelectorAll('#ga-weigh .ga-in').length, document.querySelectorAll('#ga-feed .ga-in').length]`)) === '[3,8]');
  await setSel('ga-week', '5'); await setSel('ga-batch', '0');
  const sample = await headline();

  await setIn('w22', '80.0');
  check('改数字后出现“已改动”提示并置灰旧结果', await ev(`document.getElementById('ga-stale').classList.contains('on') && document.getElementById('ga-result').classList.contains('stale')`));
  check('改数字后来源说明变为自己的数据', (await text('#ga-src')).includes('你录入的数据'));
  await click('#ga-run');
  check('点“生成”后标注为你录入的数据且提示消失', (await text('#ga-result .answer .badge')).includes('你录入的数据') && await ev(`!document.getElementById('ga-stale').classList.contains('on')`));
  check('自己的数据与示例结果不同', (await headline()) !== sample);
  check('自己的数据没有“事后实际”标记', await ev(`!document.getElementById('ga-result').textContent.includes('事后实际')`));
  check('自己的数据带“重新验证”提示', await ev(`document.getElementById('ga-result').textContent.includes('换成你的猪场要重新验证')`));

  await setIn('w22', '5'); await click('#ga-run');
  check('体重填 5 报错并标红', (await text('#ga-err')).includes('第 22 天') && await ev(`document.querySelector('.ga-in[data-key="w22"]').classList.contains('bad')`), await text('#ga-err'));
  check('报错时保留旧结果且置灰', await ev(`!!document.querySelector('#ga-result .answer') && document.getElementById('ga-result').classList.contains('stale')`));
  await setIn('w22', '80.0'); await setIn('f2', '9'); await click('#ga-run');
  check('采食填 9 报错', (await text('#ga-err')).includes('第 3 周'), await text('#ga-err'));
  await setIn('f2', '1.84'); await click('#ga-run');
  check('改回合法值后报错消失', (await text('#ga-err')) === '');

  const withMargin = await lys();
  await setMargin('0'); await click('#ga-run');
  check('安全余量 0 时赖氨酸更低，并提示改动了余量', (await lys()) < withMargin && await ev(`document.getElementById('ga-result').textContent.includes('你把安全余量改成了')`));
  await setMargin('80'); await click('#ga-run');
  check('安全余量 80 被拒绝并置灰旧结果', (await text('#ga-err')).includes('0–50') && await ev(`document.getElementById('ga-result').classList.contains('stale')`));
  await setMargin('14.5'); await setSel('ga-batch', '0');
  check('换回示例批次后恢复为示例', (await text('#ga-result .answer .badge')).includes('202001'));

  for (const v of ['overview', 'history', 'ai', 'compare', 'evidence', 'start']) {
    await click(`[data-view="${v}"]`);
    check('页签可打开：' + v, await ev(`!document.getElementById('view-${v}').hidden`));
  }
  check('结果区没有 NaN 或 undefined', await ev(`!/NaN|undefined/.test(document.getElementById('view-start').innerText)`));
  check('页面没有运行时异常', pageErrors.length === 0, pageErrors.join('; '));

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log((r.pass ? '通过  ' : '失败  ') + r.name + (r.pass || !r.detail ? '' : '  → ' + r.detail));
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' 项通过');
  cleanup();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(2); });
