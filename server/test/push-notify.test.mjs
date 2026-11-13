import test from 'node:test';
import assert from 'node:assert/strict';
import { pushService, focusPlan, notifyChoices, closingTime, phaseEnd } from '../src/push.mjs';
import { openDb } from '../src/db.mjs';
import { fakeSubscription } from '../../tools/lib/push-receive.mjs';

const T0 = Date.parse('2026-11-12T07:00:00Z');          // 10:00 in Istanbul, a Thursday
const iso = (ms) => new Date(ms).toISOString();
const active = (over = {}) => ({ phase: 'focus', startedAt: iso(T0), plannedMin: 25, pausedLeft: null, blockId: null, label: 'x', ...over });
const day = (focus, extra = {}) => ({ columns: [{ from: null, closedAt: null, blocks: [] }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} }, focus: { sessions: [], active: focus }, ...extra });

function setup({ settings = {}, tz = 'Europe/Istanbul', status = 201 } = {}) {
  const db = openDb(':memory:');
  const user = db.users.create({ email: 'a@example.org', name: 'A', password: 'x' });
  const sub = fakeSubscription(); sub.timeZone = tz;
  db.push.put(user.id, sub.json());
  const put = (u, key, value) => { const cur = db.docs.get(u, key); const r = db.docs.put(u, key, value, cur?.version ?? 0); assert.ok(!r.conflict); };
  put(user.id, 'settings', settings);
  const log = [];
  const send = async (endpoint, init) => { log.push({ endpoint, ttl: init.headers.TTL, payload: JSON.parse(sub.open(init.body)) }); return new Response(null, { status }); };
  const svc = pushService(db, { send, timers: false });
  return { db, user, sub, put, log, svc, day: (focus, extra, date = '2026-11-12') => put(user.id, `day:${date}`, day(focus, extra)) };
}
const plan = (s, at) => s.svc.pending(s.user.id, at).map((p) => ({ at: p.at, type: p.type, id: p.id }));

test('plan follows start, pause, resume, extend, skip and stop', () => {
  const s = setup();
  s.day(active());
  assert.deepEqual(plan(s, T0 + 60_000).map((p) => [p.at, p.type]), [[T0 + 25 * 60_000, 'focus-end']]);
  const first = plan(s, T0)[0].id;
  // paused: nothing is planned
  s.day(active({ pausedLeft: 20 * 60 }));
  assert.deepEqual(plan(s, T0 + 5 * 60_000), []);
  // resumed with 20 minutes left: the client moves startedAt so that exactly that much remains
  const resumed = T0 + 10 * 60_000;
  s.day(active({ startedAt: iso(resumed - 5 * 60_000), pausedLeft: null }));
  assert.equal(plan(s, resumed)[0].at, resumed + 20 * 60_000);
  // extended by 5: later end, and a new announcement id
  s.day(active({ plannedMin: 30 }));
  const ext = plan(s, T0 + 60_000)[0];
  assert.equal(ext.at, T0 + 30 * 60_000); assert.notEqual(ext.id, first);
  // skipped: the break that follows ends at its own time
  s.day(active({ phase: 'short', startedAt: iso(T0 + 12 * 60_000), plannedMin: 5 }));
  assert.deepEqual(plan(s, T0 + 13 * 60_000).map((p) => [p.at, p.type]), [[T0 + 17 * 60_000, 'break-end']]);
  // stopped
  s.day(null);
  assert.deepEqual(plan(s, T0 + 13 * 60_000), []);
});

test('phaseEnd and focusPlan ignore malformed or impossible phases', () => {
  for (const a of [null, {}, active({ startedAt: 'nope' }), active({ plannedMin: 0 }), active({ plannedMin: 9999 }), active({ plannedMin: 'x' }), active({ pausedLeft: 0 })]) assert.equal(phaseEnd(a), null);
  assert.equal(focusPlan(active({ phase: 'focus' }), { focus: { autoBreak: false } }).act, true);
  assert.equal(focusPlan(active({ phase: 'focus' }), {}).act, false);
  assert.equal(focusPlan(active({ phase: 'short' }), {}).act, true);
  assert.equal(focusPlan(active({ phase: 'short' }), { focus: { autoFocus: true } }).act, false);
});

