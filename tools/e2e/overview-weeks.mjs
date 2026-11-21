import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const s=await startServer(),b=await launch();
mkdirSync('reports/overview-recent-weeks/after/weeks',{recursive:true});
try {
 const api=await demoAccount(client(s.url),{lang:'tr',today:new Date('2026-11-14T12:00:00')}),settings=(await api.get('settings')).value;
 await api.put('settings',{...settings,schedule:[],lang:'tr'});
 const context=await b.newContext({reducedMotion:'reduce'});await context.addInitScript(()=>{try{localStorage.setItem('sc-home-history','true')}catch{}}); // these cards live in the History disclosure
 await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await context.newPage();p.on('pageerror',e=>console.log('PAGEERROR',e.message));await p.clock.install({time:new Date('2026-11-14T12:00:00')});
 for(const state of ['empty','sparse','dense','single']) {
  const expected=new Map();
  for(let i=0;i<91;i++) {
   const d=new Date('2026-11-14T12:00:00');d.setDate(d.getDate()-i);const date=iso(d),key='day:'+date;
   const original=(await api.get(key))?.value??{tasks:[],shutdown:{done:false,at:null,steps:{}},columns:[{id:'a',blocks:[]}],activeColumn:'a',habits:{},metrics:{},notes:''};
   const n=state==='empty'?0:state==='single'?(i===0?75:0):state==='sparse'?(i%13===0?75:0):[0,29,30,59,60,119,120,180][i%8];expected.set(date,n);
   await api.put(key,{...original,...(state==='empty'||state==='single'?{tasks:[],shutdown:{done:false,at:null,steps:{}}}:{}),focus:{active:null,sessions:n?[{id:'test',kind:'deep',minutes:n,start:'2026-11-14T09:00:00',end:'2026-11-14T10:00:00',label:''}]:[]}});
  }
  for(const [width,height] of [[1440,900],[1366,768],[1904,1015],[390,844]]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');const tile=p.locator('.b-heat');await tile.waitFor();await p.waitForTimeout(600);
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   if(state==='empty') {
    assert.equal(await tile.locator('.b-heatmap, .b-heat-legend').count(),0,'no skeleton for a new account');
    assert.ok(await tile.locator('.b-heat-empty').isVisible(),'explain the empty history');
    assert.equal(await p.locator('.b-recent .b-bars').count(),0,'recent history is also empty');
    assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),'empty tile fits');
   } else {
   const cells=await tile.locator('.b-heatmap a').evaluateAll(es=>es.map(e=>({date:e.dataset.date,n:Number(e.dataset.minutes),cls:e.className,label:e.getAttribute('aria-label'),href:e.getAttribute('href')})));
   assert.equal(cells.length,84, state+' '+width);assert.equal(cells[0].date,'2026-08-24');assert.equal(cells[83].date,'2026-11-15');
   for(const c of cells){const n=expected.get(c.date)??0;assert.equal(c.n,n);assert.ok(c.cls.includes('heat-'+(n<=0?0:n<30?1:n<60?2:n<120?3:4)));assert.equal(c.href,'/day/'+c.date);assert.ok(c.label.includes(' · '));}
   assert.equal(await tile.locator('[aria-current="date"]').count(),1);assert.equal(await tile.locator('.b-heat-future').count(),1);
   assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),'tile fits '+state+width);
   assert.ok(await tile.locator('.b-heatmap').evaluate(e=>e.getBoundingClientRect().width/e.parentElement.getBoundingClientRect().width>.9));
   assert.equal(await tile.locator('.b-heat-days small').count(),7);
   const geometry=await tile.locator('.b-heatmap a').first().boundingBox();
   const column=await tile.locator('.b-heatmap').evaluate(e=>e.getBoundingClientRect().width/12);
   // phone: square cells beside the weekday letters; desktop: each day fills its week column as one even strip
   if(width<861) assert.ok(Math.abs(geometry.width-geometry.height)<2,'square cells');
   else assert.ok(geometry.width>=column-6&&geometry.height>=4,'cells fill their week column');
   assert.ok(await tile.locator('.b-heat-legend').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=11),'readable legend');
   const alignment=await tile.evaluate(e=>{
    const labels=[...e.querySelectorAll('.b-heat-months > span')];
    const cells=[...e.querySelectorAll('.b-heatmap > a')];
    return labels.every((label,w)=>{const l=label.getBoundingClientRect(),c=cells[w*7].getBoundingClientRect();return Math.abs(l.x+l.width/2-c.x-c.width/2)<1;});
   });
   assert.ok(alignment,'months align with their week columns');
   }
   await tile.scrollIntoViewIfNeeded();await p.screenshot({path:`reports/overview-recent-weeks/after/weeks/${state}-${width}-${theme}.png`,fullPage:true});
  }
 }
 const href=await p.locator('.b-heatmap a').first().getAttribute('href');await p.locator('.b-heatmap a').first().click();await p.waitForURL('**'+href);
 await p.goto(s.url+'/');await p.locator('.b-heat .b-act').click();await p.waitForURL('**/year/2026');
 console.log('PASS Weeks: 32 screenshots, real session values, thresholds, dates, fit and navigation');
} finally {await b.close();s.stop();}




