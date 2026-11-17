import test from 'node:test';
import assert from 'node:assert/strict';
import { habitsDue } from '../src/push.mjs';

// 2026-11-18 is a Wednesday (weekday 2, Monday = 0)
const date = '2026-11-18', at = 21 * 60 + 5;
const habit = (id, extra = {}) => ({ id, name: id, kind: 'check', unit: '', target: null, remindAt: '21:00', ...extra });
const days = (map) => (d) => map[d];

test('a habit with a reminder is due within its window, once its time has come', () => {
  const settings = { metrics: [habit('read')] };
  assert.deepEqual(habitsDue(settings, date, at, days({})).map((h) => h.id), ['read']);
  assert.equal(habitsDue(settings, date, 20 * 60 + 59, days({})).length, 0, 'not before its time');
  assert.equal(habitsDue(settings, date, 21 * 60 + 25, days({})).length, 0, 'not after the window');
});

test('done, skipped, archived, metric and reminder-less habits are left out', () => {
  const settings = { metrics: [habit('done'), habit('skip'), habit('old', { archived: true }), habit('none', { remindAt: undefined }), habit('bad', { remindAt: '9pm' }), { ...habit('num'), kind: 'number' }] };
  const doc = { metrics: { done: true }, skippedHabits: ['skip'] };
  assert.deepEqual(habitsDue(settings, date, at, days({ [date]: doc })), []);
});

test('a days habit is due only on its weekdays', () => {
  assert.equal(habitsDue({ metrics: [habit('wed', { frequency: { mode: 'days', days: [2] } })] }, date, at, days({})).length, 1);
  assert.equal(habitsDue({ metrics: [habit('mon', { frequency: { mode: 'days', days: [0] } })] }, date, at, days({})).length, 0);
});

test('a weekly quota stops reminding once the week has enough', () => {
  const settings = { metrics: [habit('walk', { frequency: { mode: 'weekly', count: 2 } })] };
  assert.equal(habitsDue(settings, date, at, days({ '2026-11-16': { metrics: { walk: true } } })).length, 1, 'one of two so far');
  assert.equal(habitsDue(settings, date, at, days({ '2026-11-16': { metrics: { walk: true } }, '2026-11-17': { metrics: { walk: true } } })).length, 0, 'quota met');
  assert.equal(habitsDue(settings, date, at, days({ '2026-11-15': { metrics: { walk: true } }, '2026-11-14': { metrics: { walk: true } } })).length, 1, 'last week does not count');
});

test('since suppresses reminders before the creation day',()=>{
 const settings={metrics:[habit('new',{since:date})]};
 assert.equal(habitsDue(settings,'2026-01-01',at,days({})).length,0);
 assert.equal(habitsDue(settings,date,at,days({})).length,1);
});
