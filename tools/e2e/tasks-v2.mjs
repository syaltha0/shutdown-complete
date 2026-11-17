import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const srv = await startServer(), browser = await launch();
const api = await demoAccount(client(srv.url), { lang: 'en' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:srv.url}]);
const page = await ctx.newPage(), D=iso(new Date());
const inbox=async()=>(await api.get('inbox')).value;
const settle=()=>page.waitForTimeout(1100);
try {
 await page.goto(srv.url+'/tasks'); await page.locator('#tk-new').fill('Repeat sample'); await page.locator('#tk-new').press('Enter'); await settle();
 let b=await inbox(); const task={...b.items[0],due:D,repeat:{every:1,unit:'day'},steps:[{id:'step-test',text:'Small step',done:false}]};
 await api.put('inbox',{...b,items:[task,{id:'single-test',text:'Single sample',done:false}]}); await page.reload();
 await page.getByRole('button',{name:'New filter',exact:true}).click();
 await page.getByLabel('Name',{exact:true}).fill('My filter'); await page.locator('.tk-filter-form').getByLabel('Due',{exact:true}).selectOption('today'); await page.getByRole('button',{name:'Save filter',exact:true}).click(); await settle();
 assert.equal((await inbox()).filters[0].name,'My filter'); assert.equal(await page.locator('.tk-main .tk-row').count(),1);
 await page.getByRole('button',{name:'Edit filter',exact:true}).click(); await page.getByLabel('Name',{exact:true}).fill('Edited filter'); await page.getByRole('button',{name:'Save filter',exact:true}).click(); await settle(); assert.equal((await inbox()).filters[0].name,'Edited filter');
 await page.locator('.tk-done-bar').getByRole('button',{name:'Delete',exact:true}).click(); await settle(); assert.equal((await inbox()).filters.length,0);
 console.log('PASS saved filters create, apply, edit, delete');
 await page.getByRole('button',{name:'Select',exact:true}).click(); await page.getByRole('button',{name:'Select all',exact:true}).click(); await page.getByRole('button',{name:'Plan today',exact:true}).click(); await settle();
 b=await inbox();assert.deepEqual(b.items,[task]); let day=(await api.get('day:'+D)).value; assert.equal(day.tasks.filter(t=>['Repeat sample','Single sample'].includes(t.text)).length,2);const copy=day.tasks.find(t=>t.text===task.text); assert.notEqual(copy.id,task.id);assert.equal(copy.repeat,undefined);
 await api.put('day:'+D,{...day,tasks:day.tasks.map(t=>t.id===copy.id?{...t,done:true}:t)});assert.equal((await inbox()).items[0].doneCount,1);
 await api.put('day:'+D,{...day,tasks:day.tasks.map(t=>({...t,done:true}))});assert.equal((await inbox()).items[0].doneCount,1);
 console.log('PASS bulk planning preserves occurrence and UID; completion advances exactly once');
 await page.reload();await page.locator('.tk-open').click();await page.getByRole('button',{name:'Delete task',exact:true}).click();await settle();assert.equal((await inbox()).trash.length,1);assert.equal((await inbox()).trash[0].item.steps.length,1);
 await page.getByRole('button',{name:'Trash',exact:true}).click();await page.getByRole('button',{name:'Restore',exact:true}).click();await settle();assert.equal((await inbox()).items[0].id,task.id);
 await page.goto(srv.url+'/tasks');await page.locator('.tk-open').click();await page.getByRole('button',{name:'Delete task',exact:true}).click();await settle();await page.getByRole('button',{name:'Trash',exact:true}).click();await page.getByRole('button',{name:'Delete permanently',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete permanently',exact:true}).click();await settle();assert.equal((await inbox()).trash.length,0);
 b=await inbox();await api.put('inbox',{...b,trash:[{item:task,deletedAt:new Date().toISOString()}]});await page.clock.install({time:new Date(Date.now()+31*86400000)});await page.reload();await settle();assert.equal((await inbox()).trash.length,0);console.log('PASS trash restore, permanent delete and expiry with simulated time');
 await page.goto(srv.url+'/tasks'); await page.locator('#tk-new').fill('Review the weekly plan'); await page.locator('#tk-new').press('Enter'); await settle();
 mkdirSync('reports/shots/tasks-v2',{recursive:true});
 for(const lang of ['en','tr']) { const settings=(await api.get('settings')).value; await api.put('settings',{...settings,lang}); await page.reload(); await page.getByRole('button',{name:lang === 'en' ? 'New filter' : 'Yeni filtre',exact:true}).click(); for(const width of [1440,390])for(const theme of ['light','dark']) {await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});await page.screenshot({path:`reports/shots/tasks-v2/${lang}-${width}-${theme}.png`});}
 }
} finally {await browser.close();srv.stop();}
