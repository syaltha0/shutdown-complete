import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const check = (ok, name) => { if (!ok) throw Error('FAIL ' + name); console.log('PASS ' + name); };
const s = await startServer(), api = await demoAccount(client(s.url), { lang: 'en' }), browser = await launch();
const shots = resolve('reports/block-drag'); mkdirSync(shots, { recursive: true });
const key = 'day:2026-11-20';
const base = { id: 'drag-a', start: 600, end: 690, label: 'Review proposal', kind: 'deep', note: '', repeatId: 'drag-repeat' };
try {
  const settings = (await api.get('settings')).value;
  await api.put('settings', { ...settings, startHour: 9, endHour: 17, wholeDay: false });
  for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light']]) {
    await api.put('settings', { ...settings, startHour: 9, endHour: 17, wholeDay: false, schedule: [{ ...base, id: 'drag-repeat', days: [5], since: '2026-11-20' }] });
    await api.put(key, { columns: [{ from: null, closedAt: null, blocks: [base, { ...base, repeatId: undefined, id: 'drag-b', start: 660, end: 720, label: 'Overlapping review' }] }], repeats: ['drag-repeat'], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } });
    const c = await browser.newContext({ timezoneId: 'Europe/Istanbul', viewport: { width, height: 1000 }, hasTouch: width === 390, isMobile: width === 390, reducedMotion: 'reduce' });
    await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    await c.addInitScript(t => localStorage.setItem('sc-theme', t), theme);
    const p = await c.newPage(); await p.clock.install({ time: new Date('2026-11-20T07:37:00Z') });
    await p.goto(s.url + '/day/2026-11-20');
    const a = p.locator('.col.active .block', { hasText: 'Review proposal' });
    await a.waitFor(); await a.scrollIntoViewIfNeeded();
    const current = async () => (await api.get(key)).value.columns.at(-1).blocks.find(b => b.id === base.id);
    const saved = async (start, end) => {
      await p.waitForFunction(({ start, end }) => {
        const el = [...document.querySelectorAll('.col.active .block')].find(e => e.textContent.includes('Review proposal'));
        return el?.getAttribute('aria-label')?.includes(`${String(start / 60 | 0).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`) && el?.getAttribute('aria-label')?.includes(`${String(end / 60 | 0).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`);
      }, { start, end });
      for (let i = 0; i < 60; i++) { const b = await current(); if (b.start === start && b.end === end) return; await p.waitForTimeout(100); }
      throw Error('save mismatch ' + JSON.stringify(await current()));
    };
    let writes = 0;
    p.on('request', r => { if (r.method() === 'PUT' && decodeURIComponent(r.url()).endsWith('/api/doc/' + key)) writes++; });
    const grab = async (edge = 'body') => {
      await a.scrollIntoViewIfNeeded();
      const r = await a.boundingBox(); const x = r.x + r.width / 2;
      const y = edge === 'start' ? r.y + 3 : edge === 'end' ? r.y + r.height - 3 : r.y + r.height / 2;
      await p.mouse.move(x, y); await p.mouse.down(); return { x, y };
    };
    await a.click(); await p.locator('#be-label').waitFor();
    check(await p.locator('#be-label').inputValue() === base.label, 'click still opens editor');
    await p.keyboard.press('Escape');
    let slight = await grab(); await p.mouse.move(slight.x + 2, slight.y + 2); await p.mouse.up();
    await p.locator('#be-label').waitFor();
    check((await current()).start === 600 && writes === 0, 'movement below four pixels remains a click');
    await p.keyboard.press('Escape');
    const g = await grab(); await p.mouse.move(g.x, g.y + 16, { steps: 6 });
    check(await p.locator('.block-drag-time').innerText() === '10:15–11:45', 'five minute snapping preview: ' + await p.locator('.block-drag-time').innerText());
    check((await current()).start === 600 && writes === 0, 'preview does not save');
    const other = p.locator('.col.active .block', { hasText: 'Overlapping review' });
    const ra = await a.boundingBox(), rb = await other.boundingBox();
    check(ra.x + ra.width <= rb.x, 'preview preserves overlap lanes');
    await p.screenshot({ path: resolve(shots, `${width}-${theme}-preview.png`) });
    await p.mouse.up(); await saved(615, 705);
    check(writes === 1, `drop saves once (${writes} requests)`);
    for (let i = 0; i < 60 && (await api.get('settings')).value.schedule.find(r => r.id === 'drag-repeat').start !== 615; i++) await p.waitForTimeout(100);
    check((await api.get('settings')).value.schedule.find(r => r.id === 'drag-repeat').start === 615, 'repeating block updates its template');
    await p.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(600, 690);
    for (let i = 0; i < 60 && (await api.get('settings')).value.schedule.find(r => r.id === 'drag-repeat').start !== 600; i++) await p.waitForTimeout(100);
    check((await api.get('settings')).value.schedule.find(r => r.id === 'drag-repeat').start === 600, 'undo restores template too');
    check(true, 'undo restores original times');
    let h = await grab('end'); await p.mouse.move(h.x, h.y + 18); await p.mouse.up(); await saved(600, 705);
    check(true, 'bottom edge extends');
    h = await grab('end'); await p.mouse.move(h.x, h.y - 600); await p.mouse.up(); await saved(600, 615);
    check(true, 'shortening stops at fifteen minutes');
    h = await grab('start'); await p.mouse.move(h.x, h.y - 30); await p.mouse.up(); await saved(575, 615);
    check(true, 'top edge extends without moving end');
    h = await grab('start'); await p.mouse.move(h.x, h.y - 200); await p.mouse.up(); await saved(540, 615);
    check(true, 'top edge clamps to day start');
    h = await grab(); await p.mouse.move(h.x, h.y + 700); await p.mouse.up(); await saved(945, 1020);
    check(true, 'move clamps to day end');
    h = await grab(); await p.mouse.move(h.x, h.y - 30); await p.keyboard.press('Escape'); await p.mouse.up();
    check(await p.locator('.block-drag-time').count() === 0, 'Escape clears preview');
    check((await current()).start === 945, 'Escape does not save');
    await a.focus(); await p.keyboard.press('Alt+ArrowUp'); await saved(940, 1015);
    await p.keyboard.press('Alt+Shift+ArrowUp'); await saved(940, 1010);
    check(true, 'Alt arrows move and Alt Shift arrows resize by five minutes');
    if (width === 390) {
      await a.scrollIntoViewIfNeeded(); const r = await a.boundingBox();
      const session = await c.newCDPSession(p), x = r.x + r.width / 2, y = r.y + r.height / 2;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await p.waitForTimeout(420);
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 18 }] });
      check(await p.locator('.block-drag-time').isVisible(), 'phone long press activates preview');
      await p.screenshot({ path: resolve(shots, '390-light-touch-preview.png') });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await saved(925, 995); check(true, 'phone long press drag saves');
      await a.scrollIntoViewIfNeeded(); const swipe = await a.boundingBox();
      const sx = swipe.x + swipe.width / 2, sy = swipe.y + swipe.height / 2;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 40 }] });
      await p.waitForTimeout(420);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      check(await p.locator('.block-drag-time').count() === 0 && (await current()).start === 925, 'early touch swipe does not drag or save');
      await session.detach();
    }
    await c.close();
  }
} finally { await browser.close(); s.stop(); }
