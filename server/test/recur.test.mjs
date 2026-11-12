import test from 'node:test';
import assert from 'node:assert/strict';
import { rollOn, nextDate, onRuleDay } from '../src/recur.mjs';

test('rollOn skips past dates and resets progress while preserving start distance', () => {
  const patch = rollOn({ due: '2026-11-01', start: '2026-10-30', repeat: { unit: 'day', every: 2 }, percent: 75, steps: [{ id: 's', done: true }] }, '2026-11-06');
  assert.equal(patch.due, '2026-11-07');
  assert.equal(patch.start, '2026-11-05');
  assert.equal(patch.percent, undefined);
  assert.deepEqual(patch.steps, [{ id: 's', done: false }]);
  assert.equal(patch.doneCount, 1);
  assert.equal(patch.lastDone, '2026-11-06');
});
test('month end keeps the 31st through February, including leap years', () => {
  for (const [year, end] of [[2026, 28], [2028, 29]]) {
    const patch = rollOn({ due: `${year}-01-31`, repeat: { unit: 'month' } }, `${year}-01-31`);
    assert.equal(patch.due, `${year}-02-${end}`);
    assert.equal(nextDate(patch.repeat, patch.due), `${year}-03-31`);
  }
});
test('weekly weekdays stay in the week then advance by the interval', () => {
  const rule = { unit: 'week', every: 2, days: [4, 0, 4] };
  assert.equal(nextDate(rule, '2026-11-09'), '2026-11-13');
  assert.equal(nextDate(rule, '2026-11-13'), '2026-11-23');
  assert.equal(onRuleDay(rule, '2026-11-10'), '2026-11-13');
  assert.equal(onRuleDay(rule, '2026-11-13'), '2026-11-13');
});
test('after counts from completion rather than the old due date', () => {
  assert.equal(rollOn({ due: '2026-11-01', repeat: { unit: 'day', every: 3, after: true } }, '2026-11-12').due, '2026-11-15');
});
test('count and until end a repeating task, with until inclusive', () => {
  const t = { due: '2026-11-12', repeat: { unit: 'day', count: 2 }, doneCount: 1 };
  assert.equal(rollOn(t, t.due).done, true);
  assert.equal(rollOn({ ...t, repeat: { unit: 'day', until: '2026-11-12' } }, t.due).done, true);
  assert.equal(rollOn({ ...t, repeat: { unit: 'day', until: '2026-11-13' } }, t.due).due, '2026-11-13');
});
