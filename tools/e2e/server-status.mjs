import assert from 'node:assert/strict';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount} from '../lib/demo.mjs';
import {launch} from '../lib/browser.mjs';
import {mkdirSync} from 'node:fs';
const server=await startServer({env:{SOURCE_URL:'https://example.invalid/a/b'}});let browser;
try {
 const admin=await demoAccount(client(server.url));const normal=await demoAccount(client(server.url),{lang:'tr'});
 assert.equal((await normal.call('/api/admin/server-status')).status,403);
 let r=await admin.call('/api/admin/server-status');assert.equal(r.status,200);assert.ok(r.body.warnings.includes('appUrlMissing'));assert.ok(r.body.warnings.includes('backupOld'));assert.equal(r.body.accounts,2);
 const text=JSON.stringify(r.body);for(const secret of ['@','password','token','endpoint',server.dir])if(secret)assert.ok(!text.includes(secret));
 assert.equal((await admin.call('/api/admin/backups',{})).status,200);r=await admin.call('/api/admin/server-status');assert.equal(r.body.backup.attempt.ok,true);assert.ok(r.body.backup.last.size>0);
 browser=await launch();mkdirSync('reports/shots/server-status',{recursive:true});
 for(const lang of ['en','tr'])for(const theme of ['light','dark'])for(const width of [1440,390]){
 const settings=(await admin.get('settings')).value; await admin.put('settings',{...settings,lang});
 const ctx=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});await ctx.addCookies([{name:'sc_session',value:admin.cookie.split('=')[1],url:server.url}]);const page=await ctx.newPage();await page.goto(server.url);await page.evaluate(({lang,theme})=>{localStorage.setItem('sc-lang',lang);localStorage.setItem('sc-theme',theme);},{lang,theme});await page.goto(server.url+'/settings/status');await page.getByText(lang==='tr'?'Sunucu durumu':'Server status',{exact:true}).first().waitFor();await page.getByRole('button',{name:lang==='tr'?'\u015eimdi yedek al':'Back up now',exact:true}).click();await page.getByRole('button',{name:lang==='tr'?'\u015eimdi yedek al':'Back up now',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.status-actions button')?.disabled);await page.screenshot({path:'reports/shots/server-status/'+lang+'-'+theme+'-'+width+'.png',fullPage:true});await ctx.close();
 }
 console.log('server-status: API authorization, privacy, warnings, backup and screenshots passed');
}finally{await browser?.close();await server.stop();}
