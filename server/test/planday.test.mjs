import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStartOf, planningDay, planningNow, planningParts, onPlanningScale } from '../src/planday.mjs';
import { pushService } from '../src/push.mjs';
import { openDb } from '../src/db.mjs';
import { fakeSubscription } from '../../tools/lib/push-receive.mjs';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);

test('day start 0 keeps the calendar day and the clock', () => {
  for (const d of [at(2026, 11, 14, 0, 0), at(2026, 11, 14, 3, 59), at(2026, 11, 14, 23, 59)]) {
    assert.equal(planningDay(d, 0), `2026-11-14`);
    assert.equal(planningNow(d, 0), d.getHours() * 60 + d.getMinutes());
  }
  assert.deepEqual(planningParts('2026-11-14', 30, 0), { date: '2026-11-14', minute: 30 });
  assert.equal(onPlanningScale(120, 0), 120);
});

test('03:59 belongs to the day before, 04:00 starts the new day', () => {
  assert.equal(planningDay(at(2026, 11, 14, 3, 59), 240), '2026-11-13');
  assert.equal(planningNow(at(2026, 11, 14, 3, 59), 240), 1440 + 239);
  assert.equal(planningDay(at(2026, 11, 14, 4, 0), 240), '2026-11-14');
  assert.equal(planningNow(at(2026, 11, 14, 4, 0), 240), 240);
  assert.equal(planningDay(at(2026, 11, 14, 2, 0), 240), '2026-11-13');
  assert.equal(planningNow(at(2026, 11, 14, 2, 0), 240), 1560);
  assert.deepEqual(planningParts('2026-11-14', 120, 240), { date: '2026-11-13', minute: 1560 });
  assert.deepEqual(planningParts('2026-11-14', 240, 240), { date: '2026-11-14', minute: 240 });
  assert.equal(onPlanningScale(180, 240), 1620);
  assert.equal(onPlanningScale(510, 240), 510);
});

test('month and year ends, leap day', () => {
  assert.equal(planningDay(at(2027, 1, 1, 1, 0), 240), '2026-12-31');
  assert.equal(planningDay(at(2026, 12, 1, 0, 30), 60), '2026-11-30');
  assert.equal(planningDay(at(2028, 3, 1, 2, 0), 180), '2028-02-29');
  assert.deepEqual(planningParts('2027-01-01', 0, 240), { date: '2026-12-31', minute: 1440 });
  assert.deepEqual(planningParts('2028-03-01', 59, 60), { date: '2028-02-29', minute: 1499 });
});

test('daylight saving days keep the right calendar day', () => {
  // whichever zone the tests run in, a date shifted back one day is the day before (setDate, not 24 h of milliseconds)
  for (const [y, mo, d] of [[2026, 3, 29], [2026, 10, 25], [2026, 3, 8], [2026, 11, 1]]) {
    const day = at(y, mo, d, 3, 30), prev = new Date(y, mo - 1, d - 1);
    const want = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    assert.equal(planningDay(day, 240), want);
  }
  assert.deepEqual(planningParts('2026-03-29', 150, 240), { date: '2026-03-28', minute: 1590 });
});

test('the setting is read safely', () => {
  assert.equal(dayStartOf(undefined), 0);
  assert.equal(dayStartOf({}), 0);
  assert.equal(dayStartOf({ dayStart: 240 }), 240);
  assert.equal(dayStartOf({ dayStart: 360 }), 360);
  for (const bad of [-60, 361, 1440, 30.5, '240', null]) assert.equal(dayStartOf({ dayStart: bad }), 0);
});

function setup(settings) {
  const db = openDb(':memory:');
  const user = db.users.create({ email: '[EMAIL]', name: 'A', password: 'x' });
  const sub = fakeSubscription(); sub.timeZone = 'Europe/Istanbul';
  db.push.put(user.id, sub.json());
  const put = (key, value) => { const cur = db.docs.get(user.id, key); db.docs.put(user.id, key, value, cur?.version ?? 0); };
  put('settings', settings);
  const log = [];
  const send = async (endpoint, init) => { log.push(JSON.parse(sub.open(init.body))); return new Response(null, { status: 201 }); };
  return { put, log, svc: pushService(db, { send, timers: false }) };
}
const blocks = (list) => ({ columns: [{ from: null, closedAt: null, blocks: list }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } });

