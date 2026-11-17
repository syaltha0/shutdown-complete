import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitStats, cycleHabit, shift, planned } from '../../client/src/lib/habits.ts';
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
import { habitHeatmap, habitLongest } from '../../client/src/lib/habits.ts';

test('annual heatmap maps Mondays into exactly 52 columns and seven rows', () => {
 const cells=habitHeatmap(h,()=>doc(),'2026-11-17');
 assert.equal(cells.length,364);assert.equal(cells[0].date,'2025-11-24');
 assert.deepEqual([cells[0].week,cells[0].day],[0,0]);
 const today=cells.find(c=>c.date==='2026-11-17');assert.deepEqual([today.week,today.day],[51,1]);
 assert.deepEqual([cells.at(-1).week,cells.at(-1).day],[51,6]);
});
test('annual tones encode weekly progress, skips and future dates remain neutral', () => {
 const weekly={...h,frequency:{mode:'weekly',count:4}};
 for (let count=1;count<=4;count++) {
  const cells=habitHeatmap(weekly,d=>doc(d>='2026-11-09'&&d<shift('2026-11-09',count),d==='2026-11-13'),'2026-11-15');
  assert.equal(cells.find(c=>c.date==='2026-11-09').level,count);
  const skipped=cells.find(c=>c.date==='2026-11-13');assert.equal(skipped.level,0);assert.equal(skipped.state,'skipped');
 }
 const cells=habitHeatmap(h,()=>doc(true),'2026-11-17');
 assert.equal(cells.find(c=>c.date==='2026-11-18').level,0);
 assert.equal(cells.find(c=>c.date==='2026-11-17').level,4);
 const selected=habitHeatmap({...h,frequency:{mode:'days',days:[0]}},()=>doc(true),'2026-11-17');
 assert.equal(selected.find(c=>c.date==='2026-11-17').level,0);
});
test('longest run survives skips and separates completed daily and weekly runs', () => {
 assert.equal(habitLongest(h,days,d=>doc(!['2026-11-05','2026-11-10'].includes(d),d==='2026-11-05'),days.at(-1)),7);
 assert.equal(habitLongest({...h,frequency:{mode:'weekly',count:2}},days,()=>doc(true),days.at(-1)),2);
 assert.equal(habitLongest(h,days,()=>doc(false,true),days.at(-1)),0);
});

test('since excludes past days from totals, streaks and heatmaps',()=>{
 const fresh={...h,since:'2026-11-14'};
 assert.equal(habitStats(fresh,days,()=>doc(),days.at(-1)).total,2);
 assert.equal(habitStats(h,days,()=>doc(),days.at(-1)).total,14);
 assert.equal(planned(fresh,'2026-11-13'),false);
 assert.equal(habitLongest(fresh,days,()=>doc(true),days.at(-1)),2);
 assert.ok(habitHeatmap(fresh,()=>doc(true),days.at(-1)).filter(c=>c.date<fresh.since).every(c=>c.level===0 && c.state==='unavailable'));
 for(const n of [30,90]) assert.equal(habitStats({...h,since:days.at(-1)},Array.from({length:n},(_,i)=>shift(days.at(-1),i-n+1)),()=>doc(),days.at(-1)).total,1);
 const weekly={...fresh,frequency:{mode:'weekly',count:7}};
 assert.equal(habitStats(weekly,days,()=>doc(true),days.at(-1)).total,2);
});
