// Plan and actual on the day grid (a strip where focus really ran) and the realistic-capacity note (day and week).
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';

const s = await startServer(), api = await demoAccount(client(s.url), { lang: 'en' }), b = await launch();
const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
const p = await c.newPage(), shots = 'reports/shots/plan-actual'; mkdirSync(shots, { recursive: true });
const check = (ok, label) => { if (!ok) throw Error('FAIL ' + label); console.log('PASS ' + label); };
const near = (a, e, tol, label) => check(Math.abs(a - e) <= tol, `${label}: ${a.toFixed(1)} vs ${e}`);

const today = new Date(); today.setHours(12, 0, 0, 0);
const at = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
const off = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
const T = iso(today), wk = weekOf(T), nextWk = weekOf(iso(off(7)));
let n = 0; const id = () => 'pa' + n++;
const fmt = (m) => (Math.floor(m / 60) ? Math.floor(m / 60) + ' h' : '') + (m % 60 ? (Math.floor(m / 60) ? ' ' : '') + (m % 60) + ' m' : '');
// the week's usual is the four weeks before the week begins: the odd days back from today (-1 ... -19) that fall before Monday
const mondayOffset = -((today.getDay() + 6) % 7);
const weekUsual = ([-1, -3, -5, -7, -9, -11, -13, -15, -17, -19].filter((k) => k < mondayOffset).length * 120) / 4;

/**
 * Seeds 35 days back to 14 ahead. `sessionDays`: how many of the 28 days before today hold four 30-minute sessions (120 min).
 * `deep`: minutes of deep work planned on each day from today on (and on the days of this week).
 */
async function seed({ sessionDays, deep }) {
  const thisWeekStart = new Date(today); thisWeekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  for (let k = -35; k <= 14; k++) {
    const d = off(k), date = iso(d);
    const hasSessions = k < 0 && k >= -28 && -k <= sessionDays * 2 && -k % 2 === 1; // every other day: 1, 3, 5 ...
    const planned = d >= thisWeekStart && k >= -7 || k >= 0;
    const sessions = hasSessions ? [9, 10, 11, 12].map((h) => ({ id: id(), blockId: null, label: 'Chapter draft', kind: 'deep', start: at(d, h, 0), end: at(d, h, 30), minutes: 30 })) : [];
    if (k === 0) sessions.push(
      { id: id(), blockId: 'b-today', label: 'Chapter draft', kind: 'deep', start: at(d, 9, 10), end: at(d, 9, 35), minutes: 25 },
      { id: id(), blockId: null, label: 'Reading', kind: 'deep', start: at(d, 14, 5), end: at(d, 14, 30), minutes: 25 });
    if (k === 1) sessions.push({ id: id(), blockId: null, label: 'Future', kind: 'deep', start: at(d, 10, 0), end: at(d, 10, 25), minutes: 25 });
    await api.put('day:' + date, {
      columns: [{ from: null, closedAt: null, blocks: planned ? [{ id: k === 0 ? 'b-today' : id(), start: 540, end: 540 + deep, label: 'Chapter draft', note: '', kind: 'deep' }] : [] }],
      tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} }, focus: { active: null, sessions },
    });
  }
}
const goDay = async (date) => { await p.goto(`${s.url}/day/${date}`); await p.locator('.col.active .col-body').waitFor(); await p.waitForTimeout(400); };
const goWeek = async (id) => { await p.goto(`${s.url}/week/${id}`); await p.locator('.title-row').waitFor(); await p.waitForTimeout(500); };
const note = (scope) => p.locator(`[data-capacity="${scope}"]`);

