import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitStats, cycleHabit, shift } from '../../client/src/lib/habits.ts';
const h = {id:'h',name:'Habit',kind:'check',unit:'',target:null};
const days = Array.from({length:14},(_,i)=>shift('2026-11-02',i));
const doc = (done=false,skip=false)=>({metrics:{h:done},skippedHabits:skip?['h']:[]});
test('legacy daily, skips preserve streak and leave rate denominator',()=>{
 const get=d=>doc(d!=='2026-11-05',d==='2026-11-05');
 assert.deepEqual(habitStats(h,days,get,days.at(-1)),{done:13,total:13,streak:13,rate:1});
 assert.equal(habitStats({...h,frequency:{mode:'daily'}},days,get,days.at(-1)).streak,13);
});
test('selected days ignore unplanned gaps',()=>{
 const stats=habitStats({...h,frequency:{mode:'days',days:[0,2]}},days,d=>doc([0,2].includes((new Date(d+'T12:00Z').getUTCDay()+6)%7)),days.at(-1));
 assert.deepEqual(stats,{done:4,total:4,streak:4,rate:1});
});
test('weekly quota caps work, counts consecutive completed weeks',()=>{
 const weekly={...h,frequency:{mode:'weekly',count:2}};
 assert.deepEqual(habitStats(weekly,days,d=>doc(['02','03','04','09','10'].includes(d.slice(-2))),days.at(-1)),{done:4,total:4,streak:2,rate:1});
 assert.equal(habitStats(weekly,days,d=>doc(d.endsWith('02')),days.at(-1)).streak,0);
});
test('cycle done, skipped, empty preserves unrelated data',()=>{
 let d={metrics:{other:3}};d=cycleHabit(h,d);assert.equal(d.metrics.h,true);
 d=cycleHabit(h,d);assert.deepEqual(d.skippedHabits,['h']);
 d=cycleHabit(h,d);assert.deepEqual(d.skippedHabits,[]);assert.equal(d.metrics.h,false);assert.equal(d.metrics.other,3);
});
test('partial rates and weekly skips preserve completed quotas',()=>{
 const weekly={...h,frequency:{mode:'weekly',count:2}};
 assert.equal(habitStats(weekly,days,d=>doc(d.endsWith('02'),d.endsWith('03')),days.at(-1)).rate,.25);
 const firstWeek=days.slice(0,7);
 assert.equal(habitStats(weekly,firstWeek,d=>doc(['02','04'].includes(d.slice(-2)),d.endsWith('03')),firstWeek.at(-1)).streak,1);
 assert.equal(habitStats(h,firstWeek,d=>doc(d.endsWith('02')),firstWeek.at(-1)).rate,1/7);
});