test('reminders follow the planning day', async () => {
  // Istanbul is UTC+3: 2026-11-14 02:00 local is 2026-11-13T23:00Z
  const s = setup({ dayStart: 240, notify: { morning: true, evening: true, eveningAt: '01:30', weekends: true }, reminders: { before: 0, autoFocus: false } });
  s.put('day:2026-11-13', blocks([{ id: 'late', start: 1560, end: 1620, label: '', note: '', kind: 'deep' }]));
  s.put('day:2026-11-14', blocks([{ id: 'early', start: 120, end: 180, label: '', note: '', kind: 'deep' }]));
  // 01:30 on the 14th: the evening reminder of the 13th (its shutdown is not done)
  await s.svc.tick(new Date('2026-11-13T22:30:00Z'));
  assert.deepEqual(s.log, [{ type: 'evening' }]);
  // 02:00: the block at 26:00 of the 13th, not the one at 02:00 of the 14th
  s.log.length = 0;
  await s.svc.tick(new Date('2026-11-13T23:00:00Z'));
  assert.deepEqual(s.log, [{ type: 'block' }]);
  // the morning reminder at 08:30 counts the 14th's blocks, after the day has started
  s.log.length = 0;
  await s.svc.tick(new Date('2026-11-14T05:30:00Z'));
  assert.deepEqual(s.log, [{ type: 'morning', n: 1 }]);
});

test('a morning reminder set before the day start waits for the day start', async () => {
  const s = setup({ dayStart: 240, notify: { morning: true, morningAt: '02:00', weekends: true } });
  await s.svc.tick(new Date('2026-11-14T00:59:00Z')); // 03:59
  assert.deepEqual(s.log, []);
  await s.svc.tick(new Date('2026-11-14T01:00:00Z')); // 04:00
  assert.deepEqual(s.log, [{ type: 'morning' }]);
});

// Execute in a DST-observing zone even when the host uses a fixed offset.
test('DST spring and autumn boundaries in New York', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = `import { planningDay, planningNow } from './server/src/planday.mjs';
    import assert from 'node:assert/strict';
    for (const [date, prev] of [['2026-03-08', '2026-03-07'], ['2026-11-01', '2026-10-31']]) {
      const before = new Date(date + 'T03:59:00');
      assert.equal(planningDay(before, 240), prev);
      assert.equal(planningNow(before, 240), 1679);
      assert.equal(planningDay(new Date(date + 'T04:00:00'), 240), date);
    }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('planned repeating task completion advances from the account planning date', (t) => {
  const instant = new Date(2026, 10, 14, 2, 0).getTime();
  t.mock.timers.enable({ apis: ['Date'], now: instant });
  const db = openDb(':memory:');
  const u = db.users.create({ email: 'repeat@example.test', name: 'A', password: 'test' });
  db.docs.put(u.id, 'settings', { dayStart: 240 }, 0);
  const task = { id: 'repeat', text: 'Daily', done: false, due: '2026-11-13', repeat: { unit: 'day', every: 1 } };
  db.docs.put(u.id, 'inbox', { items: [task] }, 0);
  const day = blocks([]);
  day.tasks = [{ id: 'planned', text: 'Daily', done: false, plannedRepeat: { id: task.id, due: task.due, doneCount: 0 } }];
  db.docs.put(u.id, 'day:2026-11-13', day, 0);
  const cur = db.docs.get(u.id, 'day:2026-11-13');
  db.docs.put(u.id, 'day:2026-11-13', { ...day, tasks: day.tasks.map(x => ({ ...x, done: true })) }, cur.version);
  const next = db.docs.get(u.id, 'inbox').value.items[0];
  assert.equal(next.due, '2026-11-14');
  assert.equal(next.lastDone, '2026-11-13');
});
