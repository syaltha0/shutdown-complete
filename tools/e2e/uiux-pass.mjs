import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount} from '../lib/demo.mjs';
const s=await startServer(),b=await launch(),results=[];
try {const api=client(s.url);await demoAccount(api,{lang:'en'});const c=await b.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);const p=await c.newPage();
await p.goto(s.url+'/tasks');await p.locator('#tk-new').fill('UI review task');await p.locator('#tk-new').press('Enter');await p.getByText('UI review task',{exact:true}).first().click();await p.locator('.tk-detail').waitFor();
assert.equal(await p.locator('.tk-advanced').getAttribute('open'),null);assert.ok(await p.locator('.tk-notes').isVisible());
const target=await p.locator('.tk-d-head button').boundingBox();assert.ok(target.width>=44&&target.height>=44);results.push({check:'task close target',...target});
for(const width of [390,1440])for(const theme of ['light','dark']) {await p.setViewportSize({width,height:844});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.screenshot({path:`reports/shots/uiux-pass/after-task-detail-${width}-${theme}.png`,fullPage:true});}
await p.setViewportSize({width:390,height:844});await p.goto(s.url+'/habits/2026-11');await p.locator('.hweek').waitFor();const boxes=await p.locator('.hweek .hcell').evaluateAll(es=>es.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));assert.ok(boxes.length);assert.ok(boxes.every(r=>r.w>=44&&r.h>=44));results.push({check:'habit targets',count:boxes.length,minWidth:Math.min(...boxes.map(r=>r.w))});
await p.goto(s.url+'/metrics');await p.evaluate(()=>document.documentElement.dataset.theme='dark');const contrast=await p.evaluate(()=>{const s=getComputedStyle(document.documentElement);const rgb=h=>h.trim().replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);const lum=h=>rgb(h).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);return (lum(s.getPropertyValue('--faint'))+.05)/(lum(s.getPropertyValue('--active'))+.05)});assert.ok(contrast>=4.5);results.push({check:'dark faint on active contrast',ratio:contrast});
writeFileSync('reports/uiux-measurements.json',JSON.stringify(results,null,2));console.log('PASS UIUX measurements');
}finally{await b.close();await s.stop();}
