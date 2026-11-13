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
    const v=c[0]==='t'?Math.abs(r.y-24)<=3:Math.abs(r.y+r.height-(H-24))<=3, h=c[1]==='l'?Math.abs(r.x-80)<=3:Math.abs(r.x+r.width-(W-24))<=3;
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
  // --- minimize: only the phase ring stays; hover, focus or a tap brings the whole card back ---
  {
   await p.setViewportSize({width:1440,height:900});
   await seed('focus');
   await p.evaluate(()=>{localStorage.removeItem('sc-mini-corner');localStorage.removeItem('sc-mini-compact');});
   const root=p.locator('.mini-timer'), trigger=root.locator('.mt-trigger');
   const flag=()=>p.evaluate(()=>localStorage.getItem('sc-mini-compact'));
   const size=async()=>{const r=await root.boundingBox();return {w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.x+r.width),bottom:Math.round(r.y+r.height)};};
   await trigger.hover();
   await p.locator('.mt-compact').click();
   await p.mouse.move(700,450);
   check('minimize: 44 px circle in the corner it was in',JSON.stringify(await size())==='{"w":44,"h":44,"right":1416,"bottom":876}');
   check('minimize: remembered on this device',await flag()==='1');
   check('minimize: no number or pause button, ring stays',!(await p.locator('.mt-pause').isVisible())&&!(await root.locator('.mt-trigger b').isVisible())&&await root.locator('svg.ring').isVisible());
   const name=await trigger.getAttribute('aria-label');
   check('minimize: the name says the time left to the minute',/\d+ (min left|dk kald)/.test(name||''));
   const phase=await root.evaluate(e=>e.className);
   check('minimize: ring keeps the phase colour class',/phase-focus/.test(phase));
   await p.screenshot({path:`${dir}/${lang}-compact-closed.png`});
   await p.reload();await root.waitFor();
   check('minimize: survives a reload',(await size()).w===44);
   await trigger.hover();
   check('hover brings the full card back (300 px)',(await size()).w===300&&await trigger.getAttribute('aria-expanded')==='true');
   await p.screenshot({path:`${dir}/${lang}-compact-open.png`});
   await p.mouse.move(700,450);
   check('leaving shrinks it again',(await size()).w===44);
   await trigger.focus();
   check('keyboard focus opens it',(await size()).w===300&&await trigger.getAttribute('aria-expanded')==='true');
   await p.keyboard.press('Escape');
   check('Escape shrinks it back',(await size()).w===44);
   await p.locator('body').click({position:{x:2,y:2}});
   await trigger.tap();
   check('a tap opens it',(await size()).w===300);
   await p.locator('body').tap({position:{x:2,y:2}});
   check('a tap outside shrinks it',(await size()).w===44);
   // the circle drags like the card does
   const c0=await trigger.boundingBox();await p.mouse.move(c0.x+22,c0.y+22);
   const r=await trigger.boundingBox();const sx=r.x+r.width/2,sy=r.y+r.height/2;
   await p.mouse.move(sx,sy);await p.mouse.down();for(let i=1;i<=6;i++) await p.mouse.move(sx-1200*i/6,sy-700*i/6);await p.mouse.up();
   await p.mouse.move(700,450);
   const moved=await size();
   check('the circle drags to another corner',(await p.evaluate(()=>localStorage.getItem('sc-mini-corner')))==='tl'&&moved.w===44&&moved.right===124);
   // a phone: the circle sits at the right edge; open it is full width
   await p.setViewportSize({width:390,height:800});await p.evaluate(()=>localStorage.setItem('sc-mini-corner','br'));await p.reload();await root.waitFor();
   const pc=await root.boundingBox();
   check('phone: circle at the right edge, above the tab bar',Math.round(pc.width)===44&&Math.round(pc.x+pc.width)===378&&pc.y+pc.height<=800-64);
   await p.screenshot({path:`${dir}/${lang}-phone-compact.png`});
   await trigger.tap();
   const po=await root.boundingBox();
   check('phone: tapping it opens the full card',Math.round(po.width)===366&&po.x>=11);
   await p.screenshot({path:`${dir}/${lang}-phone-compact-open.png`});
   await p.locator('body').tap({position:{x:2,y:200}});
   // and back to the full card for good
   await p.setViewportSize({width:1440,height:900});await p.reload();await root.waitFor();
   await trigger.hover();await p.locator('.mt-compact').click();await p.mouse.move(700,450);
   check('"keep expanded" returns the full card',(await size()).w===300&&await flag()===null);
   await p.evaluate(()=>{localStorage.removeItem('sc-mini-corner');localStorage.removeItem('sc-mini-compact');});await p.reload();await root.waitFor();
  }
  // --- a phase change draws the card's edge in the new phase colour once (border-color only; none when motion is reduced) ---
  {
   const live={...base,focus:{sessions:[],active:{phase:'focus',startedAt:new Date(Date.now()-120000).toISOString(),plannedMin:25,pausedLeft:null,blockId:null,label:'Pilot'}}};
   const c2=await b.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
   await c2.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
   const q=await c2.newPage();
   const flashOf=(page)=>page.locator('.mini-timer').evaluate(e=>({cls:e.className,name:getComputedStyle(e,'::after').animationName,edge:getComputedStyle(e,'::after').borderTopColor,shadow:getComputedStyle(e).boxShadow}));
   await api.put(key,live);await q.goto(s.url+'/');await q.locator('.mini-timer').waitFor();
   await q.waitForTimeout(600);
   const calm=await flashOf(q);
   check('no cue while nothing changes',!/mt-flash/.test(calm.cls)&&calm.name==='none');
   await q.locator('.mt-trigger').hover();
   await q.locator('.mt-panel button').nth(1).click();
   await q.locator('.mini-timer.mt-flash').waitFor({timeout:3000});
   await q.mouse.move(700,450);await q.waitForTimeout(450);
   const mid=await flashOf(q);
   check('focus to break: the edge animates (mt-flash)',mid.name==='mt-flash');
   check('focus to break: the edge reaches the break colour, not transparent',mid.edge!=='rgba(0, 0, 0, 0)'&&mid.edge!=='transparent');
   check('the cue adds no glow or shadow',mid.shadow===calm.shadow);
   await q.screenshot({path:`${dir}/${lang}-phase-flash.png`});
   await q.waitForTimeout(1300);
   check('the cue is gone after about a second',!/mt-flash/.test((await flashOf(q)).cls));
   // a session that is already in its break when the page loads is not a change
   await api.put(key,{...base,focus:{sessions:[],active:{...live.focus.active,phase:'short',plannedMin:5}}});
   await q.reload();await q.locator('.mini-timer').waitFor();await q.waitForTimeout(400);
   check('a reload mid-break shows no cue',!/mt-flash/.test((await flashOf(q)).cls));
   // reduced motion (the system setting, via the context; and the app's own setting, via data-motion)
   await api.put(key,live);await p.goto(s.url+'/');await p.locator('.mini-timer').waitFor();
   await p.locator('.mt-trigger').hover();await p.locator('.mt-panel button').nth(1).click();await p.waitForTimeout(500);
   const red=await flashOf(p);
   check('reduced motion (system): no cue',!/mt-flash/.test(red.cls)&&red.name==='none');
   await api.put(key,live);await q.reload();await q.locator('.mini-timer').waitFor();
   await q.evaluate(()=>{document.documentElement.dataset.motion='reduce';});
   await q.locator('.mt-trigger').hover();await q.locator('.mt-panel button').nth(1).click();await q.waitForTimeout(500);
   const red2=await flashOf(q);
   check('reduced motion (app setting): no cue',!/mt-flash/.test(red2.cls)&&red2.name==='none');
   await c2.close();
   await api.put(key,live);await p.goto(s.url+'/');await p.locator('.mini-timer').waitFor();
  }
  // --- in a break: the next block (name and start time) and a button that ends the break and starts that focus ---
  {
   const d=new Date(),nowMin=d.getHours()*60+d.getMinutes(),start=Math.min(nowMin+20,1400);
   const col=base.columns[base.columns.length-1];
   const hhmm=`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`;
   const withBlock=(active)=>({...base,columns:[...base.columns.slice(0,-1),{...col,blocks:[{id:'b-next',start,end:start+30,label:'Review draft',note:'',kind:'deep'}]}],focus:{sessions:[],active}});
   const brk={phase:'short',startedAt:new Date(Date.now()-60000).toISOString(),plannedMin:5,pausedLeft:null,blockId:null,label:lang==='en'?'Break':'Mola'};
   const root=p.locator('.mini-timer'), panel=p.locator('.mt-panel');
   await api.put('settings',{...settings,focus:{...settings.focus,fullscreenBreak:false,sound:false,autoFocus:false,strict:false}});
   await api.put(key,withBlock(brk));await p.goto(s.url+'/');await root.waitFor();
   await p.locator('.mt-trigger').hover();
   const text=await panel.innerText();
   check('break: the next block name and start time are shown',/Review draft/.test(text)&&text.includes(hhmm)&&/Next block|Sıradaki blok/.test(text));
   check('break: "Start next focus" button is there',await p.locator('.mt-start-next').isVisible());
   const pr=await root.boundingBox(),sb=await p.locator('.mt-start-next').boundingBox();
   check('break: details stay inside the 300 px card',Math.round(pr.width)===300&&sb.x>=pr.x&&sb.x+sb.width<=pr.x+pr.width&&pr.y>=0);
   await p.screenshot({path:`${dir}/${lang}-break-open.png`});
   await p.mouse.move(700,450);await p.locator('body').click({position:{x:2,y:2}});await p.screenshot({path:`${dir}/${lang}-break-closed.png`});
   await p.locator('.mt-trigger').hover();
   await p.locator('.mt-start-next').click();await p.waitForTimeout(900);
   const a1=(await api.get(key)).value.focus.active;
   check('start next focus: a focus phase starts',a1&&a1.phase==='focus'&&a1.pausedLeft===null);
   check('start next focus: on the next block, at the set focus length',a1.blockId==='b-next'&&a1.label==='Review draft'&&a1.plannedMin===(settings.focus.focusMin||25));
   check('the button is only for breaks',await p.locator('.mt-start-next').count()===0);
   // strict mode keeps its rules: the break can be skipped or left, the focus that starts cannot be paused or finished
   await api.put('settings',{...settings,focus:{...settings.focus,fullscreenBreak:false,sound:false,autoFocus:false,strict:true}});
   await api.put(key,withBlock(brk));await p.goto(s.url+'/');await root.waitFor();await p.locator('.mt-trigger').hover();
   check('strict: skipping the break and starting the next focus stay available',await panel.locator('button').nth(1).isEnabled()&&await p.locator('.mt-start-next').isEnabled());
   await p.locator('.mt-start-next').click();await p.waitForTimeout(900);
   check('strict: the new focus is locked as before',(await api.get(key)).value.focus.active.phase==='focus'&&await p.locator('.mt-pause').isDisabled()&&await panel.locator('button').nth(1).isDisabled());
   await api.put('settings',{...settings,focus:{...settings.focus,fullscreenBreak:false,sound:false,autoFocus:false,strict:false}});
   // the card is not rebuilt, so the phase cue still plays (motion allowed)
   const c3=await b.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
   await c3.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);
   const q=await c3.newPage();
   await api.put(key,withBlock(brk));await q.goto(s.url+'/');await q.locator('.mini-timer').waitFor();
   await q.locator('.mt-trigger').hover();await q.locator('.mt-start-next').click();
   await q.locator('.mini-timer.mt-flash').waitFor({timeout:3000});
   check('break to focus: the phase cue plays',true);
   await c3.close();
   await api.put(key,{...base,focus:{sessions:[],active:{phase:'focus',startedAt:new Date(Date.now()-120000).toISOString(),plannedMin:25,pausedLeft:null,blockId:null,label:'Pilot'}}});
   await p.goto(s.url+'/');await root.waitFor();
  }
  // --- Alt+P pauses or resumes from any screen; typing in a field is left alone; the Focus screen keeps Space and does not double up ---
  {
   const off={...settings.focus,fullscreenBreak:false,sound:false,autoFocus:false};
   await api.put('settings',{...settings,focus:{...off,strict:false}});
   await api.put(key,{...base,focus:{sessions:[],active:{phase:'focus',startedAt:new Date(Date.now()-120000).toISOString(),plannedMin:25,pausedLeft:null,blockId:null,label:'Pilot'}}});
   await p.setViewportSize({width:1440,height:900});await p.goto(s.url+'/');await p.locator('.mini-timer').waitFor();
   const paused=async()=>{await p.waitForTimeout(800);return (await api.get(key)).value.focus.active.pausedLeft!=null;};
   const idle=()=>p.locator('body').click({position:{x:2,y:2}});
   await idle();
   await p.keyboard.press('Alt+KeyP');check('Alt+P pauses the timer from the home screen',await paused());
   await p.keyboard.press('Alt+KeyP');check('Alt+P resumes it',!(await paused()));
   await p.evaluate(()=>{const i=document.createElement('input');i.id='probe';i.style.cssText='position:fixed;left:4px;top:4px;z-index:99';document.body.append(i);i.focus();});
   await p.keyboard.press('Alt+KeyP');check('Alt+P is ignored while typing in a field',!(await paused()));
   await p.evaluate(()=>{document.getElementById('probe')?.remove();const d=document.createElement('div');d.id='probe2';d.contentEditable='true';d.style.cssText='position:fixed;left:4px;top:40px;z-index:99';d.textContent='x';document.body.append(d);d.focus();});
   await p.keyboard.press('Alt+KeyP');check('Alt+P is ignored in a contenteditable',!(await paused()));
   await p.evaluate(()=>{document.getElementById('probe2')?.remove();const d=document.createElement('dialog');d.id='probe3';d.textContent='x';document.body.append(d);d.showModal();});
   await p.keyboard.press('Alt+KeyP');check('Alt+P is ignored while a dialog is open',!(await paused()));
   await p.evaluate(()=>document.getElementById('probe3')?.remove());
   await idle();
   await p.keyboard.press('Control+Alt+KeyP');check('other modifiers do not trigger it',!(await paused()));
   await p.goto(s.url+'/week');await p.locator('.mini-timer').waitFor();await idle();
   await p.keyboard.press('Alt+KeyP');check('Alt+P works on another screen too',await paused());
   await p.keyboard.press('Alt+KeyP');check('and resumes there',!(await paused()));
   await p.goto(s.url+'/focus');await p.waitForTimeout(800);await idle();
   await p.keyboard.press('Alt+KeyP');check('Focus screen: Alt+P pauses once (no double toggle)',await paused());
   await p.keyboard.press('Space');check('Focus screen: Space still resumes',!(await paused()));
   await p.keyboard.press('Alt+KeyP');check('Focus screen: Alt+P pauses again',await paused());
   await p.keyboard.press('Alt+KeyP');check('Focus screen: Alt+P resumes',!(await paused()));
   await api.put('settings',{...settings,focus:{...off,strict:true}});
   await p.goto(s.url+'/');await p.locator('.mini-timer').waitFor();await idle();
   await p.keyboard.press('Alt+KeyP');check('strict mode: Alt+P cannot pause a running focus',!(await paused()));
   await api.put('settings',{...settings,focus:{...off,strict:false}});
   await p.goto(s.url+'/');await p.locator('.mini-timer').waitFor();await idle();await p.keyboard.press('Shift+Slash');await p.waitForTimeout(300);
   const body=await p.locator('body').innerText();
   check('the shortcut list has the Alt+P row',/Alt/.test(body)&&/(Pause or resume the focus timer|Odak zamanlayıcıyı duraklat)/.test(body));
   await p.keyboard.press('Escape');
  }
  //__MORE__
  await c.close();
 }
 console.log(`PASS mini-timer: ${passed} assertions; screenshots in reports/shots/mini-timer-v3`);
} finally {await b.close();s.stop();}

