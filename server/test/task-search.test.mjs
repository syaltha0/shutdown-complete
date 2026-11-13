import test from 'node:test';
import assert from 'node:assert/strict';
import { taskMatches } from '../../client/src/lib/taskSearch.ts';

const task = { id: 'a', text: 'Pay the rent', notes: 'bank transfer on friday', tags: ['home'], done: false, steps: [{ id: 'b', text: 'Check the balance', done: false }] };
test('every word must match, in any order and any field', () => {
  assert.ok(taskMatches(task, ''));
  assert.ok(taskMatches(task, '  rent '));
  assert.ok(taskMatches(task, 'friday rent'));
  assert.ok(taskMatches(task, 'home bank'));
  assert.ok(!taskMatches(task, 'rent garden'));
});
test('a subtask title finds its task', () => {
  assert.ok(taskMatches(task, 'balance'));
  assert.ok(taskMatches(task, 'balance rent'));
  assert.ok(!taskMatches({ ...task, steps: undefined }, 'balance'));
});
