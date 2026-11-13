import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['client/src/lib/repeat.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
globalThis.document = { documentElement: {} };
const { placeRepeats, isExcepted } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const r = { id: 'math', label: 'Math', note: '', kind: 'deep', start: 600, end: 660, days: [0,1,2,3,4,5,6], since: '2099-11-16' };
const day = () => ({ columns: [{ from: 0, blocks: [] }] });
const ex = { id: 'holiday', from: '2099-11-16', to: '2099-11-20', label: 'Holiday', applies: 'all' };
test('inclusive boundaries, outside range and selected/all', () => {
 for (const d of ['2099-11-16','2099-11-18','2099-11-20']) assert.equal(isExcepted([ex],d,r.id),true);
 for (const d of ['2099-11-15','2099-11-21']) assert.equal(isExcepted([ex],d,r.id),false);
 assert.equal(isExcepted([{...ex,applies:['other']}],ex.from,r.id),false);
 assert.equal(placeRepeats(day(),ex.from,[r],[ex]),null);
 assert.equal(placeRepeats(day(),ex.from,[r],[{...ex,applies:['other']}]).columns[0].blocks.length,1);
});
test('future placed blocks return after removal; past days untouched', () => {
 const placed = placeRepeats(day(),ex.from,[r]);
 const removed = placeRepeats(placed,ex.from,[r],[ex]);
 assert.equal(removed.columns[0].blocks.length,0);
 assert.equal(placeRepeats(removed,ex.from,[r],[]).columns[0].blocks.length,1);
 assert.equal(placeRepeats(placed,'2000-01-01',[r],[{...ex,from:'1999-01-01',to:'2001-01-01'}]),null);
});
test('A/B week remains anchored through exceptions', () => {
 const ab = {...r,every:2};
 assert.equal(placeRepeats(day(),'2099-11-16',[ab],[ex]),null);
 assert.equal(placeRepeats(day(),'2099-11-23',[ab]),null);
 assert.equal(placeRepeats(day(),'2099-11-30',[ab]).columns[0].blocks.length,1);
});

test('a deliberate single-day deletion remains deleted', () => {
 const second = {...r,id:'second'};
 const placed = placeRepeats({...day(),repeats:['second']},ex.from,[r,second]);
 const removed = placeRepeats(placed,ex.from,[r,second],[ex]);
 const restored = placeRepeats(removed,ex.from,[r,second]);
 assert.deepEqual(restored.columns[0].blocks.map(b=>b.repeatId),['math']);
});
