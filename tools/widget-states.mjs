import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { startServer, client } from './lib/server.mjs';
import { demoAccount, iso, weekOf } from './lib/demo.mjs';
const stage = process.argv[2] || 'önce';
if (!['önce', 'sonra'].includes(stage)) throw Error('Expected önce or sonra');
const out = `reports/widget-states/${stage}`;
mkdirSync(out, { recursive: true });
const server = await startServer(), browser = await launch();
const manifest = [];
try {
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const api = await demoAccount(client(server.url), { lang: 'tr', today: now });
  const settings = (await api.get('settings')).value;
  const original = (await api.get('day:' + iso(now))).value;
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: server.url }]);
  const page = await context.newPage(); await page.clock.install({ time: now });
  for (const state of ['dolu', 'yarı', 'boş']) {
    if (state !== 'dolu') {
      for (let offset = -90; offset <= 14; offset++) {
        const date = new Date(now); date.setDate(date.getDate() + offset);
        await api.put('day:' + iso(date), { columns: [{ id: 'empty', blocks: [] }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} }, focus: { active: null, sessions: [] } });
      }
      await api.put('inbox', { items: [] });
      await api.put('week:' + weekOf(iso(now)), { items: [], notes: '' });
      for (let offset = 0; offset < 2; offset++) {
        const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        await api.put('month:' + iso(date).slice(0, 7), { goals: [], dates: [], notes: '' });
      }
      await api.put('settings', { ...settings, schedule: [], countdowns: [] });
      if (state === 'yarı') await api.put('day:' + iso(now), { ...original, columns: [{ id: 'partial', blocks: original.columns[0].blocks.slice(0, 1) }], tasks: original.tasks.slice(0, 1), metrics: { deep: 0.5 } });
    }
    for (const route of ['/', '/focus']) {
      const name = route === '/' ? 'home' : 'focus';
      for (const [width, height, theme] of [[1440,900,'light'],[1904,1015,'light'],[390,844,'light'],[1440,900,'dark']]) {
        await page.setViewportSize({ width, height }); await page.goto(server.url + route);
        await page.locator(route === '/' ? '.overview' : '.focus-grid').waitFor();
        await page.evaluate(t => { document.documentElement.dataset.theme = t; return document.fonts.ready; }, theme);
        await page.screenshot({ path: `${out}/${name}-${state}-${width}-${theme}.png`, fullPage: true });
        if (width === 1440 && theme === 'light') {
          const panels = page.locator(route === '/' ? '.overview .panel' : '.focus-grid .panel');
          for (let i = 0; i < await panels.count(); i++) {
            const panel = panels.nth(i), title = await panel.locator('h2').first().textContent().catch(() => 'timer');
            const file = `${name}-${i}-${state}.png`;
            await panel.screenshot({ path: `${out}/${file}` });
            manifest.push({ route, state, title, file });
          }
        }
      }
    }
  }
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`PASS ${manifest.length} widget captures`);
} finally { await browser.close(); server.stop(); }
