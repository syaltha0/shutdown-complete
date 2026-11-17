import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
try {
 for (const lang of ['en','tr']) {
  const api=await demoAccount(client(s.url),{lang});
  const ctx=await b.newContext({locale:lang,viewport:{width:1440,height:1000}});
  await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
  const p=await ctx.newPage();await p.goto(s.url+'/habits');
  const frequency=p.locator('section[aria-label] select');await frequency.first().waitFor();
  const firstName=await p.locator('.hgrid .hrow:not(.head) .hname').first().innerText();
  await frequency.first().selectOption('weekly');
  const quota=p.locator('section[aria-label] input[type=number]');await quota.fill('2');await quota.blur();
  const cell=p.locator('.hgrid .hrow:not(.head)').first().locator('.hcell.is-today');
  // Normalize to empty through the public UI, then exercise all three states.
  for(let i=0;i<3 && (await cell.getAttribute('aria-pressed')==='true'||(await cell.innerText()).trim());i++)await cell.click();
  await cell.click();assert.equal(await cell.getAttribute('aria-pressed'),'true');
  await cell.click();assert.equal((await cell.innerText()).trim(),'/');
  await p.waitForTimeout(600);await p.reload();await p.locator('.hgrid').waitFor();
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
  await p.waitForTimeout(600);await p.reload();await p.locator('.hgrid').waitFor();
  assert.ok(await p.locator('.hgrid .hname').filter({hasText:firstName}).count());
  assert.notEqual(await p.locator('.hgrid .hrow:not(.head) .hname').first().innerText(),firstName);
  await p.locator('section[aria-label] select').first().selectOption('days');
  const checks=p.locator('section[aria-label] input[type=checkbox]');await checks.first().uncheck();
  await p.waitForTimeout(600);await p.reload();await p.locator('.hgrid').waitFor();
  assert.equal(await p.locator('section[aria-label] select').first().inputValue(),'days');
  assert.equal(await p.locator('section[aria-label] input[type=checkbox]').first().isChecked(),false);
  console.log('PASS '+lang+' habit frequency, cycle, archive, restore, order and persistence');await ctx.close();
 }
}finally{await b.close();await s.stop();}
