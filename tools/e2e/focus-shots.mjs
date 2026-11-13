import {mkdirSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const s=await startServer(), api=await demoAccount(client(s.url),{lang:'en'}), b=await launch();
const c=await b.newContext({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
const p=await c.newPage(), dir=process.argv[2] || 'reports/focus-shots/pomatez2'; mkdirSync(dir,{recursive:true});
try {
 const settings=(await api.get('settings')).value;
 await api.put('settings',{...settings,focus:{...settings.focus,scheduled:true,strict:true,breaks:[{id:'lunch',time:'12:30',minutes:30,label:'Lunch'}]}});
 await p.goto(s.url+'/focus'); await p.locator('.focus-setup').waitFor();
 await p.locator('.focus-config-anchor > button').click();
 await p.getByText('Start breaks automatically',{exact:true}).waitFor();
 await p.screenshot({path:dir+'/settings.png'});
 await p.locator('.focus-special').scrollIntoViewIfNeeded(); await p.screenshot({path:dir+'/special-breaks.png'});
 await p.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await p.getByRole('button',{name:'Start focus',exact:true}).click(); await p.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await p.screenshot({path:dir+'/strict.png'});
 await p.setViewportSize({width:390,height:844}); await p.screenshot({path:dir+'/phone390.png',fullPage:true});
 await p.setViewportSize({width:360,height:800});
 if (!await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)) throw Error('360 overflow');
 await p.setViewportSize({width:1440,height:1000}); await p.emulateMedia({colorScheme:'dark'}); await p.evaluate(()=>document.documentElement.dataset.theme='dark'); await p.screenshot({path:dir+'/dark.png'});
 console.log('5 screenshots; 360px no overflow');
} finally {await b.close(); s.stop();}
