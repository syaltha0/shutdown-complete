import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
mkdirSync('reports/shots/year',{recursive:true});
try {
 for(const lang of ['en','tr']) {
 const api=client(s.url);await demoAccount(api,{lang});
 await api.put('quarter:2026-Q1',{goals:[{id:'year-goal',text:'Year goal',done:true}],notes:''});
 const day=(await api.get('day:2026-03-12')).value;
 await api.put('day:2026-03-12',{columns:[{from:null,closedAt:null,blocks:[]}],tasks:[],notes:'',metrics:{},...day,shutdown:{done:true,at:null,steps:{}},focus:{active:null,sessions:[{id:'year-session',label:'Research',minutes:130,blockId:null,kind:'deep',start:'2026-03-12T09:00:00Z',end:'2026-03-12T11:10:00Z'}]}});
 const c=await b.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await c.newPage();await p.goto(s.url+'/year/2026');await p.locator('.year-cell').first().waitFor();
 assert.equal(await p.locator('.year-cell').count(),365);await p.getByText('Year goal',{exact:true}).waitFor();
 await p.waitForFunction(()=>document.querySelector('[data-date="2026-03-12"]')?.getAttribute('data-minutes')==='130');
 await p.locator('#year-good').fill('A steady year');await p.locator('#year-change').fill('More rest');await p.waitForTimeout(1500);await p.reload();await p.locator('#year-good').waitFor();assert.equal(await p.locator('#year-good').inputValue(),'A steady year');
 for(const width of [1440,390]) for(const theme of ['light','dark']) {await p.setViewportSize({width,height:1000});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:`reports/shots/year/${lang}-${width}-${theme}.png`,fullPage:true});}
 await p.locator('.year-mobile-month[href="/month/2026-03"]').click();await p.waitForURL('**/month/2026-03');await p.goto(s.url+'/year/2026');await p.setViewportSize({width:1440,height:1000});await p.locator('[data-date="2026-03-12"]').click();await p.waitForURL('**/day/2026-03-12');await p.setViewportSize({width:1440,height:1000});await p.locator('.rail').waitFor();await p.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});await p.keyboard.press('y');await p.waitForURL('**/year/*');await p.goto(s.url+'/year/2026');await p.locator('a[href="/year/2027"]').click();await p.waitForURL('**/year/2027');await c.close();
 }
 console.log('PASS year: cells, minutes, quarters, review persistence, navigation, keyboard, responsive screenshots');
} finally {await b.close();await s.stop();}
