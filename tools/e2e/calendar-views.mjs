import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';
const s=await startServer(); const api=await demoAccount(client(s.url),{lang:'en'}); const b=await launch(); const c=await b.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}); await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]); const p=await c.newPage(); const D=iso(new Date()); let passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('PASS '+name);};
try {
 const day=(await api.get('day:'+D)).value; day.tasks=[{id:'room-one',text:'Room task',done:false}]; await api.put('day:'+D,day);
 await p.goto(s.url+'/day/'+D); await p.locator('.calendar-view > button').waitFor();
 for (const [label,path] of [['Month','month/'+D.slice(0,7)],['Week','week/'+weekOf(D)],['Day','day/'+D],['Agenda','agenda/'+D]]) {await p.goto(s.url+'/day/'+D); await p.locator('.calendar-view > button').click(); await p.locator('.calendar-menu').getByRole('button',{name:label,exact:true}).click(); await p.waitForURL('**/'+path); check('switch '+label,true);}
 await p.locator('.calendar-view > button').click();await p.getByLabel('Jump to date').fill('2027-02-19');await p.waitForURL('**/agenda/2027-02-19'); check('jump in agenda',true);
 await p.goto(s.url+'/agenda/'+D);await p.getByText('Room task',{exact:true}).waitFor();check('agenda includes day tasks',true);
 const before=await p.locator('.agenda-day').count();await p.getByRole('button',{name:'Show more',exact:true}).click();check('more days',await p.locator('.agenda-day').count()===before+14);
 await p.goto(s.url+'/focus');await p.getByRole('button',{name:'Focus room',exact:true}).click(); await p.locator('.room-task-tab').hover();await p.locator('.room-task-body').waitFor();check('hover opens tasks',true);
 await p.mouse.move(10,10);await p.locator('.room-task-body').waitFor({state:'hidden'});check('leave closes tasks',true);
 await p.locator('.room-task-tab').click(); await p.getByRole('button',{name:'Focus on this',exact:true}).click();await p.locator('.room-controls').getByRole('button',{name:'Start focus',exact:true}).click();await p.waitForTimeout(700);check('focus attaches task',(await api.get('day:'+D)).value.focus.active.task.id==='room-one');
 await p.locator('.room-task-tab').hover(); await p.locator('.room-task-row input').click(); await p.waitForTimeout(800);check('tick persists',(await api.get('day:'+D)).value.tasks[0].done);
 await p.getByLabel('Capture a task').fill('Second room task'); await p.getByRole('button',{name:'Add task',exact:true}).click();await p.waitForTimeout(800);check('add persists',(await api.get('day:'+D)).value.tasks.some(t=>t.text==='Second room task'));
 await p.keyboard.press('Escape');await p.locator('.focus-room').waitFor({state:'hidden'});check('Escape leaves room',true);
 console.log(`${passed} passed, 0 failed`);
} finally {await b.close();s.stop();}
