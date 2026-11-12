// Renders a captured tutorial (tools/tutorial/.cache/<lang>/, written by record.mjs) into the finished film:
// compositor.html draws every frame (window, chapter cards, camera, spotlight, cursor, captions) and ffmpeg encodes them.
// The words on the cards and captions come from client/src/lib/reel.ts, so changing a word needs only a new render.
//   node tools/tutorial/render.mjs [--lang en|tr]      (the same as npm run tutorial:record -- --render-only)
//   node tools/tutorial/render.mjs --lang en --stills 1,4.5,8 --out <dir>   (just those frames, as JPEGs)
// Writes, in client/public/tutorial/<lang>/: tutorial.webm (VP9, 1600×1000, 60 fps), poster.jpg (the first frame,
// which is also the last, so the loop has no seam) and tutorial.json (the film's length, where the loop's closing card
// begins, and each chapter's start and end, for the progress bars on the sign-in page).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findFfmpeg, launch } from '../lib/browser.mjs';
import { REEL } from '../../client/src/lib/reel.ts';

const FPS = 60, SPEED = 1.12;

/** `stills`: only write the frames at these film times (seconds) into `out` as JPEGs, to look at the render quickly. */
export async function render(dir, out, { stills, probe } = {}) {
  const tl = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
  // the recording plays a little faster than it was made; camera moves and steps are moved to film time with it
  const clips = tl.clips.map((c) => {
    const rec = c.t1 - c.t0, duration = rec / SPEED;
    return { t0: c.t0, duration, camera: c.camera.map((x) => ({ ...x, t: x.t / SPEED })),
      marks: c.marks.map((m) => ({ ...m, start: m.start / SPEED, end: (m.end ?? rec) / SPEED })) };
  });

  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage();
  page.on('pageerror', (e) => console.error('compositor:', e.message));
  await page.route('http://tutorial.local/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: readFileSync(join(import.meta.dirname, 'compositor.html')) });
    if (path.startsWith('/f/')) return route.fulfill({ contentType: 'image/jpeg', body: readFileSync(join(dir, 'frames', path.slice(3))) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://tutorial.local/');
  const frames = [...tl.frames].sort((a, b) => a.t - b.t);
  const texts = REEL[basename(dir)];
  const { total, loopAt, chapters } = await page.evaluate((d) => window.setup(d), { width: tl.width, height: tl.height, frames, cursor: tl.cursor, presses: tl.presses, clips, texts, speed: SPEED });

  if (probe) {
    const rows = [];
    for (let T = 0; T < total; T += 0.1) rows.push(await page.evaluate((x) => window.probe(x), T));
    await browser.close();
    return rows;
  }
  if (stills) {
    mkdirSync(out, { recursive: true });
    for (const T of stills) {
      const url = await page.evaluate((x) => window.frame(x), T);
      writeFileSync(join(out, `still-${String(T.toFixed(2)).padStart(6, '0')}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    await browser.close();
    return { total, loopAt, chapters };
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const ff = spawn(findFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-r', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libvpx-vp9', '-crf', '45', '-b:v', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-g', String(FPS * 2),
    '-pix_fmt', 'yuv420p', '-an', join(out, 'tutorial.webm')], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => { ff.on('error', fail); ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)))); });

  const n = Math.round(total * FPS);
  const began = Date.now();
  for (let i = 0; i < n; i++) {
    const url = await page.evaluate((T) => window.frame(T), i / FPS);
    const jpg = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (i === 0) writeFileSync(join(out, 'poster.jpg'), jpg);
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % (FPS * 5) === 0) process.stdout.write(`\r  rendering ${Math.round((i / n) * 100)}%`);
  }
  ff.stdin.end();
  await done;
  await browser.close();

  writeFileSync(join(out, 'tutorial.json'), JSON.stringify({ duration: +total.toFixed(3), loopAt: +loopAt.toFixed(3), chapters }, null, 1));
  const kb = (readFileSync(join(out, 'tutorial.webm')).length / 1024).toFixed(0);
  process.stdout.write(`\r  ${out.split(/[\\/]/).at(-1)}: ${total.toFixed(1)} s film, ${kb} KB, rendered in ${((Date.now() - began) / 1000).toFixed(0)} s\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = resolve(import.meta.dirname, '../..');
  const langs = process.argv.includes('--lang') ? [process.argv[process.argv.indexOf('--lang') + 1]]
    : readdirSync(join(import.meta.dirname, '.cache')).filter((l) => existsSync(join(import.meta.dirname, '.cache', l, 'timeline.json')));
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
  const stills = arg('--stills')?.split(',').map(Number);
  for (const lang of langs) {
    if (process.argv.includes('--probe')) console.log(JSON.stringify(await render(join(import.meta.dirname, '.cache', lang), null, { probe: true })));
    else if (stills) console.log(await render(join(import.meta.dirname, '.cache', lang), resolve(arg('--out') || 'tutorial-stills', lang), { stills }));
    else await render(join(import.meta.dirname, '.cache', lang), join(ROOT, 'client/public/tutorial', lang));
  }
}
