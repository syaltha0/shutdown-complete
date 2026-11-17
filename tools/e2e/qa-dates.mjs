import assert from 'node:assert/strict';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount} from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
try {
 const api=await demoAccount(client(s.url));
 const ctx=await b.newContext();
 await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
 const p=await ctx.newPage();
 await p.clock.install({time:new Date('2026-11-17T12:00:00')});
 for(const [from,to] of [['day/2026-02-30','day/2026-03-02'],['day/2026-99-99','day/2026-11-17'],['month/2026-13','month/2026-11'],['week/2026-W99','week/2026-W47'],['year/0000','year/2026'],['week/2026-W53','week/2026-W53']]) {
  await p.goto(s.url+'/'+from);await p.waitForURL(s.url+'/'+to);await p.locator('h1').waitFor();
 }
 await p.goto(s.url+'/day/2026-02-30');await p.waitForURL('**/day/2026-03-02');
 await p.locator('textarea.notes-area').fill('Canonical QA note');
 await p.waitForTimeout(1800);
 assert.equal((await api.get('day:2026-03-02')).value.notes,'Canonical QA note');
 assert.notEqual((await api.get('day:2026-02-30')).value?.notes,'Canonical QA note');
 console.log('PASS canonical date redirects and document key');
} finally {await b.close();s.stop();}
