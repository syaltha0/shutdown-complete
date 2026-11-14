// Renders the README banner from docs/banner/banner.html: design A as docs/banner-light.png and docs/banner-dark.png,
// and design B (kept as an alternative) under docs/banner/. Run `node tools/render-banner.mjs` (needs CHROME_PATH or Playwright's Chromium).
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch } from './lib/browser.mjs';

const page = pathToFileURL(resolve('docs/banner/banner.html')).href;
const out = { a: ['docs/banner-light.png', 'docs/banner-dark.png'], b: ['docs/banner/banner-b-light.png', 'docs/banner/banner-b-dark.png'] };
const browser = await launch();
const p = await (await browser.newContext({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 2 })).newPage();
for (const [v, [light, dark]] of Object.entries(out)) {
  for (const [path, theme] of [[light, ''], [dark, '&dark']]) {
    await p.goto(`${page}?v=${v}${theme}`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    await p.screenshot({ path });
  }
}
await browser.close();
console.log('banner rendered');
