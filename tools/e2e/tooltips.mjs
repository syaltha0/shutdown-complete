import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';

// Hover notes: one styled note replaces the browser's own, keeps inside the window and gives the title back after.
// Quick add: the field and its button sit on one line in a centred dialog on wide screens.
const server = await startServer(), browser = await launch();
try {
  const api = await demoAccount(client(server.url));
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: server.url }]);
  const page = await context.newPage();
  for (const [width, height] of [[1440, 900], [1366, 768]]) {
    await page.setViewportSize({ width, height }); await page.goto(server.url + '/');
    const cell = page.locator('.b-heatmap a').last(); await cell.waitFor();
    const title = await cell.getAttribute('title');
    assert.ok(title, 'the cell carries its note');
    await cell.hover(); const tip = page.locator('.app-tip.on'); await tip.waitFor();
    assert.equal(await cell.getAttribute('title'), null, 'the browser note is held back while ours shows');
    assert.equal((await tip.textContent()).replace(/\s+/g, ''), title.replace(/ · /, '').replace(/\s+/g, ''), 'the same words');
    assert.equal(await tip.locator('strong').textContent(), title.split(' · ')[0], 'the first part leads');
    const box = await tip.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, 'inside the window');
    const cellBox = await cell.boundingBox();
    assert.ok(box.y + box.height <= cellBox.y || box.y >= cellBox.y + cellBox.height, 'beside the cell, never over it');
    await page.mouse.move(5, 5); await page.waitForTimeout(100);
    assert.equal(await page.locator('.app-tip.on').count(), 0, 'gone when the mouse leaves');
    assert.equal(await cell.getAttribute('title'), title, 'the title is back');

    // quick add from today's card
    await page.locator('.b-today .b-add, .b-today .b-round-action').first().click();
    const dialog = page.locator('dialog.quick-capture[open]'); await dialog.waitFor();
    const input = await dialog.locator('input').boundingBox(), submit = await dialog.locator('button[type=submit]').boundingBox();
    assert.ok(Math.abs(input.y - submit.y) < 2 && submit.x > input.x + input.width, 'field and button on one line');
    const d = await dialog.boundingBox();
    assert.ok(d.y + d.height < height - 40 && Math.abs(d.x + d.width / 2 - width / 2) < 2, 'centred, not stuck to the bottom');
    await dialog.locator('input').fill('Tooltip test task'); await dialog.locator('input').press('Enter');
    await dialog.waitFor({ state: 'detached' }).catch(() => {}); await page.waitForTimeout(1200);
    const { iso } = await import('../lib/demo.mjs');
    assert.ok((await api.get('day:' + iso(new Date()))).value.tasks.some((x) => x.text === 'Tooltip test task'), 'the task is on today');
  }
  console.log('PASS tooltips: styled hover note in place of the native one, inside the window, title restored; quick add on one line, centred');
} finally { await browser.close(); server.stop(); }
