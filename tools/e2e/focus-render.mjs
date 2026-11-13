// A running timer changes the clock and the ring each second and nothing else: the Focus screen's four-week chart and
// session list, and the mini timer's details, are not rebuilt; and the work that hangs on time (the tab title, the end
// of a phase) still happens. Run `npm run build` first.
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const s = await startServer();
const api = await demoAccount(client(s.url), { lang: 'en' });
const b = await launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
const p = await c.newPage();
const D = iso(new Date());
let passed = 0;
const check = (name, ok) => { if (!ok) throw Error(name); passed++; console.log('PASS ' + name); };
const doc = async () => (await api.get('day:' + D)).value;
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await p.waitForTimeout(150); } return false; };
const run = (min, ago, extra = {}) => ({ phase: 'focus', startedAt: new Date(Date.now() - ago * 60000).toISOString(), plannedMin: min, pausedLeft: null, blockId: null, label: 'Render', ...extra });
const setActive = async (active, sessions) => { const x = (await api.get('day:' + D)).value ?? {}; await api.put('day:' + D, { ...x, focus: { ...(x.focus ?? {}), active, sessions: sessions ?? x.focus?.sessions ?? [] } }); };
const session = (i) => ({ id: `s${i}`, blockId: null, label: 'Earlier ' + i, kind: null, start: `${D}T09:00:00`, end: `${D}T09:25:00`, minutes: 25 });
const open = async (path) => { await p.goto(s.url + path); await p.locator('.focus-panel, .mini-timer').first().waitFor(); };

// Watches the page for `ms` and says what changed: how many changes landed inside each guarded region and which
// elements outside them were touched. A text change inside the clock, an attribute change on the ring and the tab
// title are the only changes a ticking timer may make.
const watch = (guard, nodes, ms) => p.evaluate(async ([guard, nodes, ms]) => {
  const marks = nodes.map((q) => document.querySelector(q));
  marks.forEach((el) => { if (el) el.__same = true; });
  const inside = Object.fromEntries(guard.map((g) => [g, 0])), outside = new Set();
  const seen = (m) => {
    const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    const hit = guard.find((g) => el?.closest(g));
    if (hit) { inside[hit]++; return; }
    const clock = el?.closest('.focus-read b, .focus-config-time, .mt-trigger b');
    const ring = m.type === 'attributes' && el?.closest('.ring');
    if (!clock && !ring) outside.add(`${m.type}:${el?.tagName}.${el?.className?.baseVal ?? el?.className}`);
  };
  const mo = new MutationObserver((list) => list.forEach(seen));
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const clock = document.querySelector('.focus-read b, .mt-trigger b')?.textContent;
  await new Promise((r) => setTimeout(r, ms));
  mo.disconnect();
  return { inside, outside: [...outside], kept: nodes.map((q, i) => !!marks[i] && document.querySelector(q) === marks[i] && marks[i].__same === true), clock: [clock, document.querySelector('.focus-read b, .mt-trigger b')?.textContent], title: document.title };
}, [guard, nodes, ms]);

try {
  // ---------- 1. The Focus screen ----------
  await setActive(run(25, 5), [session(1), session(2), session(3)]);
  await open('/focus');
  await p.locator('.focus-history svg').first().waitFor();
  await p.waitForTimeout(1500);
  const f = await watch(['.focus-history', '.focus-sessions', '.focus-widgets', '.focus-stage .focus-run', '.focus-stage .focus-cycle-summary', '.title-row'], ['.focus-history .chart svg', '.focus-sessions .session', '.focus-history', '.focus-run'], 5200);
  check('the clock on the Focus screen keeps running', f.clock[0] !== f.clock[1] && /^\d\d:\d\d$/.test(f.clock[1]));
  check('the four-week chart is not drawn again while the timer runs', f.inside['.focus-history'] === 0 && f.kept[0]);
  check('the session list is not rebuilt while the timer runs', f.inside['.focus-sessions'] === 0 && f.kept[1]);
  check('the cards around the timer and the title row stay as they are', f.inside['.focus-widgets'] + f.inside['.focus-stage .focus-run'] + f.inside['.focus-stage .focus-cycle-summary'] + f.inside['.title-row'] === 0 && f.kept[3]);
  check('only the clock and the ring change on the Focus screen', f.outside.length === 0 || (console.log(f.outside), false));
  check('the tab title carries the clock', /^\d\d:\d\d · /.test(f.title));
  check('the timer keeps its role and stays quiet for a screen reader', await p.evaluate(() => { const t = document.querySelector('.focus-read b'); return t.getAttribute('role') === 'timer' && t.getAttribute('aria-live') === 'off'; }));

  // the settings view shows the clock in the card's title too
  await p.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await p.locator('.focus-config-time').waitFor();
  const t0 = await p.locator('.focus-config-time').innerText();
  await p.waitForTimeout(2200);
  check('the clock in the settings view keeps running too', t0 !== await p.locator('.focus-config-time').innerText());

  // ---------- 2. The mini timer on another screen ----------
  await setActive(run(25, 5), [session(1)]);
  await open('/');
  await p.locator('.mini-timer .mt-trigger b').waitFor();
  const m = await watch(['.mt-panel'], ['.mt-panel', '.mt-body', '.mini-timer'], 5200);
  check('the mini timer\'s clock keeps running', m.clock[0] !== m.clock[1] && /^\d\d:\d\d$/.test(m.clock[1]));
  check('the mini timer\'s details are not rebuilt', m.inside['.mt-panel'] === 0 && m.kept.every(Boolean));
  check('only the clock and the ring change in the mini timer', m.outside.length === 0 || (console.log(m.outside), false));

  // ---------- 3. What hangs on time still happens ----------
  // a phase that runs out on another screen: the session is logged and the break begins
  await setActive(run(1, 1 - 2 / 60), []);
  await open('/');
  const ended = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' && x.focus.sessions.length === 1 ? x : null; });
  check('a phase that runs out on another screen is logged and the break begins', !!ended);
  // and on the Focus screen
  await setActive(run(1, 1 - 2 / 60), []);
  await open('/focus');
  const ended2 = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' && x.focus.sessions.length === 1 ? x : null; });
  check('a phase that runs out on the Focus screen is logged and the break begins', !!ended2);
  check('the Focus screen then shows the break', await until(async () => /Short break|Break/i.test(await p.locator('.focus-read .phase-name').innerText())));
  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await b.close();
  s.stop();
}
