import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s = await startServer(), b = await launch();
mkdirSync('reports/search',{recursive:true});
try {
  const other = await demoAccount(client(s.url), {email:'private@search.test', history:0});
  await other.put('day:2026-11-20',{notes:'PrivateSearchSecret',tasks:[],columns:[]});
  for (const lang of ['en','tr']) {
    const api = await demoAccount(client(s.url), {lang, history:730});
    await api.put('day:2026-11-19',{notes:'ŞİŞLİ çalışma SearchNeedle',tasks:[],columns:[]});
    const samples=[];
    for(let i=0;i<8;i++) { const start=performance.now(); const r=await api.call('/api/search?q=chapter'); assert.equal(r.status,200); samples.push(performance.now()-start); }
    writeFileSync(`reports/search/performance-${lang}.json`,JSON.stringify({history:730,roundTripMs:samples,maxMs:Math.max(...samples)},null,2));
    assert.equal((await api.call('/api/search?q=PrivateSearchSecret')).body.length,0);
    assert.equal((await api.call('/api/search?q=x')).status,400);
    const hits=(await api.call('/api/search?q=sisli%20calisma')).body;
    assert.ok(hits.some(r=>r.key==='day:2026-11-19'));
    for(const theme of ['light','dark']) for(const width of [1440,390]) {
      const context=await b.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      await context.addInitScript(theme=>localStorage.setItem('sc-theme',theme),theme);
      await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
      const p=await context.newPage(); await p.goto(s.url+'/search');
      await p.locator('.history-search').waitFor();
      await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      await p.keyboard.press('Control+k');
      await p.locator('.command-palette input').fill('sisli calisma');
      await p.locator('.command-palette .history-result').first().waitFor();
      assert.ok(await p.locator('.command-palette mark').count());
      const resultIndex = await p.locator('.command-palette [role="option"]').evaluateAll(options=>options.findIndex(el=>el.querySelector('.history-result')));
      for(let i=0;i<resultIndex;i++) await p.keyboard.press('ArrowDown');
      await p.keyboard.press('Enter'); await p.waitForURL('**/day/2026-11-19');
      await p.goto(s.url+'/search?q=sisli%20calisma');
      await p.locator('.history-link').first().waitFor();
      assert.equal(await p.locator('.history-filters button').first().innerText(),lang==='tr'?'Tümü':'All');
      assert.ok((await p.locator('.history-link small').first().innerText()).startsWith(lang==='tr'?'Gün notu':'Day note'));
      assert.ok((await p.locator('.history-search').innerText()).includes('ŞİŞLİ'));
      assert.equal(await p.locator('.history-search').getByText('PrivateSearchSecret').count(),0);
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await p.screenshot({path:`reports/search/${lang}-${theme}-${width}.png`,fullPage:true});
      await p.locator('.history-filters button').last().click(); assert.equal(await p.locator('.history-link').count(),0);
      await context.close(); console.log(`PASS search ${lang} ${theme} ${width}`);
    }
  }
} finally { await b.close(); s.stop(); }
