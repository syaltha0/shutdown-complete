// Puts the README showcase together from docs/screenshots/: the day on a desktop with the same planner on a phone
// beside it, light and dark (docs/showcase-light.png, docs/showcase-dark.png). Run tools/screenshots.mjs first.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { launch } from './lib/browser.mjs';

const shots = pathToFileURL(resolve('docs/screenshots')).href;
const page = (dark) => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1600px;height:860px;background:${dark ? '#0d1117' : '#ffffff'};position:relative;overflow:hidden}
.desk{position:absolute;left:40px;top:40px;width:1240px;border:1px solid ${dark ? '#30363d' : '#d0d7de'};border-radius:12px;overflow:hidden;background:${dark ? '#161b22' : '#f6f8fa'}}
.bar{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid ${dark ? '#30363d' : '#d0d7de'}}
.bar i{width:11px;height:11px;border-radius:50%;background:${dark ? '#30363d' : '#d0d7de'}}
.desk img{display:block;width:100%}
.phone{position:absolute;right:40px;top:110px;width:330px;border:10px solid ${dark ? '#2b2f36' : '#1f2328'};border-radius:44px;overflow:hidden;background:#000}
.phone img{display:block;width:100%;height:690px;object-fit:cover;object-position:top}
</style><div class="desk"><div class="bar"><i></i><i></i><i></i></div><img src="${shots}/day${dark ? '-dark' : ''}.jpg"></div>
<div class="phone"><img src="${shots}/phone-focus${dark ? '-dark' : ''}.jpg"></div>`;

const dir = mkdtempSync(join(tmpdir(), 'showcase-'));
const browser = await launch();
const p = await (await browser.newContext({ viewport: { width: 1600, height: 860 }, deviceScaleFactor: 1.5 })).newPage();
for (const dark of [false, true]) {
  const file = join(dir, `showcase${dark ? '-dark' : ''}.html`);
  writeFileSync(file, page(dark));
  await p.goto(pathToFileURL(file).href);
  await p.waitForLoadState('load');
  await p.screenshot({ path: `docs/showcase-${dark ? 'dark' : 'light'}.jpg`, type: 'jpeg', quality: 86 });
}
await browser.close();
console.log('showcase rendered');
