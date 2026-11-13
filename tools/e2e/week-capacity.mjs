import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';

// The weekly plan's "put it on the days" step shows how much room each day has, and updates as items are put on days.
const TZ = 'Europe/Istanbul';
const shots = 'reports/shots/week-capacity';
mkdirSync(shots, { recursive: true });
const check = (ok, label) => { if (!ok) throw new Error('FAIL ' + label); console.log('PASS ' + label); };

// next week, so every day is still ahead: Monday .. Sunday
const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + 7);
const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return iso(d); });
const week = weekOf(days[0]);
const tue = days[1].replace(/-/g, '');
// Tuesday: two events that overlap (10:00-11:00 and 10:30-11:30 are 90 minutes, not 120)
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:a@test', 'SUMMARY:Review', `DTSTART;TZID=${TZ}:${tue}T100000`, `DTEND;TZID=${TZ}:${tue}T110000`, 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b@test', 'SUMMARY:Overlap', `DTSTART;TZID=${TZ}:${tue}T103000`, `DTEND;TZID=${TZ}:${tue}T113000`, 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
const feed = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(ics); }).listen(0, '127.0.0.1');
await new Promise((ok) => feed.once('listening', ok));

const s = await startServer({ env: { CALENDAR_ALLOW_PRIVATE: 'on' } });
const api = await demoAccount(client(s.url), { lang: 'en' });
const b = await launch();
try {
  const settings = (await api.get('settings')).value;
  const set = (lang) => api.put('settings', {
    ...settings, lang, startHour: 9, endHour: 17, wholeDay: false,
    calendars: [{ id: 'work', name: 'Work', url: `http://127.0.0.1:${feed.address().port}/work.ics` }],
    // Monday and Thursday have a class 13:00-14:00; Thursday is a holiday (no classes)
    schedule: [{ id: 'class', label: 'Class', note: '', kind: 'meeting', start: 780, end: 840, days: [0, 3], since: days[0] }],
    exceptions: [{ id: 'holiday', from: days[3], to: days[3], label: 'Holiday', applies: 'all' }],
    // Wednesday: the writing template (90 minutes of deep work, a 60-minute lunch)
    templates: [{ id: 'writing', name: 'Writing', days: [2], blocks: [
      { start: 570, end: 660, label: 'Write', note: '', kind: 'deep' }, { start: 720, end: 780, label: 'Lunch', note: '', kind: 'personal' }] }],
  });
  await set('en');
  // Friday: 3 hours of deep work planned, a task of 45 minutes and one with no estimate
  const base = (await api.get('day:' + days[4])).value;
  await api.put('day:' + days[4], { notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} }, columns: [{ from: null, closedAt: null, blocks: [{ id: 'f1', start: 540, end: 720, label: 'Chapter', note: '', kind: 'deep' }] }],
    tasks: [{ id: 't1', text: 'Taxes', done: false, estimate: 45 }, { id: 't2', text: 'Post office', done: false }] });
  await api.put(`week:${week}`, { items: [{ id: 'r', text: 'Write report', done: false }, { id: 'g', text: 'Big thing', done: false, estimate: 240 }], notes: '' });

  const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', timezoneId: TZ, reducedMotion: 'reduce' });
  await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
  const p = await c.newPage();
  p.on('pageerror', (e) => console.log('page error:', e.message));

  const openSpread = async () => {
    await p.goto(`${s.url}/plan/${week}`);
    for (let i = 0; i < 3; i++) await p.locator('.btn.primary.big').click();
    await p.locator('[data-testid="week-capacity"] [data-date]').first().waitFor();
  };
  const left = (i) => p.locator(`[data-testid="week-capacity"] [data-date="${days[i]}"] [data-cap="left"]`);
  const minutes = async (i) => Number(await left(i).getAttribute('data-minutes'));
  // wait for the calendar (Tuesday's events) to arrive
  const settled = () => p.waitForFunction((n) => document.querySelector(`[data-testid="week-capacity"] [data-date="${n}"] [data-cap="left"]`)?.getAttribute('data-minutes') === '390', days[1]);

  await openSpread();
  await settled();
  const expected = [420, 390, 330, 480, 255, 480, 480]; // Mon class, Tue 90 of events once, Wed template, Thu no class, Fri deep + 45, empty weekend
  for (let i = 0; i < 7; i++) check(await minutes(i) === expected[i], `day ${i} has ${expected[i]} minutes left`);
  check((await left(1).innerText()) === '6 h 30 m free', 'text: 6 h 30 m free');
  check((await left(3).innerText()) === '8 h free', 'a day with a schedule exception has no class');
  const week0 = await p.locator('[data-cap="week"]').innerText();
  check(/4 h 30 m deep work planned/.test(week0), 'the week line adds the deep work planned: ' + week0);
  check(/1 task has no duration/.test(week0), 'the week line counts tasks with no estimate');
  check((await p.locator(`[data-date="${days[4]}"] [data-cap="unestimated"]`).innerText()) === '1 task has no duration', 'Friday: 1 task has no duration');
  check(await p.locator(`[data-date="${days[0]}"] [data-cap="unestimated"]`).count() === 0, 'Monday has none to count');

  // putting an item on a day updates the preview at once
  const chips = (item) => p.getByRole('group', { name: `Days for ${item}` });
  await chips('Big thing').getByRole('button', { name: /^Thu/ }).click();
  check(await minutes(3) === 240, 'Big thing (4 h) on Thursday leaves 240 minutes');
  await chips('Write report').getByRole('button', { name: /^Thu/ }).click();
  check((await p.locator(`[data-date="${days[3]}"] [data-cap="unestimated"]`).innerText()) === '1 task has no duration', 'an item with no estimate is counted apart');
  check(await minutes(3) === 240, 'and takes no time from the day');
  await p.getByLabel('How long “Write report” takes').selectOption('60');
  check(await minutes(3) === 180, 'giving it an hour updates Thursday at once');
  check(await p.locator(`[data-date="${days[3]}"] [data-cap="unestimated"]`).count() === 0, 'no tasks without duration left on Thursday');
  await chips('Write report').getByRole('button', { name: /^Thu/ }).click();
  check(await minutes(3) === 240, 'taking it off Thursday gives the hour back');

  // a day that is full: Friday had 255 minutes; 240 + 60 leaves -45
  await chips('Big thing').getByRole('button', { name: /^Fri/ }).click();
  await chips('Write report').getByRole('button', { name: /^Fri/ }).click();
  check(await minutes(4) === -45, 'Friday goes to -45 minutes');
  check((await left(4).innerText()) === '−45 m', 'text: −45 m');
  check(await p.locator(`[data-date="${days[4]}"].over`).count() === 1, 'Friday is marked as over');
  check(await p.locator(`[data-date="${days[2]}"].over`).count() === 0, 'Wednesday is not');

  // saving carries the estimate to the day's task
  await p.locator('.btn.primary.big').click();
  await p.waitForURL(`**/week/${week}`);
  let fri; for (let i = 0; i < 40; i++) { fri = (await api.get('day:' + days[4])).value; if (fri.tasks.some((t) => t.text === 'Write report')) break; await new Promise((r) => setTimeout(r, 250)); } // saving is debounced
  check(fri.tasks.some((t) => t.text === 'Write report' && t.estimate === 60), 'the day task has the estimate');

  // the same numbers come back after saving (Friday's tasks are in the document now, not only in the plan)
  await openSpread();
  await p.waitForFunction((n) => document.querySelector(`[data-testid="week-capacity"] [data-date="${n}"] [data-cap="left"]`)?.getAttribute('data-minutes') === '390', days[1]);
  check(await minutes(4) === -45, 'after saving, Friday still adds up (no task counted twice)');

  // screenshots: both languages, both widths, both themes (the over-full Friday is in them)
  for (const lang of ['en', 'tr']) {
    await set(lang);
    await openSpread();
    await p.waitForFunction((n) => document.querySelector(`[data-testid="week-capacity"] [data-date="${n}"] [data-cap="left"]`)?.getAttribute('data-minutes') === '390', days[1]);
    if (lang === 'tr') {
      check((await left(1).innerText()) === '6 sa 30 dk boş', 'Turkish: 6 sa 30 dk boş');
      check(/dk$/.test(await left(4).innerText()) && (await left(4).innerText()).startsWith('−'), 'Turkish: over-full day starts with −');
    }
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang} ${theme} ${width} does not overflow`);
        await p.locator('.plan-week').screenshot({ path: `${shots}/${lang}-${width}-${theme}.png` });
      }
    }
    await p.setViewportSize({ width: 1440, height: 1000 });
  }
  console.log('PASS week-capacity: counts per day, union of overlaps, exception day, estimates, live update, full day, responsive');
} finally { await b.close(); await s.stop(); feed.close(); }
