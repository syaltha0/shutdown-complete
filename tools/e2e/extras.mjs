// End-to-end checks of the second round of task features: rules that end, due times with reminders, several tasks
// at once, focus time on a task, a timetable brought into the weekly schedule, the week in review, and backups with a
// restore (the server stops and is started again on the same data).
//   npm run build && node tools/e2e/extras.mjs
import { rmSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';
import { reviewMail } from '../../server/src/weekly.mjs';

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const D = iso(new Date());
const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
const pad = (n) => String(n).padStart(2, '0');

let srv = await startServer();
const dataDir = srv.dir;
let api = await demoAccount(client(srv.url), { lang: 'en' });
const me = (await api.call('/api/account')).body;
await api.put('inbox', { lists: [{ id: 'school', name: 'School' }], items: [
  { id: 't1', text: 'Read chapter 5', done: false, list: 'school', due: D },
  { id: 't2', text: 'Lab report', done: false, list: 'school', due: addD(D, 2) },
  { id: 't3', text: 'Buy milk', done: false },
  { id: 't4', text: 'Stretch', done: false, due: D, repeat: { every: 1, unit: 'day', count: 2 } },
] });
const task = async (id) => (await api.get('inbox')).value.items.find((x) => x.id === id);
const browser = await launch();
const ctxOf = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce', ...opts });
  await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
  // notifications are written down instead of shown
  await ctx.addInitScript(() => {
    window.__notes = [];
    class N { constructor(t, o) { window.__notes.push([t, o?.body]); } static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } }
    window.Notification = N;
    // the planner shows them through its service worker when there is one: none here
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration = () => Promise.resolve(undefined);
  });
  return ctx;
};
const ctx = await ctxOf();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const row = (text) => page.locator('.tk-main .tk-row', { hasText: text });

