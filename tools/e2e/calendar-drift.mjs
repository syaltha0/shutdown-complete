import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';

// A block made from a calendar event follows the event: when the calendar changes the event's time or day, or drops it,
// the block says so and offers to follow or to stay. Nothing is ever written to the calendar.
const shotsAt = 'reports/shots/calendar-drift';
mkdirSync(shotsAt, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const shot = (page, name) => page.screenshot({ path: `${shotsAt}/${name}.png` });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const TZ = 'Europe/Istanbul';
const dayOf = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));
const D = dayOf(0), TOMORROW = dayOf(1);
const ymd = (iso) => iso.replace(/-/g, '');

// ---------- a feed whose events the test changes ----------
const ev = ({ uid, title, date, from, to }) => ['BEGIN:VEVENT', ...(uid ? [`UID:${uid}`] : []), `SUMMARY:${title}`, `DTSTART;TZID=${TZ}:${ymd(date)}T${from}00`, `DTEND;TZID=${TZ}:${ymd(date)}T${to}00`, 'END:VEVENT'];
const calendar = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap(ev), 'END:VCALENDAR'].join('\r\n');
const V1 = [
  { title: 'Standup', date: D, from: '0900', to: '0930' }, // no UID: its time is all there is to tell it by
  { uid: 'lunch@test', title: 'Lunch with Ece', date: D, from: '1200', to: '1230' },
  { uid: 'moveme@test', title: 'Workshop', date: D, from: '1400', to: '1430' },
  { uid: 'review@test', title: 'Design review', date: D, from: '1600', to: '1630' },
  { uid: 'offsite@test', title: 'Offsite', date: D, from: '1800', to: '1900' },
  { uid: 'cancel@test', title: 'Dinner', date: D, from: '2000', to: '2030' },
];
const V2 = [
  { title: 'Standup', date: D, from: '0930', to: '1000' }, // moved, but without a UID of its own: nothing to say
  { uid: 'lunch@test', title: 'Lunch with Ece', date: D, from: '1230', to: '1300' },
  { uid: 'moveme@test', title: 'Workshop', date: TOMORROW, from: '1000', to: '1030' },
  { uid: 'review@test', title: 'Design review', date: D, from: '1700', to: '1730' },
];
let ics = calendar(V1);
const feed = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(ics); }).listen(0, '127.0.0.1');
await new Promise((ok) => feed.once('listening', ok));
const base = `http://127.0.0.1:${feed.address().port}/work.ics`;

const srv = await startServer({ env: { CALENDAR_ALLOW_PRIVATE: 'on' } });
const api = await demoAccount(client(srv.url), { lang: 'en' });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', timezoneId: TZ, reducedMotion: 'reduce' });
await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
const doc = async (key) => (await api.get(key)).value;
// the server keeps a feed for ten minutes per address: each version of the calendar gets an address of its own
const setFeed = async (url, extra = {}) => api.put('settings', { ...(await doc('settings')), calendars: [{ id: 'work', name: 'Work', url }], startHour: 7, endHour: 22, ...extra });
const blockOf = async (date, title) => (await doc('day:' + date))?.columns.at(-1).blocks.find((b) => b.label === title);
const grid = (title) => page.locator('.col.active .block', { hasText: title });
const drifted = page.locator('.col.active .block.drifted');
const dialog = page.locator('dialog.sheet[open]');
const open = async (title) => { await grid(title).first().click(); await dialog.waitFor(); };
const close = async () => { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); };
const act = async (name) => { await dialog.getByRole('button', { name, exact: true }).click(); await wait(900); };

