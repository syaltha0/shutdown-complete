import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const s=await startServer(),b=await launch();
mkdirSync('reports/shots/overview-weeks',{recursive:true});
try {
 const api=await demoAccount(client(s.url),{lang:'tr',today:new Date('2026-11-14T12:00:00')}),settings=(await api.get('settings')).value;
 await api.put('settings',{...settings,schedule:[],lang:'tr'});
 const context=await b.newContext({reducedMotion:'reduce'});
 await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await context.newPage();p.on('pageerror',e=>console.log('PAGEERROR',e.message));await p.clock.install({time:new Date('2026-11-14T12:00:00')});
 for(const state of ['empty','sparse','dense']) {
  const expected=new Map();
  for(let i=0;i<91;i++) {
   const d=new Date('2026-11-14T12:00:00');d.setDate(d.getDate()-i);const date=iso(d),key='day:'+date;
   const original=(await api.get(key))?.value??{tasks:[],shutdown:{done:false,at:null,steps:{}},columns:[{id:'a',blocks:[]}],activeColumn:'a',habits:{},metrics:{},notes:''};
   const n=state==='empty'?0:state==='sparse'?(i%13===0?75:0):[0,29,30,59,60,119,120,180][i%8];expected.set(date,n);
   await api.put(key,{...original,focus:{active:null,sessions:n?[{id:'test',kind:'deep',minutes:n,start:'2026-11-14T09:00:00',end:'2026-11-14T10:00:00',label:''}]:[]}});
  }
  for(const [width,height] of [[1440,900],[1904,1015],[390,844]]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');const tile=p.locator('.b-heat');await tile.waitFor();await p.waitForTimeout(600);
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const cells=await tile.locator('.b-heatmap a').evaluateAll(es=>es.map(e=>({date:e.dataset.date,n:Number(e.dataset.minutes),cls:e.className,label:e.getAttribute('aria-label'),href:e.getAttribute('href')})));
   assert.equal(cells.length,84, state+' '+width);assert.equal(cells[0].date,'2026-08-24');assert.equal(cells[83].date,'2026-11-15');
   for(const c of cells){const n=expected.get(c.date)??0;assert.equal(c.n,n);assert.ok(c.cls.includes('heat-'+(n<=0?0:n<30?1:n<60?2:n<120?3:4)));assert.equal(c.href,'/day/'+c.date);assert.ok(c.label.includes(' · '));}
   assert.equal(await tile.locator('[aria-current="date"]').count(),1);assert.equal(await tile.locator('.b-heat-future').count(),1);
   assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),'tile fits '+state+width);
   assert.ok(await tile.locator('.b-heatmap').evaluate(e=>e.getBoundingClientRect().width/e.parentElement.getBoundingClientRect().width>.9));
   await tile.scrollIntoViewIfNeeded();await p.screenshot({path:`reports/shots/overview-weeks/${state}-${width}-${theme}.png`,fullPage:true});
  }
 }
 const href=await p.locator('.b-heatmap a').first().getAttribute('href');await p.locator('.b-heatmap a').first().click();await p.waitForURL('**'+href);
 await p.goto(s.url+'/');await p.locator('.b-heat .b-act').click();await p.waitForURL('**/year/2026');
 console.log('PASS Weeks: 18 screenshots, real session values, thresholds, dates, fit and navigation');
} finally {await b.close();s.stop();}