try {
  // ---- the strip ----
  await seed({ sessionDays: 10, deep: 300 }); // ten days with sessions, 5 h planned a day
  await goDay(T);
  const body = await p.locator('.col.active .col-body').boundingBox();
  const strips = p.locator('.col.active .actual');
  check(await strips.count() === 2, 'today shows both logged sessions (one in a block, one with no block)');
  const r0 = 540; // the grid opens at the chosen start hour (9:00)
  const want = [{ start: 9 * 60 + 10, min: 25, label: 'Chapter draft' }, { start: 14 * 60 + 5, min: 25, label: 'Reading' }];
  const boxes = [];
  for (let i = 0; i < 2; i++) boxes.push(await strips.nth(i).boundingBox());
  boxes.sort((a, z) => a.y - z.y);
  for (let i = 0; i < 2; i++) {
    near(boxes[i].y - body.y, (want[i].start - r0) * 1.2, 2, `strip ${i} top matches the session start`);
    near(boxes[i].height, want[i].min * 1.2, 2, `strip ${i} length matches the session`);
    check(boxes[i].x + boxes[i].width >= body.x + body.width - 1 && boxes[i].width <= 7, `strip ${i} sits on the edge of the column, ${boxes[i].width}px wide`);
  }
  const color = await strips.first().evaluate((e) => getComputedStyle(e).backgroundColor);
  check(color === 'rgb(29, 95, 191)', 'strip is the data colour #1d5fbf: ' + color);
  // the tip: on hover and on focus
  const reading = p.locator('.col.active .actual', { hasText: 'Reading' });
  await reading.hover();
  const tip = reading.locator('.tip');
  check(await tip.isVisible(), 'tip shows on hover');
  const tipText = (await tip.innerText()).replace(/\s+/g, ' ');
  check(/14:05\s?–\s?14:30 · 25 min · Reading/.test(tipText), 'tip text: ' + tipText);
  await p.mouse.move(5, 5);
  check(!(await tip.isVisible()), 'tip hides again');
  await p.locator('.col.active .actual').first().focus();
  check(await p.locator('.col.active .actual').first().locator('.tip').isVisible(), 'tip shows on focus');
  // no overlap with the plan: a block keeps clear of the strip
  const blk = await p.locator('.col.active .block').first().boundingBox();
  check(blk.x + blk.width <= boxes[0].x + 0.5, 'the block ends before the strip');
  // a past day shows its sessions, a coming day none; paper hides them
  await goDay(iso(off(-1)));
  check(await p.locator('.col.active .actual').count() === 4, 'yesterday shows its four sessions');
  await goDay(iso(off(1)));
  check(await p.locator('.col.active .actual').count() === 0, 'tomorrow shows no strips');
  await goDay(T);
  await p.emulateMedia({ media: 'print' });
  check(await strips.first().evaluate((e) => getComputedStyle(e).display) === 'none', 'strips are hidden on paper');
  await p.emulateMedia({ media: 'screen' });

  // ---- the closing screen ----
  await p.goto(`${s.url}/shutdown/${T}`);
  const line = p.locator('.focus-plan'); await line.waitFor();
  const lineText = (await line.innerText());
  check(/Deep work: 5 h planned · 50 m focused/.test(lineText), 'shutdown line: ' + lineText);

  // ---- the capacity note ----
  await goDay(T);
  check(await note('day').count() === 1, 'day note shows: 5 h planned against 2 h usual');
  console.log('   ' + (await note('day').innerText()).replace(/\s+/g, ' '));
  check(/5 h of deep work today/.test(await note('day').innerText()) && /2 h/.test(await note('day').innerText()), 'day note names both numbers');
  await goWeek(wk);
  check(await note('week').count() === 1, 'week note shows');
  const weekText = await note('week').innerText();
  console.log('   ' + weekText.replace(/\s+/g, ' '));
  check(weekText.includes('35 h of deep work this week') && weekText.includes('averaged ' + fmt(weekUsual)), 'week note names planned and usual (' + fmt(weekUsual) + ')');
  // dismissed: remembered for that day / week only
  await note('week').getByRole('button').click();
  check(await note('week').count() === 0, 'week note closes');
  await p.reload(); await p.locator('.title-row').waitFor(); await p.waitForTimeout(500);
  check(await note('week').count() === 0, 'week note stays closed after a reload');
  await goWeek(nextWk);
  check(await note('week').count() === 1, 'another week still shows its note');
  await goDay(T); await note('day').getByRole('button').click();
  await goDay(T);
  check(await note('day').count() === 0, 'day note stays closed after a reload');
  await goDay(iso(off(1)));
  check(await note('day').count() === 1, 'tomorrow still shows its note');
  await goDay(iso(off(-1)));
  check(await note('day').count() === 0, 'a past day shows no note');

  // under the threshold, and not enough data
  await p.evaluate(() => localStorage.clear());
  await seed({ sessionDays: 10, deep: 30 });
  await goDay(T);
  check(await note('day').count() === 0, 'below the threshold: no day note');
  await goWeek(wk);
  check(await note('week').count() === 0, 'below the threshold: no week note');
  await seed({ sessionDays: 10, deep: 150 }); // 150 min against 120: over by less than 40 %
  await goDay(T);
  check(await note('day').count() === 0, '2.5 h against 2 h is within reach: no day note');
  await seed({ sessionDays: 4, deep: 300 }); // sessions on 4 days only
  await goDay(T);
  check(await note('day').count() === 0, 'too few days with sessions: no day note');
  await goWeek(wk);
  check(await note('week').count() === 0, 'too few days with sessions: no week note');

  // ---- screenshots: the day grid and the week, light and dark, English and Turkish, wide and narrow ----
  await seed({ sessionDays: 10, deep: 300 });
  for (const lang of ['en', 'tr']) {
    await api.put('settings', { ...(await api.get('settings')).value, lang });
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        await goDay(T);
        await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await p.locator('.col.active .actual', { hasText: lang === 'en' ? 'Reading' : 'Reading' }).hover();
        await p.locator('section.plan').screenshot({ path: `${shots}/day-${lang}-${theme}-${width}.png` });
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang} ${theme} ${width} day fits`);
        if (lang === 'tr' && theme === 'light') check(/dk · Reading/.test(await p.locator('.col.active .actual .tip').last().innerText()), 'Turkish tip uses dk');
        await goWeek(wk);
        await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await note('week').waitFor();
        await p.screenshot({ path: `${shots}/week-${lang}-${theme}-${width}.png` });
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang} ${theme} ${width} week fits`);
      }
    }
  }
} finally { await b.close(); s.stop(); }
