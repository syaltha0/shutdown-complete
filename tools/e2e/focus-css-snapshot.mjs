import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {startServer,client} from '../lib/server.mjs';
import {demoAccount,iso} from '../lib/demo.mjs';
const name=process.argv[2]||'before', out='reports/focus-css'; mkdirSync(out,{recursive:true});
const s=await startServer(),b=await launch(),results=[];
try {const api=await demoAccount(client(s.url),{lang:'tr'});
for(const [width,height] of [[1904,1015],[1440,900],[1024,768],[390,844]]) {
const c=await b.newContext({viewport:{width,height},reducedMotion:'reduce'}); await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]); const p=await c.newPage();
for(const state of ['idle','running','settings']) {const key='day:'+iso(new Date()),d=(await api.get(key)).value; d.focus={...d.focus,active:state==='idle'?null:{blockId:null,label:'',phase:'focus',plannedMin:25,startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+1500000).toISOString(),pausedLeft:null}}; await api.put(key,d); await p.goto(s.url+'/focus'); await p.locator('.focus-stage').waitFor(); await p.evaluate(()=>document.fonts.ready); if(state==='settings')await p.locator('.focus-config-anchor > button').click(); await p.waitForTimeout(300);
results.push({width,height,state,elements:await p.evaluate(()=>[...document.querySelectorAll('.focus-grid, .focus-grid *')].filter(e=>!e.closest('svg')&&!e.matches('svg')&&!e.closest('.focus-room')).map((e,i)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {i,tag:e.tagName,cls:e.className,heading:e.matches('h2,h3'),x:r.x,y:r.y,width:r.width,height:r.height,fontSize:s.fontSize,padding:s.padding,gap:s.gap};}))});
}await c.close();}
writeFileSync(`${out}/${name}.json`,JSON.stringify(results,null,2));
if(name!=='before'){const old=JSON.parse(readFileSync(`${out}/before.json`));let count=0,max=0,heads=0;for(let j=0;j<results.length;j++)for(let i=0;i<results[j].elements.length;i++){const a=old[j].elements[i],z=results[j].elements[i];for(const k of ['x','y','width','height','fontSize','padding','gap']){if(a[k]===z[k])continue;const delta= Math.abs(parseFloat(a[k])-parseFloat(z[k]));if(delta<=1)continue;if(z.heading){heads++;continue;}count++;max=Math.max(max,delta||0);}}console.log(JSON.stringify({cases:results.length,nonHeadingDifferences:count,maxDelta:max,headingDifferences:heads}));}else console.log('Saved 12 baseline cases');
}finally{await b.close();s.stop();}
