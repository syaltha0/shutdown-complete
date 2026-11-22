import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
import { mkdirSync } from 'node:fs';
// a fixed local noon, so the next block never crosses the evening or midnight whatever the hour the test runs
const noon = new Date(); noon.setHours(12, 0, 0, 0);
const s = await startServer();
const api = await demoAccount(client(s.url), { lang: 'tr', today: noon });
const b = await launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', timezoneId: 'Europe/Istanbul' });
await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
const p = await c.newPage();
await p.clock.install({ time: noon });
const check = (name, ok) => { if (!ok) throw Error(name); console.log('PASS ' + name); };
const key = 'day:' + iso(noon);
const wait = async (fn) => { for(let i=0;i<50;i++){ if(await fn()) return true; await p.waitForTimeout(150); } return false; };
const shots = process.env.FOCUS_WIDGET_SHOTS || 'reports/focus-shots/widgets';
mkdirSync(shots, { recursive: true });
try {
  const day = (await api.get(key)).value;
  day.metrics.deep = 1.5;
  const now = 12 * 60;
  day.columns.at(-1).blocks = [
    { id: 'fw-current', label: 'Mevcut blok', start: now-10, end: now+20, kind: 'deep' },
    { id: 'fw-next', label: 'Öğle arası', start: now+20, end: now+80, kind: 'personal' }
  ];
  await api.put(key, day);
  await p.goto(s.url+'/focus');
  const capture = p.locator('#fw-capture');
  await capture.fill('Widget yakalama denemesi'); await capture.press('Enter');
  check('capture persists to inbox', await wait(async()=> (await api.get('inbox')).value?.items.some(x=>x.text==='Widget yakalama denemesi')));
  check('capture clears and retains focus', await capture.inputValue()==='' && await capture.evaluate(el=>el===document.activeElement));
  await p.getByRole('button', { name: 'Geri al', exact: true }).click();
  check('undo removes captured item', await wait(async()=> !(await api.get('inbox')).value?.items.some(x=>x.text==='Widget yakalama denemesi')));
  const ring = p.locator('.fw-goal [role=progressbar]');
  check('metric value and target are hours converted to minutes', await ring.getAttribute('aria-valuenow')==='90' && await ring.getAttribute('aria-valuemax')==='180');
  check('ring shows half the target', await ring.locator('circle').last().getAttribute('stroke-dasharray')==='0.5 1');
  const clock = m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  check('next block and boundary times', (await p.locator('.fw-next').innerText()).includes(`Öğle arası (${clock(now+20)}–${clock(now+80)})`));
  await p.screenshot({path: shots+'/1440-idle.png', fullPage:true});
  await p.locator('.focus-setup button[type=submit]').click();
  await p.locator('.focus-controls').waitFor();
  await capture.fill('Odakta yakalama'); await capture.press('Enter');
  check('capture works during focus', await wait(async()=> (await api.get('inbox')).value?.items.some(x=>x.text==='Odakta yakalama')));
  await p.screenshot({path: shots+'/1440-focus.png', fullPage:true});
  await capture.blur();
  await p.getByRole('button', { name: 'Geri al', exact: true }).click();
  await p.evaluate(()=>window.scrollTo(0,0));
  for(const width of [390,360]) {
    await p.setViewportSize({width,height:900});
    check(width+' has no horizontal overflow', await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await p.screenshot({path: shots+'/'+width+'.png', fullPage:true});
  }
  const settings = (await api.get('settings')).value;
  await api.put('settings', {...settings, theme:'dark', features:{...settings.features,inbox:false}});
  await p.setViewportSize({width:1440,height:900}); await p.reload();
  await p.locator('.focus-widgets').waitFor();
  check('inbox disabled hides capture', await capture.count()===0);
  await p.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await p.screenshot({path: shots+'/dark.png', fullPage:true});
} finally { await b.close(); await s.stop(); }



