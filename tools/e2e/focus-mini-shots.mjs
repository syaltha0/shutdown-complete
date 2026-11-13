import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.MINI_SHOTS || 'reports/focus-shots/mini2';
mkdirSync(out, { recursive: true });
const s = await startServer(), api = await demoAccount(client(s.url), { lang: 'en' }), b = await launch();
try {
 const c = await b.newContext(); await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
 const p = await c.newPage();
 for (const theme of ['light', 'dark']) for (const phase of ['focus', 'short', 'long']) {
  const key = 'day:' + iso(new Date()), d = (await api.get(key)).value;
  d.focus = { sessions: [], active: {phase, startedAt: new Date().toISOString(), plannedMin: 25, pausedLeft: 1492, blockId: null, label: ''} }; await api.put(key,d);
  await p.goto(s.url + '/focus'); await p.locator('.focus-mini-trigger').waitFor();
  await p.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  await p.locator('.focus-mini-trigger').click();
  await p.waitForFunction(() => window.documentPictureInPicture.window?.document.querySelector('.focus-mini'));
  // Render the live portal DOM with its actual styles in a 260 x 150 frame for capture.
  await p.evaluate(async () => {
   const source = window.documentPictureInPicture.window.document;
   const frame = document.createElement('iframe'); frame.id = 'mini-proof'; frame.style.cssText = 'position:fixed;left:0;top:0;width:260px;height:150px;border:0;z-index:9999'; document.body.appendChild(frame);
   const d = frame.contentDocument; d.open(); d.write(source.documentElement.outerHTML); d.close(); await d.fonts.ready;
  });
  await p.locator('#mini-proof').screenshot({ path: `${out}/${phase}-${theme}.png` });
  await p.evaluate(() => window.documentPictureInPicture.window.close());
 }
 await p.addInitScript(() => Object.defineProperty(window, 'documentPictureInPicture', { value: undefined }));
 await p.reload(); await p.locator('.focus-mini-trigger').click(); await p.waitForTimeout(1400);
 const data = await p.evaluate(() => { const video = document.querySelector('video'); const canvas = document.createElement('canvas'); canvas.width = 520; canvas.height = 300; canvas.getContext('2d').drawImage(video,0,0); return canvas.toDataURL().split(',')[1]; });
 writeFileSync(`${out}/canvas.png`, Buffer.from(data, 'base64'));
 console.log(out);
} finally { await b.close(); s.stop(); }
