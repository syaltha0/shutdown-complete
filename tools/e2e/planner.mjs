// End-to-end checks of planning tools: linked calendars, keyboard shortcuts, undo, and the weekly planning steps,
// in a real browser against a throwaway server (and a tiny calendar feed served on this machine).
//   npm run build && node tools/e2e/planner.mjs [--shots <dir>]
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';
import { feedProblem } from '../../server/src/calendar.mjs';

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const shot = async (page, name) => { if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png` }); };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const TZ = 'Europe/Istanbul';

// ---------- the feed address guard, on its own ----------
check('a feed on this machine is refused', (await feedProblem('http://127.0.0.1:8080/cal.ics')) === 'private' && (await feedProblem('http://localhost/cal.ics')) === 'private');
check('a feed on a private network is refused', (await feedProblem('http://10.0.0.5/cal.ics')) === 'private' && (await feedProblem('http://192.168.1.2/cal.ics')) === 'private');
check('only web addresses are feeds', (await feedProblem('ftp://example.org/cal.ics')) === 'url' && (await feedProblem('not a url')) === 'url');

// ---------- a calendar for today, in Istanbul time ----------
const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:review@test', 'SUMMARY:Design review', `DTSTART;TZID=${TZ}:${day}T160000`, `DTEND;TZID=${TZ}:${day}T163000`, 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:lunch@test', 'SUMMARY:Lunch with Ece', `DTSTART;TZID=${TZ}:${day}T120000`, `DTEND;TZID=${TZ}:${day}T123000`, 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:conf@test', 'SUMMARY:Conference week', `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${String(Number(day) + 1)}`, 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
const feed = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(ics); }).listen(0, '127.0.0.1');
await new Promise((ok) => feed.once('listening', ok));
const feedUrl = `http://127.0.0.1:${feed.address().port}/work.ics`;

const srv = await startServer({ env: { CALENDAR_ALLOW_PRIVATE: 'on' } });
const api = await demoAccount(client(srv.url), { lang: 'en' });
const D = iso(new Date());
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: TZ, reducedMotion: 'reduce' });
await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
const doc = async (key) => (await api.get(key)).value;
const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.className || '');

