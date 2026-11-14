import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
mkdirSync('reports/shots/home-v4',{recursive:true});
try {
 const api=await demoAccount(client(s.url));
 const context=await b.newContext({reducedMotion:'reduce'});
 await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await context.newPage();
 const settings=(await api.get('settings')).value;
 for(const empty of [false,true]) {
  if(empty) {
   // Clear known demo keys through the same API used to seed the account.
   const date=new Date();
   const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
   for(let i=-60;i<=14;i++){const d=new Date(date);d.setDate(d.getDate()+i);await api.put(`day:${iso(d)}`,{columns:[{id:'empty',blocks:[]}],tasks:[],notes:'',metrics:{},shutdown:{done:false,at:null,steps:{}}});}
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
    assert.equal(await p.locator('.overview h2').count(),4);
    const fit=await p.evaluate(()=>{const root=document.documentElement;const cards=[...document.querySelectorAll('.overview .home-tasks,.overview .home-coming')];return {scroll:root.scrollHeight-innerHeight,bottoms:cards.map(e=>e.getBoundingClientRect().bottom),rows:[...document.querySelectorAll('.overview-block')].map(e=>e.getBoundingClientRect().height)};});
    if(width>860){assert.ok(fit.scroll<=1,JSON.stringify({width,height,...fit}));assert.ok(Math.max(...fit.bottoms)-Math.min(...fit.bottoms)<=1);assert.ok(fit.rows.every(h=>h<=40));}
    if(!disabled.length && [1904,1440,390].includes(width))for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.screenshot({path:`reports/shots/home-v4/${empty?'empty':'full'}-${width}-${height}-${theme}.png`,fullPage:true});}
   }
  }
 }
 console.log('PASS home-fit: four regions, desktop geometry, feature toggles, empty account, 12 screenshots');
} finally {await b.close();await s.stop();}
