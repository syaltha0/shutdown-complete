import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount} from '../lib/demo.mjs';
const s=await startServer(),b=await launch();
mkdirSync('reports/shots/overview-ahead',{recursive:true});
try {
 const api=await demoAccount(client(s.url)), settings=(await api.get('settings')).value;
 const context=await b.newContext({reducedMotion:'reduce'});
 await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await context.newPage();
 await p.clock.install({time:new Date('2026-11-14T12:00:00')});
 for(const state of ['empty','few','many','boundary']) {
  const date=state==='boundary'?'2026-11-28':'2026-11-14';
  await p.clock.setFixedTime(new Date(date+'T12:00:00'));
  const dates=state==='empty'?[]:Array.from({length:state==='many'?7:2},(_,i)=>({id:'date'+i,date:state==='boundary'?`2026-12-${String(i+1).padStart(2,'0')}`:`2026-11-${14+i}`,text:'Milestone '+i}));
  await api.put('month:2026-11',{goals:[],notes:'',dates:dates.filter(x=>x.date.startsWith('2026-11'))});
  await api.put('month:2026-12',{goals:[],notes:'',dates:dates.filter(x=>x.date.startsWith('2026-12'))});
  await api.put('settings',{...settings,schedule:[],exams:[],countdowns:state==='many'?[{id:'launch',name:'Launch',date:'2026-11-16',repeat:'none'}]:[]});
  for(const [width,height] of [[1440,900],[1904,1015],[390,844]]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');const tile=p.locator('.b-ahead');await tile.waitFor();await p.waitForTimeout(500);
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.equal(await tile.locator('.b-calendar>a').count(),14);
   assert.ok(await tile.evaluate(e=>e.scrollHeight<=e.clientHeight+1&&e.scrollWidth<=e.clientWidth+1),'fits '+state+' '+width);
   assert.equal(await tile.locator('.b-events>a').count(),state==='empty'?0:state==='many'?4:2);
   if(state==='few') assert.match(await tile.locator('.b-events').innerText(),/Milestone 0/);
   if(state==='few') assert.match(await tile.locator('.b-events').innerText(),/tomorrow/);
   await p.screenshot({path:`reports/shots/overview-ahead/${state}-${width}-${theme}.png`,fullPage:true});
  }
  const href=await p.locator('.b-calendar>a').first().getAttribute('href');await p.locator('.b-calendar>a').first().click();await p.waitForURL('**'+href);
 }
 for (const enabled of [true,false]) {
  await api.put('settings',{...settings,features:{...settings.features,exams:enabled},exams:[{id:'qa-exam',name:'QA visibility exam',date:'2026-11-29',subject:'QA',topics:[],daily:30,session:30,days:[0],from:540,to:1020,review:0}]});
  await p.goto(s.url+'/');await p.locator('.b-ahead').waitFor();
  assert.equal(await p.locator('.b-ahead').getByText('QA visibility exam',{exact:true}).count(),enabled?1:0);
  await p.goto(s.url+'/countdown');await p.locator('h1').waitFor();
  assert.equal(await p.getByText('QA visibility exam',{exact:true}).count(),enabled?1:0);
 }
 console.log('PASS Ahead: 24 screenshots, four datasets, responsive fit and day routes');
} finally {await b.close();s.stop();}
