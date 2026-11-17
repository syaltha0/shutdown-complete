import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
mkdirSync('reports/habits-v2',{recursive:true});
try {
 const api=await demoAccount(client(s.url),{history:90}),settings=(await api.get('settings')).value;
 const ctx=await b.newContext({reducedMotion:'reduce'});
 await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await ctx.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const now=new Date();now.setHours(12,0,0,0);await p.clock.install({time:now});
 const dates=Array.from({length:90},(_,i)=>{const d=new Date(now);d.setDate(d.getDate()-89+i);return iso(d);});
 const base=(await api.get('day:'+dates.at(-1))).value;
 for (const [state,count] of [['empty',0],['one',1],['six',6],['full',6]]) {
  const metrics=Array.from({length:count},(_,i)=>({id:'visual-'+i,name:['Read 20 pages','Go for a walk','Practice the piano','Stretch for 5 minutes','Write a journal entry','An evening without screens and a very long habit name'][i],kind:'check',unit:'',target:null,...(i===1?{frequency:{mode:'weekly',count:3}}:i===2?{frequency:{mode:'days',days:[0,2,4]}}:{})}));
  await api.put('settings',{...settings,metrics,features:{...settings.features,habits:true}});
  for(let i=0;i<90;i++)await api.put('day:'+dates[i],{...base,metrics:Object.fromEntries(metrics.map((m,n)=>[m.id,state==='full'||(i+n)%5<3])),skippedHabits:state==='full'?[]:metrics.filter((_,n)=>(i+n)%5===3).map(m=>m.id)});
  for(const [width,height,theme] of [[1440,900,'light'],[1440,900,'dark'],[1904,1015,'light'],[390,844,'light']]) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/habits');await p.locator('.hv-ledger[aria-busy=false]').waitFor();
   await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(350);await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.waitForTimeout(350);
   const fits=()=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
   assert.ok(await fits(),state+' page overflow '+width);
   assert.equal(await p.locator('.hv-habit').count(),count);
   for(const cell of await p.locator('.hcell:visible').all()) {const r=await cell.boundingBox();assert.ok(r.width>=32&&r.height>=32,'touch cell '+JSON.stringify(r));}
   await p.screenshot({path:`reports/habits-v2/${state}-${width}-${theme}.png`,fullPage:true});
   if(count) {
    await p.locator('.hv-name').first().click();await p.locator('.hv-map-cell').first().waitFor();
    assert.equal(await p.locator('.hv-map-grid .hv-map-cell').count(),364);
    assert.equal(await p.locator('.hv-stats > div').count(),4);
    assert.ok(await fits(),'detail overflow '+width);
    await p.screenshot({path:`reports/habits-v2/${state}-detail-${width}-${theme}.png`,fullPage:true});
    await p.locator('.hv-name').first().click();
   } else {
    await p.locator('.hv-suggestions button').first().click();await p.locator('.hv-habit').waitFor();
    assert.equal(await p.locator('.hname').first().innerText(),'Read 20 pages');
    await p.waitForTimeout(600);await api.put('settings',{...settings,metrics:[]});
   }
  }
 }
 assert.deepEqual(errors,[]);await ctx.close();
 console.log('PASS habits visual: 21 screenshots, 364 heatmap positions, empty suggestions, four statistics, 32px touch cells, phone overflow and console');
}finally{await b.close();await s.stop();}
