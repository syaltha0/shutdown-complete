// Draws the favicon and the app icons (PWA, home screen) from the mark in client/src/lib/mark.ts:
//   node tools/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { markSvg } from '../client/src/lib/mark.ts';

const OUT = 'client/public/icons';
mkdirSync(OUT, { recursive: true });

// the browser tab: the small cut, ink and hue swapped for a dark tab strip
writeFileSync('client/public/mark.svg', markSvg({ small: true, size: 32 }) + '\n');
console.log('client/public/mark.svg');

// the app icons: the mark on the paper ground, inset (a maskable icon keeps it inside the safe circle)
const PAPER = '#f8f8f8';
const tile = (size, pad, small) => `<!doctype html><html><body style="margin:0;background:${PAPER}">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="${PAPER}"/>
  <g transform="translate(${128 * pad} ${128 * pad}) scale(${1 - pad})">${markSvg({ small, ground: PAPER }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>
</svg></body></html>`;

const browser = await launch();
const page = await browser.newPage();
for (const [name, size, pad, small] of [
  ['icon-192.png', 192, 0.12, false], ['icon-512.png', 512, 0.12, false], ['icon-maskable-512.png', 512, 0.3, false],
  ['apple-touch-icon.png', 180, 0.14, false], ['favicon-32.png', 32, 0.04, true], ['favicon-16.png', 16, 0.02, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(tile(size, pad, small));
  await page.screenshot({ path: `${OUT}/${name}`, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`${OUT}/${name}`);
}
await browser.close();
