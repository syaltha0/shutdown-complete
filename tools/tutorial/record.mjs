// Records the sign-in page's tutorial: five short clips of the real app in use, one feature each, for every language,
// then renders them into one finished film (tools/tutorial/render.mjs: camera, cursor, spotlight and transitions are
// drawn into the frames, so the page only plays a video).
//   npm run build && npm run tutorial:record            (both languages: capture, then render)
//   npm run tutorial:record -- --lang tr                 (one language)
//   npm run tutorial:record -- --render-only             (render again from the last capture, to tune the look)
// The app runs on a throwaway server with its own demo account (tools/lib), so no real data is involved.
// The raw capture (screen frames + timeline.json) is kept in tools/tutorial/.cache/<lang>/ (git-ignored).
// Each clip has two steps; their words are `reel.scenes[n].steps` in client/src/lib/i18n-auth.ts, and the recorder
// only says when each step happens and which part of the screen it is about.
// Needs Chrome/Edge/Chromium (or CHROME_PATH) and ffmpeg (FFMPEG_PATH, Playwright's ffmpeg, or ffmpeg on the PATH).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso, WORDS } from '../lib/demo.mjs';
import { render } from './render.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const W = 1280, H = 800, DSF = 2;
const LANGS = process.argv.includes('--lang') ? [process.argv[process.argv.indexOf('--lang') + 1]] : ['en', 'tr'];
const RENDER_ONLY = process.argv.includes('--render-only');

// a clock that the film controls (the cursor is drawn later, by the renderer)
const INIT = (startNow) => `(() => {
  const R = Date;
  if (sessionStorage.getItem('tut-off') == null) sessionStorage.setItem('tut-off', String(${startNow} - R.now()));
  const off = () => Number(sessionStorage.getItem('tut-off'));
  class F extends R { constructor(...a) { if (a.length === 0) super(R.now() + off()); else super(...a); } static now() { return R.now() + off(); } }
  window.Date = F;
  window.__setNow = (ms) => sessionStorage.setItem('tut-off', String(ms - R.now()));
  window.__warp = (ms) => sessionStorage.setItem('tut-off', String(off() + ms));
  // timers of a second or more run on the film's clock, so a time-lapse makes the focus ring sweep instead of jump
  const SI = window.setInterval.bind(window);
  window.setInterval = (cb, ms, ...a) => {
    if (typeof cb !== 'function' || !(ms >= 250)) return SI(cb, ms, ...a);
    let next = F.now() + ms;
    return SI(() => { const n = F.now(); if (n >= next) { next = n + ms; cb(...a); } }, 40);
  };
})();`;

