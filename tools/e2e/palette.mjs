import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
mkdirSync('reports/shots/palette',{recursive:true});
try {
 for(const lang of ['en','tr']) {
  const api=await demoAccount(client(s.url),{lang});
  const context=await b.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
  const p=await context.newPage();await p.goto(s.url+'/');await p.locator('.rail').waitFor({state:'attached'});
  const open=async()=>{await p.keyboard.press('Control+k');await p.locator('.command-palette').getByRole('combobox').waitFor();};
  const run=async(text)=>{await open();await p.locator('.command-palette').getByRole('combobox').fill(text);await p.keyboard.press('Enter');await p.locator('.command-palette').waitFor({state:'detached'});};
  await p.keyboard.press('Meta+k');await p.locator('.command-palette').getByRole('combobox').waitFor();await p.keyboard.press('Tab');assert.ok(await p.locator('.command-palette').getByRole('combobox').evaluate(el=>el===document.activeElement));await p.keyboard.press('ArrowDown');assert.equal(await p.getByRole('option',{selected:true}).count(),1);await p.keyboard.press('Escape');
  await run(lang==='tr'?'ayarlar':'settings');await p.waitForURL('**/settings');
  await run('tomorrow');assert.match(p.url(),/\/day\/\d{4}-\d{2}-\d{2}$/);
  await run('next friday');await run('15 kas');assert.match(p.url(),/11-15$/);
  await run('start focus');await run('pause focus');await open();await p.locator('.command-palette').getByRole('combobox').fill('resume focus');assert.equal(await p.locator('.command-palette').getByRole('option').count(),1);await p.keyboard.press('Escape');
  await run('Task: Palette test tomorrow 14:30 @palette !1');
  await p.waitForTimeout(1500);let doc=(await api.get('inbox')).value;let task=doc.items.find(x=>x.text==='Palette test');assert.ok(task);assert.equal(task.dueTime,'14:30');assert.equal(task.priority,1);assert.ok(task.tags.includes('palette'));assert.ok(task.due);
  await run('Capture: Palette capture');await p.waitForTimeout(1500);doc=(await api.get('inbox')).value;assert.ok(doc.items.some(x=>x.text==='Palette capture'));
  await p.locator('.rail a').first().focus();await open();const before=p.url();await p.locator('.command-palette').getByRole('combobox').fill('twmq');assert.equal(p.url(),before);await p.keyboard.press('Escape');assert.ok(await p.locator('.rail a').first().evaluate(el=>el===document.activeElement));
  for(const width of [1440,390]) for(const theme of ['light','dark']) {
   await p.setViewportSize({width,height:900});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await open();await p.screenshot({path:`reports/shots/palette/${lang}-${width}-${theme}.png`});await p.keyboard.press('Escape');
  }
  await p.getByRole('button',{name:lang==='tr'?'Daha fazla':'More',exact:true}).click();assert.equal(await p.locator('.more-sheet').getByRole('button',{name:/Ctrl \/ Cmd K/}).count(),0);await p.keyboard.press('Control+k');await p.locator('.command-palette').getByRole('combobox').waitFor();await p.keyboard.press('Escape');
  const settings=(await api.get('settings')).value;await api.put('settings',{...settings,features:{...settings.features,boards:false}});await p.reload();await p.locator('.rail').waitFor({state:'attached'});await open();await p.locator('.command-palette').getByRole('combobox').fill('boards');assert.equal(await p.locator('.command-palette').getByRole('option').count(),0);await p.keyboard.press('Escape');
  await context.close();
 }
 console.log('PASS palette: keyboard, dates, focus, parsed task, capture, focus return, features, TR/EN and 8 screenshots');
} finally {await b.close();await s.stop();}


