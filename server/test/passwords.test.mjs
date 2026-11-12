import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordCheck } from '../src/passwords.mjs';

test('basic requires length, upper case and a symbol', () => {
  for (const [pw, problem] of [['Ab!', 'short'], ['eightwords!', 'upper'], ['Eightwords', 'special'], ['Ab!'.repeat(68), 'long']]) {
    assert.equal(passwordCheck(pw).problem, problem);
  }
  assert.equal(passwordCheck('Eightwords!').problem, null);
});
test('strong requires every character class', () => {
  for (const [pw, problem] of [['LANTERN!48296', 'lower'], ['Lantern!grove', 'digit'], ['Lantern48296x', 'special']]) {
    assert.equal(passwordCheck(pw, {}, 'strong').problem, problem);
  }
  assert.equal(passwordCheck('Lantern!48296grove', {}, 'strong').problem, null);
});
test('strong refuses common and personal passwords; basic still rejects patterns', () => {
  assert.equal(passwordCheck('Password123!', {}, 'strong').problem, 'common');
  assert.equal(passwordCheck('Alexandra1999!', { name: 'Alexandra' }, 'strong').problem, 'personal');
  assert.equal(passwordCheck('Aa!Aa!Aa!').problem, 'pattern');
});
