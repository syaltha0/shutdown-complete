import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
import { mkdirSync } from 'node:fs';
const s = await startServer(), api = await demoAccount(client(s.url), { lang: 'en' }), b = await launch();
const check = (ok, text) => { if (!ok) throw Error(text); console.log('PASS ' + text); };
const wait = async (fn) => { for (let i=0;i<80;i++) { if(await fn()) return; await new Promise(r=>setTimeout(r,100)); } throw Error('Timed out'); };
const contexts = await Promise.all([0,1].map(async () => { const c=await b.newContext({viewport:{width:1440,height:1000}, reducedMotion:'reduce'}); await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]); return c; }));
const [a,p] = await Promise.all(contexts.map(c=>c.newPage()));
const key='day:'+iso(new Date()), path='/day/'+iso(new Date());
try {
  await Promise.all([a,p].map(page=>page.goto(s.url+path)));
  await Promise.all([a,p].map(page=>page.locator('.notes-area').waitFor()));
  await a.locator('.notes-area').fill('Server notes');
  await wait(async()=> (await api.get(key)).value.notes==='Server notes');
  await p.locator('.notes-area').fill('My kept notes');
  await p.locator('.draft').waitFor();
  await p.getByRole('button',{name:'Show my changes'}).click();
  check(await p.locator('.draft-cols').textContent().then(t=>t.includes('Server notes')&&t.includes('My kept notes')), 'two contexts retain both versions');
  await p.reload(); await p.getByRole('button',{name:'Show my changes'}).click();
  check(await p.locator('.draft-cols').textContent().then(t=>t.includes('My kept notes')), 'draft survives reload');
  mkdirSync('reports/shots/conflict-draft',{recursive:true});
  for (const lang of ['en','tr']) for (const theme of ['light','dark']) for (const width of [1440,390]) {
    await p.evaluate(({lang,theme})=>{localStorage.setItem('sc-theme',theme);}, {lang,theme});
    // Language is an account setting; reload the retained draft with the selected language.
    const settings=await api.get('settings'); await api.put('settings',{...settings.value,lang});
    await p.setViewportSize({width,height:1000}); await p.reload();
    await p.locator('.draft-actions button').first().click();
    await p.screenshot({path:`reports/shots/conflict-draft/${lang}-${theme}-${width}.png`,fullPage:true});
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `${lang} ${theme} ${width} fits`);
  }
  const settings=await api.get('settings'); await api.put('settings',{...settings.value,lang:'en'}); await p.reload();
  await p.getByRole('button',{name:'Show my changes'}).click();
  await p.getByRole('button',{name:'Restore mine',exact:true}).click(); await p.getByRole('button',{name:'Yes, restore'}).click();
  await wait(async()=> (await api.get(key)).value.notes==='My kept notes'); await p.locator('.draft').waitFor({state:'detached'});
  await a.reload(); check(await a.locator('.notes-area').inputValue()==='My kept notes','restored version reaches other context');
  await a.locator('.notes-area').fill('New server notes'); await wait(async()=> (await api.get(key)).value.notes==='New server notes');
  await p.locator('.notes-area').fill('Dismiss me'); await p.locator('.draft').waitFor(); await p.getByRole('button',{name:'Ignore',exact:true}).click(); await p.reload();
  check(await p.locator('.draft').count()===0,'Ignore deletes retained draft');
  // Exercise the same store with inbox; the UI is shared across document kinds.
  await p.goto(s.url+'/tasks');
  await p.waitForTimeout(500);
  const inbox=await api.get('inbox');
  await api.put('inbox',{...inbox.value,items:[...(inbox.value?.items??[]),{id:'remote',text:'Remote task',done:false}]});
  await p.locator('#tk-new').fill('Local task'); await p.locator('#tk-new').press('Enter');
  await p.locator('.draft').waitFor(); await p.getByRole('button',{name:'Show my changes'}).click();
  check(await p.locator('.draft-cols').textContent().then(t=>t.includes('Remote task')&&t.includes('Local task')), 'inbox conflict shows task texts');
  await p.getByRole('button',{name:'Ignore',exact:true}).click();
  for (const [path,key,selector] of [['/week/2026-W46','week:2026-W46','#wk-notes'],['/month/2026-11','month:2026-11','#m-notes'],['/quarter/2026-Q4','quarter:2026-Q4','#q-notes']]) {
    await p.goto(s.url+path); await p.locator(selector).waitFor();
    await api.put(key,{...(await api.get(key)).value,notes:'Remote period notes'});
    await p.locator(selector).fill('My period notes'); await p.locator('.draft').waitFor();
    await p.getByRole('button',{name:'Show my changes'}).click();
    check(await p.locator('.draft-cols').textContent().then(t=>t.includes('Remote period notes')&&t.includes('My period notes')),key+' readable comparison');
    await p.getByRole('button',{name:'Ignore',exact:true}).click();
  }
  await p.goto(s.url+'/settings'); await p.locator('#s-end').waitFor();
  const before=await api.get('settings'); await api.put('settings',{...before.value,startHour:6});
  await p.locator('#s-end').selectOption('22'); await p.locator('#s-end').blur();
  await p.locator('.draft').waitFor(); await p.getByRole('button',{name:'Show my changes'}).click();
  check(await p.locator('.draft-cols').textContent().then(t=>t.includes('06:00')&&t.includes('22:00')), 'settings readable workday comparison');
  await p.getByRole('button',{name:'Ignore',exact:true}).click();
  await p.goto(s.url+path); await p.locator('.notes-area').waitFor();
  await p.route('**/api/doc/day:*', r=>r.request().method()==='GET'?r.abort():r.continue());
  for(let i=1;i<=4;i++) {
    await api.put(key,{...(await api.get(key)).value,notes:'Server '+i});
    await p.locator('.notes-area').fill('Kept '+i);
    await wait(()=>p.evaluate(text=>Object.entries(localStorage).some(([k,v])=>k.startsWith('sc-drafts:')&&v.includes(text)), 'Kept '+i));
  }
  const kept=await p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('sc-drafts:')).flatMap(([,v])=>JSON.parse(v)));
  check(kept.length===3&&kept[0].value.notes==='Kept 4'&&!kept.some(d=>d.value.notes==='Kept 1'),'last three drafts retained');
  await p.evaluate(()=>{for(const [k,v] of Object.entries(localStorage)) if(k.startsWith('sc-drafts:')) localStorage.setItem(k,JSON.stringify(JSON.parse(v).map(d=>({...d,at:Date.now()-8*864e5}))));});
  await p.unroute('**/api/doc/day:*'); await p.reload(); await p.locator('.notes-area').waitFor();
  check(await p.locator('.draft').count()===0,'drafts expire after seven days');
} finally { await b.close(); s.stop(); }
