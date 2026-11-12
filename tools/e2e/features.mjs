// End-to-end checks of the planner's features in a real browser, against a throwaway server.
//   npm run build && node tools/e2e/features.mjs [--shots <dir>]
// Each check prints PASS or FAIL; the process exits with 1 when any check fails.
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const shot = async (page, name, opts = {}) => { if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png`, ...opts }); };

const srv = await startServer();
const api = await demoAccount(client(srv.url), { lang: 'en' });
const D = iso(new Date());
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' });
await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
const doc = async (key) => (await api.get(key)).value;

try {
  // ---------- passkeys, with Chrome's virtual authenticator ----------
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(`${srv.url}/settings/account`);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await page.getByText('Passkey added.').waitFor({ timeout: 8000 });
  const pks = (await api.call('/api/account/passkeys')).body;
  check('a passkey is added from Settings', pks.length === 1, pks[0]?.name);
  await page.getByRole('button', { name: 'Sign out here' }).click();
  await page.waitForURL('**/login');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.getByRole('heading', { name: 'Overview', level: 1 }).waitFor({ timeout: 8000 }).catch(() => {});
  check('signing in with the passkey opens the overview', new URL(page.url()).pathname === '/');
  // the browser has a new session now; the API client follows it
  api.cookie = `sc_session=${(await ctx.cookies()).find((c) => c.name === 'sc_session').value}`;
  const used = (await api.call('/api/account/passkeys')).body[0];
  check('the passkey shows when it was last used', !!used?.lastUsed);
  await page.goto(`${srv.url}/settings/account`);
  await page.getByRole('button', { name: /^Remove / }).click();
  await page.getByText('No passkeys yet.').waitFor();
  check('a passkey can be removed', (await api.call('/api/account/passkeys')).body.length === 0);

  // ---------- day templates ----------
  await api.put(`day:${D}`, { ...(await doc(`day:${D}`)), columns: [{ from: null, closedAt: null, blocks: [] }] });
  const weekday = (new Date().getDay() + 6) % 7;
  const settings = await doc('settings');
  await api.put('settings', { ...settings, templates: settings.templates.map((t) => ({ ...t, days: [weekday] })) });
  await page.goto(`${srv.url}/day/${D}`);
  const suggest = page.getByRole('button', { name: /^Apply “/ });
  check('an empty day suggests its weekday’s template', await suggest.waitFor({ timeout: 5000 }).then(() => true, () => false));
  await suggest.click();
  await page.waitForTimeout(1200);
  const applied = (await doc(`day:${D}`)).columns.at(-1).blocks;
  check('applying the template fills the day', applied.length === 3, applied.map((b) => b.label).join(', '));
  await page.getByRole('button', { name: 'Templates' }).click();
  await page.locator('#tp-name').fill('Teaching day');
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.waitForTimeout(1200);
  check('the day can be saved as a new template', (await doc('settings')).templates.some((t) => t.name === 'Teaching day'));

  // ---------- dragging a task onto the grid ----------
  const grip = page.locator('.check-row.grabbable .grip').first();
  const task = await page.locator('.check-row.grabbable .text').first().inputValue();
  const body = await page.locator('.col.active .col-body').boundingBox();
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  const target = { x: body.x + body.width / 2, y: body.y + (14 * 60 - 540) * 1.2 + 4 }; // 14:00
  await page.mouse.move(target.x, target.y, { steps: 12 });
  check('a dashed preview shows where the task will land', await page.locator('.block.ghost.drop').isVisible());
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const dropped = (await doc(`day:${D}`)).columns.at(-1).blocks.find((b) => b.label === task);
  check('dropping a task makes a block at that time', dropped?.start === 840 && dropped?.end === 870, JSON.stringify(dropped));

  // ---------- printing ----------
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({
    rail: getComputedStyle(document.querySelector('.rail')).display,
    head: getComputedStyle(document.querySelector('.print-head')).display,
    cols: getComputedStyle(document.querySelector('.spread')).gridTemplateColumns.split(' ').length,
  }));
  check('print hides the app chrome and keeps the two-page spread', printed.rail === 'none' && printed.head === 'flex' && printed.cols === 2, JSON.stringify(printed));
  await shot(page, 'print-day', { fullPage: true });
  const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
  check('the day prints to one A4 page', pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length === 1);
  await page.emulateMedia({ media: 'screen' });

  // ---------- dark theme ----------
  await page.goto(`${srv.url}/settings`);
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('the dark theme turns the page dark', bg === 'rgb(11, 11, 11)', bg);
  await page.goto(`${srv.url}/day/${D}`);
  await page.waitForTimeout(600);
  check('the theme stays after a reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await shot(page, 'dark-day');
  await page.goto(`${srv.url}/metrics`);
  await page.waitForTimeout(1200);
  await shot(page, 'dark-metrics');
  await page.goto(`${srv.url}/settings`);
  await page.getByRole('button', { name: 'Light' }).click();

  // ---------- the sign-in tutorial ----------
  const guest = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })).newPage();
  await guest.goto(`${srv.url}/login`);
  await guest.waitForFunction(() => document.querySelector('.vscreen video')?.currentTime > 0.5, null, { timeout: 8000 }).catch(() => {});
  check('the tutorial film plays', await guest.evaluate(() => document.querySelector('.vscreen video')?.currentTime > 0.5));
  await guest.locator('.seg').nth(2).click();
  await guest.waitForTimeout(1500);
  const third = await guest.evaluate(async () => {
    const film = await (await fetch('/tutorial/en/tutorial.json')).json(), t = document.querySelector('.vscreen video').currentTime, c = film.chapters[2];
    return { t: +t.toFixed(2), from: c.start, to: c.end, bar: [...document.querySelectorAll('.seg')].findIndex((b) => b.getAttribute('aria-selected') === 'true') };
  });
  check('a progress bar jumps to its chapter', third.t >= third.from && third.t < third.to && third.bar === 2, JSON.stringify(third));
  check('the tutorial has no player controls', (await guest.locator('.showcase button:not(.seg)').count()) === 0);
  const film = await (await fetch(`${srv.url}/tutorial/en/tutorial.json`)).json();
  check('the film has five chapters and closes on its opening card', film.chapters.length === 5 && film.loopAt < film.duration && Math.abs(film.chapters.at(-1).end - film.loopAt) < 0.01);
  // with the system asking for less motion the clips still play; Settings can turn motion fully on per device
  const calm = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' })).newPage();
  await calm.goto(`${srv.url}/login`);
  check('reduced motion follows the system', (await calm.evaluate(() => document.documentElement.dataset.motion)) === 'reduce');
  await calm.waitForFunction(() => document.querySelector('.vscreen video')?.currentTime > 0.5, null, { timeout: 8000 }).catch(() => {});
  check('the tutorial plays with reduced motion too', await calm.evaluate(() => document.querySelector('.vscreen video')?.currentTime > 0.5));
  await calm.evaluate(() => localStorage.setItem('sc-motion', 'full'));
  await calm.reload();
  check('motion can be turned on for the device', (await calm.evaluate(() => document.documentElement.dataset.motion)) === 'full');

  // ---------- installable ----------
  const manifest = await (await fetch(`${srv.url}/manifest.webmanifest`)).json();
  check('the app has a manifest with icons', manifest.icons?.length >= 3 && manifest.display === 'standalone');
  const sw = await fetch(`${srv.url}/sw.js`);
  check('the service worker is served', sw.ok && (await sw.text()).includes('networkFirst'));
} finally {
  await browser.close();
  srv.stop();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
