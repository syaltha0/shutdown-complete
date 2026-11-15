import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const srv = await startServer(); const browser = await launch();
const shots = 'reports/shots/schedule-exceptions'; mkdirSync(shots,{recursive:true});
try {
 for (const lang of ['en','tr']) {
 const api = await demoAccount(client(srv.url),{lang});
 const settings = (await api.get('settings')).value;
 await api.put('settings',{...settings,lang,templates:[],schedule:[{id:'math',label:'Mathematics',note:'',kind:'deep',start:600,end:660,days:[0,1,2,3,4,5,6],since:'2099-11-16'}],exceptions:[]});
 for (const width of [1440,390]) for (const theme of ['light','dark']) {
 const ctx=await browser.newContext({viewport:{width,height:1000},locale:lang==='tr'?'tr-TR':'en-US'});
 await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:srv.url}]);
 await ctx.addInitScript(t=>localStorage.setItem('sc-theme',t),theme);
 const page=await ctx.newPage();
 await page.goto(srv.url+'/settings');
 await page.locator('#ex-from').fill('2099-11-16'); await page.locator('#ex-to').fill('2099-11-20'); await page.locator('#ex-label').fill('Holiday');
 assert.match(await page.getByTestId('exception-preview').innerText(),/5/);
 await page.getByRole('button',{name:lang==='tr'?'İstisna ekle':'Add exception',exact:true}).click();
 await page.getByRole('button',{name:/^(Delete exception|İstisnayı sil): Holiday/}).waitFor();
 await page.locator('#s-exceptions').scrollIntoViewIfNeeded();
 await page.screenshot({path:`${shots}/${lang}-${width}-${theme}-settings.png`});
 await page.waitForTimeout(1200);
 await page.goto(srv.url+'/day/2099-11-16');
 await page.getByRole('note').filter({hasText:lang==='tr'?'Ders yok: Holiday':'No classes: Holiday'}).waitFor();
 await page.waitForTimeout(1200);
 const doc=(await api.get('day:2099-11-16')).value;
 assert.ok(!(doc?.columns ?? []).some(c=>c.blocks.some(b=>b.repeatId==='math')));
 await page.screenshot({path:`${shots}/${lang}-${width}-${theme}-day.png`});
 await page.goto(srv.url+'/settings');
 await page.getByRole('button',{name:/^(Delete exception|İstisnayı sil): Holiday/}).click();
 await page.waitForTimeout(1200);
 await page.goto(srv.url+'/day/2099-11-16');
 let restored=false; for(let i=0;i<40&&!restored;i++){ restored=(await api.get('day:2099-11-16')).value?.columns?.some(c=>c.blocks.some(b=>b.repeatId==='math'))??false; if(!restored) await page.waitForTimeout(250); }
 assert.ok(restored);
 await ctx.close();
 console.log(`PASS ${lang} ${width} ${theme}: preview, suppression, restore`);
 }
 }
} finally { await browser.close(); srv.stop(); }