async function capture(lang, dir) {
  const L = WORDS[lang];
  const srv = await startServer();
  const api = await demoAccount(client(srv.url), { lang, plan: 'partial' });
  const today = new Date();
  const D = iso(today);
  const at = (h, m) => { const d = new Date(today); d.setHours(h, m, 20, 0); return d.getTime(); };

  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, locale: lang === 'tr' ? 'tr-TR' : 'en-GB', reducedMotion: 'no-preference' });
  await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
  await ctx.addInitScript(INIT(at(10, 38)));
  const page = await ctx.newPage();
  await page.goto(`${srv.url}/day/${D}`);
  await page.waitForTimeout(2200);

  // ---------- the screencast; only the frames inside clips are kept (plus the one showing when a clip starts) ----------
  const clips = [];
  let clip = null;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'frames'), { recursive: true });
  const frames = [];
  let held = null; // the latest frame while no clip runs
  const keep = (data, t) => {
    const file = `${String(frames.length).padStart(6, '0')}.jpg`;
    writeFileSync(join(dir, 'frames', file), Buffer.from(data, 'base64'));
    frames.push({ t, file });
  };
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    if (clip) keep(f.data, f.metadata.timestamp); else held = f;
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W * DSF, maxHeight: H * DSF, everyNthFrame: 1 });
  await page.waitForTimeout(500);

  const wall = () => Date.now() / 1000;
  const t = () => +(wall() - clip.t0).toFixed(2);
  // every clip opens on the whole screen and the player glides in, so the hand waits a moment first; at the end the
  // player glides back out, so each clip holds its result for a while
  const startClip = async () => {
    await page.waitForTimeout(150);
    if (held) keep(held.data, held.metadata.timestamp);
    clip = { t0: wall(), camera: [], marks: [] };
  };
  // the renderer opens each clip on the whole window and only then glides in, so the hand waits for the camera
  const settle = () => page.waitForTimeout(1150);
  const endClip = async (hold = 2200) => { await page.waitForTimeout(hold); clip.t1 = wall(); clips.push(clip); clip = null; };
  const box = (sel) => page.locator(sel).first().boundingBox();
  const frac = (r) => ({ x: r.x / W, y: r.y / H, w: r.width / W, h: r.height / H });
  async function cam(target, pad = 20) {
    if (target === 'full') { clip.camera.push({ t: t(), x: 0, y: 0, w: 1, h: 1 }); return; }
    const r = typeof target === 'string' ? await box(target) : target;
    if (!r) return;
    const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    clip.camera.push({ t: t(), ...frac({ x, y, width: Math.min(W - x, r.width + 2 * pad), height: Math.min(H - y, r.height + 2 * pad) }) });
  }
  // the shot so far also takes in this (a dialog that opens later, say), so the camera never has to swing over to it
  async function widen(target, pad = 16) {
    const r = typeof target === 'string' ? await box(target) : target, c = clip.camera.at(-1);
    if (!r || !c) return;
    const x = Math.min(c.x, (r.x - pad) / W), y = Math.min(c.y, (r.y - pad) / H);
    const x2 = Math.max(c.x + c.w, (r.x + r.width + pad) / W), y2 = Math.max(c.y + c.h, (r.y + r.height + pad) / H);
    Object.assign(c, { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1, x2) - Math.max(0, x), h: Math.min(1, y2) - Math.max(0, y) });
  }
  // step n of the clip begins now, about this part of the screen (highlighted until hush() or the next step)
  async function step(n, target, pad = 6) {
    const r = typeof target === 'string' ? await box(target) : target;
    if (!r) throw new Error(`not found: ${target}`);
    hush();
    clip.marks.push({ step: n, start: t(), end: null, ...frac({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad }) });
  }
  const hush = () => { const last = clip.marks.at(-1); if (last && last.end == null) last.end = t(); };

  // ---------- the hand ----------
  // where the hand is, sampled as it moves, and when it presses; the renderer draws the cursor from this
  let pos = { x: 900, y: 500 };
  const cursor = [{ t: wall(), ...pos }], presses = [];
  const to = async (x, y) => { pos = { x, y }; await page.mouse.move(x, y); cursor.push({ t: wall(), x, y }); };
  const down = async () => { presses.push({ t: wall(), down: true }); await page.mouse.down(); };
  const up = async () => { presses.push({ t: wall(), down: false }); await page.mouse.up(); };
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
  async function move(x, y, ms = 600) {
    const from = { ...pos }, steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await to(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await page.waitForTimeout(ms / steps);
    }
  }
  async function click(sel, ms = 600) {
    const r = await box(sel);
    if (!r) throw new Error(`not found: ${sel}`);
    await move(r.x + r.width / 2, r.y + r.height / 2, ms);
    await page.waitForTimeout(110);
    await down(); await page.waitForTimeout(80); await up();
    await page.waitForTimeout(220);
  }
  async function drag(x1, y1, x2, y2, ms = 900) {
    await move(x1, y1, 500);
    await page.waitForTimeout(120);
    await down();
    const from = { ...pos }, steps = Math.round(ms / 16);
    for (let i = 1; i <= steps; i++) { const k = ease(i / steps); await to(from.x + (x2 - from.x) * k, from.y + (y2 - from.y) * k); await page.waitForTimeout(ms / steps); }
    await page.waitForTimeout(100);
    hush(); // the drop opens a dialog over the marked spot
    await up();
    await page.waitForTimeout(300);
  }
  const PPM = 1.2, R0 = 540;
  const gridY = async (min) => (await box('.col.active .col-body')).y + (min - R0) * PPM;
  const gridX = async () => { const b = await box('.col.active .col-body'); return b.x + b.width * 0.4; };
  async function camGrid(a, z, share = 1) {
    const g = await box('.grid-wrap');
    const y1 = (await gridY(a)) - 40, y2 = (await gridY(z)) + 24;
    await cam({ x: g.x, y: y1, width: g.width * share, height: y2 - y1 }, 6);
  }
  // between clips: the hand takes the rail to the next screen, then moves off it so no tooltip stays up
  const rail = async (href) => { await click(`.rail a[href${href}]`, 500); await move(760, 470, 450); };

  // One or two shots a clip, each with a reason to move: in on the action, then on to its result. Dialogs open in the
  // middle of the screen, so a shot that will have one is widened to include it from the start.

  // ---------- 1. block out the day ----------
  await startClip();
  await camGrid(540, 760, 0.62);
  const body = await box('.col.active .col-body');
  const x = await gridX(), y1 = (await gridY(570)) + 3, y2 = (await gridY(690)) + 1;
  await settle();
  await step(0, { x: body.x, y: y1 - 3, width: body.width, height: y2 - y1 + 3 }, 2);
  await drag(x, y1, x, y2, 1000);
  await page.waitForTimeout(250);
  await widen('dialog.sheet[open]');
  await page.waitForTimeout(300);
  await step(1, '#be-label');
  for (const ch of L.chapter) { await page.keyboard.insertText(ch); await page.waitForTimeout(36); }
  await page.waitForTimeout(250);
  await click('dialog.sheet[open] button[type=submit]', 500);
  await page.waitForTimeout(200);
  await step(1, '.col.active .block.k-deep');
  await endClip(2300);

  // ---------- 2. revise from now ----------
  await startClip();
  const rv = await box('[data-tour="revise"]'), right = await box('.page-right');
  await cam({ x: right.x + right.width * 0.35, y: rv.y, width: right.width * 0.65, height: right.height * 0.55 }, 12);
  await settle();
  await step(0, '[data-tour="revise"]');
  await page.waitForTimeout(500);
  await click('[data-tour="revise"]', 800);
  hush();
  await page.waitForTimeout(250);
  await widen('dialog.sheet[open]');
  await page.waitForTimeout(550);
  await click('dialog.sheet[open] button[type=submit]', 550);
  await page.waitForTimeout(250);
  await camGrid(560, 800);
  await page.waitForTimeout(800);
  const col = await box('.col.active'), now = await gridY(630);
  await step(1, { x: col.x, y: now - 28, width: col.width, height: (await gridY(780)) - now + 26 }, 0);
  await endClip(2700);

  // ---------- 3. focus ----------
  await rail('="/focus"');
  await page.waitForTimeout(1300);
  await startClip();
  await cam('.focus-panel', 10);
  await settle();
  await step(0, '.focus-setup .btn.primary');
  await page.waitForTimeout(500);
  await click('.focus-setup .btn.primary', 650);
  hush(); // the button gives way to the running timer
  await page.waitForTimeout(450);
  // twenty-five minutes as a time-lapse: the ring sweeps round, the session is logged, the break begins
  for (let k = 0; k < 60; k++) { await page.evaluate(() => window.__warp(25 * 1000)); await page.waitForTimeout(40); }
  await page.evaluate(() => window.__warp(2500));
  await page.waitForTimeout(400);
  // then out a little to the right, to take in the session log beside the ring
  const fp = await box('.focus-panel'), fs = await box('section[aria-labelledby="fs-h"]');
  await cam({ x: fp.x, y: Math.min(fp.y, fs.y), width: fs.x + fs.width - fp.x, height: Math.max(fp.y + fp.height, fs.y + fs.height) - Math.min(fp.y, fs.y) }, 12);
  await page.waitForTimeout(500);
  await step(1, '.sessions .session');
  await endClip(2700);

  // ---------- 4. habits ----------
  await rail('^="/habits/"');
  await page.waitForTimeout(1300);
  await startClip();
  // first the whole month, then in on today and the streaks
  const g = await box('.hgrid'), cell = await box('.hgrid .hcell.is-today'), end = await box('.hgrid .hrow.head .n:last-child');
  await cam({ x: g.x, y: g.y, width: g.width, height: g.height }, 10);
  await page.waitForTimeout(1500);
  const x0 = cell.x - 9 * cell.width;
  await cam({ x: x0, y: g.y, width: end.x + end.width - x0, height: g.height }, 10);
  await page.waitForTimeout(1100);
  const today3 = await box('.hgrid .hrow:not(.head):nth-child(3) .hcell.is-today'), today4 = await box('.hgrid .hrow:not(.head):nth-child(4) .hcell.is-today');
  await step(0, { x: today3.x, y: today3.y, width: today3.width, height: today4.y + today4.height - today3.y }, 4);
  await click('.hgrid .hrow:not(.head):nth-child(3) .hcell.is-today', 750);
  await page.waitForTimeout(300);
  await click('.hgrid .hrow:not(.head):nth-child(4) .hcell.is-today', 500);
  await page.waitForTimeout(400);
  const st3 = await box('.hgrid .hrow:not(.head):nth-child(3) .streak'), st4 = await box('.hgrid .hrow:not(.head):nth-child(4) .streak');
  await step(1, { x: Math.min(st3.x, st4.x), y: st3.y, width: Math.max(st3.width, st4.width), height: st4.y + st4.height - st3.y }, 6);
  await endClip(2300);

  // ---------- 5. shutdown ----------
  await page.evaluate((ms) => window.__setNow(ms), at(17, 21));
  await rail('^="/shutdown/"');
  await page.waitForTimeout(1400);
  await startClip();
  await cam('.panel.fill', 8);
  await settle();
  await step(0, '.ritual', 8);
  const n = await page.locator('.ritual-step').count();
  for (let k = 1; k <= n; k++) { await click(`.ritual > div:nth-child(${k}) .check`, 300); await page.waitForTimeout(90); }
  hush();
  const s4 = await box('.ritual > div:nth-last-child(2)'), foot = await box('.ritual-foot');
  await cam({ x: foot.x, y: s4.y, width: foot.width, height: foot.y + foot.height - s4.y }, 14);
  await page.waitForTimeout(500);
  await click('.ritual-foot .btn.primary', 600);
  await page.waitForTimeout(500);
  await step(1, '.complete-stamp', 8);
  await endClip(2500);

  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(300);
  await browser.close();
  srv.stop();

  writeFileSync(join(dir, 'timeline.json'), JSON.stringify({ width: W, height: H, scale: DSF, frames, clips, cursor, presses }));
  console.log(`${lang}: captured ${clips.length} clips, ${frames.length} frames`);
}

for (const lang of LANGS) {
  const dir = join(import.meta.dirname, '.cache', lang);
  if (!RENDER_ONLY) await capture(lang, dir);
  await render(dir, join(ROOT, 'client/public/tutorial', lang));
}
