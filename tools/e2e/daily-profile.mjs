import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const srv = await startServer();
const browser = await launch();
try {
 for (const lang of ['en','tr']) {
  const api = await demoAccount(client(srv.url), {lang});
  const original = (await api.get('settings')).value;
  await api.put('settings', {...original, features: undefined});
  const settings = (await api.get('settings')).value;
  const ctx = await browser.newContext({viewport:{width:390,height:844},locale:lang});
  await ctx.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:srv.url}]);
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.locator('.b-hello').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  console.log('PASS '+lang+' home fits 390px');
  assert.deepEqual((await api.get('settings')).value, settings);
  for (const route of ['boards','metrics']) assert(await page.locator(`nav a[href="/${route}"]`).count() > 0);
  await page.goto(srv.url+'/focus');
  await page.locator('.friends').waitFor();
  console.log('PASS '+lang+' existing account settings preserved');
  const date=iso(new Date()), day=(await api.get('day:'+date)).value;
  await api.put('day:'+date,{...day,tasks:[{id:'a',text:'First',done:false},{id:'b',text:'Second',done:false}]});
  await page.goto(srv.url+'/day/'+date);
  const buttons=page.locator('.key-task'); await buttons.first().focus(); await buttons.first().press('Space'); await buttons.nth(1).focus(); await buttons.nth(1).press('Space');
  await page.waitForTimeout(1200);
  assert.equal((await api.get('day:'+date)).value.keyTaskId,'b');
  assert.equal(await page.locator('.key-task[aria-pressed="true"]').count(),1);
  await page.goto(srv.url); await page.locator('.b-today .key-task-selected').waitFor();
  assert.equal(await page.locator('.b-today .b-open-list li').first().textContent(),'Second');
  await page.goto(srv.url+'/shutdown/'+date); await page.locator('.carry.key-task-selected').waitFor();
  assert.equal(await page.locator('.carry').first().textContent(),'Second');
  const next = new Date(); next.setDate(next.getDate()+1);
  await page.goto(srv.url+'/day/'+iso(next));
  assert.equal(await page.locator('.key-task[aria-pressed="true"]').count(),0);
  console.log('PASS '+lang+' single key task leads overview and shutdown');
  await api.put('settings',{...settings,setupDone:false,setupAgain:false,tourDone:false,features:undefined});
  await page.evaluate(()=>{sessionStorage.setItem('sc-welcome-2',JSON.stringify({step:2,reached:2,person:'Robin',uses:['work']}));});
  await page.goto(srv.url);
  await page.locator('.profile-choice select').waitFor();
  assert.equal(await page.locator('.profile-choice select').inputValue(),'daily');
  await page.locator('.welcome-foot .btn.primary').click();
  await page.waitForTimeout(1800);
  const profile=(await api.get('settings')).value.features;
  assert.equal(profile.boards,false); assert.equal(profile.friends,false); assert.equal(profile.metrics,true); assert.equal(profile.habits,true); assert.equal(profile.longTerm,false);
  console.log('PASS '+lang+' first-run daily default writes explicit feature flags');
  await page.goto(srv.url);
  await page.locator('nav a[href^="/week"]').first().waitFor({ state: 'attached', timeout: 8000 }); // the week stays in the daily profile
  assert.equal(await page.locator('nav a[href="/boards"]').count(),0);
  await page.goto(srv.url+'/focus');
  await page.locator('.focus-grid').waitFor();
  assert.equal(await page.locator('.friends').count(),0);
  await page.goto(srv.url+'/settings');
  const featureOrder = ['inbox','boards','countdown','habits','metrics','friends','exams','longTerm'];
  for (const feature of ['boards','friends','longTerm']) {
    await page.locator('.feature-row input').nth(featureOrder.indexOf(feature)).check();
    await page.waitForTimeout(1200);
    assert.equal((await api.get('settings')).value.features[feature],true);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  console.log('PASS '+lang+' individual features restored from Settings without mobile overflow');
  assert.equal(await page.locator('.rail a[href="/boards"], .rail a[href="/metrics"]').count(),2);
  await page.goto(srv.url+'/focus');
  await page.locator('.friends').waitFor();
  await ctx.close();
 }
} finally { await browser.close(); await srv.stop(); }
