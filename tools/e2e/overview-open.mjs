import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s = await startServer(), b = await launch();
const dir = 'reports/shots/overview-open';
mkdirSync(dir, { recursive: true });
try {
 const api = await demoAccount(client(s.url), { lang: 'en' });
 const ctx = await b.newContext({ reducedMotion: 'reduce' });
 await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
 const p = await ctx.newPage();
 const time = new Date(); time.setHours(20,0,0,0);
 await p.clock.install({ time });
 const key = 'day:' + iso(time), original = (await api.get(key)).value;
 const settings = (await api.get('settings')).value;
 await api.put('settings', { ...settings, schedule: [], metrics: [{id:'measure',name:'Deep focus',kind:'number'}], features:{...settings.features,metrics:true,inbox:true} });
 for (const state of ['done','few','many','shutdown','inbox']) {
  const count = state === 'few' ? 3 : state === 'many' ? 12 : 0;
  await api.put(key, {...original, columns:[{id:'main',blocks:[]}], tasks:Array.from({length:count},(_,i)=>({id:'task'+i,text:'Review the next step '+i,done:false})),metrics:state==='few'?{}:{measure:0},shutdown:{done:state!=='shutdown',at:null,steps:{}}});
  await api.put('inbox',{items:state==='inbox'?[{id:'incoming',text:'Sort this task'}]:[]});
  for (const [width,height] of [[1440,900],[390,844]]) for (const theme of ['light','dark']) {
   await p.setViewportSize({width,height}); await p.goto(s.url+'/');
   const tile=p.locator('.b-open'); await tile.waitFor(); await p.waitForTimeout(300);
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),state+' fits '+width);
   assert.equal(await tile.locator('input.check').count(),Math.min(count,5));
   if(state==='done') assert.match(await tile.innerText(),/All done for today/);
   if(state==='shutdown') assert.equal(await tile.locator('.due').count(),1);
   if(state==='inbox') assert.match(await tile.innerText(),/Inbox: 1 to sort/);
   await p.screenshot({path:`${dir}/${state}-${width}-${theme}.png`,fullPage:true});
  }
  if(state==='few') {
   await p.locator('.b-open input.check').first().click();
   await p.getByRole('button',{name:'Undo',exact:true}).click();
   assert.equal(await p.locator('.b-open input.check').count(),3);
   await p.locator('.b-open .b-round-action').click(); await p.locator('dialog.quick-capture input').fill('Captured from overview'); await p.locator('dialog.quick-capture input').press('Enter');
   await p.clock.runFor(1500); await p.waitForTimeout(400);
   assert.ok((await api.get(key)).value.tasks.some(x=>x.text==='Captured from overview'));
   await p.locator('.b-open input.check').first().click(); await p.clock.runFor(1500); await p.waitForTimeout(400);
   assert.equal((await api.get(key)).value.tasks[0].done,true);
   await p.getByRole('button',{name:'Undo',exact:true}).click(); await p.clock.runFor(1500); await p.waitForTimeout(400);
   assert.equal((await api.get(key)).value.tasks[0].done,false);
  }
 }
 console.log('PASS Still open: five states, 20 screenshots, fit, completion, undo and capture');
} finally { await b.close(); s.stop(); }


