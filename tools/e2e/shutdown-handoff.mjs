import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const s = await startServer(), b = await launch();
const blank = tasks => ({ columns: [{ from: null, closedAt: null, blocks: [] }], tasks, notes: '', metrics: {}, shutdown: { done: false, at: null, steps: {} } });
const from = '2026-11-13', tomorrow = '2026-11-14', target = '2026-11-18';
try {
  for (const lang of ['en', 'tr']) {
    const api = await demoAccount(client(s.url), { lang });
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Istanbul' });
    await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    const p = await c.newPage();
    await p.clock.install({ time: new Date('2026-11-13T23:00:00Z') });
    const settings = (await api.get('settings')).value;
    await api.put('settings', { ...settings, dayStart: 240 });
    const task = { id: 'move', text: 'Move this', done: false, due: '2026-11-15' };
    await api.put('day:' + from, blank([task, { id: 'stay', text: 'Keep this', done: false }]));
    await api.put('day:' + tomorrow, blank([]));
    await api.put('day:' + target, blank([]));
    await p.goto(s.url + '/shutdown');
    const panel = p.locator('section[aria-labelledby="open-h"]');
    await panel.locator('.carry').first().waitFor();
    assert.equal(await panel.locator('.segmented button').first().getAttribute('aria-pressed'), 'true');
    assert.equal(await panel.locator('.carry input:checked').count(), 2);
    assert.match(await panel.locator('.field > button').innerText(), /16/);
    assert.equal(await panel.locator('.segmented button').last().getAttribute('aria-pressed'), 'false');
    await panel.locator('.segmented button').last().click();
    await panel.locator('input[type="date"]').fill(target);
    await panel.locator('.carry', { hasText: 'Keep this' }).locator('input').uncheck();
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px overflow');
    await panel.locator('header button').click();
    await p.clock.runFor(2500);
    const src = (await api.get('day:' + from)).value;
    const dst = (await api.get('day:' + target)).value;
    assert.deepEqual(src.tasks.map(t => t.id), ['stay']);
    assert.equal(dst.tasks.filter(t => t.id === 'move').length, 1);
    assert.equal(dst.tasks[0].due, task.due);
    assert.equal((await api.get('day:' + tomorrow)).value.tasks.length, 0);
    // Repeat the transfer with the same source id and verify the second document is unchanged.
    await api.put('day:' + from, blank([task]));
    await p.reload();
    await panel.locator('.carry').waitFor();
    await panel.locator('.segmented button').last().click();
    await panel.locator('input[type="date"]').fill(target);
    await panel.locator('header button').click();
    await p.clock.runFor(2500);
    assert.equal((await api.get('day:' + target)).value.tasks.length, 1);
    assert.equal((await api.get('day:' + target)).value.tasks[0].due, task.due);
    console.log('PASS ' + lang + ': default tomorrow, weekday suggestion, selected date/tasks, retry, due, day start, 390px');
    await c.close();
  }
} finally { await b.close(); s.stop(); }
