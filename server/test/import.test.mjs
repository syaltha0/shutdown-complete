import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('client/src/lib/import/tasks.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {csv,parseImport,mergeImport,fileIdentity}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const fixture=n=>readFileSync(`tools/fixtures/import/${n}.csv`,'utf8');
test('Todoist BOM, quotes, multiline, dates, priorities, steps, notes and recurrence',()=>{
 const p=parseImport(fixture('todoist'),'todoist','Project.csv');assert.equal(p.tasks.length,2);const t=p.tasks[0];assert.equal(t.text,'Read, then "write"');assert.equal(t.due,'2026-12-01');assert.equal(t.dueTime,'14:30');assert.equal(t.priority,1);assert.equal(t.steps[0].priority,5);assert.match(t.notes,/First line\nSecond line\nKeep sources/);assert.deepEqual(t.tags,['Research']);assert.equal(p.tasks[1].priority,9);assert.match(p.tasks[1].notes,/every Friday/);assert.equal(p.skipped[0].reason,'completed');assert.equal(parseImport(fixture('todoist'),'todoist','Project',true).tasks.length,3);
});
test('TickTick meta rows, priority, completion and list',()=>{const p=parseImport(fixture('ticktick'),'ticktick','Backup');assert.equal(p.tasks.length,1);assert.equal(p.tasks[0].listName,'Reading');assert.equal(p.tasks[0].priority,1);assert.equal(p.tasks[0].dueTime,'14:30');assert.match(p.tasks[0].notes,/FREQ=WEEKLY/);assert.equal(parseImport(fixture('ticktick'),'ticktick','Backup',true).tasks[1].done,true);});
test('semicolon and malformed CSV',()=>{assert.equal(csv('\uFEFFa;b\r\n"a;b";"c""d"')[1][1],'c"d');assert.throws(()=>csv('"unclosed'));assert.throws(()=>parseImport('random','todoist','x'));assert.equal(parseImport(fixture('todoist-semicolon'),'todoist','x').tasks[1].notes,'A; B');});
test('same file twice is idempotent; reuse list and preserve existing tasks',async()=>{const p=parseImport(fixture('todoist'),'todoist','Project');const id=await fileIdentity(fixture('todoist'),'todoist');const doc={items:[{id:'existing',text:'Keep',done:false}],lists:[{id:'list',name:'Project'}]};const once=mergeImport(doc,p,id),twice=mergeImport(once,p,id);assert.deepEqual(twice,once);assert.equal(once.lists.length,1);assert.equal(once.items[1].list,'list');assert.ok(once.items[1].steps[0].id);assert.equal(await fileIdentity(fixture('todoist').replace(/\r\n/g,'\n'),'todoist'),id);});

test('completion option preserves identity and invalid dates remain in notes',async()=>{const text='TYPE,CONTENT,DATE,COMPLETED\ntask,Done,,1\ntask,Open,2026-99-32,0';const id=await fileIdentity(text,'todoist');const first=mergeImport({items:[]},parseImport(text,'todoist','x'),id);const second=mergeImport(first,parseImport(text,'todoist','x',true),id);assert.equal(second.items.length,2);assert.equal(first.items[0].due,undefined);assert.match(first.items[0].notes,/2026-99-32/);});

test('skipped parents never attach children to the previous task',()=>{const p=parseImport('TYPE,CONTENT,INDENT,COMPLETED\ntask,First,1,0\ntask,Completed,1,1\ntask,Child,2,0','todoist','x');assert.equal(p.tasks.length,2);assert.equal(p.tasks[0].steps,undefined);});