try {
  // ---------- 3: a rule that ends ----------
  await page.goto(`${srv.url}/tasks`);
  await page.locator('.tk-main').waitFor({ timeout: 8000 });
  await row('Stretch').locator('.check').click();
  await wait(900);
  let t = await task('t4');
  check('a rule of 2 times: the first tick rolls it on', !t.done && t.due === addD(D, 1) && t.doneCount === 1, JSON.stringify(t));
  await row('Stretch').locator('.check').click();
  await wait(900);
  t = await task('t4');
  check('the second tick ends it for good', t.done && t.doneAt === D && (await page.locator('.undo-note').textContent()).includes('last time'));
  await row('Buy milk').locator('.tk-open').click();
  await page.locator('#tk-rep').selectOption('weekly');
  await page.locator('#tk-end').selectOption('count');
  await page.locator('.tk-ends input[type=number]').fill('3');
  await wait(900);
  t = await task('t3');
  check('"Ends after a number of times" is kept', t.repeat?.count === 3 && t.repeat.unit === 'week');
  check('and said with the rule', (await row('Buy milk').locator('.tk-rep').textContent()).includes('3 times'));
  await page.locator('#tk-end').selectOption('until');
  await wait(700);
  t = await task('t3');
  check('"Ends on a day" replaces it', !t.repeat.count && !!t.repeat.until);
  await page.keyboard.press('Escape');

  // ---------- 2: a due time and a reminder ----------
  const soon = new Date(Date.now() + 3 * 60_000);
  const hhmm = `${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  await row('Read chapter 5').locator('.tk-open').click();
  await page.locator('.tk-detail input[type=time]').fill(hhmm);
  await page.locator('.tk-detail .tk-two select').selectOption('5');
  await wait(1500);
  t = await task('t1');
  check('a due time and a reminder are kept', t.dueTime === hhmm && t.remind === 5, JSON.stringify(t));
  check('the row shows the time and a bell', (await row('Read chapter 5').textContent()).includes(hhmm) && await row('Read chapter 5').locator('.tk-has svg').count() > 0);
  const notes = await page.evaluate(() => window.__notes);
  check('within the reminder’s minutes, a notification', notes.some(([title, body]) => title === 'Read chapter 5' && /Due in/.test(body)), JSON.stringify(notes));
  const pw = (await api.call('/api/account/app-passwords', { name: 'Test' })).body.password;
  const ics = await (await fetch(`${srv.url}/dav/calendars/${me.id}/school/t1.ics`, { headers: { authorization: `Basic ${Buffer.from(`${me.email}:${pw}`).toString('base64')}` } })).text();
  check('over CalDAV: a DUE with its time and an alarm 5 minutes before', ics.includes(`DUE:${soon.getFullYear()}${pad(soon.getMonth() + 1)}${pad(soon.getDate())}T${hhmm.replace(':', '')}00`) && ics.includes('TRIGGER;RELATED=END:-PT5M'));
  await page.keyboard.press('Escape');

  // ---------- 4: several at once ----------
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await row('Lab report').locator('.tk-open').click();
  await row('Buy milk').locator('.tk-open').click();
  check('picked rows are marked and counted', (await page.locator('.tk-row.picked').count()) === 2 && (await page.locator('.tk-bulk-n').textContent()) === '2 selected');
  await page.locator('.tk-bulk select').first().selectOption('school');
  await wait(800);
  check('moved together', (await task('t3')).list === 'school' && (await task('t2')).list === 'school');
  await row('Lab report').locator('.tk-open').click();
  await row('Buy milk').locator('.tk-open').click();
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  await wait(800);
  check('starred together', (await task('t2')).priority === 1 && (await task('t3')).priority === 1);
  await row('Lab report').locator('.tk-open').click();
  await row('Buy milk').locator('.tk-open').click();
  await page.locator('.tk-bulk').getByRole('button', { name: 'Delete', exact: true }).click();
  await wait(800);
  check('deleted together', !(await task('t2')) && !(await task('t3')));
  await page.locator('.undo-note').getByRole('button', { name: 'Undo' }).click();
  await wait(800);
  check('and brought back together', !!(await task('t2')) && !!(await task('t3')));
  await page.getByRole('button', { name: 'Done selecting' }).click();
  check('Ctrl + click starts picking too', await (async () => { await row('Lab report').locator('.tk-open').click({ modifiers: ['Control'] }); return (await page.locator('.tk-row.picked').count()) === 1 && await page.locator('.tk-bulk').isVisible(); })());
  await page.getByRole('button', { name: 'Done selecting' }).click();

  // ---------- 10: focus time on a task ----------
  {
    const c2 = await ctxOf();
    const p2 = await c2.newPage();
    await p2.clock.install();
    await p2.goto(`${srv.url}/focus`);
    await p2.locator('#fc-task').waitFor({ timeout: 8000 });
    await p2.locator('#fc-task').selectOption('l:t1');
    await p2.getByRole('button', { name: 'Start focus' }).click();
    await wait(800);
    await p2.clock.fastForward('26:00');
    await wait(2500);
    const day = (await api.get(`day:${D}`)).value;
    const s = day.focus.sessions.at(-1);
    check('a focus session records its task', s?.taskId === 't1' && s.taskText === 'Read chapter 5', JSON.stringify(s));
    check('and its minutes add up on the task', (await task('t1')).spent >= 20, String((await task('t1')).spent));
    await c2.close();
    await page.reload();
    await row('Read chapter 5').waitFor();
    check('the row shows the focused time', /focused/.test(await row('Read chapter 5').textContent()));
  }

  // ---------- 11: a timetable ----------
  const before = ((await api.get('settings')).value.schedule ?? []).length;
  await page.goto(`${srv.url}/settings`);
  await page.getByRole('button', { name: 'Import a timetable' }).click();
  const dlg = page.locator('dialog.sched-import');
  await dlg.getByRole('button', { name: 'Paste a table' }).click();
  await dlg.locator('textarea').fill('Mon, Wed 09:00-10:30 Maths\nTue 13:00 - 14:30 Physics\nFri 08.30-09.15 Maths');
  check('lines become classes with their days', (await dlg.locator('.sched-slots li').count()) === 3 && (await dlg.locator('.sched-slots li', { hasText: 'Physics' }).textContent()).includes('13:00–14:30'));
  await dlg.locator('textarea').fill('\tMon\tTue\n09:00-10:00\tMaths\tArt\n10:00-11:00\t\tMaths');
  check('a table copied from a spreadsheet too', (await dlg.locator('.sched-slots li').count()) === 3);
  await dlg.getByRole('button', { name: 'Calendar file' }).click();
  const mon = (() => { const x = new Date(`${D}T12:00:00`); x.setDate(x.getDate() + ((8 - x.getDay()) % 7 || 7)); return iso(x).replace(/-/g, ''); })();
  const cal = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:c1', 'SUMMARY:Chemistry', `DTSTART:${mon}T090000`, `DTEND:${mon}T103000`, 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:c2', 'SUMMARY:History', `DTSTART:${mon}T140000`, `DTEND:${mon}T150000`, 'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  await dlg.locator('input[type=file]').setInputFiles({ name: 'school.ics', mimeType: 'text/calendar', buffer: Buffer.from(cal) });
  await dlg.locator('.sched-slots li').first().waitFor({ timeout: 5000 });
  const chem = await dlg.locator('.sched-slots li', { hasText: 'Chemistry' }).textContent();
  check('a calendar file’s weekly classes, with their days', (await dlg.locator('.sched-slots li').count()) === 2 && chem.includes('09:00–10:30') && /Mon.*Wed/.test(chem), chem);
  await dlg.locator('.sched-slots li', { hasText: 'History' }).locator('input').uncheck();
  await dlg.getByRole('button', { name: 'Add 1 to the weekly schedule' }).click();
  await wait(1200);
  const sched = (await api.get('settings')).value.schedule ?? [];
  check('the chosen class joins the weekly schedule', sched.length === before + 1 && sched.some((r) => r.label === 'Chemistry' && r.days.join() === '0,2' && r.start === 540 && r.end === 630));

  // ---------- 9: the week in review ----------
  const week = weekOf(D);
  const rv = (await api.call(`/api/review/${week}`)).body;
  check('the review adds up the week', rv.days.length === 7 && rv.totals.planned > 0 && rv.totals.focused >= 20 && rv.focusOn.some((x) => x.name === 'Read chapter 5'), JSON.stringify(rv.totals));
  const mail = reviewMail(rv, 'tr', 'Deniz', `http://x/review/${week}`);
  check('its e-mail reads in the account’s language', mail.subject.includes('haftanın özeti') && mail.text.includes('Odak:') && mail.text.includes(`http://x/review/${week}`));
  await page.goto(`${srv.url}/week/${week}`);
  await page.getByRole('link', { name: 'Week in review' }).click();
  await page.locator('.wr-stats').waitFor({ timeout: 6000 });
  check('the Week screen leads to its review', (await page.locator('h1').textContent()).includes('in review') && (await page.locator('.wr-day').count()) === 7);
  check('without e-mail on the server it says so', await page.getByText('sends no e-mail').isVisible());
  check('no errors on the pages', !errors.length, errors.join(' | '));

  // ---------- 12: backups and a restore ----------
  const made = await api.call('/api/admin/backups', {});
  const name = made.body.list?.[0]?.name;
  check('a backup is made', made.status === 200 && made.body.list.length === 1 && /planner-manual-/.test(name));
  const dl = await fetch(`${srv.url}/api/admin/backups/${name}`, { headers: { cookie: api.cookie } });
  const gz = Buffer.from(await dl.arrayBuffer());
  check('it downloads as a gzip', dl.status === 200 && gz[0] === 0x1f && gz[1] === 0x8b);
  const up = await fetch(`${srv.url}/api/admin/backups/upload`, { method: 'POST', body: gz, headers: { cookie: api.cookie, 'content-type': 'application/octet-stream' } });
  check('a downloaded backup can be brought back', up.status === 200 && (await up.json()).list.some((b) => b.kind === 'upload'));
  const junk = await fetch(`${srv.url}/api/admin/backups/upload`, { method: 'POST', body: Buffer.from('not a database'), headers: { cookie: api.cookie, 'content-type': 'application/octet-stream' } });
  check('anything else is refused', junk.status === 400, `${junk.status} ${await junk.text()}`);
  await api.put('inbox', { ...(await api.get('inbox')).value, items: [...(await api.get('inbox')).value.items, { id: 'late', text: 'Written after the backup', done: false }] });
  check('a restore needs the owner’s password', (await api.call(`/api/admin/backups/${name}/restore`, { password: 'wrong' })).status === 401);
  const r = await api.call(`/api/admin/backups/${name}/restore`, { password: 'Demo-password-1' });
  check('a restore stops the server', r.status === 200 && r.body.restarting && await Promise.race([srv.exited.then(() => true), wait(8000).then(() => false)]));
  srv = await startServer({ dataDir });
  const cookie = api.cookie;
  api = client(srv.url);
  api.cookie = cookie;
  const back = (await api.get('inbox')).value;
  check('started again, the planner is as it was at the backup', !!back && !back.items.some((x) => x.id === 'late') && back.items.some((x) => x.id === 't1'));
  check('and what was there before the restore is kept as a backup', (await api.call('/api/admin/backups')).body.list.some((b) => b.kind === 'before-restore'));
} finally {
  await browser.close();
  srv.stop();
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* busy */ }
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
