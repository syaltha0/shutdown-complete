import test from 'node:test';
import assert from 'node:assert/strict';
import { unionMinutes } from '../../client/src/lib/intervals.ts';

test('overlapping blocks count a minute once', () => {
  // 09:00-10:00 and 09:30-10:30 are 90 busy minutes, not 120
  assert.equal(unionMinutes([{ start: 540, end: 600 }, { start: 570, end: 630 }]), 90);
});
test('a block inside another adds nothing; touching blocks add up; order does not matter', () => {
  assert.equal(unionMinutes([{ start: 540, end: 660 }, { start: 570, end: 600 }]), 120);
  assert.equal(unionMinutes([{ start: 600, end: 660 }, { start: 540, end: 600 }]), 120);
  assert.equal(unionMinutes([{ start: 600, end: 660 }, { start: 300, end: 360 }, { start: 330, end: 400 }]), 160);
});
test('identical blocks and the clip window', () => {
  assert.equal(unionMinutes([{ start: 540, end: 600 }, { start: 540, end: 600 }, { start: 540, end: 600 }]), 60);
  // from 09:30 on, to 10:15: 45 of the 90 minutes remain
  assert.equal(unionMinutes([{ start: 540, end: 600 }, { start: 570, end: 630 }], 570, 615), 45);
  assert.equal(unionMinutes([{ start: 540, end: 600 }], 700, 800), 0);
  assert.equal(unionMinutes([]), 0);
});
