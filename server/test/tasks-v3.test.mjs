import test from 'node:test';
import assert from 'node:assert/strict';
import {taskIcs,parseTodo} from '../src/vtodo.mjs';
test('waiting fields round trip without changing due or status',()=>{const t={id:'waiting',text:'Wait',done:false,due:'2026-12-01',waiting:true,waitingNote:'Ali; reply\nsoon',review:'2026-11-18'};const ics=taskIcs(t),p=parseTodo(ics);for(const k of ['due','waiting','waitingNote','review'])assert.equal(p[k],t[k]);assert.ok(!ics.includes('STATUS:IN-PROCESS'));});
