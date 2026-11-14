import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
mkdirSync('reports/shots/overview-habits',{recursive:true});
try {
 const api=await demoAccount(client(s.url)), settings=(await api.get('settings')).value;
 const context=await b.newContext({reducedMotion:'reduce'});
 await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await context.newPage(); const noon=new Date();noon.setHours(12,0,0,0);await p.clock.install({time:noon});
 const dates=Array.from({length:7},(_,i)=>{const d=new Date(noon);d.setDate(d.getDate()-6+i);return iso(d);});
 const base=(await api.get('day:'+dates[6])).value;
 for(const state of ['empty','partial','complete','six']) {
  const count=state==='empty'?0:state==='six'?6:3;
  const metrics=Array.from({length:count},(_,i)=>({id:'habit-'+i,name:i===5?'A very long habit name that must fit gracefully':'Habit '+(i+1),kind:'check',unit:'',target:null}));
  await api.put('settings',{...settings,schedule:[],metrics,features:{...settings.features,habits:true}});
  for(let i=0;i<7;i++) await api.put('day:'+dates[i],{...base,metrics:Object.fromEntries(metrics.map((m,n)=>[m.id,i===6?state==='complete'||n===0:i%2===0]))});
  for(const [width,height] of [[1440,900],[390,844]]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');const tile=p.locator('.b-habits');await tile.waitFor();await p.waitForTimeout(350);
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.equal(await tile.locator('button').count(),count);
   assert.equal(await tile.locator('.b-habits-complete').count(),state==='complete'?1:0);
   if(count===6){await tile.locator('button').last().scrollIntoViewIfNeeded();assert.ok(await tile.locator('button').last().isVisible());await tile.locator('.b-habit-list').evaluate(e=>e.scrollTop=0);}
   assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),'tile fits '+state+width);
   if(count){const dots=tile.locator('.b-habit-row').first().locator('.b-habit-week > span');assert.equal(await dots.count(),7);for(let i=0;i<7;i++)assert.equal(await dots.nth(i).getAttribute('data-done'),String(i===6||i%2===0));}
   await p.screenshot({path:`reports/shots/overview-habits/${state}-${width}-${theme}.png`,fullPage:true});
  }
  if(count){const button=p.locator('.b-habits button').first();await button.click();await p.waitForTimeout(700);assert.equal((await api.get('day:'+dates[6])).value.metrics['habit-0'],false);await button.click();await p.waitForTimeout(700);assert.equal((await api.get('day:'+dates[6])).value.metrics['habit-0'],true);await p.reload();await p.locator('.b-habits button[aria-pressed=true]').first().waitFor();}
  await p.locator('.b-habits .b-act').click();await p.waitForURL('**/habits');
 }
 console.log('PASS habits: 16 screenshots, fit, real seven-day history, persisted toggle both ways, habits route');
} finally {await b.close();await s.stop();}

