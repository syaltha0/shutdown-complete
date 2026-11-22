import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const out = 'reports/shots/focus-responsive';
mkdirSync(out, { recursive: true });
const sizes = [[320,740],[360,800],[390,844],[414,896],[667,375],[844,390],[768,1024],[1024,768],[820,1180],[1180,820],[1024,1366],[1366,1024],[1280,720],[1366,768],[1440,900],[1920,1080],[2560,1440],[1093,520],[720,450]];
const s = await startServer(), b = await launch(), results = [];
try {
 for (const lang of ['tr','en']) {
  const api = await demoAccount(client(s.url), { lang });
  for (const [width,height] of sizes) {
   const c = await b.newContext({viewport:{width,height}, hasTouch:width<=1180, isMobile:width<860, reducedMotion:'reduce'});
   await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
   const p = await c.newPage();
   // Windows Chrome keeps (pointer: fine) even with hasTouch; touch emulation makes the 44px target check run everywhere, not only on Linux CI
   if(width<=1180) await (await c.newCDPSession(p)).send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
   p.on('pageerror', error => console.error('pageerror', lang, width, height, error.stack));
   for (const state of ['idle','running','settings','room']) {
    const key='day:'+iso(new Date()), d=(await api.get(key)).value;
    d.focus={...d.focus,active: state==='idle'?null:{blockId:null,label:'',phase:'focus',plannedMin:25,startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+1500000).toISOString(),pausedLeft:null}};
    await api.put(key,d); await p.goto(s.url+'/focus'); await p.locator('.focus-stage').waitFor(); await p.evaluate(()=>document.fonts.ready);
    if(state==='settings') await p.locator('.focus-config-anchor > button').click();
    if(state==='room') await p.locator('.focus-room-btn').click();
    for (const theme of ['light','dark']) {
     await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.dataset.motion='reduce'},theme);
     await p.waitForTimeout(80);
     // measure settled boxes: a popover or panel still scaling in reads small on a slow runner
     await p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))));
     const m=await p.evaluate(()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const panels=[...document.querySelectorAll('.focus-grid .panel')].map(rect);
      const overlaps=[];
      for(let i=0;i<panels.length;i++)for(let j=i+1;j<panels.length;j++){const a=panels[i],b=panels[j];if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1)overlaps.push([i,j]);}
      const timer=rect(document.querySelector('.focus-panel')),chart=rect(document.querySelector('[aria-labelledby="f4-h"]')),right=rect(document.querySelector('.focus-grid > .span-5').lastElementChild);
      const room=document.querySelector('.focus-room');
      const scope=room||document.querySelector('.focus-grid');
      const smallTargets=matchMedia('(pointer: coarse)').matches?[...scope.querySelectorAll('button')].filter(e=>!e.closest('[inert]')&&e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9}).map(e=>e.textContent.trim()):[];
      return {smallTargets,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),overlaps, leftHeight:chart.bottom-timer.y,rightHeight:right.height,columnDifference:Math.abs(chart.bottom-right.bottom),chartBelow:chart.y>=timer.bottom-1,roomOverflow:room?Math.max(0,room.scrollWidth-room.clientWidth):0};
     });
     const pass=m.overflow===0&&m.overlaps.length===0&&m.roomOverflow===0&&m.chartBelow&&m.smallTargets.length===0;
     results.push({lang,width,height,state,theme,pass,...m});
     await p.screenshot({path:`${out}/${lang}-${width}x${height}-${state}-${theme}.png`,fullPage:state!=='room'});
    }
   }
   await c.close();
  }
 }
 const failures=results.filter(r=>!r.pass);
 console.log(`${failures.length?'FAIL':'PASS'} ${results.length} cases; ${failures.length} failures`);
 for(const f of failures)console.log('FAILED CASE '+JSON.stringify(f));
 if(failures.length)process.exitCode=1;
} finally {writeFileSync(`${out}/measurements.json`,JSON.stringify(results,null,2));await b.close();s.stop();}