try {
  await setFeed(base + '?v=1');
  const initial = await doc('day:' + D);
  await api.put('day:' + D, { ...initial, columns: [{ from: 360, closedAt: null, blocks: [] }] });
  await page.goto(srv.url + '/day/' + D);
  await page.locator('.cal-event', { hasText: 'Design review' }).waitFor();
  await page.getByRole('button', { name: /Add calendar events/ }).click(); await wait(1000);
  const made = (await doc('day:' + D)).columns[0].blocks;
  check('every event became a block', made.length === 6, `blocks: ${made.length}`);
  const review = made.find((b) => b.label === 'Design review');
  check('a block remembers the event time it was made at', review?.source?.start === 960 && review.source.end === 990, JSON.stringify(review?.source));
  await page.reload(); await grid('Design review').waitFor(); await wait(800);
  check('nothing is marked while the calendar is as it was', (await drifted.count()) === 0 && (await page.locator('.week-nudge', { hasText: 'in your calendar' }).count()) === 0);

  // a calendar that does not answer says nothing
  await setFeed('http://127.0.0.1:1/none.ics');
  await page.reload(); await grid('Design review').waitFor(); await wait(1200);
  check('a calendar that cannot be read leaves the blocks alone', (await drifted.count()) === 0);

  // ---------- the calendar changes ----------
  ics = calendar(V2);
  await setFeed(base + '?v=2');
  await page.reload(); await grid('Design review').waitFor();
  await drifted.first().waitFor();
  const titles = await drifted.locator('.bl').allTextContents();
  check('the changed blocks are marked', titles.length === 5 && ['Lunch with Ece', 'Workshop', 'Design review', 'Offsite', 'Dinner'].every((t) => titles.includes(t)), titles.join(', '));
  check('an event without a UID stays quiet', (await grid('Standup').count()) === 1 && (await page.locator('.col.active .block.drifted', { hasText: 'Standup' }).count()) === 0);
  check('the mark says what happened', (await page.locator('.col.active .block.drifted', { hasText: 'Design review' }).innerText()).includes('Changed in calendar'));
  check('one line sums up the changes above the day', await page.locator('.week-nudge', { hasText: '5 changes in your calendar' }).isVisible());
  check('the plan is not touched until asked', (await blockOf(D, 'Design review')).start === 960);

  // looks: the day with its marks, and a block's note, in both widths, languages and themes
  for (const width of [1440, 390]) for (const lang of ['en', 'tr']) for (const theme of ['light', 'dark']) {
    await setFeed(base + '?v=2', { lang });
    await page.setViewportSize({ width, height: 1000 }); await page.reload(); await drifted.first().waitFor();
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await shot(page, `${width}-${lang}-${theme}-day`);
    await grid('Design review').first().click(); await dialog.waitFor(); await shot(page, `${width}-${lang}-${theme}-note`); await close();
  }
  await setFeed(base + '?v=2', { lang: 'en' });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload(); await drifted.first().waitFor();

  // the summary opens the first block to look at (the lunch, earliest of the changed ones)
  await page.locator('.week-nudge').getByRole('button', { name: 'Review', exact: true }).click(); await dialog.waitFor();
  check('Review opens the first changed block', (await dialog.locator('.drift-note').innerText()).includes('Lunch with Ece: 12:00–12:30 → 12:30–13:00'));
  await act('Keep current plan');
  check('Keep current plan leaves the time and clears the mark', (await blockOf(D, 'Lunch with Ece')).start === 720 && (await blockOf(D, 'Lunch with Ece')).source.start === 750);
  await close();
  check('the kept block is no longer marked', (await page.locator('.col.active .block.drifted', { hasText: 'Lunch' }).count()) === 0 && await page.locator('.week-nudge', { hasText: '4 changes in your calendar' }).isVisible());

  // a time that changed
  await open('Design review');
  check('the note gives the old and the new time', (await dialog.locator('.drift-note').innerText()).includes('Design review: 16:00–16:30 → 17:00–17:30'));
  await act('Update plan');
  const r = await blockOf(D, 'Design review');
  check('Update plan moves the block', r.start === 1020 && r.end === 1050 && r.source.start === 1020);
  await close();
  check('the updated block is no longer marked', (await drifted.count()) === 3);

  // an event that went to another day
  await open('Workshop');
  check('the note names the new day', /Workshop: 14:00–14:30 → .*10:00–10:30/.test(await dialog.locator('.drift-note').innerText()));
  await act('Update plan'); await wait(600);
  check('the block follows the event to its day', !(await blockOf(D, 'Workshop')) && (await blockOf(TOMORROW, 'Workshop'))?.start === 600);
  check('and keeps its link to the event there', (await blockOf(TOMORROW, 'Workshop'))?.source?.date === TOMORROW);
  await page.waitForSelector('dialog.sheet[open]', { state: 'detached', timeout: 1500 }).catch(() => {});

  // events that are gone
  await open('Offsite');
  check('a dropped event says it is gone', (await dialog.locator('.drift-note').innerText()).includes('Offsite: No longer in the calendar'));
  await act('Remove block'); await wait(300);
  check('Remove block takes it off the plan', !(await blockOf(D, 'Offsite')));
  await open('Dinner');
  await act('Keep');
  check('Keep leaves the block as an ordinary one', !!(await blockOf(D, 'Dinner')) && !(await blockOf(D, 'Dinner')).source);
  await close();
  check('nothing is marked once all are settled', (await drifted.count()) === 0 && (await page.locator('.week-nudge', { hasText: 'in your calendar' }).count()) === 0);
  check('Standup kept its place', (await blockOf(D, 'Standup')).start === 540);

  // a later change flags it again, and "Keep" only accepted the earlier one
  ics = calendar([...V2.slice(0, 1), { uid: 'lunch@test', title: 'Lunch with Ece', date: D, from: '1300', to: '1330' }, ...V2.slice(3)]);
  await setFeed(base + '?v=3');
  await page.reload(); await drifted.first().waitFor();
  check('a further change marks the block again', (await drifted.count()) === 1 && (await drifted.locator('.bl').innerText()).includes('Lunch with Ece'));

  console.log(results.filter(Boolean).length + ' passed, ' + results.filter((x) => !x).length + ' failed');
  if (results.some((x) => !x)) process.exitCode = 1;
} finally { await browser.close(); srv.stop(); feed.close(); }
