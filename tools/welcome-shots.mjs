// Screenshots of every first-run setup step (a throwaway server, a fresh owner account).
//   npm run build && node tools/welcome-shots.mjs --out <dir> [--lang en|tr] [--theme dark] [--width 1440]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { client, startServer } from './lib/server.mjs';
import { findBrowser } from './lib/browser.mjs';

const arg = (name, def) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : def);
const out = arg('out', 'welcome-shots'), lang = arg('lang', 'en'), theme = arg('theme', 'light'), width = Number(arg('width', 1440));
mkdirSync(out, { recursive: true });
const srv = await startServer();
const api = client(srv.url);
await api.call('/api/auth/setup', { email: 'sam@example.test', password: 'Demo-password-1', signupMode: 'closed', lang });
const browser = await chromium.launch({ executablePath: findBrowser() });
const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 860 : 900 }, deviceScaleFactor: 1, locale: lang });
await ctx.addCookies([{ name: api.cookie.split('=')[0], value: api.cookie.split('=').slice(1).join('='), url: srv.url }]);
await ctx.addInitScript((t) => { localStorage.setItem('sc-theme', t); localStorage.setItem('sc-motion', 'reduce'); }, theme);
const page = await ctx.newPage();
await page.goto(srv.url + '/');
await page.waitForSelector('.welcome-card');
const clicks = { 0: ['.wtile >> nth=0', '.wtile >> nth=2'] };
const steps = await page.locator('.welcome-progress li').count();
for (let s = 0; s < steps; s++) {
  await page.waitForTimeout(500);
  if (s === 0) await page.fill('#w-name', 'Sam Rivera');
  for (const c of clicks[s] ?? []) await page.click(c);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `step${s + 1}.png`), fullPage: true });
  if (s < steps - 1) await page.click('.welcome-foot .btn.primary');
}
// the end: the box ticked, the button saying it is ready (then the day opens)
await page.click('.welcome-foot .btn.primary');
await page.waitForTimeout(150);
await page.screenshot({ path: join(out, 'ready.png'), fullPage: true });
await page.waitForURL(/\/day\//, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, 'day.png') });
await browser.close(); srv.stop();
console.log('shots in', out);
