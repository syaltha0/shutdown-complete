import { createServer } from 'node:http';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
import { pushService } from '../../server/src/push.mjs';
import { openDb } from '../../server/src/db.mjs';
import { fakeSubscription } from '../lib/push-receive.mjs';

const check = (ok, name) => { if (!ok) throw Error('FAIL ' + name); console.log('PASS ' + name); };
const until = async (fn) => { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } throw Error('Timed out waiting for document'); };
const feed = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.end(['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:night@test', 'SUMMARY:Night calendar',
    'DTSTART;TZID=Europe/Istanbul:20261114T030000', 'DTEND;TZID=Europe/Istanbul:20261114T033000',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
}).listen(0, '127.0.0.1');
await new Promise(resolve => feed.once('listening', resolve));
const s = await startServer({ env: { CALENDAR_ALLOW_PRIVATE: 'on' } }), api = await demoAccount(client(s.url), { lang: 'en' }), b = await launch();
const c = await b.newContext({ timezoneId: 'Europe/Istanbul', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
const p = await c.newPage();
const prev = '2026-11-13', next = '2026-11-14';
const doc = async (key) => (await api.get(key)).value;
const blank = () => ({ columns: [{ from: null, closedAt: null, blocks: [] }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } });
try {
  await api.put('settings', { ...await doc('settings'), dayStart: 240, wholeDay: true, calendars: [{ id: 'night', name: 'Night', url: `http://127.0.0.1:${feed.address().port}/cal.ics` }], ritual: [{ id: 'close', text: 'Close loops' }] });
  await api.put('day:' + prev, blank()); await api.put('day:' + next, blank());
  await api.put('inbox', { ...await doc('inbox'), items: [
    { id: 'old', text: 'Planning day task', due: prev, done: false },
    { id: 'new', text: 'Calendar day task', due: next, done: false },
  ] });
  await p.clock.install({ time: new Date('2026-11-13T23:00:00Z') });
  await p.goto(s.url);
  const todayLink = () => p.locator('.rail a.rail-item').filter({ has: p.locator('.label', { hasText: /^Today$/ }) });
  await p.locator('.rail').waitFor();
  await p.goto(s.url + '/settings');
  await p.locator('#s-daystart').waitFor();
  check(await p.locator('#s-daystart').inputValue() === '240', 'Settings shows the saved day start');
  await p.locator('#s-daystart').selectOption('0');
  await p.clock.runFor(2000);
  await until(async () => !(await doc('settings')).dayStart);
  check(await todayLink().getAttribute('href') === '/day/' + next, 'midnight setting immediately restores calendar Today');
  await p.locator('#s-daystart').selectOption('240');
  await p.clock.runFor(2000);
  await until(async () => (await doc('settings')).dayStart === 240);
  check(await todayLink().getAttribute('href') === '/day/' + prev, '02:00 Today links to the previous planning day');
  await todayLink().click(); await p.locator('.col.active .col-body').waitFor();
  check(new URL(p.url()).pathname === '/day/' + prev, 'Today opens the previous document');
  check(await p.locator('.now-line').count() > 0 || await p.locator('.now-tag').count() > 0, 'after-midnight now marker is visible');
  await p.getByRole('button', { name: 'Add a block', exact: true }).click();
  await p.locator('#be-label').fill('Night work');
  check(await p.locator('#be-start').inputValue() === '1560', 'new night block starts at minute 1560');
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.clock.runFor(2000);
  await until(async () => (await doc('day:' + prev)).columns[0].blocks.some(x => x.start === 1560 && x.end > 1440));
  check(true, 'night block persists beyond 24:00');
  const event = p.locator('.cal-event', { hasText: 'Night calendar' });
  await event.waitFor();
  check(await event.innerText().then(x => x.includes('03:00')), 'next calendar morning appears at the end of the planning day');
  await event.click(); await p.getByRole('button', { name: 'Make block', exact: true }).click();
  await p.clock.runFor(2000);
  await until(async () => (await doc('day:' + prev)).columns[0].blocks.some(x => x.source?.uid === 'night@test' && x.start === 1620 && x.end === 1650));
  check(true, 'calendar event creates a sourced block beyond 1440');
  await p.goto(s.url + '/focus');
  await p.getByRole('button', { name: 'Start focus', exact: true }).click();
  await p.clock.runFor(1000);
  await until(async () => (await doc('day:' + prev)).focus?.active);
  check(!(await doc('day:' + next)).focus?.active, '02:00 focus starts on the previous planning day');
  await p.clock.fastForward(26 * 60000);
  await p.clock.runFor(2000);
  await until(async () => (await doc('day:' + prev)).focus?.sessions?.length);
  check((await doc('day:' + prev)).focus.sessions.length === 1, 'finished focus is logged on the original day');
  await p.goto(s.url + '/shutdown');
  await p.getByRole('button', { name: 'Schedule shutdown, complete', exact: true }).click();
  const confirmation = p.locator('dialog[open]');
  await confirmation.waitFor();
  check(!(await doc('day:' + prev)).shutdown.done, 'shutdown waits for confirmation when ritual steps remain');
  await confirmation.getByRole('button', { name: 'Close', exact: true }).click();
  await p.clock.runFor(2000);
  await until(async () => (await doc('day:' + prev)).shutdown.done);
  check(!(await doc('day:' + next)).shutdown.done, 'shutdown completes the previous planning day');
  await p.goto(s.url + '/tasks');
  await p.locator('.tk-views button', { hasText: 'Today' }).first().click();
  check(await p.locator('.tk-row', { hasText: 'Planning day task' }).isVisible(), 'Today tasks include the previous planning date');
  check(await p.locator('.tk-row', { hasText: 'Calendar day task' }).count() === 0, 'Today tasks exclude the next planning date');
  // A timer begun just before the boundary remains on its original document.
  const old = await doc('day:' + prev);
  old.focus.active = { phase: 'focus', startedAt: '2026-11-14T00:59:00Z', plannedMin: 2, pausedLeft: null, blockId: null, label: 'Across day start' };
  await api.put('day:' + prev, old);
  await p.goto(s.url);
  await p.clock.setSystemTime(new Date('2026-11-14T00:59:59Z'));
  await p.clock.runFor(1000);
  check(await todayLink().getAttribute('href') === '/day/' + next, '04:00 updates Today without a reload');
  await todayLink().click();
  check(new URL(p.url()).pathname === '/day/' + next, '04:00 opens the new planning day');
  await p.goto(s.url + '/focus');
  await p.clock.fastForward(2 * 60000);
  await p.clock.runFor(2000);
  await until(async () => (await doc('day:' + prev)).focus?.sessions?.length === 2);
  check(!(await doc('day:' + next)).focus?.sessions?.length, 'focus crossing 04:00 stays on its original planning day');
  // Delivery uses the same settings and wall clock in the subscription's zone.
  const db = openDb(':memory:');
  const u = db.users.create({ email: 'day-start@example.test', name: 'A', password: 'test' });
  const sub = fakeSubscription(); sub.timeZone = 'Europe/Istanbul'; db.push.put(u.id, sub.json());
  db.docs.put(u.id, 'settings', { dayStart: 240, notify: { morning: true, morningAt: '02:00', weekends: true } }, 0);
  const messages = [];
  const svc = pushService(db, { timers: false, send: async (_url, init) => { messages.push(JSON.parse(sub.open(init.body))); return new Response(null, { status: 201 }); } });
  await svc.tick(new Date('2026-11-13T23:00:00Z'));
  check(messages.length === 0, 'morning reminder waits at 02:00');
  await svc.tick(new Date('2026-11-14T01:00:00Z'));
  check(messages.length === 1 && messages[0].type === 'morning', 'morning reminder sends at the 04:00 day start');
} finally { await b.close(); s.stop(); feed.close(); }
