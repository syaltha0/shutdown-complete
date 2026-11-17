import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result = await build({entryPoints:['client/src/lib/dates.ts'],bundle:true,platform:'node',format:'esm',write:false});
globalThis.document = {documentElement:{}};
const {canonicalDateId} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('canonical date routes preserve valid ISO week 53',()=>{
 for(const [s,id,want] of [['day','2026-02-30','2026-03-02'],['day','2026-99-99','2026-11-17'],['month','2026-13','2026-11'],['week','2026-W99','2026-W47'],['week','2026-W53','2026-W53'],['week','2025-W53','2026-W47'],['year','0000','2026']]) assert.equal(canonicalDateId(s,id,'2026-11-17'),want);
});
