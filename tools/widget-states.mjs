import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { startServer, client } from './lib/server.mjs';
import { demoAccount, fillDemo, iso, weekOf } from './lib/demo.mjs';
const stage = process.argv[2] || 'sonra2';
if (!['önce', 'sonra', 'sonra2'].includes(stage)) throw Error('Unknown capture stage');
const out = `reports/widget-states/${stage}`;
mkdirSync(out, { recursive: true });
const server = await startServer(), browser = await launch();
const manifest = [];
try {
  const now = new Date('2026-11-17T12:00:00');
  const api = await demoAccount(client(server.url), { today: now, history: 84 });
  const settings = (await api.get('settings')).value;
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: server.url }]);
  const page = await context.newPage(); await page.clock.install({ time: now });
  const date = offset => { const d = new Date(now); d.setDate(d.getDate() + offset); return iso(d); };
  const blank = () => ({ columns: [{ id: 'capture', blocks: [] }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} }, focus: { active: null, sessions: [] } });
  const block = (id, start, label) => ({ id, start, end: start + 60, label, kind: 'deep', note: '' });
  const partialDay = offset => ({ ...blank(), columns: [{ id: 'capture', blocks: [block('writing', 690, 'Write the chapter introduction')] }], tasks: [{ id: 'budget', text: 'Send the revised budget', done: false }], metrics: { deep: 0.5 }, focus: { active: null, sessions: [{ id: 'session', minutes: 30, kind: 'deep', blockId: 'writing', label: 'Chapter introduction', start: `${date(offset)}T09:00:00`, end: `${date(offset)}T09:30:00` }] } });
  async function reset() {
    for (let i = -90; i <= 14; i++) await api.put(`day:${date(i)}`, blank());
    await api.put('inbox', { items: [] });
    await api.put(`week:${weekOf(date(0))}`, { items: [], notes: '' });
    for (let i = 0; i < 2; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); await api.put(`month:${iso(d).slice(0, 7)}`, { goals: [], dates: [], notes: '' }); }
    await api.put('settings', { ...settings, schedule: [], countdowns: [], exams: [], templates: [] });
  }
  const cards = ['hello', 'timeline', 'open', 'focus', 'tasks', 'ahead', 'streak', 'recent', 'heat'];
  for (const state of ['empty', 'partial', 'full']) {
    for (const card of cards) {
      await reset();
      if (state === 'full') {
        await fillDemo(api, { today: now, history: 84 });
        if (['tasks','open'].includes(card)) await api.put('day:'+date(0), { ...partialDay(0), tasks: Array.from({length:12},(_,i)=>({id:'task-'+i,text:['Send the revised budget to the editorial committee','Book flights for the workshop','Review the chapter introduction'][i%3],done:i>7})) });
        if (card === 'focus') await api.put('day:'+date(0), { ...partialDay(0), metrics:{deep:3},focus:{active:null,sessions:Array.from({length:6},(_,i)=>({...partialDay(0).focus.sessions[0],id:'session-'+i}))} });
        if (card === 'ahead') await api.put('month:'+date(0).slice(0,7), {goals:[],notes:'',dates:Array.from({length:7},(_,i)=>({id:'event-'+i,date:date(i+1),text:'Submit the revised workshop abstract '+(i+1)}))});
        if (card === 'streak') for(let i=-14;i<=0;i++) await api.put('day:'+date(i),{...partialDay(i),shutdown:{done:true,at:date(i)+'T17:00:00',steps:{}}});
        if (['recent','heat'].includes(card)) for(let i=card==='heat'?-84:-6;i<=0;i++) await api.put('day:'+date(i),{...partialDay(i),metrics:{deep:(Math.abs(i)%5+1)*0.5}});
      }
      if (state === 'partial') {
        if (['hello', 'timeline', 'open', 'focus', 'tasks', 'recent', 'heat'].includes(card)) await api.put(`day:${date(0)}`, partialDay(0));
        if (card === 'hello') await api.put(`day:${date(1)}`, partialDay(1));
        if (card === 'ahead') {
          await api.put(`day:${date(1)}`, partialDay(1));
          await api.put(`month:${date(0).slice(0, 7)}`, { goals: [], notes: '', dates: [{ id: 'deadline', date: date(3), text: 'Send the workshop abstract' }] });
        }
        if (card === 'streak') for (const offset of [-2, -1]) await api.put(`day:${date(offset)}`, { ...blank(), shutdown: { done: true, at: `${date(offset)}T17:00:00`, steps: {} } });
        if (card === 'heat') for (const offset of [-14, -7, -2]) await api.put(`day:${date(offset)}`, partialDay(offset));
      }
      await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(server.url);
      const panel = page.locator(`.overview .b-${card}`); await panel.waitFor();
      await page.evaluate(async () => { document.documentElement.dataset.theme = 'light'; await document.fonts.ready; });
      await page.waitForTimeout(350);
      const fit = await panel.evaluate(e => ({x:e.scrollWidth-e.clientWidth,y:e.scrollHeight-e.clientHeight}));
      if(fit.x>1 || fit.y>1) throw Error(`${card} ${state} overflows: ${JSON.stringify(fit)}`);
      const file = `${card}-${state}-1440-light.png`;
      await page.screenshot({ path: `${out}/${file}`, fullPage: true });
      await panel.screenshot({ path: `${out}/${card}-${state}-detail.png` });
      manifest.push({ card, state, file, width: 1440, height: 900, title: await panel.locator('h2').first().innerText(), box: await panel.boundingBox() });
    }
    // Complete overview at all requested sizes, on an independently seeded account state.
    await reset();
    if (state === 'full') await fillDemo(api, { today: now, history: 84 });
    if (state === 'partial') { await api.put(`day:${date(0)}`, partialDay(0)); await api.put(`day:${date(-1)}`, { ...partialDay(-1), shutdown: { done: true, at: `${date(-1)}T17:00:00`, steps: {} } }); }
    for (const [width, height, theme] of [[1440,900,'light'],[1904,1015,'light'],[1366,768,'light'],[390,844,'light'],[1440,900,'dark']]) {
      await page.setViewportSize({ width, height }); await page.goto(server.url); await page.locator('.overview').waitFor();
      await page.evaluate(async theme => { document.documentElement.dataset.theme = theme; await document.fonts.ready; }, theme); await page.waitForTimeout(200);
      const file = `overview-${state}-${width}-${theme}.png`; await page.screenshot({ path: `${out}/${file}`, fullPage: true }); manifest.push({ state, width, height, theme, file });
    }
  }
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`PASS ${cards.length * 3} independent widget states; ${manifest.length} full overview captures`);
} finally { await browser.close(); server.stop(); }
