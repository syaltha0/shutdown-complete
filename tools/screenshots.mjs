// Retakes the README screenshots in docs/screenshots/ from a throwaway demo planner.
//   npm run build && node tools/screenshots.mjs
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './lib/browser.mjs';
import { client, startServer } from './lib/server.mjs';
import { demoAccount, iso } from './lib/demo.mjs';

const OUT = resolve(import.meta.dirname, '../docs/screenshots');
mkdirSync(OUT, { recursive: true });
const srv = await startServer();
const api = await demoAccount(client(srv.url), { lang: 'en' });
const today = new Date(), D = iso(today);
const browser = await launch();
// the pictures are taken at 10:42 on a workday morning, whatever the time is now
const at = new Date(today); at.setHours(10, 42, 0, 0);
const CLOCK = `(() => { const R = Date, off = ${at.getTime()} - R.now();
  class F extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
  window.Date = F; })();`;
const shoot = async (ctx, path, file, wait = 1400) => {
  const page = await ctx.newPage();
  await page.goto(srv.url + path);
  await page.waitForTimeout(wait);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 84 });
  await page.close();
  console.log(file);
};

try {
  const opts = { viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' };
  const light = await browser.newContext(opts);
  await light.addInitScript(CLOCK);
  await light.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
  // the day mid-morning, with the plan already revised once
  const day = (await api.get(`day:${D}`)).value;
  const [col] = day.columns;
  // the call at 10:30 eats into the chapter; the overflow block after it absorbs the rest, as the method plans it
  const chapter = col.blocks.find((b) => b.kind === 'deep');
  const later = col.blocks.filter((b) => b.start >= 720).map((b) => ({ ...b, id: `${b.id}r` }));
  await api.put(`day:${D}`, { ...day, columns: [{ ...col, closedAt: 630 }, { from: 630, closedAt: null, blocks: [
    { id: 'urgent', start: 630, end: 660, label: 'Grant office call', note: '', kind: 'meeting' },
    { ...chapter, id: 'chapter-r', start: 660, end: 720 }, ...later] }] });
  await shoot(light, `/day/${D}`, 'day.jpg');
  await shoot(light, '/', 'home.jpg');
  await shoot(light, `/month/${D.slice(0, 7)}`, 'month.jpg');
  await shoot(light, `/habits/${D.slice(0, 7)}`, 'habits.jpg');
  await shoot(light, '/focus', 'focus.jpg');
  const tasks = await light.newPage();
  await tasks.goto(srv.url + '/tasks');
  for (const title of ['Draft the next chapter', 'Review research notes', 'Prepare the weekly plan']) {
    await tasks.getByPlaceholder(/^Add a task/).fill(title);
    await tasks.getByPlaceholder(/^Add a task/).press('Enter');
    await tasks.waitForTimeout(300);
  }
  await tasks.close();
  await shoot(light, '/tasks', 'tasks.jpg');
  await shoot(light, `/year/${D.slice(0, 4)}`, 'year.jpg');
  const room = await light.newPage();
  await room.goto(srv.url + '/focus');
  await room.getByRole('button', { name: 'Focus room', exact: true }).click();
  await room.locator('.focus-room').waitFor();
  await room.screenshot({ path: join(OUT, 'focus-room.jpg'), type: 'jpeg', quality: 84 });
  await room.close();

  const dark = await browser.newContext({ ...opts, colorScheme: 'dark' });
  await dark.addInitScript(CLOCK);
  await dark.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
  await shoot(dark, `/day/${D}`, 'day-dark.jpg');

  // the same planner on a phone, for the README showcase (tools/render-showcase.mjs)
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', reducedMotion: 'reduce' };
  for (const [scheme, suffix] of [['light', ''], ['dark', '-dark']]) {
    const ctx = await browser.newContext({ ...phone, colorScheme: scheme });
    await ctx.addInitScript(CLOCK);
    await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
    await shoot(ctx, `/day/${D}`, `phone-day${suffix}.jpg`);
    await shoot(ctx, '/focus', `phone-focus${suffix}.jpg`);
    await ctx.close();
  }

  // signed out, with the tutorial a few seconds in
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await shoot(guest, '/login', 'sign-in.jpg', 3200);
} finally {
  await browser.close();
  srv.stop();
}
