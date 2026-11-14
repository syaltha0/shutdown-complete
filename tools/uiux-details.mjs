import {launch} from './lib/browser.mjs';
import {startServer,client} from './lib/server.mjs';
import {demoAccount} from './lib/demo.mjs';
const s=await startServer(),b=await launch();
try{const api=client(s.url);await demoAccount(api,{lang:'tr'});const c=await b.newContext({reducedMotion:'reduce'});await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);const p=await c.newPage();
for(const mode of ['focus-settings','palette','welcome']) {if(mode==='welcome'){const st=(await api.get('settings')).value;await api.put('settings',{...st,setupDone:false,tourDone:false,setupAgain:true});}await p.goto(s.url+(mode==='focus-settings'?'/focus':'/'));if(mode==='focus-settings')await p.locator('.focus-config-anchor > button').click();if(mode==='palette')await p.keyboard.press('Control+k');await p.waitForTimeout(500);for(const width of [390,1440])for(const theme of ['light','dark']) {await p.setViewportSize({width,height:width===390?844:900});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.screenshot({path:`reports/shots/uiux-pass/after-${mode}-${width}-${theme}.png`,fullPage:true});}}
console.log('Captured detail states');}finally{await b.close();await s.stop();}

