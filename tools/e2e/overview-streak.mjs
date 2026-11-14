import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s = await startServer(), b = await launch();
const dir = 'reports/shots/overview-streak';
mkdirSync(dir, { recursive: true });
try {
 const time = new Date(); time.setHours(20,0,0,0);
 const api = await demoAccount(client(s.url), { lang: 'en' });
 const ctx = await b.newContext({ reducedMotion: 'reduce' });
 await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p = await ctx.newPage(); await p.clock.install({time});
 const date = i => { const d = new Date(time); d.setDate(d.getDate()-i); return iso(d); };
 const original = (await api.get('day:'+date(0))).value;
 const settings = (await api.get('settings')).value;
 await api.put('settings',{...settings,schedule:[]});
 for (const [state,current,closed,best] of [['zero',0,false,12],['ongoing',5,false,12],['done',6,true,12],['long',60,true,75]]) {
  for(let i=0;i<90;i++) {
   const done = state==='long' ? i<75 : ((i>0&&i<=5&&state!=='zero')||(i>=20&&i<32)||(i===0&&closed));
   await api.put('day:'+date(i),{...original,shutdown:{done,at: done ? new Date(new Date(time).setHours(17,24,0,0)).toISOString():null,steps:{}}});
  }
  for (const [width,height] of [[1440,900],[390,844]]) for (const theme of ['light','dark']) {
   await p.setViewportSize({width,height}); await p.goto(s.url+'/');
   const tile=p.locator('.b-streak'); await tile.waitFor();
   await p.waitForTimeout(350); await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.equal(await tile.locator('.b-streak-number').innerText(),String(current));
   assert.equal(await tile.locator('.b-streak-summary small').innerText(),`Best: ${best}`);
   assert.equal(await tile.locator('.b-streak-days a').count(),14);
   assert.equal(await tile.locator('.today.on').count(),closed?1:0);
   assert.ok(await tile.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1),`${state} fits ${width}`);
   if(closed) assert.match(await tile.innerText(),/Done at 17:24/);
   else assert.equal(await tile.locator('.b-act').getAttribute('href'),'/shutdown/'+date(0));
   await p.screenshot({path:`${dir}/${state}-${width}-${theme}.png`,fullPage:true});
  }
 }
 console.log('PASS streak: four states, real current/best, today, action, fit; 16 screenshots');
} finally { await b.close(); s.stop(); }
