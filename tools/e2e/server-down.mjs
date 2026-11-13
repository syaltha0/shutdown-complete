// Saving while the server cannot be reached: silent for a short wait and for normal saves, a calm warning once it lasts.
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const s = await startServer(), api = await demoAccount(client(s.url), { lang: 'en' }), b = await launch();
const c = await b.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
const p = await c.newPage();
const check = (ok, label) => { if (!ok) throw Error('FAIL ' + label); console.log('PASS ' + label); };
const date = iso(new Date());
const bar = p.locator('.offline-queue');
const down = { on: false, mode: '503' };
await p.route('**/api/doc/*', (route) => {
  if (route.request().method() !== 'PUT' || !down.on) return route.continue();
  return down.mode === 'net' ? route.abort('failed') : route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' });
});
// the page's own clock is simulated: seconds of waiting cost nothing, and each step lets the answers come in
let shown = false;
const wait = async (seconds) => { for (let i = 0; i < seconds * 2; i++) { await p.clock.runFor(500); await p.waitForTimeout(25); if (await bar.count()) shown = true; } };
const note = (text) => p.locator('.notes-area').fill(text);
const saved = async () => (await api.get('day:' + date)).value?.notes;

try {
  await p.clock.install();
  await p.goto(`${s.url}/day/${date}`); await p.locator('.notes-area').waitFor();

  // normal save: nothing is said, not even "saved"
  await note('First line'); await wait(3);
  check(await saved() === 'First line' && !shown && (await p.locator('.stamp').innerText()).trim() === '' && (await p.locator('.canvas').innerText()).indexOf('waiting') < 0, 'a normal save says nothing');

  for (const mode of ['503', 'net']) {
    // a short outage mends itself with no word
    down.on = true; down.mode = mode; shown = false;
    await note(`${mode} blip`); await wait(6);
    check(!shown, `${mode}: six seconds of failing saves stay silent`);
    down.on = false; await wait(14);
    check(await saved() === `${mode} blip` && !shown, `${mode}: the saves are retried by themselves and nothing was ever shown`);

    // a long one is said, with the number waiting and a Retry
    down.on = true; shown = false;
    await note(`${mode} long`); await wait(8);
    check(!shown, `${mode}: still silent at eight seconds`);
    await wait(18);
    check(await bar.count() === 1 && /Can’t reach the server · 1 change waiting/.test(await bar.innerText()), `${mode}: after a while the warning appears with the count`);
    check(await saved() !== `${mode} long`, `${mode}: the change is still only local`);
    down.on = false;
    await bar.getByRole('button', { name: 'Retry' }).click(); await wait(2);
    check(await bar.count() === 0 && await saved() === `${mode} long`, `${mode}: Retry sends it and the warning goes away`);
  }

  // the browser's own offline state keeps its own line
  await c.setOffline(true);
  await note('while offline'); await wait(2);
  check(/^Offline · 1 change waiting/.test(await bar.innerText()), 'offline keeps the existing offline line');
  await c.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(3);
  check(await bar.count() === 0 && await saved() === 'while offline', 'back online: sent, line gone');
} finally { await b.close(); s.stop(); }
