import { mkdirSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { startServer, client } from './lib/server.mjs';
import { demoAccount, iso } from './lib/demo.mjs';
const s=await startServer(); const api=await demoAccount(client(s.url),{lang:'en'}); const b=await launch(); const c=await b.newContext({reducedMotion:'reduce'}); await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]); const p=await c.newPage(); const dir='reports/e-shots/'+(process.argv[2]||'before'); mkdirSync(dir,{recursive:true});
try { for(const [w,h] of [[360,740],[1440,900],[1920,1080]]) { await p.setViewportSize({width:w,height:h}); for(const route of ['focus','shutdown/'+iso(new Date()),'agenda']) {await p.goto(s.url+'/'+route); await p.locator('.focus-stage, .ritual, .agenda-day').first().waitFor(); await p.waitForTimeout(400); await p.screenshot({path:`${dir}/${route.split('/')[0]}-${w}.png`,fullPage:true});} } } finally {await b.close();s.stop();}
