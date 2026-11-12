// a contact sheet of every concept: symbol large, then 64/32/16 px, then the lockup
import { launch } from '../lib/browser.mjs';
// run from tools/brand/.out after logo-concepts.py; list.txt holds one concept path per line (e.g. skill/skill-a)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(process.env.OUT || fileURLToPath(new URL('./.out/', import.meta.url)));
const keys = readFileSync('list.txt', 'utf8').trim().split(/\r?\n/);
const inline = (f, w, h) => readFileSync(f, 'utf8').replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);
const rows = keys.map((k) => `<div class="row"><b>${k.split('/')[1]}</b>${inline(k + '.svg', 160, 160)}${inline(k + '.svg', 64, 64)}${inline(k + '.svg', 32, 32)}${inline(k + '.svg', 16, 16)}<span class="lk">${inline(k + '-lockup.svg', 'auto', 56)}</span></div>`).join('');
const b = await launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
await p.setContent(`<html><body style="margin:24px;font:14px sans-serif;background:#fff"><style>.row{display:flex;align-items:center;gap:28px;margin-bottom:18px}.row b{width:70px}.lk svg{height:56px;width:auto}</style>${rows}</body></html>`);
await p.screenshot({ path: process.argv[2] || 'renders/sheet.png', fullPage: true });
await b.close();
