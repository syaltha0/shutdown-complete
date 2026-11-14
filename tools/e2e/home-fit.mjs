import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
mkdirSync('reports/shots/home-v6',{recursive:true});
try {
 const api=await demoAccount(client(s.url));
 const context=await b.newContext({reducedMotion:'reduce'});
 await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await context.newPage();
 const settings=(await api.get('settings')).value;
 // Hello's five day states use a fixed local noon, independent of test run time.
 const {iso}=await import('../lib/demo.mjs');
 const noon=new Date();noon.setHours(12,0,0,0);
 await p.clock.install({time:noon});
 const key='day:'+iso(noon), original=(await api.get(key)).value;
 await api.put('settings',{...settings,schedule:[]});
 mkdirSync('reports/shots/overview-hello',{recursive:true});
 const block=(id,start,end,label)=>({id,start,end,label,note:'',kind:'deep'});
 for(const state of ['active','before','ended','closed','empty']) {
  const blocks=state==='empty'?[]:state==='active'?[block('now',690,780,'Writing the next chapter'),block('next',810,840,'Shutdown ritual')]:state==='before'?[block('first',810,870,'Writing')]:[block('done',540,600,'Writing')];
  await api.put(key,{...original,columns:[{id:'hello',blocks}],activeColumn:'hello',focus:{sessions:[],active:null},shutdown:{done:state==='closed',at:state==='closed'?new Date(noon.getTime()-60000).toISOString():null,steps:{}}});
  for(const [width,height] of [[1440,900],[390,844]]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');await p.locator('.b-hello').waitFor();await p.waitForTimeout(250);
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const tile=p.locator('.b-hello');
   assert.ok(await tile.evaluate(e=>e.scrollHeight<=e.clientHeight+1 && e.scrollWidth<=e.clientWidth+1),'Hello fits: '+state+' '+width);
   assert.equal(await tile.locator('[role=progressbar]').count(),state==='active'?1:0);
   await p.screenshot({path:'reports/shots/overview-hello/'+state+'-'+width+'-'+theme+'.png',fullPage:true});
  }
  if(state==='active') {
   await p.locator('.b-hello button.b-act.main').click();await p.waitForURL('**/focus');
   await p.clock.runFor(1500);await p.waitForTimeout(300);
   const running=(await api.get(key)).value.focus.active;
   assert.equal(running.blockId,'now');assert.equal(running.pausedLeft,null);assert.ok(running.startedAt);
  }
  if(state==='ended') {await p.locator('.b-hello a.b-act.main').click();await p.waitForURL('**/shutdown/'+iso(noon));}
  if(state==='before'||state==='empty') {await p.locator('.b-hello a.b-act.main').click();await p.waitForURL('**/day/'+iso(noon));}
 }
 await api.put(key,original);await api.put('settings',settings);
 await p.clock.resume();
 console.log('PASS Hello: five states, 20 screenshots, focus timer and action routes');
 for(const empty of [false,true]) {
  if(empty) {
   // Clear known demo keys through the same API used to seed the account.
   const date=new Date();
   const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
   for(let i=-90;i<=14;i++){const d=new Date(date);d.setDate(d.getDate()+i);await api.put(`day:${iso(d)}`,{columns:[{id:'empty',blocks:[]}],tasks:[],notes:'',metrics:{},shutdown:{done:false,at:null,steps:{}}});}
   const today=iso(date);const {weekOf}=await import('../lib/demo.mjs');
   await api.put(`week:${weekOf(today)}`,{items:[],notes:''});
   for(let i=0;i<2;i++){const d=new Date(date.getFullYear(),date.getMonth()+i,1);await api.put(`month:${iso(d).slice(0,7)}`,{goals:[],dates:[],notes:''});}
   await api.put('settings',{...settings,schedule:[],countdowns:[]});
  }
  for(const disabled of [[],['inbox'],['habits'],['metrics'],['countdown'],['inbox','habits','metrics','countdown']]) {
   if(empty && disabled.length)continue;
   await api.put('settings',{...settings,...(empty?{schedule:[],countdowns:[]}:{}),features:{...settings.features,...Object.fromEntries(disabled.map(x=>[x,false]))}});
   for(const [width,height] of [[1904,1015],[1440,900],[1366,768],[1280,800],[390,844]]) {
    await p.setViewportSize({width,height});await p.goto(s.url+'/');await p.locator('.overview').waitFor();await p.waitForTimeout(350);
    assert.equal(await p.locator('.overview h2').count(),disabled.includes('habits')?9:10);
    const fit=await p.evaluate(()=>{const root=document.documentElement,grid=document.querySelector('.overview'),r=grid.getBoundingClientRect();return {scroll:root.scrollHeight-innerHeight,horizontal:root.scrollWidth-innerWidth,bottom:r.bottom,overflow:[...grid.querySelectorAll('.panel')].filter(e=>e.scrollHeight>e.clientHeight+1).map(e=>({name:e.className,h:e.clientHeight,scroll:e.scrollHeight})),rings:[...grid.querySelectorAll('.b-ring')].map(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width-r.height)}),strip:grid.querySelector('.b-track').getBoundingClientRect().height};});
    assert.ok(fit.horizontal<=0,JSON.stringify(fit));
    assert.ok(fit.strip<=40,'Timeline stays at most 40px on every viewport');
    assert.equal(await p.locator('.b-calendar>small').count(),7,'One weekday header');
    assert.equal(await p.locator('.b-calendar>a').count(),14,'Two complete weeks');
    assert.equal(await p.locator('.b-calendar>a').first().evaluate(e=>new Date(e.getAttribute('href').split('/').pop()+'T12:00:00').getDay()),1,'Calendar starts on Monday');
    assert.ok(await p.locator('.b-truncate').evaluate(e=>e.clientHeight>=16),'Next task stays visible');
    if(width>860){assert.ok(fit.scroll<=1,JSON.stringify({width,height,...fit}));assert.ok(fit.overflow.length===0,JSON.stringify({width,height,...fit}));assert.ok(fit.rings.every(n=>n<=2));assert.ok(fit.strip<=40);assert.ok(Math.abs(fit.bottom-(height-32))<=1,JSON.stringify({width,height,...fit}));}
    if(!disabled.length && [1904,1440,390].includes(width))for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.waitForTimeout(600);await p.screenshot({path:`reports/shots/home-v6/${empty?'empty':'full'}-${width}-${height}-${theme}.png`,fullPage:true});}
   }
  }
 }
 const {iso}=await import('../lib/demo.mjs');
 const date=iso(new Date()), base=(await api.get('day:'+date)).value;
 const block=(id,start,end,kind)=>({id,start,end,kind,label:`Timeline ${id}`,note:''});
 const full=[block('deep',540,660,'deep'),block('shallow',690,750,'shallow'),block('meeting',780,840,'meeting'),block('overflow',870,930,'overflow'),block('personal',960,1020,'personal')];
 mkdirSync('reports/shots/overview-timeline',{recursive:true});
 await api.put('settings',{...settings,schedule:[]});
 for(const [name,columns] of [
  ['full',[{from:null,closedAt:null,blocks:full}]],
  ['revision',[{from:null,closedAt:700,blocks:[block('obsolete',540,660,'deep')]},{from:700,closedAt:null,blocks:full.slice(2)}]],
  ['overnight',[{from:null,closedAt:null,blocks:[block('night-a',1450,1480,'deep'),block('night-b',1500,1530,'personal')]}]],
  ['empty',[{from:null,closedAt:null,blocks:[]}]],
 ]) {
  await api.put('day:'+date,{...base,columns,focus:{active:null,sessions:[]}});
  for(const [width,height] of [[1904,1015],[1440,900],[390,844]]) {
   await p.setViewportSize({width,height});await p.goto(s.url+'/');await p.locator('.b-track').waitFor();await p.evaluate(()=>document.fonts.ready);
   const links=p.locator('.b-timeline-block');
   assert.equal(await links.count(),columns.at(-1).blocks.length,'Only active revision blocks');
   assert.ok(await p.locator('.b-track').evaluate(e=>e.getBoundingClientRect().height<=40));
   const ticks=await p.locator('.b-ticks span').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}}));
   for(let i=1;i<ticks.length;i++)assert.ok(ticks[i-1].right<=ticks[i].left,'Timeline ticks do not overlap');
   if(await links.count()) {
    await links.first().focus();
    assert.match(await links.first().getAttribute('aria-label'),/Timeline.*[0-9]{2}:[0-9]{2}.*0/);
    assert.ok(await links.first().locator('.b-timeline-tip').isVisible(),'Keyboard reveals block details');
    if(await links.count()>1){await p.keyboard.press('Tab');assert.ok(await links.nth(1).evaluate(e=>e===document.activeElement));}
    await links.first().click();await p.waitForURL('**/day/'+date);await p.goto(s.url+'/');await p.locator('.b-track').waitFor();
   } else assert.ok(await p.locator('.b-empty-plan').isVisible());
   for(const theme of ['light','dark']) {
    await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.waitForTimeout(100);
    await p.screenshot({path:`reports/shots/overview-timeline/${name}-${width}-${height}-${theme}.png`,fullPage:true});
   }
  }
 }
 console.log('PASS timeline: active revision, empty CTA, keyboard tooltip, navigation, tick geometry, 24 screenshots');
 console.log('PASS home-fit: bento tiles, desktop geometry, feature toggles, empty account, 12 screenshots');
} finally {await b.close();await s.stop();}
