import test from 'node:test';
import assert from 'node:assert/strict';
import { taskIcs, stepIcs, parseTodo, upsert } from '../src/vtodo.mjs';

for (const repeat of [
  { unit: 'day', every: 3, after: true },
  { unit: 'week', every: 2, days: [0, 2, 4], count: 8 },
  { unit: 'month', every: 1, monthDay: 31, until: '2027-12-31' },
  { unit: 'year', every: 2, monthDay: 29 },
]) test(`VTODO RRULE round trip: ${repeat.unit}`, () => {
  const original = { id: 'task-1', text: 'Read, review; then\\finish\n' + 'ş'.repeat(80), notes: 'Line one\nLine two', due: '2026-11-12', repeat };
  const ics = taskIcs(original);
  const parsed = parseTodo(ics);
  assert.deepEqual(parsed.repeat, repeat);
  assert.equal(parsed.uid, original.id);
  assert.equal(parsed.text, original.text);
  assert.equal(parsed.notes, original.notes);
  assert.equal(parsed.due, original.due);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
});
test('RELATED-TO round trip attaches a subtask to its parent', () => {
  const parent = { id: 'parent', text: 'Parent', steps: [] };
  const ics = stepIcs({ id: 'child', text: 'Child', done: true }, parent);
  assert.equal(parseTodo(ics).parent, parent.id);
  const result = upsert({ items: [parent] }, 'inbox', 'child.ics', ics, '2026-11-12');
  assert.deepEqual(result.doc.items[0].steps, [{ id: 'child', text: 'Child', done: true }]);
  assert.equal(parent.steps.length, 0);
});
test('non-VTODO data is rejected', () => {
  assert.equal(parseTodo('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), null);
});