test('a push goes out once, when the phase ends, and carries only a short type', async () => {
  const s = setup();
  s.day(active());
  await s.svc.tick(new Date(T0 + 25 * 60_000 - 1000)); assert.equal(s.log.length, 0);
  await s.svc.tick(new Date(T0 + 25 * 60_000 + 1000)); assert.equal(s.log.length, 1);
  assert.deepEqual(s.log[0].payload, { type: 'focus-end' });
  await s.svc.tick(new Date(T0 + 26 * 60_000)); assert.equal(s.log.length, 1);
});

test('a pause, extension or stop after planning cancels the old end time', async () => {
  const s = setup();
  s.day(active());
  await s.svc.refresh(s.user.id, T0 + 60_000);          // planned for T0 + 25 min
  s.day(active({ plannedMin: 30 }));                     // extended before it was reached
  await s.svc.tick(new Date(T0 + 26 * 60_000)); assert.equal(s.log.length, 0);
  await s.svc.tick(new Date(T0 + 30 * 60_000 + 1000)); assert.equal(s.log.length, 1);
  s.log.length = 0;
  s.day(active({ startedAt: iso(T0 + 40 * 60_000), pausedLeft: 600 }));
  await s.svc.tick(new Date(T0 + 80 * 60_000)); assert.equal(s.log.length, 0);
});

test('a restart recovers the running phase from the documents, and never repeats it', async () => {
  const s = setup();
  s.day(active());
  const restarted = pushService(s.db, { send: async (e, init) => { s.log.push({ payload: JSON.parse(s.sub.open(init.body)) }); return new Response(null, { status: 201 }); }, timers: false });
  assert.equal(restarted.pending(s.user.id, T0 + 60_000).length, 1);
  await restarted.tick(new Date(T0 + 27 * 60_000)); assert.equal(s.log.length, 1);
  const again = pushService(s.db, { send: async () => { s.log.push({}); return new Response(null, { status: 201 }); }, timers: false });
  await again.tick(new Date(T0 + 28 * 60_000)); assert.equal(s.log.length, 1);
});

test('a phase that ended long ago is not announced', async () => {
  const s = setup(); s.day(active());
  await s.svc.tick(new Date(T0 + 25 * 60_000 + 16 * 60_000)); assert.equal(s.log.length, 0);
});

test('a session begun before midnight is found on the earlier day', async () => {
  const s = setup();
  const start = Date.parse('2026-11-12T20:50:00Z');     // 23:50 in Istanbul
  s.day(active({ startedAt: iso(start) }), {}, '2026-11-12');
  await s.svc.tick(new Date(start + 26 * 60_000));      // 00:16 on the 13th
  assert.equal(s.log.length, 1);
});

test('the next-phase button is offered only when the next phase does not start by itself', async () => {
  const s = setup({ settings: { focus: { autoBreak: false } } });
  s.day(active()); await s.svc.tick(new Date(T0 + 26 * 60_000));
  assert.deepEqual(s.log[0].payload, { type: 'focus-end', act: 1 });
});

test('focus announcements can be turned off', async () => {
  const s = setup({ settings: { notify: { focus: false } } });
  s.day(active()); await s.svc.tick(new Date(T0 + 26 * 60_000)); assert.equal(s.log.length, 0);
});

test('morning and evening follow the device time zone, weekends and a finished shutdown', async () => {
  const s = setup({ settings: { notify: { morning: true, evening: true } } });
  const at = (z) => new Date(z);
  s.day(null, { columns: [{ from: null, closedAt: null, blocks: [{ id: 'a', start: 540 }, { id: 'b', start: 600 }, { id: 'c', start: 660 }] }] });
  await s.svc.tick(at('2026-11-12T05:29:00Z')); assert.equal(s.log.length, 0);        // 08:29
  await s.svc.tick(at('2026-11-12T05:30:00Z')); assert.deepEqual(s.log.map((x) => x.payload), [{ type: 'morning', n: 3 }]);   // 08:30 Istanbul
  await s.svc.tick(at('2026-11-12T05:40:00Z')); assert.equal(s.log.length, 1);       // once
  await s.svc.tick(at('2026-11-12T14:29:00Z')); assert.equal(s.log.length, 1);       // 17:29
  await s.svc.tick(at('2026-11-12T14:30:00Z')); assert.deepEqual(s.log.at(-1).payload, { type: 'evening' });   // 17:30 default
  // closing ritual done: no evening reminder
  s.log.length = 0;
  s.day(null, { shutdown: { done: true, at: '2026-11-13T14:00:00Z', steps: {} } }, '2026-11-13');
  await s.svc.tick(at('2026-11-13T14:30:00Z')); assert.equal(s.log.length, 0);
});

