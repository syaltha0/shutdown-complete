import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s = await startServer(), api = await demoAccount(client(s.url), {lang:'en'}), browser = await launch();
const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
const p = await context.newPage(), date='2026-11-13', key='day:'+date;
const shots='reports/shots/task-block-link'; mkdirSync(shots,{recursive:true});
try {
 const base=(await api.get(key)).value;
 const task={id:'stable-task',text:'Linked task',done:false};
 const block={id:'linked-block',start:840,end:930,label:task.text,taskLabel:task.text,task:{id:task.id,list:'day',day:date},kind:'shallow',note:''};
 const seed=async(t, b=block)=>api.put(key,{...base,tasks:t,columns:[{from:null,closedAt:null,blocks:[b]}]});
 await api.put(key,{...base,tasks:[task],columns:[{from:null,closedAt:null,blocks:[]}]});
 await p.goto(s.url+'/day/'+date);
 const grip=p.locator('.check-row .grip').first(); await grip.scrollIntoViewIfNeeded();
 const g=await grip.boundingBox(), grid=await p.locator('.col.active .col-body').boundingBox();
 await p.mouse.move(g.x+g.width/2,g.y+g.height/2); await p.mouse.down();
 await p.mouse.move(grid.x+grid.width/2,Math.min(800,Math.max(350,grid.y+60)),{steps:12}); await p.mouse.up();
 await p.locator('#be-label').waitFor(); await p.waitForTimeout(1000);
 const created=(await api.get(key)).value.columns.at(-1).blocks.at(-1); assert.equal(created.task.id,task.id);
 await seed([task]);
 const open=async()=>{await p.goto(s.url+'/day/'+date+'?block=linked-block');await p.locator('#be-label').waitFor();};
 await open(); assert.ok(await p.getByRole('link',{name:'Open task',exact:true}).isVisible());
 await p.getByRole('link',{name:'Open task',exact:true}).click();
 await p.locator('.tk-d-title').waitFor(); assert.equal(await p.locator('.tk-d-title').inputValue(),task.text);
 await p.getByText(/Planned:/).waitFor();
 await p.locator('.tk-d-title').fill('Renamed task'); await p.waitForTimeout(1000);
 await p.getByRole('link',{name:'Go to block',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('#be-label')?.value==='Renamed task');
 await seed([{...task,text:'Renamed task',done:true}]); await open(); assert.ok(await p.locator('dialog').getByText(/Completed/).isVisible());
 await seed([]); await open(); assert.ok(await p.locator('dialog').getByText('Task deleted',{exact:true}).isVisible());
 await seed([task]); await open(); assert.ok(await p.getByRole('link',{name:'Open task',exact:true}).isVisible());
 const {task:ref,taskLabel,...legacy}=block; await seed([task],legacy); await open(); assert.ok(await p.getByRole('link',{name:'Open task',exact:true}).isVisible());
 const settings=(await api.get('settings')).value;
 for(const lang of ['en','tr']) {
  await api.put('settings',{...settings,lang}); await seed([task]); await open();
  for(const width of [1440,390]) {await p.setViewportSize({width,height:1000}); for(const theme of ['light','dark']) {
   await p.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
   await p.screenshot({path:`${shots}/${lang}-${theme}-${width}.png`});
  }}
 }
 console.log('PASS task link navigation, rename, completion, removal, restoration, legacy fallback; eight screenshots');
} finally {await browser.close();s.stop();}
