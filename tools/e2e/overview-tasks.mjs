import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s = await startServer(), b = await launch();
try {
 const api = await demoAccount(client(s.url));
 const context = await b.newContext({ reducedMotion: 'reduce' });
 await context.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
 const p = await context.newPage(), key = 'day:' + iso(new Date()), base = (await api.get(key)).value;
 mkdirSync('reports/shots/overview-tasks', { recursive: true });
 for (const [state, count, done] of [['empty',0,0],['partial',3,1],['complete',3,3],['many',24,2]]) {
  const tasks = Array.from({length:count},(_,i)=>({id:'task-'+i,text:i===done?'Review the project proposal and send the final detailed notes to the team':'Task '+(i+1),done:i<done}));
  await api.put(key,{...base,tasks});
  for (const [width,height] of [[1440,900],[390,844]]) for (const theme of ['light','dark']) {
   await p.setViewportSize({width,height}); await p.goto(s.url); const tile=p.locator('.b-today'); await tile.waitFor();
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme); await p.evaluate(()=>document.fonts.ready);
   if (count) {
   await p.waitForFunction(expected => document.querySelector('.b-today [role=progressbar]')?.getAttribute('aria-valuenow') === String(expected), done);
   assert.equal(await tile.locator('input[type=checkbox]').count(),count-done);
   assert.equal(await tile.locator('[role=progressbar]').getAttribute('aria-valuenow'),String(done));
   } else assert.ok(await tile.locator(':is(.b-round-action, .b-today-add)').isVisible(),'Empty tile offers one round add action');
   assert.ok(await tile.evaluate(e=>e.scrollHeight<=e.clientHeight+1 && e.scrollWidth<=e.clientWidth+1),'Tile fits '+state+' '+width);
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
   await p.screenshot({path:`reports/shots/overview-tasks/${state}-${width}-${theme}.png`,fullPage:true});
  }
  if(state==='empty') {
   // the round action opens a small dialog that adds straight onto today's list
   await p.locator('.b-today :is(.b-round-action, .b-today-add)').click();
   await p.locator('dialog.quick-capture input').fill('Round action task');
   await p.locator('dialog.quick-capture input').press('Enter');
   await assertEventually(async()=>assert.deepEqual((await api.get(key)).value.tasks.map(x=>x.text),['Round action task']));
   await api.put(key,{...base,tasks:[]});
  }
  if(state==='partial') {
   await p.locator('.b-today input').first().click();
   await assertEventually(async()=>assert.equal((await api.get(key)).value.tasks[1].done,true));
   await p.getByRole('button',{name:'Undo',exact:true}).click();
   await assertEventually(async()=>assert.equal((await api.get(key)).value.tasks[1].done,false));
   await p.reload(); await p.locator('.b-today').waitFor();
   assert.equal(await p.locator('.b-today [role=progressbar]').getAttribute('aria-valuenow'),'1');
  }
  // Every task stays reachable inside the bounded content area.
  if(count-done>5){
   const content=p.locator('.b-today-content');
   assert.ok(await content.evaluate(e=>e.scrollHeight>e.clientHeight),'Long task list scrolls');
   await p.locator('.b-today input.check').last().scrollIntoViewIfNeeded();
   assert.ok(await p.locator('.b-today input.check').last().isVisible());
  }
 }
 console.log('PASS Tasks today: 16 screenshots, four states, completion persisted, undo persisted, full task list, internal scroll, fit');
} finally { await b.close(); s.stop(); }
async function assertEventually(check) { for(let i=0;i<30;i++){try{await check();return;}catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,100));}} }
