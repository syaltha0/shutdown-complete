import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
const assertEventually=async(fn,ms=5000)=>{const end=Date.now()+ms;for(;;){try{return await fn();}catch(e){if(Date.now()>end)throw e;await new Promise(r=>setTimeout(r,150));}}};
try {
 for (const lang of ['en','tr']) {
  const api=await demoAccount(client(s.url),{lang});
  const ctx=await b.newContext({locale:lang,viewport:{width:1440,height:1000}});
  await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
  const p=await ctx.newPage();await p.goto(s.url+'/habits');
  await p.locator('.hv-name').first().click();
  const frequency=p.locator('section[aria-label] select');await frequency.first().waitFor();
  const firstName=await p.locator('.hgrid .hrow:not(.head) .hname').first().innerText();
  await frequency.first().selectOption('weekly');
  const quota=p.locator('section[aria-label] input[type=number]');await quota.fill('2');await quota.blur();
  const cell=p.locator('.hgrid .hrow:not(.head)').first().locator('.hcell.is-today');
  // Normalize to empty through the public UI, then exercise all three states.
  for(let i=0;i<3 && (await cell.getAttribute('aria-pressed')==='true'||(await cell.innerText()).trim());i++)await cell.click();
  await cell.click();assert.equal(await cell.getAttribute('aria-pressed'),'true');
  await cell.click();assert.equal((await cell.innerText()).trim(),'/');
  await p.waitForTimeout(600);await p.reload();await p.locator('.hgrid').waitFor();await p.locator('.hv-name').first().click();
  assert.equal(await p.locator('section[aria-label] select').first().inputValue(),'weekly');
  assert.equal(await p.locator('section[aria-label] input[type=number]').inputValue(),'2');
  assert.equal((await p.locator('.hgrid .hrow:not(.head)').first().locator('.is-today').innerText()).trim(),'/');
  const word=lang==='en'?{archive:'Archive',restore:'Restore',down:'Move down'}:{archive:'Arşivle',restore:'Geri al',down:'Aşağı taşı'};
  await p.getByRole('button',{name:firstName+' / '+word.down,exact:true}).click();
  assert.notEqual(await p.locator('.hgrid .hrow:not(.head) .hname').first().innerText(),firstName);
  await p.getByRole('button',{name:firstName+' / '+word.archive,exact:true}).click();
  assert.equal(await p.locator('.hgrid .hname').filter({hasText:firstName}).count(),0);
  await p.locator('details').last().locator('summary').click();
  await p.getByRole('button',{name:firstName+' / '+word.restore,exact:true}).click();
  await p.waitForTimeout(600);await p.reload();await p.locator('.hgrid').waitFor();await p.locator('.hv-name').first().click();
  assert.ok(await p.locator('.hgrid .hname').filter({hasText:firstName}).count());
  assert.notEqual(await p.locator('.hgrid .hrow:not(.head) .hname').first().innerText(),firstName);
  await p.locator('section[aria-label] select').first().selectOption('days');
  const wd=p.locator('.hv-controls .hv-wd');await wd.first().click();
  await p.waitForTimeout(600);await p.reload();await p.locator('.hgrid').waitFor();await p.locator('.hv-name').first().click();
  assert.equal(await p.locator('section[aria-label] select').first().inputValue(),'days');
  assert.equal(await p.locator('.hv-controls .hv-wd').first().getAttribute('aria-pressed'),'false');
  // the last chosen weekday cannot be taken away
  for(const i of [1,2,3])await p.locator('.hv-controls .hv-wd').nth(i).click();
  assert.ok(await p.locator('.hv-controls .hv-wd').nth(4).isDisabled(),'last weekday stays chosen');
  // rename from the detail
  const named=p.locator('.hv-controls .hv-field input:not([type])').first();const renamed='Renamed habit '+lang;
  await named.fill(renamed);await named.press('Enter');
  await assertEventually(async()=>assert.ok((await api.get('settings')).value.metrics.some(m=>m.name===renamed)));
  // add with a frequency chosen up front: the new habit opens with it
  await p.locator('#habit-name').fill('Weekly swim '+lang);
  await p.locator('.habit-add .hv-freq select').selectOption('weekly');
  await p.locator('.habit-add button[type=submit]').click();
  await assertEventually(async()=>{const m=(await api.get('settings')).value.metrics.find(m=>m.name==='Weekly swim '+lang);assert.equal(m?.frequency?.mode,'weekly');});
  assert.equal(await p.locator('.hv-habit.is-new .hv-name').getAttribute('aria-expanded'),'true');
  // archive, then delete for good after a confirmation
  await p.getByRole('button',{name:'Weekly swim '+lang+' / '+word.archive,exact:true}).click();
  await p.locator('details').last().locator('summary').click();
  p.once('dialog',d=>d.accept());
  await p.getByRole('button',{name:'Weekly swim '+lang+' / '+(lang==='en'?'Delete for good':'Kalıcı olarak sil'),exact:true}).click();
  await assertEventually(async()=>assert.ok(!(await api.get('settings')).value.metrics.some(m=>m.name==='Weekly swim '+lang)));
  console.log('PASS '+lang+' habit frequency, cycle, archive, restore, order, persistence, weekday minimum, rename, add with frequency, delete');await ctx.close();
 }
}finally{await b.close();await s.stop();}
