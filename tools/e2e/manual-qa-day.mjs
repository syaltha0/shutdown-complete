import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const s=await startServer(); const api=await demoAccount(client(s.url),{lang:'en'});
const b=await launch(); const c=await b.newContext({viewport:{width:1440,height:900},timezoneId:'Europe/Istanbul'});
await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
const p=await c.newPage(); const date=iso(new Date()),key='day:'+date;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+name)};
const blocks=async()=>((await api.get(key)).value.columns.at(-1).blocks);
try {
 await p.goto(s.url+'/day/'+date); const before=(await blocks()).length;
 await p.getByRole('button',{name:'Add a block',exact:true}).click(); await p.locator('#be-label').fill('Cancelled escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(800);
 check('B1 Escape leaves no block',(await blocks()).length===before);
 await p.getByRole('button',{name:'Add a block',exact:true}).click(); await p.locator('#be-label').fill('Cancelled button'); await p.getByRole('button',{name:'Cancel',exact:true}).click(); await p.waitForTimeout(800);
 check('B1 Cancel leaves no block',(await blocks()).length===before);
 await p.getByRole('button',{name:'Add a block',exact:true}).click(); await p.locator('#be-label').fill('Saved QA block'); await p.getByRole('button',{name:'Save',exact:true}).click(); await p.waitForTimeout(1000);
 check('B1 Save persists block',(await blocks()).some(x=>x.label==='Saved QA block'));
 mkdirSync('reports/manual-qa-day',{recursive:true});
 for(const width of [1440,390]){await p.setViewportSize({width,height:900});await p.screenshot({path:`reports/manual-qa-day/day-${width}.png`,fullPage:true});}
 await p.setViewportSize({width:1440,height:900});
 await p.locator('#m-deep').fill('1'); await p.locator('#m-deep').blur(); await p.waitForTimeout(1000);
 for(const route of ['/','/day/'+date,'/shutdown/'+date,'/focus']){await p.goto(s.url+route);await p.getByText('manually entered',{exact:true}).first().waitFor();check('B2 manual label '+route,await p.getByText('manually entered',{exact:true}).first().isVisible());check('B2 one hour '+route,(await p.locator('main').innerText()).includes('1 h'));}
 await p.locator('.focus-setup button[type=submit]').click();await p.locator('.focus-controls').waitFor();
 await p.getByRole('button',{name:'Skip',exact:true}).click();await p.waitForTimeout(1000);
 const focused=(await api.get(key)).value.focus;
 check('B8 immediate skip adds no round',!focused?.sessions.length&&!focused?.skippedRounds);
 await p.goto(s.url+'/shutdown/'+date);
 const done=p.getByRole('button',{name:'Schedule shutdown, complete',exact:true});await done.click();await p.locator('#shutdown-confirm-title').waitFor();
 check('B9 incomplete ritual asks',await p.locator('#shutdown-confirm-title').isVisible());
 await p.getByRole('button',{name:'Go back',exact:true}).click();await p.waitForTimeout(800);
 check('B9 Go back keeps day open',!(await api.get(key)).value.shutdown.done);
} finally {await b.close();await s.stop();}
