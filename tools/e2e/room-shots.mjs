import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const s=await startServer(); const b=await launch();
const out='reports/shots/focus-room'; mkdirSync(out,{recursive:true});
try { for(const lang of ['en','tr']) {
const api=await demoAccount(client(s.url),{lang}); const c=await b.newContext({reducedMotion:'reduce'}); await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]); const p=await c.newPage();
for(const phase of ['focus','short','long']) for(const paused of [false,true]) {
const key='day:'+iso(new Date());const d=(await api.get(key)).value;const min=phase==='focus'?25:phase==='short'?5:15;
d.focus={...(d.focus??{}),sessions:[],active:{blockId:null,label:lang==='en'?'One thing at a time':'Her seferinde tek bir iş',phase,plannedMin:min,startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+min*60000).toISOString(),pausedLeft:paused?min*60:null}};await api.put(key,d);
await p.goto(s.url+'/focus');await p.getByRole('button',{name:lang==='en'?'Focus room':'Odak odası',exact:true}).click();await p.locator('.focus-room').waitFor();
for(const width of [1440,1024,390]) for(const theme of ['light','dark']) {await p.setViewportSize({width,height:900});await p.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);await p.mouse.move(0,0);await p.screenshot({path:`${out}/${process.env.ROOM_STAGE??'after'}-${lang}-${phase}-${paused?'paused':'running'}-${width}-${theme}.png`});if(await p.locator('.focus-room').evaluate(el=>el.scrollWidth>el.clientWidth))throw Error('overflow '+width);}
await p.keyboard.press('Tab'); if(!await p.locator('.focus-room').evaluate(el=>el.contains(document.activeElement)))throw Error('focus trap'); await p.locator('.room-leave').click(); if(await p.evaluate(()=>!!document.fullscreenElement))throw Error('fullscreen exit'); await p.getByRole('button',{name:lang==='en'?'Focus room':'Odak odas\u0131',exact:true}).click(); await p.keyboard.press('Escape');if(await p.locator('.focus-room').count())throw Error('escape');
} await c.close(); } console.log('PASS 72 screenshots; no overflow; Esc'); } finally {await b.close();s.stop();}
