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
// every picture shows the same day: Thursday 1 January 2026, mid-afternoon, with a year of history behind it
const today = new Date(2026, 0, 1, 15, 10), D = iso(today);
const api = await demoAccount(client(srv.url), { lang: 'en', today, history: 400 });
const browser = await launch();
const at = today;
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
    { ...chapter, id: 'chapter-r', start: 660, end: 720 }, ...later] }],
    // a day well under way: two hours of deep focus logged, most of the list done, habits ticked
    tasks: day.tasks.map((t, i) => ({ ...t, done: i < 2 })),
    metrics: { ...day.metrics, deep: 2.1, exercise: true, read: true },
    focus: { active: null, sessions: [[570, chapter.id, chapter.label], [600, chapter.id, chapter.label], [665, 'chapter-r', chapter.label], [695, 'chapter-r', chapter.label], [875, later.find((b) => b.kind === 'deep')?.id ?? null, later.find((b) => b.kind === 'deep')?.label ?? 'Focus']].map(([m, blockId, label], i) => {
      const start = new Date(today); start.setHours(Math.floor(m / 60), m % 60, 0, 0);
      return { id: `s${i}`, blockId, label, kind: 'deep', start: start.toISOString(), end: new Date(start.getTime() + 25 * 60000).toISOString(), minutes: 25, ...(i === 1 ? { note: 'Outline of section 3 done' } : {}) };
    }) } });
  await shoot(light, `/day/${D}`, 'day.jpg');
  await shoot(light, '/', 'home.jpg');
  await shoot(light, `/month/${D.slice(0, 7)}`, 'month.jpg');
  // January has one day so far: habits and the year show the full month and year before it
  await shoot(light, '/habits/2025-12', 'habits.jpg');
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
  // the year before, with its seasons' goals and a written review
  const seasons = [['Outline the book', 'Grant application sent'], ['Chapters 1 and 2 drafted', 'Pilot study designed'], ['Chapter 3 drafted', 'Summer school talk'], ['Chapter 4 started', 'Pilot data collected']];
  for (const [q, goals] of seasons.entries()) await api.put(`quarter:2025-Q${q + 1}`, { goals: goals.map((text, i) => ({ id: `q${q}${i}`, text, done: q < 3 || i === 1 })), notes: '' });
  await api.put('year:2025', { good: 'Wrote most mornings before e-mail, and kept the shutdown ritual on four days out of five.', change: 'Plan the week on Sunday evening, and give the pilot analysis its own afternoon block.' });
  await shoot(light, '/year/2025', 'year.jpg');
  await shoot(light, `/shutdown/${D}`, 'shutdown.jpg');
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
