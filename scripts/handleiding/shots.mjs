// Screenshots for the manuals (/handleiding), from staging with the demo data of the app
// repo's server/src/scripts/seed-demo.js. Logs in once from the page (password from
// DEMO_PASSWORD, never printed), hides the staging banner, then takes each shot.
//
//   DEMO_PASSWORD=… node scripts/handleiding/shots.mjs https://sweet-truth-staging.up.railway.app \
//     scripts/handleiding/shots.json /tmp/shots   # then scale to 1600 px and copy to public/images/handleiding
// The /org/bel/<slug> paths in shots.json are the demo bells' slugs, printed by seed-demo.js:
// update them after re-seeding. {wilg} is looked up by name.
// shots.json: [{ path, out, width, height, as: 'org'|'caretaker'|null, scrollTo?: text, click?: text }]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const [base, list, outDir, port = '9450'] = process.argv.slice(2);
const shots = JSON.parse(readFileSync(list, 'utf8'));
const chrome = spawn('/Applications/Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${(await import('node:os')).tmpdir()}/spelbel-shots-${Date.now()}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
await send('Page.enable');
const accounts = { org: 'org@voorbeeld.test', caretaker: 'belbaas@voorbeeld.test' };
let current = null;
const HIDE_BANNER = `(() => { const all = [...document.querySelectorAll('body *')].filter((e) => e.textContent.trim().startsWith('⚠️ STAGING') && e.textContent.trim().length < 60);
  const outer = all.find((e) => !all.includes(e.parentElement)); if (outer) outer.style.display = 'none'; })()`;
async function go(url) { await send('Page.navigate', { url }); await sleep(3500); await evaluate(HIDE_BANNER); }
for (const s of shots) {
  await send('Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: 2, mobile: s.width < 600 });
  if (s.as !== current) {
    await go(`${base}/org`);
    await evaluate(`(async () => { localStorage.clear(); await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {}); })()`);
    if (s.as) {
      const ok = await evaluate(`fetch('/auth/api/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ${JSON.stringify(accounts[s.as])}, password: ${JSON.stringify(process.env.DEMO_PASSWORD)}, client: 'web' }) }).then((r) => r.status)`);
      console.log(`login ${s.as}: ${ok}`);
    }
    current = s.as;
  }
  let path = s.path;
  if (path.includes('{wilg}')) {
    const bellId = await evaluate(`fetch('/webhook/admin/me', { credentials: 'include' }).then((r) => r.json()).then((d) => d.doorbells.find((b) => b.name === 'Speeltuin De Wilg').id)`);
    path = path.replace('{wilg}', bellId);
  }
  await go(`${base}${path}`);
  if (s.click) {
    // A real mouse press and release: React Native Web's Pressable listens for those, not for click().
    const box = await evaluate(`(() => { const e = [...document.querySelectorAll('div,a,button,span')].reverse().find((x) => x.textContent.trim().endsWith(${JSON.stringify(s.click)}));
      if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (box) for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(2000);
  }
  if (s.scrollTo) { await evaluate(`[...document.querySelectorAll('div,span,h1,h2,p')].reverse().find((e) => e.textContent.includes(${JSON.stringify(s.scrollTo)}))?.scrollIntoView({ block: 'start' })`); await sleep(600); }
  await evaluate(`(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) n.nodeValue = n.nodeValue.replace(' · testomgeving', ''); })()`);
  writeFileSync(`${outDir}/${s.out}`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log(`shot ${s.out}`);
}
chrome.kill(); process.exit(0);
