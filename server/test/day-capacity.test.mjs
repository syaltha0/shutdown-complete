import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['client/src/lib/dayCapacity.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
globalThis.document = { documentElement: {} };
const { dayCapacity } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

const date = '2099-11-18';
const settings = { startHour: 9, endHour: 17 };
const hm = (h, m = 0) => h * 60 + m;
const block = (id, start, end, kind, label = id, extra = {}) => ({ id, start, end, kind, label, note: '', ...extra });
const day = (blocks = [], tasks = [], extra = {}) => ({ columns: [{ from: null, closedAt: null, blocks }], tasks, notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} }, ...extra });
const task = (id, estimate, extra = {}) => ({ id, text: id, done: false, estimate, ...extra });
const event = (start, end, allDay = false) => ({ start, end, allDay });

test('a day without a document has the whole range free', () => {
  const c = dayCapacity({ date, doc: null, settings });
  assert.deepEqual([c.available, c.fixed, c.planned, c.estimated, c.left, c.unestimated], [480, 0, 0, 0, 480, 0]);
});

test('the range comes from the settings, the whole day, or a block outside it', () => {
  assert.equal(dayCapacity({ date, settings: { startHour: 8, endHour: 20 } }).available, 720);
  assert.equal(dayCapacity({ date, settings: { startHour: 9, endHour: 17, wholeDay: true } }).available, 1440);
  // a block at 18:00-19:00 widens the day to 19:00, as the day grid does
  const c = dayCapacity({ date, doc: day([block('late', hm(18), hm(19), 'personal')]), settings });
  assert.deepEqual([c.available, c.fixed, c.left], [600, 60, 540]);
  // today: only what is still ahead
  assert.equal(dayCapacity({ date, settings, from: hm(15) }).available, 120);
  assert.equal(dayCapacity({ date, settings, from: hm(23) }).available, 0);
});

test('fixed time: calendar events, personal and meeting blocks; all-day events take none', () => {
  const c = dayCapacity({
    date, settings,
    doc: day([block('lunch', hm(12), hm(13), 'personal'), block('call', hm(15), hm(15, 30), 'meeting')]),
    events: [event(hm(10), hm(11)), event(0, 1440, true)],
  });
  assert.deepEqual([c.fixed, c.planned, c.left], [150, 0, 330]);
});

test('overlapping blocks count a minute once, also an event that is blocked out on the day', () => {
  const c = dayCapacity({
    date, settings,
    doc: day([block('call', hm(9, 30), hm(10, 30), 'meeting'), block('blocked-event', hm(13), hm(14), 'shallow')]),
    events: [event(hm(9), hm(10)), event(hm(13), hm(14))],
  });
  assert.equal(c.fixed, 90 + 60);
  assert.equal(c.left, 480 - 150);
});

test('deep work planned sits on top of the fixed time without counting it twice', () => {
  const c = dayCapacity({ date, settings, doc: day([block('write', hm(14), hm(16), 'deep')]), events: [event(hm(14), hm(15))] });
  assert.deepEqual([c.fixed, c.planned, c.left], [60, 60, 360]);
  assert.equal(c.deep, 120); // as the week's capacity note counts it
  assert.equal(dayCapacity({ date, settings, doc: day([block('a', hm(9), hm(11), 'deep'), block('b', hm(10), hm(12), 'deep')]) }).planned, 180);
});

test('task estimates are taken from what is left; tasks with no estimate are counted apart', () => {
  const doc = day([block('Report', hm(9), hm(10), 'deep')], [
    task('Email', 30), task('Slides', 45), task('Taxes'), task('Call'), task('Report', 60), task('Done one', 90, { done: true }),
  ]);
  const c = dayCapacity({ date, settings, doc });
  assert.deepEqual([c.estimated, c.unestimated, c.planned], [75, 2, 60]); // "Report" already has its block
  assert.equal(c.left, 480 - 60 - 75);
});

test('a day that does not hold its tasks goes below zero', () => {
  const c = dayCapacity({ date, settings, doc: day([block('wall', hm(9), hm(16), 'meeting')], [task('Big', 120), task('Small', 45)]) });
  assert.equal(c.left, 480 - 420 - 165);
  assert.equal(c.left, -105);
});

test('items being put on the day count, unless the day has them already', () => {
  const doc = day([], [task('Taxes', 30)]);
  const c = dayCapacity({ date, settings, doc, adding: [task('x1', 60, { text: 'Chapter' }), task('x2', undefined, { text: 'Plan' }), task('x3', 90, { text: ' taxes ' })] });
  assert.deepEqual([c.estimated, c.unestimated], [90, 1]);
});

test('weekly schedule: placed on the day, and none on a day with a schedule exception', () => {
  const repeat = { id: 'math', label: 'Math', note: '', kind: 'meeting', start: hm(10), end: hm(11, 30), days: [0, 1, 2, 3, 4, 5, 6], since: '2099-11-16' };
  const s = { ...settings, schedule: [repeat] };
  assert.equal(dayCapacity({ date, settings: s }).fixed, 90);
  const ex = { id: 'holiday', from: '2099-11-17', to: '2099-11-19', label: 'Holiday', applies: 'all' };
  const c = dayCapacity({ date, settings: { ...s, exceptions: [ex] } });
  assert.deepEqual([c.fixed, c.left], [0, 480]);
  // an exception for another entry changes nothing
  assert.equal(dayCapacity({ date, settings: { ...s, exceptions: [{ ...ex, applies: ['other'] }] } }).fixed, 90);
  // a block the schedule placed earlier is taken off a future excepted day too
  const placed = day([block('Math', hm(10), hm(11, 30), 'meeting', 'Math', { repeatId: 'math' })], [], { repeats: ['math'] });
  assert.equal(dayCapacity({ date, doc: placed, settings: { ...s, exceptions: [ex] } }).fixed, 0);
});

test('a template is counted on a day with no blocks, not on an excepted day, not twice', () => {
  const tpl = { id: 'writing', name: 'Writing', days: [0, 1, 2, 3, 4, 5, 6], blocks: [
    { start: hm(9), end: hm(12), label: 'Write', note: '', kind: 'deep' }, { start: hm(12), end: hm(13), label: 'Lunch', note: '', kind: 'personal' }] };
  const s = { ...settings, templates: [tpl] };
  const c = dayCapacity({ date, settings: s });
  assert.deepEqual([c.fixed, c.planned, c.left], [60, 180, 240]);
  const ex = { id: 'off', from: date, to: date, label: 'Off', applies: [tpl.id] };
  assert.equal(dayCapacity({ date, settings: { ...s, exceptions: [ex] } }).fixed, 0);
  // the day has blocks already: the template is not added on top
  assert.equal(dayCapacity({ date, doc: day([block('x', hm(15), hm(16), 'meeting')]), settings: s }).fixed, 60);
});


test('a task already covered by the suggested template is not estimated twice', () => {
  const templates = [{ id: 'writing', name: 'Writing', days: [0,1,2,3,4,5,6], blocks: [
    { start: 540, end: 600, label: 'Report', note: '', kind: 'deep' }] }];
  const c = dayCapacity({ date, settings: { ...settings, templates }, doc: day([], [task('Report', 60)]) });
  assert.deepEqual([c.planned, c.estimated, c.left], [60, 0, 420]);
});
