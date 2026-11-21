import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const s=await startServer(),b=await launch();
const out='reports/overview-recent-weeks/after/recent';mkdirSync(out,{recursive:true});
try {
 const api=await demoAccount(client(s.url),{history:96});const settings=(await api.get('settings')).value;
 await api.put('settings',{...settings,schedule:[],metrics:settings.metrics.map(m=>m.id===(settings.focus?.metricId??'deep')?{...m,target:3}:m)});
 const ctx=await b.newContext({reducedMotion:'reduce'});await ctx.addInitScript(()=>{try{localStorage.setItem('sc-home-history','true')}catch{}}); /* these cards live in the History disclosure */ await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);const p=await ctx.newPage();
 const now=new Date();now.setHours(12,0,0,0);await p.clock.install({time:now});
 const date=i=>{const d=new Date(now);d.setDate(d.getDate()-i);return iso(d)};
 const base=(await api.get('day:'+date(0))).value;
 for(const state of ['empty','normal','over-goal','today-zero','single']) {
  const vals=Array.from({length:14},(_,i)=>state==='empty'?0:state==='single'?(i===0?75:0):i>=7?30:state==='over-goal'?240:state==='today-zero'&&i===0?0:60);
  for(let i=0;i<14;i++) await api.put('day:'+date(i),{...base,tasks:state==='empty'||state==='single'&&i!==0?[]:[{id:'done',text:'Completed task',done:true}],shutdown:{done:state!=='empty'&&state!=='single'&&i%2===0,at:null,steps:{}},focus:{active:null,sessions:vals[i]?[{id:'session',minutes:vals[i],kind:'deep',blockId:null,label:'',start:now.toISOString(),end:now.toISOString()}]:[]}});
  for(const [width,height] of [[1440,900],[1366,768],[1904,1015],[390,844]]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');const tile=p.locator('.b-recent');await tile.waitFor();await p.waitForTimeout(300);await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const expected = state === 'empty' ? [] : Array.from({length:7},(_,i)=>state==='today-zero'&&i===6||state==='single'&&i!==6?'':state==='single'?'1 h 15 m':state==='over-goal'?'4 h':'1 h');
   await p.waitForFunction(values => { const cells=[...document.querySelectorAll('.b-recent-value')]; return cells.length===values.length && cells.every((e,i)=>e.textContent?.replace(/\u00a0/g,' ').trim()===values[i]); },expected);
   assert.equal(await tile.locator('.b-recent-goal').count(),0);
   assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),'tile fits '+state+' '+width);
   assert.equal(await tile.locator('.b-bars a').count(),state==='empty'?0:7);
   if(state==='empty') assert.ok(await tile.locator('.b-recent-empty').isVisible());
   if(state!=='empty') assert.equal(await tile.locator('.b-bars a').first().getAttribute('href'),'/day/'+date(6));
   if(state!=='empty') {
    const bars=await tile.locator('.b-recent-track > i').evaluateAll(es=>es.map(e=>({height:e.getBoundingClientRect().height,track:e.parentElement.getBoundingClientRect().height,percent:parseFloat(e.style.height)})));
    if(width===390) assert.ok(await tile.locator('.b-recent-value').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().width<=e.parentElement.getBoundingClientRect().width+1)),'duration labels fit each day');
    assert.equal(Math.max(...bars.map(e=>e.percent)),100,'scale follows the busiest day');
    assert.ok(bars.every(e=>e.height<=e.track+1),'bars remain inside their tracks');
    assert.equal(await tile.locator('.b-bars small, .b-bars svg').count(),0,'tasks and checkmarks do not crowd the chart');
   }
   if(state==='normal'){assert.match(await tile.innerText(),/7 h/);assert.match(await tile.innerText(),/\+3 h 30/);}
   if(state==='today-zero') assert.match(await tile.locator('.b-bars a').last().getAttribute('aria-label'),/0/);
   await p.screenshot({path:`${out}/${state}-${width}-${theme}.png`,fullPage:true});
  }
  if(state!=='empty') { await p.locator('.b-recent .b-bars a').first().click();await p.waitForURL('**/day/'+date(6)); }
 }
 console.log('overview-recent: 40 screenshots, fit, totals, comparison and day navigation passed');
} finally {await b.close();await s.stop();}
