import assert from 'node:assert/strict';
import { test } from 'node:test';
import { yearDays, heatLevel, longestStreak } from '../../client/src/lib/year.ts';
test('year calendar and leap days',()=>{assert.equal(yearDays(2024).length,366);assert.equal(yearDays(2026).length,365);});
test('focus streak resets on empty days',()=>{assert.equal(longestStreak([10,20,0,2,3,4,0]),3);assert.equal(longestStreak([]),0);});
test('heat thresholds',()=>assert.deepEqual([0,1,29,30,59,60,119,120].map(heatLevel),[0,1,1,2,2,3,3,4]));
