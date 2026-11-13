import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s = await startServer();
const api = await demoAccount(client(s.url), {lang:'en'});
const b = await launch();
const c = await b.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
const p = await c.newPage();
const date = iso(new Date());
const shots = 'reports/shots/focus-integration';
mkdirSync(shots,{recursive:true});
try {
 const d = (await api.get('day:'+date)).value;
 const block = d.columns.at(-1).blocks[0];
 d.focus = {active:null,sessions:[{id:'integration',blockId:'before-revision',label:block.label,kind:block.kind,start:new Date().toISOString(),end:new Date().toISOString(),minutes:25,note:'Integration session note',intent:'Integration intent',taskId:d.tasks[0]?.id,taskText:'Integration task'}]};
 await api.put('day:'+date,d);
 for (const route of ['/day/'+date,'/shutdown/'+date]) {
  await p.goto(s.url+route);
  await p.locator('.focus-log summary').click();
  for (const text of ['Integration session note','Integration intent','Integration task']) {
   if (!await p.locator('.focus-log').getByText(text,{exact:false}).isVisible()) throw Error(route+' missing '+text);
  }
  console.log('PASS journal context '+route);
 }
 await p.goto(s.url+'/day/'+date);
 await p.locator('.col.active .block').filter({hasText:block.label}).first().click();
 await p.locator('dialog[open] .focus-log summary').click();
 if (!await p.locator('dialog[open] .focus-log').getByText('Integration session note').isVisible()) throw Error('revised block journal');
 console.log('PASS revised block label matches original session');
 await p.keyboard.press('Escape');
 const settings = (await api.get('settings')).value;
 for (const lang of ['en','tr']) {
  await api.put('settings',{...settings,lang});
  await p.goto(s.url+'/shutdown/'+date);
  await p.locator('.focus-log summary').click();
  for (const theme of ['light','dark']) {
   await p.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
   await p.screenshot({path:`${shots}/${lang}-${theme}-390.png`,fullPage:true});
   if (!await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)) throw Error('horizontal overflow');
  }
 }
 console.log('PASS TR/EN light/dark 390px');
} finally { await b.close(); s.stop(); }
