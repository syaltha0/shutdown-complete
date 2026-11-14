import {mkdirSync} from 'node:fs';
import {launch} from './lib/browser.mjs';
import {startServer,client} from './lib/server.mjs';
import {demoAccount} from './lib/demo.mjs';
const phase=process.argv[2]||'after',s=await startServer(),b=await launch();
mkdirSync('reports/shots/uiux-pass',{recursive:true});
try {const api=client(s.url);await demoAccount(api,{lang:'tr'});const c=await b.newContext({reducedMotion:'reduce'});await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);const p=await c.newPage();
for(const [name,url] of Object.entries({metrics:'/metrics',year:'/year/2026',month:'/month/2026-11',habits:'/habits/2026-11',tasks:'/tasks',boards:'/boards',focus:'/focus',status:'/settings/status',welcome:'/welcome'})) for(const width of [390,1440]) for(const theme of ['light','dark']) {await p.setViewportSize({width,height:width===390?844:900});await p.goto(s.url+url);await p.waitForTimeout(500);await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.dataset.motion='reduce'},theme);await p.screenshot({path:`reports/shots/uiux-pass/${phase}-${name}-${width}-${theme}.png`,fullPage:true});}
console.log('Captured '+phase);
}finally{await b.close();await s.stop();}
