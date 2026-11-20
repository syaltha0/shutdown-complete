import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s=await startServer(), b=await launch();
try {
 for(const lang of ['en','tr']) {
  const api=await demoAccount(client(s.url),{lang});
  await api.put('inbox',{items:[],lists:[]});
  const c=await b.newContext();await c.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:s.url}]);const p=await c.newPage();
  await p.goto(s.url+'/settings');const panel=p.getByTestId('task-import');
  const choose=async(source='todoist')=>{await panel.getByRole('button',{name:lang==='tr'?'Başka uygulamadan al':'Import from another app',exact:true}).click();await panel.locator('select').selectOption(source);await panel.locator('input[type=file]').setInputFiles(`tools/fixtures/import/${source}.csv`);await panel.getByTestId('task-import-preview').waitFor();};
  const cancel=()=>panel.getByRole('button',{name:lang==='tr'?'Vazgeç':'Cancel',exact:true}).click();
  const apply=()=>panel.getByRole('button',{name:lang==='tr'?'İçe aktar':'Import tasks',exact:true}).click();
  // Poll the server directly: browser fetches may observe the service worker's local document.
  const count=async n=>{const deadline=Date.now()+10000;let actual;do{actual=(await api.get('inbox')).value.items.length;if(actual===n)return;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);assert.equal(actual,n);};
  await choose();assert.match(await panel.getByTestId('task-import-preview').innerText(),/Read, then/);await cancel();assert.equal((await api.get('inbox')).value.items.length,0);
  await choose();await apply();await count(2);
  await p.getByRole('button',{name:lang==='tr'?'Geri al':'Undo',exact:true}).click();await count(0);
  await choose();await apply();await count(2);await choose();await apply();await count(2);
  await choose('ticktick');await apply();await count(3);
  console.log('PASS '+lang+' preview, cancel, import, undo, duplicate, TickTick');await c.close();
 }
}finally{await b.close();await s.stop();}
