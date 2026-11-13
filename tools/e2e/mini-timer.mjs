import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s = await startServer();
const b = await launch();
const dir = 'reports/shots/mini-timer-v3';
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
   check('one body: details inside the pill, all on screen',box.x>=pill.x-1 && box.x+box.width<=pill.x+pill.width+1 && box.y>=pill.y-1 && pill.x>=12 && pill.x+pill.width<=width-12 && pill.y>=0 && pill.y+pill.height<=900);
   check('phone tab clearance',width!==390 || pill.y+pill.height<=824);
   await p.mouse.move(0,0);check('leave closes',await trigger.getAttribute('aria-expanded')==='false');
   await trigger.focus();check('keyboard opens',await trigger.getAttribute('aria-expanded')==='true');
   await p.keyboard.press('Escape');check('Escape closes',await trigger.getAttribute('aria-expanded')==='false');
   await trigger.tap();check('touch opens',await trigger.getAttribute('aria-expanded')==='true');
   await p.locator('body').tap({position:{x:2,y:2}});check('outside closes',await trigger.getAttribute('aria-expanded')==='false');
  }
  await seed('focus');
  const panel=p.locator('.mt-panel');await p.locator('.mt-trigger').hover();
  const pause=p.locator('.mt-pause');
  await pause.click();
  await p.waitForTimeout(800);
  check('pause persisted',(await api.get(key)).value.focus.active.pausedLeft!=null);
  await panel.locator('button').nth(0).click();await p.waitForTimeout(800);
  check('extend persisted',(await api.get(key)).value.focus.active.plannedMin===30);
  await pause.click();await p.waitForTimeout(800);
  check('resume persisted',(await api.get(key)).value.focus.active.pausedLeft===null);
  await panel.locator('button').nth(1).click();await p.waitForTimeout(800);
  check('finish enters break',(await api.get(key)).value.focus.active.phase==='short');
  await panel.locator('button').nth(1).click();await p.waitForTimeout(800);
  check('skip ends break',(await api.get(key)).value.focus.active===null);
  await api.put('settings',{...settings,focus:{...settings.focus,strict:true,fullscreenBreak:false}});await seed('focus');
  await p.locator('.mt-trigger').hover();
  check('strict locks pause and finish',await p.locator('.mt-pause').isDisabled() && await panel.locator('button').nth(1).isDisabled());
  await p.goto(s.url+'/focus');check('hidden on focus',await p.locator('.mini-timer').count()===0);
  // --- corners: drag the pill row to any of the four corners; the choice is remembered on this device ---
  {
   await api.put('settings',{...settings,focus:{...settings.focus,fullscreenBreak:false,sound:false,autoFocus:false,strict:false}});
   await p.setViewportSize({width:1440,height:900});
   await seed('focus');
   await p.evaluate(()=>localStorage.removeItem('sc-mini-corner'));
   const root=p.locator('.mini-timer'), trigger=root.locator('.mt-trigger');
   const stored=()=>p.evaluate(()=>localStorage.getItem('sc-mini-corner'));
   const dragTo=async(x,y,fromSel='.mt-trigger')=>{
    const r=await p.locator(fromSel).boundingBox();const sx=r.x+r.width/2,sy=r.y+r.height/2;
    await p.mouse.move(sx,sy);await p.mouse.down();
    for(let i=1;i<=8;i++) await p.mouse.move(sx+(x-sx)*i/8,sy+(y-sy)*i/8);
    await p.mouse.up();
   };
   const at=async(c)=>{
    const r=await root.boundingBox(),W=await p.evaluate(()=>innerWidth),H=await p.evaluate(()=>innerHeight);
    const v=c[0]==='t'?Math.abs(r.y-24)<=3:Math.abs(r.y+r.height-(H-24))<=3, h=c[1]==='l'?Math.abs(r.x-24)<=3:Math.abs(r.x+r.width-(W-24))<=3;
    return v&&h;
   };
   const lc=lang==='en'?'EN':'TR';
   for(const [c,x,y] of [['tl',120,120],['tr',1320,120],['bl',120,780],['br',1320,780]]) {
    await dragTo(x,y);
    await p.waitForTimeout(100);
    check(`${lc} drag settles in ${c}`,await at(c));
    check(`${lc} corner ${c} remembered`,await stored()===c);
    check('a drag does not leave the card open',await trigger.getAttribute('aria-expanded')==='false');
    await p.mouse.move(700,450);
    await p.screenshot({path:`${dir}/${lang}-corner-${c}.png`});
    await trigger.hover();
    const pill=await root.boundingBox(),box=await p.locator('.mt-panel').boundingBox(),row=await p.locator('.mt-row').boundingBox();
    check(`${c}: details open ${c[0]==='t'?'below':'above'} the pill row`,c[0]==='t'?box.y>=row.y+row.height-1:box.y+box.height<=row.y+1);
    check(`${c}: open card fits the screen at 300 px`,pill.x>=0&&pill.y>=0&&pill.x+pill.width<=1440&&pill.y+pill.height<=900&&Math.abs(pill.width-300)<=1);
    await p.screenshot({path:`${dir}/${lang}-corner-${c}-open.png`});
    await p.mouse.move(700,450);
   }
   await dragTo(1320,120);await p.waitForTimeout(100);
   await p.reload();await root.waitFor();
   check('corner survives a reload',await at('tr'));
   // a press that barely moves is a click, not a drag
   const t=await p.locator('.mt-trigger').boundingBox();
   await p.mouse.move(t.x+20,t.y+10);await p.mouse.down();await p.mouse.move(t.x+23,t.y+11);await p.mouse.up();
   check('a 3 px wobble is a click, not a drag',await at('tr')&&await trigger.getAttribute('aria-expanded')==='true');
   // the keyboard way
   await p.mouse.move(700,450);await trigger.focus();
   const before=await stored();
   await p.locator('.mt-corner').focus();await p.keyboard.press('Enter');
   check('"move to another corner" cycles the corner',await stored()!==before&&['br','bl','tl','tr'].includes(await stored()));
   await p.locator('.mini-timer').evaluate(()=>0);
   // a phone: only top or bottom, full width, clear of the tab bar and below the header
   await p.setViewportSize({width:390,height:800});await p.evaluate(()=>localStorage.setItem('sc-mini-corner','br'));await p.reload();await root.waitFor();
   const cdp=await c.newCDPSession(p);
   const touchDrag=async(x0,y0,x1,y1)=>{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0}]});
    for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*i/8,y:y0+(y1-y0)*i/8}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   };
   let r0=await p.locator('.mt-trigger').boundingBox();
   await touchDrag(r0.x+30,r0.y+10,200,90);await p.waitForTimeout(150);
   let pr=await root.boundingBox();
   check('phone: a touch drag to the top moves it up, full width',(await stored()).startsWith('t')&&pr.y<200&&pr.x>=11&&pr.x+pr.width<=379&&pr.width>=360);
   check('phone: top card sits below the header, clear of the edge',pr.y>=40);
   await p.screenshot({path:`${dir}/${lang}-phone-top.png`});
   await p.locator('.mt-trigger').tap();
   const pp=await p.locator('.mt-panel').boundingBox(),rr=await p.locator('.mt-row').boundingBox();
   check('phone: top corner opens downward and fits above the tab bar',pp.y>=rr.y+rr.height-1&&pp.y+pp.height<=800-64);
   await p.screenshot({path:`${dir}/${lang}-phone-top-open.png`});
   await p.locator('body').tap({position:{x:2,y:300}});
   r0=await p.locator('.mt-trigger').boundingBox();
   await touchDrag(r0.x+30,r0.y+10,200,700);await p.waitForTimeout(150);
   pr=await root.boundingBox();
   check('phone: dragged back to the bottom, above the tab bar',(await stored()).startsWith('b')&&pr.y+pr.height<=800-64);
   await p.setViewportSize({width:1440,height:900});
   await p.evaluate(()=>localStorage.removeItem('sc-mini-corner'));await p.reload();await root.waitFor();
  }
  //__MORE__
  await c.close();
 }
 console.log(`PASS mini-timer: ${passed} assertions; 48 screenshots`);
} finally {await b.close();s.stop();}