try {
  // ---------- linking a calendar ----------
  await page.goto(`${srv.url}/settings`);
  await page.locator('#cal-name').fill('Work');
  await page.locator('#cal-url').fill(feedUrl);
  await page.getByRole('button', { name: 'Add calendar' }).click();
  await page.getByText('Linked.').waitFor({ timeout: 8000 });
  await wait(1200);
  check('a calendar is checked and linked from Settings', (await doc('settings')).calendars?.[0]?.name === 'Work');
  await page.locator('#cal-url').fill('ftp://nowhere/cal.ics');
  await page.getByRole('button', { name: 'Add calendar' }).click();
  check('a wrong address is explained', await page.getByText('not a calendar address').waitFor({ timeout: 5000 }).then(() => true, () => false));

  // ---------- the day shows it ----------
  await page.goto(`${srv.url}/day/${D}`);
  const review = page.locator('.cal-event', { hasText: 'Design review' });
  await review.waitFor({ timeout: 8000 });
  check('a calendar event shows on the day, in local time', /16:00.*16:30/.test(await review.textContent()));
  check('an all-day event shows above the grid', await page.locator('.all-day', { hasText: 'Conference week' }).isVisible());
  check('only an event with nothing planned over it is offered to block out', await page.getByRole('button', { name: /Add calendar events/ }).isVisible());
  await shot(page, 'day-calendar');
  await review.click();
  await page.getByRole('button', { name: 'Make block and edit', exact: true }).click();
  await page.locator('dialog.sheet[open] #be-label').waitFor();
  check('clicking an event makes it a meeting block', (await page.locator('#be-label').inputValue()) === 'Design review');
  await page.keyboard.press('Escape');
  await wait(1200);
  const made = (await doc(`day:${D}`)).columns.at(-1).blocks.find((b) => b.label === 'Design review');
  check('the block keeps the event\'s time and is a meeting', made && made.start === 960 && made.end === 990 && made.kind === 'shallow', JSON.stringify(made));
  check('a blocked-out event is no longer offered', await review.getByText('Planned', { exact: false }).count() > 0);

  // ---------- undo ----------
  await page.locator('.col.active .block', { hasText: 'Design review' }).click();
  await page.locator('dialog.sheet[open]').getByRole('button', { name: /Delete/ }).click();
  await page.locator('.undo-note').waitFor({ timeout: 3000 });
  check('a deleted block offers an undo', (await page.locator('.undo-note').textContent()).includes('Design review'));
  await shot(page, 'undo');
  await page.keyboard.press('Control+z');
  await wait(1200);
  check('Ctrl+Z puts the block back', (await doc(`day:${D}`)).columns.at(-1).blocks.some((b) => b.label === 'Design review') && !(await page.locator('.undo-note').count()));
  const firstTask = (await doc(`day:${D}`)).tasks[0];
  await page.getByRole('button', { name: `Remove ${firstTask.text}` }).click();
  await page.locator('.undo-note').getByRole('button', { name: 'Undo' }).click();
  await wait(1200);
  check('a removed task comes back in its place', (await doc(`day:${D}`)).tasks[0]?.text === firstTask.text);

  // ---------- shortcuts ----------
  await page.locator('h1').click();
  await page.keyboard.press('n');
  check('N makes a new block on the day', await page.locator('dialog.sheet[open] #be-label').waitFor({ timeout: 3000 }).then(() => true, () => false));
  await page.locator('dialog.sheet[open]').getByRole('button', { name: /Delete/ }).click();
  await page.locator('h1').click();
  await page.keyboard.press('?');
  check('? lists the shortcuts', await page.locator('dialog.keys-sheet[open]').isVisible());
  await shot(page, 'keys');
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await page.waitForURL(`**/week/${weekOf(D)}`);
  check('W opens this week', true);
  await page.locator('.daylist').waitFor({ timeout: 8000 });
  await page.keyboard.press('ArrowLeft');
  await page.waitForURL('**/week/**');
  await wait(300);
  check('← steps back a week', page.url().endsWith(weekOf(iso(new Date(Date.now() - 7 * 86400000)))));
  await page.keyboard.press('t');
  await page.waitForURL(`**/day/${D}`);
  check('T comes back to today', true);
  await page.locator('h1').click();
  await page.locator('.notes-area').focus();
  await page.keyboard.type('nwt');
  check('letters typed into a field are only text', page.url().endsWith(`/day/${D}`) && !(await page.locator('dialog.sheet[open]').count()));

  // ---------- planning the week ----------
  const week = weekOf(D), prevWeek = weekOf(iso(new Date(Date.now() - 7 * 86400000)));
  await api.put(`week:${prevWeek}`, { items: [{ id: 'a', text: 'Send the grant report', done: true }, { id: 'b', text: 'Finish chapter 4', done: false }], notes: '' });
  await api.put(`week:${week}`, { items: [], notes: '' });
  await page.goto(`${srv.url}/week/${week}`);
  await page.getByRole('link', { name: 'Plan the week' }).click();
  await page.waitForURL(`**/plan/${week}`);
  await page.getByText('Finish chapter 4').waitFor();
  check('step one shows last week and offers to carry what was left', await page.getByRole('checkbox', { name: 'Finish chapter 4' }).isChecked() && (await page.locator('.pw-stats').textContent()).includes('1/2'));
  await shot(page, 'plan-1');
  await page.getByRole('button', { name: 'Next' }).click();
  check('step two shows the season and the week\'s meetings', await page.locator('.pw-cal').isVisible() && /2 events/.test(await page.locator('.pw-cal').textContent()));
  await shot(page, 'plan-2');
  await page.getByRole('button', { name: 'Next' }).click();
  check('the plan starts with what was carried over', await page.locator('.checklist textarea').first().inputValue() === 'Finish chapter 4');
  await page.getByRole('textbox', { name: 'Add to this week’s plan' }).fill('Run the pilot analysis');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('group', { name: 'Days for Finish chapter 4' }).getByRole('button').nth(2).click();
  await shot(page, 'plan-4');
  await page.getByRole('button', { name: 'Save the plan' }).click();
  await page.waitForURL(`**/week/${week}`);
  await wait(1200);
  const saved = await doc(`week:${week}`);
  check('the plan is saved with the week', saved.items.map((i) => i.text).join('|') === 'Finish chapter 4|Run the pilot analysis' && !!saved.plannedAt, saved.items.map((i) => i.text).join('|'));
  const wed = iso(new Date(new Date(`${D}T12:00:00`).getTime() - ((new Date(`${D}T12:00:00`).getDay() + 6) % 7) * 86400000 + 2 * 86400000));
  check('an item put on a day lands on its task list', (await doc(`day:${wed}`))?.tasks.some((t) => t.text === 'Finish chapter 4'), wed);
  check('a planned week offers to plan again', await page.getByRole('link', { name: 'Plan again' }).isVisible());

  // ---------- the whole day ----------
  await page.goto(`${srv.url}/settings`);
  await page.getByRole('button', { name: 'Whole day' }).click();
  await wait(900);
  check('Settings can switch the grid to the whole day', (await doc('settings')).wholeDay === true);
  await page.goto(`${srv.url}/day/${D}`);
  await page.locator('.time-grid, .grid-wrap').first().waitFor();
  const labels = await page.locator('.hours span').allTextContents();
  check('a whole day runs from 00:00 to 24:00', labels[0] === '00:00' && labels.at(-1) === '24:00', `${labels[0]} … ${labels.at(-1)}`);
  // the grid centres the current time again once the page settles (notes and data arrive a moment later)
  let seen = false;
  for (let i = 0; i < 20 && !seen; i++) { seen = await page.evaluate(() => { const n = document.querySelector('.now-line')?.getBoundingClientRect(); return !!n && n.top >= 0 && n.bottom <= innerHeight; }); if (!seen) await wait(100); }
  check('a whole day opens with the current time in view', seen);
  await page.goto(`${srv.url}/settings`);
  await page.getByRole('button', { name: 'Set hours' }).click();
  await wait(900);
  check('and back to the chosen hours', (await doc('settings')).wholeDay === false);

  // ---------- weekly schedule, subjects, carried tasks, reminders ----------
  {
    const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
    const wd = (new Date(`${D}T12:00:00`).getDay() + 6) % 7;
    await page.goto(`${srv.url}/day/${D}`);
    await page.locator('.grid-wrap').waitFor();
    await page.keyboard.press('n');
    await page.locator('dialog.sheet[open] #be-label').waitFor();
    await page.locator('#be-label').fill('Linear algebra');
    await page.locator('#be-subject').fill('Maths');
    await page.locator('dialog.sheet[open] .day-chips button').nth(wd).click();
    await wait(400);
    await page.getByRole('button', { name: 'Done' }).click();
    await wait(1200);
    const sched = (await doc('settings')).schedule ?? [];
    check('a block can repeat every week', sched.length === 1 && sched[0].days.includes(wd) && sched[0].subject === 'Maths', JSON.stringify(sched));
    check('the subject is remembered for the next block', ((await doc('settings')).subjects ?? []).includes('Maths'));
    await page.goto(`${srv.url}/day/${addD(D, 7)}`);
    await page.locator('.block', { hasText: 'Linear algebra' }).waitFor({ timeout: 5000 }).catch(() => {});
    await wait(1500); // the placed block is saved a moment later
    const next = (await doc(`day:${addD(D, 7)}`))?.columns?.at(-1)?.blocks ?? [];
    check('the same weekday a week later gets the block', next.some((b) => b.label === 'Linear algebra' && b.repeatId === sched[0]?.id));
    check('the block shows its subject and the repeat mark', await page.locator('.block', { hasText: 'Linear algebra' }).locator('.rep').count() === 1
      && (await page.locator('.block', { hasText: 'Linear algebra' }).locator('.subj').textContent()).includes('Maths'));

    await page.goto(`${srv.url}/metrics`);
    await page.getByRole('heading', { name: 'Time by subject' }).waitFor({ timeout: 5000 });
    check('the metrics show the time by subject', await page.locator('.subj-table th', { hasText: 'Maths' }).isVisible());

    const y = addD(D, -1);
    const yd = (await api.get(`day:${y}`)).value ?? { columns: [{ from: null, closedAt: null, blocks: [] }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } };
    await api.put(`day:${y}`, { ...yd, tasks: [...yd.tasks.filter((x) => x.done), { id: 'carry1', text: 'Return the library book', done: false }] });
    await page.goto(`${srv.url}/day/${D}`);
    const offer = page.getByRole('button', { name: 'Bring to today' });
    check('open tasks of yesterday are offered on today', await offer.waitFor({ timeout: 6000 }).then(() => true, () => false));
    await offer.click();
    await wait(1200);
    const moved = (await doc(`day:${D}`)).tasks.find((x) => x.text === 'Return the library book');
    check('they move to today and keep the day they were written', moved?.since === y && !(await doc(`day:${y}`)).tasks.some((x) => !x.done && x.text === 'Return the library book'));
    check('a carried task shows how long it has waited', await page.locator('.item-age', { hasText: '1 day' }).isVisible());

    await page.goto(`${srv.url}/settings`);
    await page.getByRole('button', { name: 'At the start' }).click();
    await wait(900);
    check('reminders can be turned on', (await doc('settings')).reminders?.before === 0);
  }

  // ---------- phone: swipe between days, long press to move a block ----------
  {
    const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-GB', timezoneId: TZ, reducedMotion: 'reduce' });
    await phone.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
    const pp = await phone.newPage();
    const cdp = await phone.newCDPSession(pp);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await pp.goto(`${srv.url}/day/${D}`);
    await pp.locator('.grid-wrap').waitFor();
    await touch('touchStart', 320, 300);
    for (let k = 1; k <= 6; k++) await touch('touchMove', 320 - k * 40, 302);
    await touch('touchEnd', 80, 302);
    await pp.waitForURL(`**/day/${addD(D, 1)}`, { timeout: 4000 }).catch(() => {});
    check('on a phone a swipe to the left opens the next day', pp.url().endsWith(`/day/${addD(D, 1)}`), pp.url());
    await touch('touchStart', 60, 300);
    for (let k = 1; k <= 6; k++) await touch('touchMove', 60 + k * 40, 302);
    await touch('touchEnd', 300, 302);
    await pp.waitForURL(`**/day/${D}`, { timeout: 4000 }).catch(() => {});
    check('and a swipe to the right goes back', pp.url().endsWith(`/day/${D}`), pp.url());

    // a block of its own, at 09:00, then held and moved an hour down
    const dd = (await api.get(`day:${D}`)).value;
    const last = dd.columns.length - 1;
    const from = dd.columns[last].from ?? 0;
    const at = Math.max(from, 9 * 60);
    dd.columns[last].blocks = dd.columns[last].blocks.filter((b) => b.end <= at || b.start >= at + 150);
    dd.columns[last].blocks.push({ id: 'lp1', start: at, end: at + 30, label: 'Hold me', note: '', kind: 'shallow' });
    await api.put(`day:${D}`, dd);
    await pp.reload();
    const blk = pp.locator('.block', { hasText: 'Hold me' });
    await blk.scrollIntoViewIfNeeded();
    const bb = await blk.boundingBox();
    const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
    await touch('touchStart', x, y);
    await wait(600);
    for (let k = 1; k <= 8; k++) await touch('touchMove', x, y + k * 9);
    await touch('touchEnd', x, y + 72);
    await wait(1200);
    const moved = (await doc(`day:${D}`)).columns.at(-1).blocks.find((b) => b.id === 'lp1');
    check('a long press moves a block with the finger', moved?.start === at + 60, JSON.stringify(moved));
    check('and the move does not open the block or turn the page', !(await pp.locator('dialog.sheet[open]').count()) && pp.url().endsWith(`/day/${D}`));
    await phone.close();
  }

  // ---------- focus room, the day's card, plan and reality, exam planner ----------
  {
    const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
    await page.goto(`${srv.url}/focus`);
    await page.getByRole('button', { name: 'Focus room' }).first().click();
    await page.locator('.focus-room').waitFor({ timeout: 4000 });
    await page.locator('.sound-pick button', { hasText: 'Rain' }).click();
    check('the focus room opens and a sound can be chosen', (await page.locator('.sound-pick button', { hasText: 'Rain' }).getAttribute('aria-pressed')) === 'true');
    await page.keyboard.press('Escape');
    check('Esc leaves the room', await page.locator('.focus-room').waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));

    const td = (await api.get(`day:${D}`)).value;
    await api.put(`day:${D}`, { ...td, shutdown: { ...td.shutdown, done: true, at: new Date().toISOString() } });
    await page.goto(`${srv.url}/shutdown/${D}`);
    const img = page.locator('.day-card img');
    await img.waitFor({ timeout: 8000 });
    check('a closed day gets its card as a picture', (await img.evaluate((el) => el.naturalWidth)) === 1080 && await page.getByRole('link', { name: 'Save the picture' }).isVisible());

    await page.goto(`${srv.url}/metrics`);
    check('the metrics show how plans held up', await page.getByRole('heading', { name: 'Plan and reality' }).waitFor({ timeout: 5000 }).then(() => true, () => false));

    await page.goto(`${srv.url}/month/${D.slice(0, 7)}`);
    await page.getByRole('button', { name: 'Plan an exam' }).click();
    await page.locator('#ex-name').fill('Physics final');
    await page.locator('#ex-date').fill(addD(D, 5));
    await page.locator('#ex-topics').fill('Kinematics\nForces\nEnergy');
    await page.locator('#ex-from').selectOption(String(18 * 60));
    await page.locator('#ex-to').selectOption(String(23 * 60));
    await page.locator('.exam-list li').first().waitFor({ timeout: 6000 });
    check('the exam planner shows the sittings before saving', (await page.locator('.exam-list li').count()) >= 3);
    await page.getByRole('button', { name: 'Put it on the days' }).click();
    await page.getByText(/sittings? planned/).waitFor({ timeout: 8000 });
    await wait(1500);
    const exams = (await doc('settings')).exams ?? [];
    let sittings = 0;
    for (let k = 1; k < 5; k++) sittings += ((await api.get(`day:${addD(D, k)}`)).value?.columns.at(-1).blocks ?? []).filter((b) => b.examId === exams[0]?.id).length;
    check('the sittings are on the days before the exam', exams.length === 1 && sittings >= 3, `${exams.length} exam, ${sittings} sittings`);
    await page.getByRole('button', { name: 'Done' }).click();
    check('the month lists the exam with its countdown', await page.locator('.exam-row', { hasText: 'Physics final' }).getByText('in 5 days').isVisible());
  }

  // ---------- focusing together ----------
  {
    const ece = client(srv.url);
    const form = (await ece.call('/api/auth/state')).body.form;
    await wait(3100);
    await ece.call('/api/auth/register', { email: 'ece@hale.test', password: 'Kalem defter mavi!', lang: 'en', form, website: '' });
    await ece.put('settings', { setupDone: true, tourDone: true });
    check('a new account starts with its focus unshared', (await ece.call('/api/friends')).body.share.focus === false);
    await ece.call('/api/friends/share', { focus: true }, 'PUT'); // Ece turns it on (Focus -> friends)
    await ece.call('/api/friends', { email: 'robin@hale.test' });
    await page.goto(`${srv.url}/focus`);
    const openFriendOptions = async () => { const t = page.locator('.friends-opt'); await t.waitFor(); if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click(); await page.locator('#fr-options').waitFor(); };
    const acceptBtn = page.locator('.friends .invite-row', { hasText: 'ece@hale.test' }).getByRole('button', { name: 'Accept' });
    check('a friend request shows on the Focus screen', await acceptBtn.waitFor({ timeout: 6000 }).then(() => true, () => false));
    check('the options are folded by default, the request stays in view', (await page.locator('.friends-opt').getAttribute('aria-expanded')) === 'false' && !(await page.locator('#fr-options').count()));
    await acceptBtn.click();
    await openFriendOptions();
    await page.locator('.friend-list li', { hasText: 'ece' }).waitFor({ timeout: 6000 });
    await ece.call('/api/presence', { state: 'focus', label: 'Physics', endsAt: new Date(Date.now() + 20 * 60000).toISOString() }, 'PUT');
    await page.reload();
    await openFriendOptions();
    check('a friend\'s focus shows (without the block\'s name, unless shared)', await page.locator('.friend-list li.on', { hasText: 'focusing' }).waitFor({ timeout: 6000 }).then(() => true, () => false)
      && !(await page.locator('.friend-list li', { hasText: 'Physics' }).count()));
    await ece.call('/api/presence', {}, 'PUT');
    // a session together, started here; Ece joins it
    const td = (await api.get(`day:${D}`)).value;
    await api.put(`day:${D}`, { ...td, focus: { active: null, sessions: td.focus?.sessions ?? [] } });
    await page.reload();
    await openFriendOptions();
    await page.getByRole('button', { name: 'Start a session together' }).click();
    await page.locator('.friend-list .pick input').first().check();
    await page.getByRole('button', { name: 'Start together' }).click();
    await wait(1200);
    const mine = (await doc(`day:${D}`)).focus?.active;
    check('a session together starts the timer here', !!mine?.roomId);
    const invites = (await ece.call('/api/friends')).body.invites;
    check('the friend is invited to it', invites.length === 1 && invites[0].id === mine?.roomId);
    const joined = (await ece.call(`/api/rooms/${invites[0]?.id}/join`, {})).body;
    check('and joining gives the same start, so both end together', joined.startsAt === mine?.startedAt);
    await ece.call('/api/presence', { state: 'focus', label: '', endsAt: new Date(Date.parse(joined.startsAt) + joined.minutes * 60000).toISOString(), roomId: joined.id }, 'PUT');
    await page.reload();
    await openFriendOptions();
    check('the Focus screen shows who is in the session with you', await page.locator('.friend-list li', { hasText: 'with you' }).waitFor({ timeout: 6000 }).then(() => true, () => false));
    // an invitation reaches you on any screen
    await api.put(`day:${D}`, { ...(await api.get(`day:${D}`)).value, focus: { active: null, sessions: [] } });
    const robinId = (await ece.call('/api/friends')).body.friends[0].id;
    await ece.call('/api/rooms', { minutes: 25, invite: [robinId] });
    await page.goto(`${srv.url}/week/${weekOf(D)}`);
    const note = page.locator('.friend-note');
    check('an invitation shows as a note on other screens', await note.waitFor({ timeout: 35000 }).then(() => true, () => false));
    await note.getByRole('button', { name: 'Join' }).click();
    await page.waitForURL('**/focus', { timeout: 5000 }).catch(() => {});
    await wait(1200);
    check('joining from the note starts the shared timer', !!(await doc(`day:${D}`)).focus?.active?.roomId);
  }

  // ---------- the overview ----------
  {
    await page.goto(`${srv.url}/`);
    check('the overview opens at /', await page.getByRole('heading', { name: 'Overview', level: 1 }).waitFor({ timeout: 6000 }).then(() => true, () => false));
    check('it draws today\'s plan as a line through the hours', (await page.locator('.b-track i').count()) > 0);
    check('it shows the week day by day', (await page.locator('.b-calendar a').count()) === 14 && (await page.locator('.b-calendar .today').count()) === 1);
    await page.locator('#home-task').fill('Buy a notebook');
    await page.locator('#home-task').press('Enter');
    await wait(1200);
    check('a task can be written from the overview', (await doc(`day:${D}`)).tasks.some((x) => x.text === 'Buy a notebook'));
    check('coming up lists the exam with its countdown', await page.locator('.b-events a', { hasText: 'Physics final' }).isVisible());
    await page.getByRole('link', { name: 'Open today' }).first().click();
    check('and the day is one click away', await page.waitForURL(`**/day/${D}`, { timeout: 4000 }).then(() => true, () => false));
  }

  // ---------- estimates and the day's load, the inbox, pushing the rest later, every other week ----------
  {
    const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
    const F = addD(D, 3); // a future day: its free time does not depend on the clock
    await api.put(`day:${F}`, { columns: [{ from: null, closedAt: null, blocks: [
      { id: 'f1', start: 540, end: 720, label: 'Long block', note: '', kind: 'deep' },
      { id: 'f2', start: 780, end: 1020, label: 'Another one', note: '', kind: 'deep' }] }], tasks: [
      { id: 't1', text: 'Essay draft', done: false, estimate: 120 },
      { id: 't2', text: 'Read chapter', done: false }], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } });
    await page.goto(`${srv.url}/day/${F}`);
    await page.locator('.overload').waitFor({ timeout: 6000 });
    check('a day whose tasks need more than its free time says so', await page.locator('.overload.over').isVisible() && (await page.locator('.overload').textContent()).includes('too much'));
    await page.locator('.check-row', { hasText: 'Read chapter' }).locator('.est-select').selectOption('30');
    await wait(1200);
    check('a task gets an estimate from its row', (await doc(`day:${F}`)).tasks.find((x) => x.id === 't2')?.estimate === 30);

    // the task lists (they took over the inbox): one written down, one given a due date in its details
    await page.goto(`${srv.url}/inbox`);
    await page.locator('#tk-new').fill('Physics report');
    await page.locator('#tk-new').press('Enter');
    await page.locator('#tk-new').fill('Return the library book');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('.tk-row', { hasText: 'Physics report' }).locator('.tk-open').click();
    await page.locator('.tk-detail input[type=date]').nth(1).fill(addD(D, 1));
    await wait(1200);
    const box = (await api.get('inbox')).value;
    check('the task list keeps things with and without a due date', box.items.length === 2 && box.items.some((x) => x.due === addD(D, 1)));
    check('nothing due by today: the rail shows no count', !(await page.locator('.rail-item .count').count()));
    await page.locator('.tk-detail .tk-plan').getByRole('button', { name: 'Today' }).click();
    await wait(1200);
    check('a task goes onto today with its due date', (await doc(`day:${D}`)).tasks.some((x) => x.text === 'Physics report' && x.due === addD(D, 1)) && (await api.get('inbox')).value.items.length === 1);
    await page.goto(`${srv.url}/day/${D}`);
    check('a task shows when it is due', await page.locator('.check-row', { hasText: 'Physics report' }).locator('.due', { hasText: 'due tomorrow' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'Add from your tasks' }).click();
    await page.locator('dialog.sheet[open] .pick-list input').first().check();
    await page.getByRole('button', { name: 'Add 1 to today' }).click();
    await wait(1200);
    check('the day takes tasks from the lists', (await doc(`day:${D}`)).tasks.some((x) => x.text === 'Return the library book') && (await api.get('inbox')).value.items.length === 0);

    // push the rest later: a 30-minute interruption at 10:00 moves the morning, the appointment stays
    const G = addD(D, 4);
    await api.put(`day:${G}`, { columns: [{ from: null, closedAt: null, blocks: [
      { id: 'g1', start: 600, end: 660, label: 'Maths', note: '', kind: 'deep' },
      { id: 'g2', start: 660, end: 720, label: 'Physics', note: '', kind: 'deep' },
      { id: 'g3', start: 720, end: 750, label: 'Advisor', note: '', kind: 'meeting' },
      { id: 'g4', start: 1020, end: 1080, label: 'Late one', note: '', kind: 'deep' }] }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } });
    await page.goto(`${srv.url}/day/${G}`);
    await page.getByRole('button', { name: 'Revise from now' }).click();
    await page.locator('#rv-at').selectOption('630');
    await page.getByRole('button', { name: 'Push it later' }).click();
    check('the dialog says what pushing would do', (await page.locator('dialog.sheet[open]').textContent()).includes('move'));
    await page.locator('dialog.sheet[open]').getByRole('button', { name: /^Revise from/ }).click();
    await wait(1200);
    const gc = (await doc(`day:${G}`)).columns.at(-1).blocks;
    const at = (l) => gc.find((b) => b.label === l);
    check('pushing the rest later keeps each block\'s length and steps around the appointment',
      at('Maths')?.start === 630 && at('Maths')?.end === 690 && at('Advisor')?.start === 720 && at('Physics')?.start === 750 && at('Physics')?.end === 810,
      JSON.stringify(gc.map((b) => [b.label, b.start, b.end])));

    // a block every other week: on the week it was made and two weeks later, not in between
    const s0 = (await doc('settings'));
    const wd = (new Date(`${D}T12:00:00`).getDay() + 6) % 7;
    await api.put('settings', { ...s0, schedule: [...(s0.schedule ?? []), { id: 'ab', label: 'Lab', note: '', kind: 'meeting', start: 840, end: 900, days: [wd], since: D, every: 2 }] });
    for (const k of [7, 14]) { await page.goto(`${srv.url}/day/${addD(D, k)}`); await page.locator('.grid-wrap').waitFor(); await wait(1500); }
    const has = async (k) => ((await api.get(`day:${addD(D, k)}`)).value?.columns.at(-1).blocks ?? []).some((b) => b.repeatId === 'ab');
    check('a block every other week skips the week between', !(await has(7)) && await has(14));
  }

  // ---------- countdowns ----------
  {
    const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
    await page.goto(`${srv.url}/countdown`);
    await page.getByRole('button', { name: 'New countdown' }).click();
    await page.locator('dialog[open] #cd-name').fill('Maths exam');
    await page.locator('dialog[open] .day-chips button', { hasText: 'Exam' }).click();
    await page.locator('dialog[open] #cd-date').fill(addD(D, 33));
    await page.locator('dialog[open]').getByRole('button', { name: 'Add', exact: true }).click();
    await wait(1200);
    check('a countdown is added', ((await doc('settings')).countdowns ?? []).some((c) => c.name === 'Maths exam' && c.date === addD(D, 33)));
    check('it shows the days left', await page.locator('.cd-card', { hasText: 'Maths exam' }).locator('.cd-num b', { hasText: '33' }).isVisible());
    check('exams planned in Month count down too', await page.locator('.cd-card', { hasText: 'Physics final' }).isVisible());
    check('the nearest leads, with its days left as dots', await page.locator('.cd-lead', { hasText: 'Physics final' }).isVisible()
      && (await page.locator('.cd-lead .cd-dots i:not(.end)').count()) === 5);
    check('a countdown shows its kind', await page.locator('.cd-card', { hasText: 'Maths exam' }).locator('.cd-kind', { hasText: 'Exam' }).isVisible());
    await page.locator('.cd-card', { hasText: 'Maths exam' }).getByRole('button', { name: 'Prepare for it' }).click();
    // the exam planner is a lazily loaded screen: on a slow machine its fields are filled a moment after it opens
    const examFilled = async () => { for (let i = 0; i < 50; i++) { if (await page.locator('dialog[open] #ex-name').inputValue().catch(() => '') === 'Maths exam'
      && await page.locator('dialog[open] #ex-date').inputValue().catch(() => '') === addD(D, 33)) return true; await wait(100); } return false; };
    check('an exam without a plan opens the exam planner, filled in', await examFilled());
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
    // a birthday that passed this year rolls on to next year
    await page.getByRole('button', { name: 'New countdown' }).click();
    await page.locator('dialog[open] #cd-name').fill('Mum');
    await page.locator('dialog[open] .day-chips button', { hasText: 'Birthday' }).click();
    await page.locator('dialog[open] #cd-date').fill(addD(D, -10));
    check('a birthday comes back every year by default', await page.locator('dialog[open] .switch-row input').isChecked());
    await page.locator('dialog[open]').getByRole('button', { name: 'Add', exact: true }).click();
    await wait(1200);
    const back = Math.round((new Date(`${addD(D, -10).replace(/^\d{4}/, (y) => String(+y + 1))}T12:00:00`) - new Date(`${D}T12:00:00`)) / 86400000);
    check('a yearly date that passed counts to its next return', await page.locator('.cd-card', { hasText: 'Mum' }).locator('.cd-num b', { hasText: String(back) }).isVisible());
    await page.locator('.cd-card', { hasText: 'Maths exam' }).getByRole('button', { name: 'Change' }).click();
    await page.locator('dialog[open] #cd-name').fill('Maths final');
    await page.locator('dialog[open]').getByRole('button', { name: 'Save' }).click();
    await wait(1200);
    check('a countdown can be changed', ((await doc('settings')).countdowns ?? []).some((c) => c.name === 'Maths final' && c.kind === 'exam'));
  }

  // ---------- boards ----------
  {
    await page.goto(`${srv.url}/boards`);
    await page.locator('.kb-part').first().waitFor({ timeout: 6000 });
    check('the boards page has a personal part, a team part and the board templates, each with a tile to make one', (await page.locator('.kb-part').count()) === 3 && await page.locator('.kb-new', { hasText: 'Make a template' }).isVisible()
      && await page.locator('.kb-new', { hasText: 'Create project' }).isVisible() && await page.locator('.kb-new', { hasText: 'Create team project' }).isVisible()
      && await page.locator('.kb-filters input[type=search]').isVisible());
    await page.locator('.kb-new', { hasText: 'Create project' }).click();
    check('making a project asks for a title and a description', await page.locator('#kp-name').isVisible() && await page.locator('#kp-desc').isVisible());
    await page.locator('#kp-name').fill('Thesis work');
    await page.locator('#kp-desc').fill('Everything for the bachelor thesis');
    await page.locator('dialog[open]').getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL('**/project/**', { timeout: 5000 });
    await page.locator('.kb-template').first().waitFor({ timeout: 6000 });
    check('a new project offers its first board with list sets to pick', (await page.locator('.kb-template').count()) === 5 && await page.locator('.kb-proj h1', { hasText: 'Thesis work' }).isVisible());
    await page.getByRole('button', { name: 'Make the board' }).click();
    check('a board without a name is not made, and the form says why', await page.getByText('Give the board a name first.').isVisible() && page.url().split('/').length === 5);
    await page.locator('.kb-template', { hasText: 'A project' }).click();
    check('the sketch beside the form draws the lists picked', (await page.locator('.kb-sketch-list').count()) === 5 && await page.locator('.kb-sketch-list b', { hasText: 'In review' }).isVisible());
    await page.locator('#kb-new-name').fill('Thesis');
    check('and the name as it is typed', await page.locator('.kb-sketch-tab', { hasText: 'Thesis' }).isVisible());
    await page.locator('#kb-new-name').fill('');
    await page.locator('.kb-template', { hasText: 'A course' }).click();
    await page.locator('.kb-template', { hasText: 'Simple' }).click();
    await page.locator('#kb-new-name').fill('Thesis');
    await page.getByRole('button', { name: 'Make the board' }).click();
    await page.waitForURL('**/project/*/*', { timeout: 5000 });
    await page.locator('.kb-list').first().waitFor({ timeout: 5000 });
    check('a board starts with its lists', (await page.locator('.kb-list').count()) === 3);
    const first = page.locator('.kb-list').nth(0), second = page.locator('.kb-list').nth(1);
    check('the boards show as tabs above the board', await page.locator('.kb-tab[aria-current="page"]', { hasText: 'Thesis' }).isVisible());
    await first.locator('.kb-add-card').click();
    await first.locator('.kb-composer textarea').fill('Read ten papers');
    await first.locator('.kb-composer textarea').press('Enter');
    await first.locator('.kb-composer textarea').fill('Write the survey');
    await first.locator('.kb-composer textarea').press('Enter');
    await first.locator('.kb-composer textarea').press('Escape');
    await wait(800);
    check('cards are added from the foot of a list, one after another', (await first.locator('.kb-card').count()) === 2 && !(await first.locator('.kb-composer').count()));
    // a list added in the last column, then dragged by its header to the front
    await page.locator('.kb-add-list').click();
    await page.locator('.kb-add-list-form input').fill('Ideas');
    await page.locator('.kb-add-list-form input').press('Enter');
    await page.locator('.kb-add-list-form input').press('Escape');
    await wait(600);
    const ideas = await page.locator('.kb-list', { hasText: 'Ideas' }).locator('header').boundingBox();
    const front = await page.locator('.kb-list').nth(0).boundingBox();
    await page.mouse.move(ideas.x + 60, ideas.y + 12); await page.mouse.down();
    await page.mouse.move(ideas.x + 20, ideas.y + 16, { steps: 4 });
    await page.mouse.move(front.x + 30, front.y + 20, { steps: 12 });
    await page.mouse.up();
    await wait(1200);
    const thesis = async () => (await api.get('boards')).value.projects.find((x) => x.name === 'Thesis work');
    const lists0 = (await thesis())?.boards[0].lists.map((l) => l.name);
    check('a list is added and dragged to another place', lists0.length === 4 && lists0[0] === 'Ideas', JSON.stringify(lists0));
    await page.locator('.kb-list', { hasText: 'Ideas' }).locator('.kb-list-more').click();
    await page.locator('.kb-pop .kb-menu button', { hasText: 'Delete list' }).click();
    await wait(800);
    // drag the first card into the second list
    const a = await first.locator('.kb-card').first().boundingBox(), t = await second.boundingBox();
    await page.mouse.move(a.x + 20, a.y + 15); await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 30, { steps: 4 });
    await page.mouse.move(t.x + t.width / 2, t.y + 60, { steps: 8 });
    await page.mouse.up();
    await wait(1200);
    const b = (await thesis())?.boards.find((x) => x.name === 'Thesis');
    check('a card is dragged into another list', b?.lists[1].cards[0]?.title === 'Read ten papers' && b?.lists[0].cards.length === 1, JSON.stringify(b?.lists.map((l) => l.cards.map((c) => c.title))));
    check('the drag does not open the card', !(await page.locator('dialog.kb-sheet[open]').count()));
    // the pencil edits the title in place
    await first.locator('.kb-card-wrap').first().hover();
    await first.locator('.kb-card-edit').first().click();
    await first.locator('.kb-quick textarea').fill('Write the survey draft');
    await first.locator('.kb-quick textarea').press('Enter');
    await wait(800);
    check('a card\'s title is edited in place', await first.locator('.kb-card', { hasText: 'Write the survey draft' }).isVisible());
    await second.locator('.kb-card').first().click();
    const dlg = page.locator('dialog.kb-sheet[open]');
    check('the card window has Add to card and Actions on its side', await dlg.locator('.kc-side').getByText('Add to card').isVisible() && await dlg.locator('.kc-side').getByText('Actions').isVisible());
    await dlg.locator('.kc-side-btn', { hasText: 'Due date' }).click();
    await page.locator('#kc-due').fill(iso(new Date(Date.now() + 2 * 86400000)));
    await dlg.locator('.kc-side-btn', { hasText: 'Labels' }).click();
    await dlg.locator('.kb-pop .kb-label-opt').first().click();
    await dlg.locator('.kb-pop .kb-pop-head button').click();
    await dlg.locator('.kc-desc-empty').click();
    await dlg.locator('#kc-desc').fill('Ten papers on time blocking');
    await dlg.locator('.kc-desc-edit').getByRole('button', { name: 'Save' }).click();
    await dlg.locator('.kc-side-btn', { hasText: 'Stopwatch' }).click();
    await dlg.locator('.kc-watch').getByRole('button', { name: 'Start' }).click();
    await wait(2300);
    check('the stopwatch runs on the card', /0:00:0[1-3]/.test(await dlg.locator('.kc-watch-btn').textContent()));
    await dlg.locator('.kc-watch').getByRole('button', { name: 'Stop' }).click();
    await dlg.getByRole('button', { name: 'Add to today’s tasks' }).click();
    await page.getByText('Added to today.').waitFor({ timeout: 4000 });
    await dlg.locator('.kc-head').getByRole('button', { name: 'Close' }).click();
    await wait(1200);
    const c = (await thesis()).boards[0].lists[1].cards[0];
    check('a card takes a due date and a label', !!c.due && c.labels.length === 1);
    check('a card can be added to today\'s tasks', (await doc(`day:${D}`)).tasks.some((x) => x.text === 'Read ten papers'));
    check('the card shows its label and due date on the board', await second.locator('.kb-card .lbl').isVisible() && await second.locator('.kb-card .due').isVisible());
    check('and its time and description', c.stopwatch?.total >= 1 && !c.stopwatch.startedAt && c.description === 'Ten papers on time blocking' && await second.locator('.kb-card .watch').isVisible());
    await page.locator('.kb-search input').fill('survey');
    check('the text filter narrows the cards', (await page.locator('.kb-card').count()) === 1 && await page.locator('.kb-bar-note').isVisible());
    await page.locator('.kb-bar-note button').click();
    await page.locator('.kb-proj-end').getByRole('button', { name: 'Actions for Thesis work' }).click();
    await page.locator('.kb-pop .kb-bg', { hasText: 'Ocean' }).click();
    await wait(800);
    check('a project takes a colour for its tile, its pages keep the planner’s ground', (await thesis()).background === 'ocean' && !(await page.locator('.kb-board.has-bg').count()));
    await page.locator('.kb-pop .kb-bg.own').click();
    check('its own colour opens a picker in place: a field, a hue strip and a code', await page.locator('.kb-pop .cp-field').isVisible() && await page.locator('.kb-pop .cp-hue').isVisible() && await page.locator('.kb-pop .kb-bg-hex input').isVisible());
    const fb = await page.locator('.kb-pop .cp-field').boundingBox();
    await page.mouse.move(fb.x + fb.width * 0.8, fb.y + fb.height * 0.2); await page.mouse.down();
    await page.mouse.move(fb.x + fb.width * 0.6, fb.y + fb.height * 0.3, { steps: 4 }); await page.mouse.up();
    await wait(900);
    const picked = (await thesis()).background;
    check('dragging in the field picks the colour, and it is kept among the latest', /^#[0-9a-f]{6}$/.test(picked) && await page.locator(`.kb-pop .cp-recent[aria-label="${picked}"]`).isVisible());
    await page.locator('.kb-pop .kb-bg-hex input').fill('#f2d16b');
    await wait(900);
    check('or a colour code', (await thesis()).background === '#f2d16b');
    await page.locator('.kb-pop .kb-bg', { hasText: 'Ocean' }).click();
    await wait(900);
    await page.goto(`${srv.url}/boards`);
    await page.locator('.kb-tile h3').first().waitFor({ timeout: 6000 });
    check('the project shows as a tile in its colour, with its description and what is done', await page.locator('.kb-tile.bg-ocean', { hasText: 'Thesis work' }).isVisible()
      && await page.locator('.kb-tile', { hasText: 'Everything for the bachelor thesis' }).isVisible() && (await page.locator('.kb-tile-foot').first().textContent()).includes('0/2 done'));
    await page.locator('.kb-filters input[type=search]').fill('nothing like it');
    check('the search narrows the projects', !(await page.locator('.kb-tile h3').count()) && await page.getByText('No project matches.').first().isVisible());
    await page.locator('.kb-filters input[type=search]').fill('');
    check('cards due within a week are listed across the boards', await page.locator('.kb-soon li', { hasText: 'Read ten papers' }).isVisible());
    await page.locator('.kb-soon li a', { hasText: 'Read ten papers' }).click();
    check('and open straight to the card', await page.locator('dialog.kb-sheet[open] .kb-card-title').waitFor({ timeout: 4000 }).then(() => true, () => false));
    // board templates of one's own
    const pid = (await thesis()).id, bid = (await thesis()).boards[0].id;
    await page.goto(`${srv.url}/project/${pid}/${bid}`);
    await page.locator('.kb-bar-end .kb-bar-btn').click();
    await page.locator('.kb-menu button', { hasText: 'Save as a template' }).click();
    await page.locator('#kt-name').fill('Thesis kit');
    await page.locator('.kt-form .switch').check();
    await page.getByRole('button', { name: 'Save template' }).click();
    await wait(1200);
    const kit = ((await api.get('boards')).value.templates ?? []).find((t) => t.name === 'Thesis kit');
    check('a board is saved as a template, with its cards if asked', kit?.lists.length === 3 && kit.lists.flatMap((l) => l.cards ?? []).length === 2 && kit.labels.length >= 3);
    await page.goto(`${srv.url}/boards`);
    await page.locator('.kb-new', { hasText: 'Make a template' }).click();
    await page.locator('#kt-name').fill('Weekly review');
    await page.locator('.kt-form .kb-tpl-make', { hasText: 'Add a list' }).click();
    await page.locator('.kt-lists li').nth(3).locator('input').fill('Notes');
    await page.getByRole('button', { name: 'Save template' }).click();
    await wait(1200);
    const wr = ((await api.get('boards')).value.templates ?? []).find((t) => t.name === 'Weekly review');
    check('a template is made from the boards page, its lists named in order', JSON.stringify(wr?.lists.map((l) => l.name)) === JSON.stringify(['To do', 'Doing', 'Done', 'Notes'])
      && await page.locator('.kb-tpl-tile', { hasText: 'Weekly review' }).isVisible());
    await page.goto(`${srv.url}/project/${pid}/${bid}`);
    await page.locator('.kb-tab.add').click();
    await page.locator('dialog[open] .kb-template', { hasText: 'Thesis kit' }).click();
    check('a template of one’s own is offered for a new board, the sketch showing its cards', await page.locator('dialog[open] .kb-sketch-list i.real', { hasText: 'Read ten papers' }).isVisible());
    await page.locator('dialog[open] #kb-new-name').fill('Thesis two');
    await page.locator('dialog[open]').getByRole('button', { name: 'Make the board' }).click();
    await wait(1200);
    const two = (await thesis()).boards.find((x) => x.name === 'Thesis two');
    const orig = (await thesis()).boards[0];
    check('and the board made from it starts with its lists, labels and cards (new ones)', two?.lists.length === 3 && two.lists.flatMap((l) => l.cards).length === 2
      && !two.lists.flatMap((l) => l.cards).some((c) => orig.lists.flatMap((l) => l.cards).some((o) => o.id === c.id))
      && two.lists.flatMap((l) => l.cards).some((c) => c.labels.length === 1 && two.labels.some((x) => x.id === c.labels[0])));
  }

  // ---------- team projects ----------
  {
    const ece = client(srv.url);
    await ece.call('/api/auth/login', { email: 'ece@hale.test', password: 'Kalem defter mavi!' });
    await page.goto(`${srv.url}/boards`);
    await page.locator('.kb-new', { hasText: 'Create team project' }).click();
    await page.locator('#kp-name').fill('Study group');
    await page.locator('#kp-desc').fill('Physics 101 with Ece');
    await page.locator('dialog[open]').getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL('**/team/**', { timeout: 6000 });
    const tid = page.url().split('/team/')[1].split('/')[0];
    await page.locator('#kb-new-name').fill('Week 1');
    await page.getByRole('button', { name: 'Make the board' }).click();
    await page.locator('.kb-list').first().waitFor({ timeout: 6000 });
    await wait(1200);
    check('a team project is made on the server, with its board', (await ece.call(`/api/doc/team:${tid}`)).status === 404
      && (await api.call(`/api/doc/team:${tid}`)).body.value.boards[0]?.name === 'Week 1');
    await page.locator('.kb-members-btn').click();
    await page.locator('.kb-people li', { hasText: 'ece' }).getByRole('button', { name: 'Add' }).click();
    await page.locator('.kb-people li', { hasText: 'ece' }).getByText('ece').first().waitFor({ timeout: 4000 });
    await wait(600);
    const seen = (await ece.call('/api/teams')).body;
    check('a friend added as a member sees the project', seen.length === 1 && seen[0].value.name === 'Study group' && !seen[0].owner);
    // Ece adds a card; it shows here without a reload
    const tdoc = (await ece.call(`/api/doc/team:${tid}`)).body;
    const v = tdoc.value;
    v.boards[0].lists[0].cards.push({ id: 'ece1', title: 'Ece: chapter 3 notes', description: '', labels: [], checklist: [], created: D });
    check('a member can change the project', (await ece.call(`/api/doc/team:${tid}`, { value: v, version: tdoc.version }, 'PUT')).status === 200);
    check('what a member adds shows for the others by itself', await page.locator('.kb-card', { hasText: 'Ece: chapter 3 notes' }).waitFor({ timeout: 9000 }).then(() => true, () => false));
    const stale = await ece.call(`/api/doc/team:${tid}`, { value: v, version: tdoc.version }, 'PUT');
    check('a stale save is refused there too', stale.status === 409);
    await page.goto(`${srv.url}/boards`);
    await page.locator('.kb-tile', { hasText: 'Study group' }).waitFor({ timeout: 6000 }).catch(() => {});
    check('the team part shows the project with its people', await page.locator('.kb-part', { hasText: 'Team' }).locator('.kb-tile', { hasText: 'Study group' }).locator('.kb-faces i').count() === 2);
    const robinId = (await ece.call('/api/friends')).body.friends[0].id;
    check('nobody can add a stranger, and a member cannot add people', (await api.call(`/api/teams/${tid}/members`, { id: 'not-a-friend' })).status === 400
      && (await ece.call(`/api/teams/${tid}/members`, { id: robinId })).status === 404);
    const eceId = seen[0].members.find((m) => m.you).id;
    await ece.call(`/api/teams/${tid}/members/${eceId}`, null, 'DELETE');
    check('a member who leaves can no longer read it', (await ece.call(`/api/doc/team:${tid}`)).status === 404 && (await ece.call('/api/teams')).body.length === 0);
  }
  // ---------- plans tied together: season -> month -> week -> day, steps, board cards ----------
  {
    const M = D.slice(0, 7), W = weekOf(D), Q = `${D.slice(0, 4)}-Q${Math.floor((Number(D.slice(5, 7)) - 1) / 3) + 1}`;
    await api.put(`quarter:${Q}`, { goals: [{ id: 'qg', text: 'Finish the thesis draft', done: false }], notes: '' });
    await api.put(`month:${M}`, { goals: [{ id: 'mg', text: 'Literature review', done: false }], notes: '', dates: [] });
    await page.goto(`${srv.url}/month/${M}`);
    const mrow = page.locator('.check-row', { hasText: 'Literature review' }).first();
    await mrow.waitFor({ timeout: 8000 });
    await mrow.hover();
    await mrow.locator('.row-tools button[aria-label^="Tie it to"]').click();
    await page.locator('.link-pop .link-opt', { hasText: 'Finish the thesis draft' }).click();
    await wait(900);
    check('a month goal is tied to a season goal', (await doc(`month:${M}`)).goals[0].up?.id === 'qg' && await mrow.locator('.link-chip.up', { hasText: 'Finish the thesis draft' }).isVisible());
    await mrow.hover();
    await mrow.locator('.row-tools button[aria-label="Break it down one scale below"]').click();
    await page.locator('.link-pop .link-add').click();
    await page.waitForURL('**/week/**', { timeout: 6000 });
    await wait(900);
    const wItem = (await doc(`week:${W}`))?.items.find((i) => i.text === 'Literature review');
    check('breaking a goal down adds it to this week, tied to it', wItem?.up?.key === `month:${M}` && wItem.up.id === 'mg');
    const wrow = page.locator('.check-row', { hasText: 'Literature review' }).first();
    await wrow.waitFor({ timeout: 8000 });
    check('the week item shows the goal it serves', await wrow.locator('.link-chip.up', { hasText: 'Literature review' }).isVisible());
    await wrow.hover();
    await wrow.locator('.row-tools button[aria-label="Break it down one scale below"]').click();
    await page.locator('.link-pop .link-add').click();
    await page.waitForURL('**/day/**', { timeout: 6000 });
    await wait(900);
    const task = (await doc(`day:${D}`)).tasks.find((x) => x.text === 'Literature review');
    check('and a week item goes on today, tied to it', task?.up?.key === `week:${W}` && task.up.id === wItem?.id);
    const trow = page.locator('.capture .check-row', { hasText: 'Literature review' }).first();
    await trow.waitFor({ timeout: 8000 });
    await trow.hover();
    await trow.locator('.row-tools button[aria-label^="Add a step to"]').click();
    // the step's field takes the focus; a re-render of the freshly opened day can take it away again, so it is clicked
    await trow.locator('.row-steps .adder input').click();
    await page.keyboard.type('Find ten papers');
    await page.keyboard.press('Enter');
    await wait(900);
    check('a task takes smaller steps', (await doc(`day:${D}`)).tasks.find((x) => x.text === 'Literature review')?.steps?.[0]?.text === 'Find ten papers', JSON.stringify((await doc(`day:${D}`)).tasks.find((x) => x.text === 'Literature review')) + ' focus=' + await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160)));
    await trow.locator('> .check').check();
    await wait(900);
    await page.goto(`${srv.url}/week/${W}`);
    const chip = page.locator('.check-row', { hasText: 'Literature review' }).first().locator('.link-chip.down');
    await chip.waitFor({ timeout: 8000 });
    check('the week item counts its tasks done', (await chip.textContent()).includes('1/1'));
    await page.goto(`${srv.url}/quarter/${Q}`);
    const qchip = page.locator('.check-row', { hasText: 'Finish the thesis draft' }).first().locator('.link-chip.down');
    await qchip.waitFor({ timeout: 8000 });
    check('the season goal counts the month goals that serve it', (await qchip.textContent()).includes('0/1'));
  }

  // ---------- a board card and the task made from it ----------
  {
    const proj = (await api.get('boards')).value.projects.find((x) => x.name === 'Thesis work');
    const bd = proj.boards[0];
    const card = bd.lists.flatMap((l) => l.cards).find((c) => c.title === 'Write the survey draft');
    await page.goto(`${srv.url}/project/${proj.id}/${bd.id}/${card.id}`);
    const dlg = page.locator('dialog.kb-sheet[open]');
    await dlg.getByRole('button', { name: 'Add to today’s tasks' }).click();
    await page.getByText('Added to today.').waitFor({ timeout: 4000 });
    await wait(1200);
    const t = (await doc(`day:${D}`)).tasks.find((x) => x.text === 'Write the survey draft');
    const c1 = (await api.get('boards')).value.projects.find((x) => x.id === proj.id).boards[0].lists.flatMap((l) => l.cards).find((c) => c.id === card.id);
    check('a task made from a card stays tied to it', t?.card?.card === card.id && c1.planned?.task === t.id);
    await page.goto(`${srv.url}/day/${D}`);
    const row = page.locator('.capture .check-row', { hasText: 'Write the survey draft' }).first();
    await row.waitFor({ timeout: 8000 });
    check('the task shows its board', await row.locator('.link-chip.card').isVisible());
    await row.locator('> .check').check();
    await wait(1500);
    const lists = (await api.get('boards')).value.projects.find((x) => x.id === proj.id).boards[0].lists;
    check('ticking the task moves the card to the board’s last list', lists[lists.length - 1].cards.some((c) => c.id === card.id));
    // moved back out of the last list on the board, the task opens again
    await page.goto(`${srv.url}/project/${proj.id}/${bd.id}/${card.id}`);
    await page.locator('dialog.kb-sheet[open] .kb-move').selectOption(lists[0].id);
    await wait(1800);
    check('a card moved out of the last list opens its task again', (await doc(`day:${D}`)).tasks.find((x) => x.id === t.id)?.done === false);
  }

  // ---------- features turned off ----------
  {
    await page.goto(`${srv.url}/settings`);
    const sw = page.locator('.feature-row', { hasText: 'Countdown' }).locator('input');
    await sw.waitFor({ timeout: 8000 });
    await sw.uncheck();
    await wait(900);
    check('a feature can be turned off in Settings', (await doc('settings')).features?.countdown === false);
    check('and leaves the menu', !(await page.locator('.rail a[href="/countdown"]').count()));
    await page.goto(`${srv.url}/countdown`);
    await page.waitForURL((u) => u.pathname === '/', { timeout: 6000 }).catch(() => {});
    check('its address leads to the overview', new URL(page.url()).pathname === '/');
    await page.goto(`${srv.url}/settings`);
    await page.locator('.feature-row', { hasText: 'Countdown' }).locator('input').check();
    await wait(900);
    check('and turned on again, it is back', await page.locator('.rail a[href="/countdown"]').isVisible());
  }
} finally {
  await browser.close();
  srv.stop();
  feed.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
