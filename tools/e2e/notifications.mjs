// Notifications while the app is closed: the server's push for a focus or break ending and the morning and evening
// reminders (caught by a fake push service and decrypted the way a browser would), the service worker's words and
// its refusal to double what an open page already says, the Settings section, and the notification buttons.
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
import { fakeSubscription } from '../lib/push-receive.mjs';

const dir = 'reports/shots/notifications';
mkdirSync(dir, { recursive: true });
let passed = 0;
const check = (name, ok) => { if (!ok) throw Error(name); passed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (name, fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(100); } throw Error(`timeout: ${name}`); };

// the fake push service
const received = [];
const sink = createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => { received.push({ endpoint: req.headers['x-endpoint'], ttl: req.headers.ttl, body: Buffer.concat(chunks) }); res.statusCode = 201; res.end(); });
});
await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const SINK = `http://127.0.0.1:${sink.address().port}/`;

const s = await startServer({ env: { PUSH_SINK_URL: SINK, NODE_OPTIONS: `--import ${pathToFileURL(resolve('tools/lib/push-sink.mjs')).href}` } });
const b = await launch();
const zone = 'Europe/Istanbul';
const hhmm = (offset = 0) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + offset * 60000));
const opened = (sub, from = 0) => received.slice(from).filter((r) => r.endpoint === sub.endpoint).map((r) => JSON.parse(sub.open(r.body)));

// a browser that has a push subscription of its own (headless Chrome has no push service to ask)
const stub = (sub) => `(() => {
  const sub = ${JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys })};
  const make = () => ({ endpoint: sub.endpoint, toJSON: () => ({ endpoint: sub.endpoint, keys: sub.keys, expirationTime: null }), unsubscribe: async () => { localStorage.removeItem('stub-sub'); return true; } });
  PushManager.prototype.getSubscription = async function () { return localStorage.getItem('stub-sub') ? make() : null; };
  PushManager.prototype.subscribe = async function () { localStorage.setItem('stub-sub', '1'); return make(); };
})();`;

async function shell(lang, { stubbed = true } = {}) {
  const api = await demoAccount(client(s.url), { lang });
  const sub = fakeSubscription();
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', timezoneId: zone, serviceWorkers: 'allow' });
  await c.grantPermissions(['notifications'], { origin: s.url });
  await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
  if (stubbed) await c.addInitScript(stub(sub));
  const p = await c.newPage();
  return { api, sub, c, p, lang };
}
const allow = async ({ p }) => {
  await p.goto(`${s.url}/settings`);
  const panel = p.locator('.notif-panel');
  await panel.waitFor();
  await p.locator('.notif-panel[data-state="off"]').waitFor();
  await panel.getByRole('button').click();
  await p.locator('.notif-panel[data-state="on"]').waitFor();
};

