import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskDraft } from '../../client/src/lib/taskQuickAdd.ts';
import { taskIcs, parseTodo, upsert } from '../src/vtodo.mjs';

const lists = [{ id: 'work', name: 'İş' }, { id: 'en-work', name: 'Work' }];
for (const input of ['Rapor yarın 9 #iş !1 @inceleme', 'Rapor tomorrow at 9 #İş !1 @inceleme']) {
  test(`quick add and VTODO round trip: ${input}`, () => {
    const parsed = parseTaskDraft(input, lists, '2026-11-13');
    assert.deepEqual(parsed, { text: 'Rapor', due: '2026-11-14', dueTime: '09:00', list: 'work', priority: 1, tags: ['inceleme'] });
    const task = { id: 'quick', done: false, ...parsed };
    const ics = taskIcs(task);
    const read = parseTodo(ics);
    for (const key of ['text', 'due', 'dueTime', 'priority']) assert.deepEqual(read[key], task[key]);
    assert.deepEqual(read.categories, task.tags);
    const back = upsert({ items: [] }, 'work', 'quick.ics', ics, '2026-11-13');
    assert.equal(back.doc.items[0].list, 'work');
    assert.deepEqual(back.doc.items[0].tags, ['inceleme']);
  });
}
for (const input of ['Oku her pazartesi', 'Oku every monday']) test(`weekly rule: ${input}`, () => {
  const parsed = parseTaskDraft(input, lists, '2026-11-13');
  assert.equal(parsed.due, '2026-11-16');
  assert.deepEqual(parseTodo(taskIcs({ id: 'weekly', ...parsed })).repeat, { every: 1, unit: 'week', days: [0] });
});
test('unsupported and invalid input stays literal; metadata alone keeps a title', () => {
  for (const input of ['Read 9 pages', 'Rapor 2026-02-30', 'Rapor yarın 25', 'yarın 9 !1']) {
    assert.deepEqual(parseTaskDraft(input, lists, '2026-11-13'), { text: input });
  }
  assert.equal(parseTaskDraft('Read tomorrow', lists, '2026-12-31').due, '2027-01-01');
});
test('a date beside a weekly rule moves to the rule\'s next weekday', () => {
  // 2026-11-14 is a Saturday; the next Friday is 2026-11-20
  const p = parseTaskDraft('Review tomorrow every friday', lists, '2026-11-13');
  assert.equal(p.due, '2026-11-20');
  assert.deepEqual(p.repeat, { every: 1, unit: 'week', days: [4] });
  assert.equal(parseTaskDraft('Oku her pazartesi 2026-11-16', lists, '2026-11-13').due, '2026-11-16');
});

test('unknown list is removed and a date with a bare hour is parsed', () => {
 assert.deepEqual(parseTaskDraft('QA görevi yarın 9 #?? !1 @inceleme', [], '2026-11-17'), {text:'QA görevi', due:'2026-11-18', dueTime:'09:00', priority:1, tags:['inceleme']});
});
