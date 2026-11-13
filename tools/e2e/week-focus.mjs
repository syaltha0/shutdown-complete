import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), api=await demoAccount(client(s.url),{lang:'en'}), b=await launch();
const c=await b.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
const p=await c.newPage(), shots='reports/shots/week-focus'; mkdirSync(shots,{recursive:true});
const check=(ok,label)=>{if(!ok)throw Error(label);console.log('PASS '+label);};
try {
 const base=(await api.get('day:2026-11-13')).value;
 for(let day=9;day<=15;day++) await api.put('day:2026-11-'+String(day).padStart(2,'0'),{...base,focus:{active:null,sessions:[]}});
 for(const [i,minutes] of [25,35,40].entries()) {
  const date=`2026-11-${String(9+i).padStart(2,'0')}`;
  await api.put('day:'+date,{...base,columns:base.columns.map((col)=>({...col,blocks:col.blocks.map((block,j)=>j===0?{...block,id:'new',label:'Writing'}:block)})),focus:{active:null,sessions:[{id:'w'+i,blockId:i===0?'old':i===1?'new':'other',label:i<2?'Writing':'Reading',kind:'deep',minutes,start:date+'T09:00:00Z',end:date+'T10:00:00Z',note:'Week note '+i,intent:'Week intent '+i}]}});
 }
 await p.goto(s.url+'/review/2026-W46');
 const panel=p.locator('.week-focus'); await panel.locator('.week-focus-blocks').waitFor();
 const header=await panel.locator('header').innerText();
 check(header.includes('1 h 40 m'),'total 100 minutes: '+header);
 const rows=panel.locator('.week-focus-blocks li');
 check(await rows.count()===2,'two blocks after revision');
 check((await rows.first().innerText()).includes('1 h'),'Writing 60 minutes');
 check((await rows.last().innerText()).includes('40 m'),'Reading 40 minutes');
 check((await panel.locator('.week-focus-days').innerText()).includes('35 m'),'daily total');
 const settings=(await api.get('settings')).value;
 for(const lang of ['en','tr']) {
  await api.put('settings',{...settings,lang}); await p.goto(s.url+'/review/2026-W46');
  await panel.locator('.week-focus-notes > summary').click();
  for(const summary of await panel.locator('.focus-log summary').all()) await summary.click();
  for(let i=0;i<3;i++) {
   check(await panel.getByText('Week note '+i,{exact:true}).isVisible(),'note '+i);
   check(await panel.getByText('Week intent '+i,{exact:false}).isVisible(),'intent '+i);
  }
  for(const width of [1440,390]) {
   await p.setViewportSize({width,height:1000});
   for(const theme of ['light','dark']) {
    await p.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    await panel.screenshot({path:`${shots}/${lang}-${theme}-${width}.png`});
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${lang} ${theme} ${width} fits`);
   }
  }
 }
 await p.goto(s.url+'/review/2025-W01');await panel.locator('.empty').waitFor();
 check(await panel.locator('.week-focus-blocks').count()===0,'empty week');
} finally {await b.close();s.stop();}