test('a day without blocks gets the plain morning reminder; weekends are opt-in', async () => {
  const s = setup({ settings: { notify: { morning: true } } });
  await s.svc.tick(new Date('2026-11-12T05:30:00Z')); assert.deepEqual(s.log.map((x) => x.payload), [{ type: 'morning' }]);
  s.log.length = 0;
  await s.svc.tick(new Date('2026-11-14T05:30:00Z')); assert.equal(s.log.length, 0);   // Saturday
  await s.svc.tick(new Date('2026-11-15T05:30:00Z')); assert.equal(s.log.length, 0);   // Sunday
  s.put(s.user.id, 'settings', { notify: { morning: true, weekends: true } });
  await s.svc.tick(new Date('2026-11-14T05:30:00Z')); assert.equal(s.log.length, 1);
});

test('the evening time is the shutdown hour chosen in Settings, else 17:30, unless set here', () => {
  assert.equal(closingTime({}), '17:30');
  assert.equal(closingTime({ setupDone: true, endHour: 18 }), '18:00');
  assert.equal(closingTime({ setupDone: true, endHour: 18, wholeDay: true }), '17:30');
  assert.equal(closingTime({ setupDone: true, endHour: 24 }), '17:30');
  assert.equal(notifyChoices({ setupDone: true, endHour: 19 }).eveningAt, '19:00');
  assert.equal(notifyChoices({ notify: { eveningAt: '21:15' } }).eveningAt, '21:15');
  assert.equal(notifyChoices({ notify: { eveningAt: '25:99', morningAt: 'x' } }).morningAt, '08:30');
  assert.deepEqual(notifyChoices({}), { focus: true, morning: false, morningAt: '08:30', evening: false, eveningAt: '17:30', weekends: false });
});

test('the same moment is a different local time in another zone', async () => {
  const s = setup({ settings: { notify: { morning: true } }, tz: 'America/New_York' });
  await s.svc.tick(new Date('2026-11-12T05:30:00Z')); assert.equal(s.log.length, 0);   // 00:30 in New York
  await s.svc.tick(new Date('2026-11-12T13:30:00Z')); assert.equal(s.log.length, 1);   // 08:30
});

test('accounts are kept apart: only the owner of the running phase is notified', async () => {
  const s = setup();
  const other = s.db.users.create({ email: 'b@example.org', name: 'B', password: 'x' });
  const otherSub = fakeSubscription(); s.db.push.put(other.id, otherSub.json());
  s.put(other.id, 'settings', {});
  s.day(active());
  await s.svc.tick(new Date(T0 + 26 * 60_000));
  assert.equal(s.log.length, 1);
  assert.equal(s.svc.pending(other.id, T0).length, 0);
  assert.equal(s.db.push.forUser(other.id).length, 1);
});

test('expired subscriptions are removed after a focus push; a busy push service is retried', async () => {
  for (const status of [404, 410]) {
    const s = setup({ status }); s.day(active());
    await s.svc.tick(new Date(T0 + 26 * 60_000)); assert.equal(s.db.push.all().length, 0);
  }
  const s = setup({ status: 503 }); s.day(active());
  await s.svc.tick(new Date(T0 + 26 * 60_000)); await s.svc.tick(new Date(T0 + 27 * 60_000));
  assert.equal(s.log.length, 2); assert.equal(s.db.push.all().length, 1);
});

test('one account cannot cause an unbounded number of pushes per hour', async () => {
  const s = setup({ settings: { reminders: { before: 0 } } });
  const blocks = Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, start: 600 }));
  s.day(null, { columns: [{ from: null, closedAt: null, blocks }] });
  await s.svc.tick(new Date('2026-11-12T07:00:00Z'));
  assert.equal(s.log.length, 240);
});

for (const extended of [false, true]) {
  test(`a timer fires at the end of the running phase (${extended ? 'extended meanwhile: re-read, nothing stale sent' : 'untouched: sent on time'})`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 + 60_000 });
    const s = setup(); s.day(active());
    await s.svc.refresh(s.user.id);                      // (setup's service has timers off) nothing armed
    const svc = pushService(s.db, { send: async (e, init) => { s.log.push({ payload: JSON.parse(s.sub.open(init.body)) }); return new Response(null, { status: 201 }); } });
    await svc.refresh(s.user.id, T0 + 60_000);
    if (extended) s.day(active({ plannedMin: 30 }));
    t.mock.timers.tick(24 * 60_000 + 400);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(s.log.length, extended ? 0 : 1);
  });
}
