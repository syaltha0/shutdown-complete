import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const s=await startServer(),b=await launch();
const out='reports/shots/overview-recent';mkdirSync(out,{recursive:true});
try {
 const api=await demoAccount(client(s.url));const settings=(await api.get('settings')).value;
 await api.put('settings',{...settings,schedule:[],metrics:settings.metrics.map(m=>m.id===(settings.focus?.metricId??'deep')?{...m,target:3}:m)});
 const ctx=await b.newContext({reducedMotion:'reduce'});await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);const p=await ctx.newPage();
 const now=new Date();now.setHours(12,0,0,0);await p.clock.install({time:now});
 const date=i=>{const d=new Date(now);d.setDate(d.getDate()-i);return iso(d)};
 const base=(await api.get('day:'+date(0))).value;
 for(const state of ['empty','normal','over-goal','today-zero']) {
  const vals=Array.from({length:14},(_,i)=>state==='empty'?0:i>=7?30:state==='over-goal'?240:state==='today-zero'&&i===0?0:60);
  for(let i=0;i<14;i++) await api.put('day:'+date(i),{...base,tasks:state==='empty'?[]:[{id:'done',text:'Completed task',done:true}],shutdown:{done:state!=='empty'&&i%2===0,at:null,steps:{}},focus:{active:null,sessions:vals[i]?[{id:'session',minutes:vals[i],kind:'deep',blockId:null,label:'',start:now.toISOString(),end:now.toISOString()}]:[]}});
  for(const [width,height] of [[1440,900],[1904,1015],[390,844]]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');const tile=p.locator('.b-recent');await tile.waitFor();await p.waitForTimeout(300);await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),'tile fits '+state+' '+width);
   assert.equal(await tile.locator('.b-bars a').count(),7);
   assert.equal(await tile.locator('.b-bars a').first().getAttribute('href'),'/day/'+date(6));
   if(state==='normal'){assert.match(await tile.innerText(),/7 h/);assert.match(await tile.innerText(),/\+3 h 30/);}
   if(state==='today-zero') assert.match(await tile.locator('.b-bars a').last().getAttribute('aria-label'),/0/);
   await p.screenshot({path:`${out}/${state}-${width}-${theme}.png`,fullPage:true});
  }
  await p.locator('.b-recent .b-bars a').first().click();await p.waitForURL('**/day/'+date(6));
 }
 console.log('overview-recent: 24 screenshots, fit, totals, comparison and day navigation passed');
} finally {await b.close();await s.stop();}
