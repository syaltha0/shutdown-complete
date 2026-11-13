import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s = await startServer();
const b = await launch();
const dir = 'reports/shots/mini-timer-v2';
mkdirSync(dir, {recursive:true});
let passed=0;
const check=(name,ok)=>{if(!ok) throw Error(name);passed++;};
try {
 for(const lang of ['en','tr']) {
  const api=await demoAccount(client(s.url),{lang});
  const settings=(await api.get('settings')).value;
  await api.put('settings',{...settings,focus:{...settings.focus,fullscreenBreak:false,sound:false,autoFocus:false}});
  const c=await b.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',hasTouch:true});
  await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
  const p=await c.newPage();
  const key='day:'+iso(new Date());
  const base=(await api.get(key)).value;
  const seed=async(phase,paused=false)=>{
   await api.put(key,{...base,focus:{sessions:[],active:{phase,startedAt:new Date(Date.now()-120000).toISOString(),plannedMin:phase==='focus'?25:5,pausedLeft:paused?1200:null,blockId:null,label:lang==='tr'?'Makale taslağı':'Article outline'}}});
   await p.goto(s.url+'/');await p.locator('.mini-timer').waitFor();
  };
  for(const width of [1440,390]) for(const theme of ['light','dark']) for(const state of ['focus','short','paused']) {
   await p.setViewportSize({width,height:900});
   await seed(state==='short'?'short':'focus',state==='paused');
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const root=p.locator('.mini-timer'), trigger=root.locator('.mt-trigger'), panel=root.locator('.mt-panel');
   await p.mouse.move(0,0);await p.locator('body').click({position:{x:2,y:2}});
   await p.screenshot({path:`${dir}/${lang}-${width}-${theme}-${state}-closed.png`});
   await trigger.hover();check('hover opens',await trigger.getAttribute('aria-expanded')==='true');
   await p.screenshot({path:`${dir}/${lang}-${width}-${theme}-${state}-open.png`});
   const box=await panel.boundingBox(), pill=await root.boundingBox();
   check('panel fits',box.x>=12 && box.x+box.width<=width-12 && box.y>=0 && box.y+box.height<=pill.y+1);
   check('phone tab clearance',width!==390 || pill.y+pill.height<=824);
   await p.mouse.move(0,0);check('leave closes',await trigger.getAttribute('aria-expanded')==='false');
   await trigger.focus();check('keyboard opens',await trigger.getAttribute('aria-expanded')==='true');
   await p.keyboard.press('Escape');check('Escape closes',await trigger.getAttribute('aria-expanded')==='false');
   await trigger.tap();check('touch opens',await trigger.getAttribute('aria-expanded')==='true');
   await p.locator('body').tap({position:{x:2,y:2}});check('outside closes',await trigger.getAttribute('aria-expanded')==='false');
  }
  await seed('focus');
  const panel=p.locator('.mt-panel');await p.locator('.mt-trigger').hover();
  await panel.locator('button').nth(0).click();
  await p.waitForTimeout(800);
  check('pause persisted',(await api.get(key)).value.focus.active.pausedLeft!=null);
  await panel.locator('button').nth(1).click();await p.waitForTimeout(800);
  check('extend persisted',(await api.get(key)).value.focus.active.plannedMin===30);
  await panel.locator('button').nth(0).click();await p.waitForTimeout(800);
  check('resume persisted',(await api.get(key)).value.focus.active.pausedLeft===null);
  await panel.locator('button').nth(2).click();await p.waitForTimeout(800);
  check('finish enters break',(await api.get(key)).value.focus.active.phase==='short');
  await panel.locator('button').nth(2).click();await p.waitForTimeout(800);
  check('skip ends break',(await api.get(key)).value.focus.active===null);
  await api.put('settings',{...settings,focus:{...settings.focus,strict:true,fullscreenBreak:false}});await seed('focus');
  await p.locator('.mt-trigger').hover();
  check('strict locks pause and finish',await panel.locator('button').nth(0).isDisabled() && await panel.locator('button').nth(2).isDisabled());
  await p.goto(s.url+'/focus');check('hidden on focus',await p.locator('.mini-timer').count()===0);
  await c.close();
 }
 console.log(`PASS mini-timer: ${passed} assertions; 48 screenshots`);
} finally {await b.close();s.stop();}

