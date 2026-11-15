import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
import assert from 'node:assert/strict';

const s = await startServer();
const api = await demoAccount(client(s.url), { lang: 'en' });
const browser = await launch();
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS ' + label); };
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  throw Error('Timed out');
};
const key = 'day:' + iso(new Date()), path = '/day/' + iso(new Date());
const contexts = await Promise.all([0, 1].map(async () => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
  return c;
}));
const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
let gets = 0, totalGets = 0, holdRead = false, heldRead, readBody, holdPut = false, heldPut;
const note = page => page.locator('.notes-area');
const event = name => b.evaluate(name => {
  if (name === 'visible' || name === 'hidden') {
    window.testVisibility = name;
    document.dispatchEvent(new Event('visibilitychange'));
  } else window.dispatchEvent(new Event(name));
}, name);
// Advance the throttle's wall clock without firing periodic callbacks.
let now = Date.now();
const age = async () => { now += 16_000; await b.clock.setSystemTime(now); };
const remote = async text => {
  await note(a).fill(text);
  await wait(async () => (await api.get(key)).value.notes === text);
};
try {
  // Headless pages do not have OS tab visibility; exercise the browser event handlers deterministically.
  await b.addInitScript(() => {
    window.testVisibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => window.testVisibility });
  });
  await b.clock.install({ time: now });
  await b.clock.pauseAt(now + 1000); now += 1000;
  await b.route('**/api/doc/*', async route => {
    if (route.request().method() === 'GET') totalGets++;
    if (decodeURIComponent(new URL(route.request().url()).pathname) !== '/api/doc/' + key) return route.continue();
    if (route.request().method() === 'GET') {
      gets++;
      if (holdRead) {
        holdRead = false;
        readBody = await (await route.fetch()).json();
        heldRead = route;
        return;
      }
    } else if (route.request().method() === 'PUT' && holdPut) {
      holdPut = false; heldPut = route; return;
    }
    await route.continue();
  });
  await Promise.all([a, b].map(p => p.goto(s.url + path)));
  await Promise.all([a, b].map(p => note(p).waitFor()));
  await remote('From device A');
  await event('focus');
  await wait(async () => await note(b).inputValue() === 'From device A');
  check(gets >= 2, 'focus refreshes device B from device A');
  const burst = gets;
  await event('visible'); await event('online'); await event('focus');
  await b.waitForTimeout(200);
  check(gets === burst, 'event bursts are throttled');

  await event('hidden');
  await remote('Visible again');
  const hiddenGets = totalGets;
  await b.clock.runFor(60_000); now += 60_000;
  await event('focus'); await event('online');
  await b.waitForTimeout(200);
  check(totalGets === hiddenGets, 'hidden tab makes zero refresh GETs, including interval and events');
  await event('visible');
  await wait(async () => await note(b).inputValue() === 'Visible again');
  check(true, 'visible event refreshes the open document');

  await contexts[1].setOffline(true);
  await remote('After reconnect');
  await age();
  await contexts[1].setOffline(false); await event('online');
  await wait(async () => await note(b).inputValue() === 'After reconnect');
  check(true, 'offline to online refreshes device B');

  // An unsent edit keeps its base version so the existing 409 draft path handles the remote change.
  await age();
  await remote('Remote conflict');
  await note(b).fill('Local pending draft');
  const beforePending = gets;
  await event('visible');
  check(await note(b).inputValue() === 'Local pending draft' && gets === beforePending, 'debounced local edit survives refresh');
  holdPut = true;
  await b.clock.runFor(650); now += 650;
  await wait(() => !!heldPut);
  await event('focus');
  check(await note(b).inputValue() === 'Local pending draft' && gets === beforePending, 'inflight PUT survives refresh');
  await heldPut.continue(); heldPut = null;
  await b.locator('.draft').waitFor();
  await b.getByRole('button', { name: 'Show my changes' }).click();
  check((await b.locator('.draft-cols').textContent()).includes('Local pending draft'), '409 preserves local draft after deferred refresh');
  await b.getByRole('button', { name: 'Ignore', exact: true }).click();

  // A delayed GET cannot overwrite an edit whose PUT has already completed.
  await age(); holdRead = true; await event('focus');
  await wait(() => !!heldRead);
  const dedup = gets;
  await age(); await event('focus');
  check(gets === dedup, 'overlapping GETs are coalesced');
  await note(b).fill('Saved after read started');
  await b.clock.runFor(650); now += 650;
  await wait(async () => (await api.get(key)).value.notes === 'Saved after read started');
  await heldRead.fulfill({ json: readBody }); heldRead = null;
  await b.waitForTimeout(200);
  check(await note(b).inputValue() === 'Saved after read started', 'stale GET cannot regress a completed save');

  await age(); holdRead = true; await event('focus'); await wait(() => !!heldRead);
  await heldRead.fulfill({ json: { ...readBody, version: 0, value: { ...readBody.value, notes: 'Stale server replica' } } }); heldRead = null;
  await b.waitForTimeout(200);
  check(await note(b).inputValue() === 'Saved after read started', 'lower server version is ignored');

  await a.reload(); await note(a).waitFor();
  await remote('Periodic update');
  await b.clock.runFor(30_001); now += 30_001;
  await wait(async () => await note(b).inputValue() === 'Periodic update');
  check(true, 'visible subscribed document refreshes periodically');
} finally {
  await browser.close(); s.stop();
}