try {
  // ---- Settings: status, "Allow", the choices ----
  const A = await shell('en');
  const { api, sub, p, c } = A;
  await p.goto(`${s.url}/settings`);
  await p.locator('.notif-panel[data-state="off"]').waitFor();
  check('off: choices are unavailable until allowed', await p.locator('.notif-choices').evaluate((e) => e.disabled));
  check('off: allow button and status', (await p.locator('.notif-panel').innerText()).includes('Off for this device.') && await p.getByRole('button', { name: 'Allow notifications' }).count() === 1);
  await allow(A);
  check('subscription stored for this account', (await api.call(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`)).body.subscribed === true);
  check('on: choices enabled', !(await p.locator('.notif-choices').evaluate((e) => e.disabled)));
  const sw0 = p.locator('.notif-choices input.switch'), tm = p.locator('.notif-choices input[type=time]');
  check('defaults: focus on, plans off', await sw0.nth(0).isChecked() && !(await sw0.nth(1).isChecked()) && !(await sw0.nth(2).isChecked()));
  check('defaults: 08:30 and, with no workday chosen, 17:30', (await tm.nth(0).inputValue()) === '08:30' && (await tm.nth(1).inputValue()) === '17:30');
  check('time and weekends are locked while no plan reminder is on', await tm.first().isDisabled() && await sw0.nth(3).isDisabled());
  await sw0.nth(1).check();
  await tm.nth(0).fill('07:45');
  await sw0.nth(2).check();
  await tm.nth(1).fill('18:20');
  await sw0.nth(3).check();
  await sw0.nth(0).uncheck();
  await until('settings saved', async () => { const n = (await api.get('settings')).value.notify; return n?.eveningAt === '18:20' && n?.focus === false && n?.weekends === true; });
  const n1 = (await api.get('settings')).value.notify;
  check('choices saved', n1.morning === true && n1.morningAt === '07:45' && n1.evening === true && n1.weekends === true && n1.focus === false);
  // leave the settings screen first, so its copy of the choices cannot be saved back over the reset below
  await p.goto('about:blank');
  await api.put('settings', { ...(await api.get('settings')).value, notify: undefined });

  // ---- the server's pushes, as the fake push service receives them ----
  const mark = received.length;
  const key = `day:${iso(new Date())}`;
  const base = (await api.get(key)).value;
  const blocksToday = base.columns.at(-1).blocks.length;
  const phase = (over) => ({ phase: 'focus', startedAt: new Date(Date.now() - 57_000).toISOString(), plannedMin: 1, pausedLeft: null, blockId: null, label: 'Draft', ...over });
  const seed = (active) => api.put(key, { ...base, focus: { sessions: [], active } });
  await seed(phase());
  const t0 = Date.now();
  await until('focus end push', () => opened(sub, mark).length > 0);
  check('focus end arrives within seconds of its end time', Date.now() - t0 < 9000 && Date.now() - t0 > 1500);
  check('focus end payload is only a short type', JSON.stringify(opened(sub, mark)) === '[{"type":"focus-end"}]');
  check('TTL set', Number(received[mark].ttl) > 0);
  await wait(2500);
  check('sent exactly once', opened(sub, mark).length === 1);

  // extended after planning: the old end time sends nothing
  const m2 = received.length;
  await seed(phase({ startedAt: new Date(Date.now() - 56_000).toISOString() }));
  await wait(300);
  await seed(phase({ startedAt: new Date(Date.now() - 56_000).toISOString(), plannedMin: 3 }));
  await wait(5500);
  check('extension cancels the stale push', opened(sub, m2).length === 0);
  await seed(phase({ pausedLeft: 30 }));
  await wait(300);
  await seed(null);
  // a break that ends: the next phase's button is offered (automatic focus is off)
  const m3 = received.length;
  await seed(phase({ phase: 'short', startedAt: new Date(Date.now() - 58_000).toISOString() }));
  await until('break end push', () => opened(sub, m3).length > 0);
  check('break end offers the button', JSON.stringify(opened(sub, m3)) === '[{"type":"break-end","act":1}]');
  await seed(null);

  // morning and evening, at the time chosen, in the device's zone
  const m4 = received.length;
  await api.put(key, { ...base, shutdown: { done: true, at: new Date().toISOString(), steps: {} }, focus: { sessions: [], active: null } });
  await api.put('settings', { ...(await api.get('settings')).value, notify: { focus: false, morning: true, morningAt: hhmm(0), evening: true, eveningAt: hhmm(0), weekends: true } });
  await until('morning push', () => opened(sub, m4).length > 0);
  await wait(1200);
  const got = opened(sub, m4);
  check('morning says how many blocks are planned', got.length === 1 && got[0].type === 'morning' && got[0].n === blocksToday);
  await api.put(key, { ...base, focus: { sessions: [], active: null } });   // shutdown not done
  await until('evening push', () => opened(sub, m4).some((x) => x.type === 'evening'));
  check('evening comes only while the shutdown is open', opened(sub, m4).map((x) => x.type).join() === 'morning,evening');
  await api.put('settings', { ...(await api.get('settings')).value, notify: undefined });

  // ---- the service worker: words, and no second notification for a page that is open ----
  await p.goto(`${s.url}/settings`);
  await p.locator('.notif-panel[data-state="on"]').waitFor();
  await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const sw = c.serviceWorkers()[0] ?? await c.waitForEvent('serviceworker');
  const cdp = await c.newCDPSession(p);
  const regs = new Map(); cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => e.registrations.forEach((r) => regs.set(r.scopeURL, r.registrationId)));
  await cdp.send('ServiceWorker.enable');
  await until('registration id', () => regs.size > 0);
  const deliver = async (msg) => { await cdp.send('ServiceWorker.deliverPushMessage', { origin: s.url, registrationId: [...regs.values()][0], data: JSON.stringify(msg) }); await wait(700); };
  const shown = () => sw.evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url, go: n.data?.go, actions: n.actions.map((a) => `${a.action}:${a.title}`) })));
  const clear = () => sw.evaluate(async () => { (await self.registration.getNotifications()).forEach((n) => n.close()); });
  await clear();
  await deliver({ type: 'focus-end', act: 1 });
  check('page in front: a focus end is not announced twice', (await shown()).length === 0);
  await deliver({ type: 'break-end' });
  check('page in front: a break end is not announced twice', (await shown()).length === 0);
  await deliver({ type: 'morning', n: 3 });
  let list = await shown();
  check('morning is shown even then, with the count', list.length === 1 && list[0].title === 'Plan your day' && list[0].body === '3 blocks are planned today.' && list[0].url === `/day/${iso(new Date())}`);
  await clear(); await deliver({ type: 'morning', n: 1 }); check('one block', (await shown())[0].body === 'One block is planned today.');
  await clear(); await deliver({ type: 'morning' }); check('no count', (await shown())[0].body === 'Take a few minutes to plan today.');
  await clear(); await deliver({ type: 'evening' });
  list = await shown(); check('evening opens the shutdown', list[0].title === 'Time to shut down' && list[0].url === `/shutdown/${iso(new Date())}`);
  await clear();
  await p.goto('about:blank');                       // no page of the planner is open any more
  await deliver({ type: 'focus-end', act: 1 });
  list = await shown();
  check('app closed: focus end is shown, opens /focus, offers "Start break"', list.length === 1 && list[0].title === 'Focus session done' && list[0].tag === 'focus' && list[0].url === '/focus' && list[0].actions.join() === 'go:Start break' && list[0].go === 'break');
  await clear(); await deliver({ type: 'break-end', act: 1 });
  list = await shown(); check('app closed: break end offers "Start focus"', list[0].title === 'Break is over' && list[0].actions.join() === 'go:Start focus');
  await clear(); await deliver({ type: 'focus-end' });
  check('no button when the next phase starts by itself', (await shown())[0].actions.length === 0);
  await clear(); await deliver({ type: 'block' });
  check('block reminders keep their words', (await shown())[0].title === 'Block reminders');

  // ---- the notification's button opens the app where the phase starts ----
  const settingsNow = (await api.get('settings')).value;
  await api.put('settings', { ...settingsNow, focus: { ...settingsNow.focus, autoBreak: false, sound: false } });
  await api.put(key, { ...base, focus: { sessions: [], active: phase({ startedAt: new Date(Date.now() - 61_000).toISOString() }) } });
  await p.goto(`${s.url}/focus?go=break`);
  await until('break started by the button', async () => { const a = (await api.get(key)).value.focus.active; return a?.phase === 'short' && a.pausedLeft == null; });
  check('button: the ended focus session was logged and the break runs', (await api.get(key)).value.focus.sessions.length === 1);
  await until('address cleaned', () => new URL(p.url()).search === '');
  await api.put(key, { ...base, focus: { sessions: [], active: null } });
  await p.goto(`${s.url}/focus?go=focus`);
  await until('focus started by the button', async () => (await api.get(key)).value.focus.active?.phase === 'focus');
  await api.put(key, { ...base, focus: { sessions: [], active: null } });
  await p.goto(`${s.url}/focus?go=break`);                     // a stale button with nothing running starts nothing
  await wait(1500);
  check('stale break button starts nothing', (await api.get(key)).value.focus.active === null);
  await A.c.close();

  // ---- pictures: the section, light and dark, wide and narrow, English and Turkish ----
  for (const lang of ['en', 'tr']) {
    const B = await shell(lang);
    await allow(B);
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await B.p.setViewportSize({ width, height: 900 });
      await B.p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      const sec = B.p.locator('section[aria-labelledby="s-notif"]');
      await sec.scrollIntoViewIfNeeded();
      const box = await sec.boundingBox();
      check(`${lang} ${width} ${theme}: section fits the screen`, box.x >= 0 && box.x + box.width <= width + 1);
      const wide = await B.p.evaluate(() => [...document.querySelectorAll('.notif-panel, .notif-panel *, section[aria-labelledby="s-notif"]')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => e.className || e.tagName));
      check(`${lang} ${width} ${theme}: the section has no sideways overflow ${wide.join(' ')}`, wide.length === 0);
      await sec.screenshot({ path: `${dir}/${lang}-${width}-${theme}-on.png` });
    }
    await B.c.close();
  }
  const O = await shell('en');
  await O.p.goto(`${s.url}/settings`); await O.p.locator('.notif-panel[data-state="off"]').waitFor();
  for (const width of [1440, 390]) { await O.p.setViewportSize({ width, height: 900 }); await O.p.locator('section[aria-labelledby="s-notif"]').screenshot({ path: `${dir}/en-${width}-light-off.png` }); }
  await O.c.close();
  // an iPhone's browser tab cannot subscribe: the note says to add the app to the Home Screen first
  const I = await shell('en', { stubbed: false });
  await I.c.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' }); delete window.PushManager; });
  await I.p.goto(`${s.url}/settings`); await I.p.locator('.notif-panel[data-state="unsupported"]').waitFor();
  check('iPhone: home screen note', (await I.p.locator('.notif-panel').innerText()).includes('Home Screen'));
  await I.p.locator('section[aria-labelledby="s-notif"]').screenshot({ path: `${dir}/en-1440-light-ios.png` });
  await I.c.close();
  console.log(`notifications e2e: ${passed} checks passed`);
} catch (e) {
  console.error(`FAILED after ${passed} checks:`, e.message);
  console.error(s.log().split('\n').slice(-8).join('\n'));
  process.exitCode = 1;
} finally {
  await b.close(); s.stop(); sink.close();
}
