import test from 'node:test';
import assert from 'node:assert/strict';
import { taskIcs, parseTodo, upsert } from '../src/vtodo.mjs';

test('a reopened task leaves no completion behind in its VTODO', () => {
  const done = { id: 'r1', text: 'Pay rent', done: true, doneAt: '2026-11-12', due: '2026-11-12' };
  const doneIcs = taskIcs(done);
  assert.match(doneIcs, /STATUS:COMPLETED/);
  assert.match(doneIcs, /COMPLETED:/);
  const reopened = { ...done, done: false, doneAt: undefined };
  const ics = taskIcs(reopened);
  assert.doesNotMatch(ics, /COMPLETED/);
  assert.match(ics, /STATUS:NEEDS-ACTION/);
  assert.equal(parseTodo(ics).done, false);
  // the server side of the sync reads it back open as well
  const first = upsert({ items: [] }, 'inbox', 'r1.ics', doneIcs, '2026-11-13');
  assert.equal(first.doc.items[0].done, true);
  const back = upsert(first.doc, 'inbox', 'r1.ics', ics, '2026-11-13');
  assert.equal(back.doc.items[0].done, false);
  assert.equal(back.doc.items[0].doneAt, undefined);
});
