import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const check = (ok, name) => { if (!ok) throw Error('FAIL ' + name); console.log('PASS ' + name); };
const s = await startServer(), api = await demoAccount(client(s.url), { lang: 'en' }), browser = await launch();
const shots = resolve('reports/block-overlap'); mkdirSync(shots, { recursive: true });
const settings = (await api.get('settings')).value;
const blocks = [{ id: 'a', start: 600, end: 660, label: 'Review proposal', kind: 'deep', note: '' }, { id: 'b', start: 630, end: 690, label: 'Shutdown ritual', kind: 'shallow', note: '' }, { id: 'c', start: 735, end: 1020, label: 'Afternoon work', kind: 'deep', note: '' }];
try {
  await api.put('settings', { ...settings, startHour: 9, endHour: 17, wholeDay: false });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await api.put('day:2026-11-20', { columns: [{ from: null, closedAt: null, blocks }], tasks: [], notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } });
    const c = await browser.newContext({ timezoneId: 'Europe/Istanbul', viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    await c.addInitScript(t => localStorage.setItem('sc-theme', t), theme);
    const p = await c.newPage(); await p.clock.install({ time: new Date('2026-11-20T07:37:00Z') });
    await p.goto(s.url + '/day/2026-11-20');
    const a = p.locator('.col.active .block', { hasText: 'Review proposal' }), b = p.locator('.col.active .block', { hasText: 'Shutdown ritual' });
    await a.waitFor(); await b.waitFor();
    const ra = await a.boundingBox(), rb = await b.boundingBox();
    check(ra.x + ra.width <= rb.x && Math.abs(ra.width - rb.width) < 1, `${width} ${theme} equal lanes do not cover each other`);
    for (const el of [a, b]) {
      check(await el.locator('.bl').isVisible() && await el.locator('.bt').isVisible(), 'title and time visible');
      await el.click(); await p.locator('#be-label').waitFor();
      check(await p.locator('#be-label').inputValue() === await el.locator('.bl').innerText(), 'both overlapping blocks open their own editor');
      await p.keyboard.press('Escape');
    }
    await p.screenshot({ path: resolve(shots, `${width}-${theme}.png`), fullPage: true });
    if (width === 390) await p.locator('.day-actions-toggle').click();
    await p.getByRole('button', { name: 'Add a block', exact: true }).click();
    check(await p.locator('#be-start').inputValue() === '690', 'today skips blocks covering now');
    check(await p.locator('#be-end').inputValue() === '735', 'default hour shortened to 45 minute gap');
    await p.locator('#be-label').fill('Free gap'); await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.locator('.col.active .block', { hasText: 'Free gap' }).waitFor();
    if (!await p.getByRole('button', { name: 'Add a block', exact: true }).isVisible()) await p.locator('.day-actions-toggle').click();
    await p.getByRole('button', { name: 'Add a block', exact: true }).click();
    check(await p.locator('#be-start').inputValue() === '990', 'full remaining day falls back inside day end');
    check(await p.getByRole('status').filter({ hasText: 'Afternoon work' }).isVisible(), 'fallback warns about overlap');
    check(await p.getByRole('status').filter({ hasText: 'No free interval' }).isVisible(), 'no available gap has an explicit warning');
    await c.close();
  }
} finally { await browser.close(); s.stop(); }
