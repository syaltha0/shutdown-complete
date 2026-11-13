import {launch} from './lib/browser.mjs';
import {mkdirSync} from 'node:fs';
const dir='D:/newport/reports/focus-shots/settings2';mkdirSync(dir,{recursive:true});
const b=await launch();const p=await b.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
for(const [name,w,theme] of [['settings-open',1440,'light'],['phone',390,'light'],['dark',1440,'dark']]){
 await p.setViewportSize({width:w,height:1000});await p.goto('http://localhost:3209/focus?theme='+theme);await p.locator('.focus-config-anchor > button').click();await p.screenshot({path:dir+'/'+name+'.png'});
 console.log(name,await p.locator('.focus-settings-sheet').evaluate(e=>({width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth})));}
await p.goto('http://localhost:3209/settings?theme=light');await p.locator('.focus-config').scrollIntoViewIfNeeded();await p.screenshot({path:dir+'/settings-page.png'});await b.close();

