import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
import { mkdirSync } from 'node:fs';
const dir = 'D:/newport/reports/focus-shots/pomatez';
mkdirSync(dir, { recursive: true });
const s = await startServer();
const api = await demoAccount(client(s.url), { lang: 'tr' });
const b = await launch();
try {
 const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
 await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
 const p = await c.newPage();
 const key = 'day:' + iso(new Date());
 const shoot = async (name) => { await p.locator('.focus-read').waitFor(); await p.waitForTimeout(500); await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true }); };
 await p.goto(s.url + '/focus'); await shoot('idle');
 await p.locator('.focus-config-anchor > button').click(); await shoot('settings');
 await p.locator('.focus-config-anchor > button').click();
 for (const phase of ['focus', 'short', 'long']) {
  const d = (await api.get(key)).value;
  d.focus = { sessions: [], active: { phase, startedAt: new Date(Date.now()-120000).toISOString(), plannedMin: phase === 'focus' ? 25 : phase === 'short' ? 5 : 15, pausedLeft: null, blockId: null, label: 'Pomatez' } };
  await api.put(key, d); await p.reload(); await shoot(phase);
  if (phase === 'focus') {
   await p.locator('.focus-config-anchor > button').click(); await shoot('running-settings');
   await p.locator('.focus-config-anchor > button').click();
  }
 }
 await p.setViewportSize({ width: 390, height: 844 }); await shoot('phone-390');
 await p.setViewportSize({ width: 1440, height: 1000 });
 await p.evaluate(() => document.documentElement.dataset.theme = 'dark'); await shoot('dark');
 console.log(dir);
} finally { await b.close(); s.stop(); }
