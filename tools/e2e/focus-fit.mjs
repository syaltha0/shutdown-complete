import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const out='reports/shots/focus-fit'; mkdirSync(out,{recursive:true});
const server=await startServer(), browser=await launch(), results=[];
let completed=false;
try {
 const api=await demoAccount(client(server.url),{lang:'en'});
 const guest=await demoAccount(client(server.url),{lang:'en',email:'fit-guest@example.test'});
 const key='day:'+iso(new Date()), base=(await api.get(key)).value;
 const settings=(await api.get('settings')).value;
 for(const [width,height] of [[2560,1329],[1904,1015],[1920,937],[1440,789],[1366,657]]) {
 if(process.env.FOCUS_FIT_WIDTH && width!==Number(process.env.FOCUS_FIT_WIDTH))continue;
 const context=await browser.newContext({viewport:{width,height},colorScheme:'dark',reducedMotion:'reduce'});
 await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:server.url}]);
 const page=await context.newPage();
 for(const count of [0,2,6,12]) for(const state of ['idle','running','paused','settings']) for(const friends of [false,true,'incoming']) for(const blocks of [false,true]) {
 if(friends==='incoming'&&(count!==6||state!=='idle'||!blocks))continue;
 if(friends==='incoming')await guest.call('/api/friends',{email:'robin@hale.test'});
 const day=structuredClone(base);
 if(!blocks)day.columns.forEach(c=>c.blocks=[]);
 day.focus={...day.focus,sessions:Array.from({length:count},(_,i)=>({id:'fit'+i,blockId:blocks?day.columns[0].blocks[0]?.id:null,label:'Focus',minutes:25,start:new Date(Date.now()-3600000-i*1800000).toISOString(),end:new Date(Date.now()-2100000-i*1800000).toISOString(),note:i%2?'A note with space below the text.':''})),active:state==='idle'||state==='settings'?null:{blockId:null,label:'',phase:'focus',plannedMin:25,startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+1500000).toISOString(),pausedLeft:state==='paused'?1500:null}};
 await api.put(key,day); await api.put('settings',{...settings,features:{...settings.features,friends:!!friends}});
 await page.goto(server.url+'/focus',{waitUntil:'domcontentloaded'}); await page.locator('.focus-stage').waitFor(); await page.evaluate(()=>document.fonts.ready);
 if(state==='settings')await page.locator('.focus-config-anchor > button').click();
 for(const theme of ['light','dark']) {
 await page.evaluate(t=>{document.documentElement.dataset.theme=t;window.dispatchEvent(new Event('themechange'));},theme); await page.waitForTimeout(40);
 const m=await page.evaluate(()=>{
 const rect=s=>document.querySelector(s).getBoundingClientRect();
 const chartElement=document.querySelector('.focus-history .chart');
 const token=getComputedStyle(chartElement).getPropertyValue('--chart-1').trim();
 const chartTheme=[...chartElement.querySelectorAll('.chart-bar')].every(e=>e.getAttribute('fill')===token);
 const l=rect('.focus-left'),r=rect('.focus-grid > .stack'),chart=rect('.focus-history .chart');
 const list=document.querySelector('.session-scroll');
 const total=document.querySelector('.sessions .total'), timer=document.querySelector('.focus-secondary');
 const inside=(!total||total.getBoundingClientRect().bottom<=rect('.focus-sessions').bottom+1)&&(!timer||timer.getBoundingClientRect().bottom<=rect('.focus-panel').bottom+1);
 const rows=list?[...list.children].map(e=>e.getBoundingClientRect()):[];
 const visible=list?rows.filter(r=>r.bottom<=list.getBoundingClientRect().bottom+1).length:0;
 return {chartTheme,inside,pageScroll:Math.max(0,document.documentElement.scrollHeight-innerHeight),difference:Math.abs(l.bottom-r.bottom),chartHeight:chart.height,visible,tabCorrect:!list||list.tabIndex===(list.scrollHeight>list.clientHeight?0:-1),partial:!!list&&rows.some(r=>r.top<list.getBoundingClientRect().bottom-1&&r.bottom>list.getBoundingClientRect().bottom+1)};
 });
 const required=height>700||(count===0&&state!=='settings'&&!friends&&!blocks);
 const pass=(!required||(m.pageScroll===0&&m.difference<=1&&m.inside))&&m.chartHeight>=120&&m.chartHeight<=240&&m.inside&&m.chartTheme&&m.tabCorrect&&!m.partial&&(count===0||m.visible>=Math.min(2,count));
 results.push({width,height,count,state,friends,blocks,theme,required,pass,...m});
 if([1904,1440].includes(width)&&[0,6].includes(count)&&['idle','running'].includes(state)&&friends&&blocks)await page.screenshot({path:`${out}/${width}-${state}-${count}-${theme}${friends==='incoming'?'-incoming':''}.png`});
 }
 if(friends==='incoming'){const social=(await api.call('/api/friends')).body; const request=social.incoming[0]; if(!request)throw Error('Incoming request fixture missing'); await api.call('/api/friends/'+request.id,null,'DELETE');}
 }
 await context.close();
 console.log(`Measured ${width}x${height}`);
 }
 completed=true;
} finally {
 writeFileSync(`${out}/measurements.json`,JSON.stringify(results,null,2));
 const failures=results.filter(r=>!r.pass);
 if(!completed)process.exitCode=1;
 writeFileSync('reports/2026-11-13-focus-fit.md',`# Focus fit\n\n${results.length} cases, ${failures.length} failures. Completed: ${completed}. Short windows permit natural flow except the basic idle/running cases at 657px. Actual scroll is recorded for every combination.\n\n|Viewport|State|Sessions|Friends|Blocks|Theme|Scroll|Bottom difference|Inside cards|Full rows|Partial row|Chart theme|Result|\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`+results.map(r=>`|${r.width}×${r.height}|${r.state}|${r.count}|${r.friends}|${r.blocks}|${r.theme}|${r.pageScroll}|${r.difference}|${r.inside}|${r.visible}|${r.partial}|${r.chartTheme}|${r.pass?'PASS':'FAIL'}|`).join('\n'));
 console.log(`${failures.length||!completed?'FAIL':'PASS'} ${results.length} cases; ${failures.length} failures`);
 if(failures.length)process.exitCode=1;
 await browser.close();server.stop();
}
