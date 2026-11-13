import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const stage = process.env.SESSIONS_STAGE ?? 'after';
const out = 'reports/shots/widget-sessions';
mkdirSync(out, {recursive:true});
const s = await startServer(), b = await launch(), measures = [];
try {
 for (const lang of ['tr','en']) {
  const api = await demoAccount(client(s.url), {lang});
  const c = await b.newContext({reducedMotion:'reduce'});
  await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
  const p = await c.newPage(), key = 'day:'+iso(new Date());
  for (const count of [0,1,3,12]) {
   const d = (await api.get(key)).value;
   const label = lang === 'tr' ? 'Araştırma ve yeni bölüm taslağının ayrıntılı değerlendirmesi' : 'Research and detailed review of the new chapter outline';
   d.columns[d.columns.length-1].blocks = [{id:'shot-block',label,kind:'deep',start:540,end:720}];
   d.focus = {active:null,sessions:Array.from({length:count},(_,i)=>({id:'shot-'+i,blockId:'shot-block',label:i%3===0?label:(lang==='tr'?'Bölüm taslağı':'Chapter outline'),minutes:25,start:new Date(new Date().setHours(9, i*30,0,0)).toISOString(),end:new Date(new Date().setHours(9,i*30+25,0,0)).toISOString(),note:i===count-1?(lang==='tr'?'Taslak tamamlandı. Sonraki oturumda kaynaklar gözden geçirilecek.':'Draft completed. Review the references in the next session.') : ''}))};
   await api.put(key,d); await p.goto(s.url+'/focus'); await p.locator('.focus-sessions').waitFor(); await p.evaluate(()=>document.fonts.ready);
   for (const width of [1440,1024,390,360]) for (const theme of ['light','dark']) {
    await p.setViewportSize({width,height:900}); await p.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await p.waitForTimeout(100);
    const panel = p.locator('.focus-sessions');
    if(count) await p.locator('.session-scroll').evaluate(el=>el.scrollTop=0);
    await panel.screenshot({path:`${out}/${stage}-${lang}-${count}-${width}-${theme}.png`});
    if(count) await p.locator('[aria-labelledby="fb-h"]').screenshot({path:`${out}/${stage}-${lang}-${count}-${width}-${theme}-blocks.png`});
    const m = await panel.evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth}));
    measures.push({lang,count,width,theme,...m}); if(stage !== 'before' && (m.overflow||m.pageOverflow)) throw Error(JSON.stringify(measures.at(-1)));
    if(count===12) { await p.locator('.session-scroll').evaluate(el=>el.scrollTop=el.scrollHeight); await panel.screenshot({path:`${out}/${stage}-${lang}-${count}-${width}-${theme}-scrolled.png`}); }
   }
  } await c.close();
 } console.log('PASS '+measures.length+' states without overflow');
} finally {writeFileSync(`${out}/${stage}-measurements.json`,JSON.stringify(measures,null,2));await b.close();s.stop();}
