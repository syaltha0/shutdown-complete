import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const srv = await startServer();
const api = await demoAccount(client(srv.url), { lang: 'en' });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
const page = await ctx.newPage();
mkdirSync('reports/qa-restore-month', { recursive: true });
const upload = async data => page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(data) });
try {
  await page.goto(srv.url + '/settings');
  const before = (await api.call('/api/export')).body.docs;
  const backup = { docs: [{ key: 'day:2026-11-01', value: { ...before.find(d => d.key.startsWith('day:')).value, note: 'restored' } }, { key: 'day:2026-11-30', value: before.find(d => d.key.startsWith('day:')).value }, { key: 'month:2026-11', value: before.find(d => d.key.startsWith('month:')).value }] };
  await upload(JSON.stringify(backup));
  const panel = page.getByTestId('restore-preview');
  await panel.waitFor();
  assert.match(await panel.innerText(), /3 documents/);
  assert.match(await panel.innerText(), /2026-11-01.*2026-11-30/);
  assert.match(await panel.innerText(), /Day, Month/);
  assert.match(await panel.innerText(), /overwritten/);
  assert.deepEqual((await api.call('/api/export')).body.docs, before);
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await panel.count(), 0);
  assert.deepEqual((await api.call('/api/export')).body.docs, before);
  await upload(JSON.stringify(backup));
  await panel.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /imported/i }).waitFor();
  assert.equal((await api.get('day:2026-11-01')).value.note, 'restored');
  await page.waitForEvent('load');
  for (const lang of ['en', 'tr']) {
    await page.goto(srv.url + '/settings');
    await page.locator(`button[lang=${lang}]`).click();
    await page.waitForFunction(l => document.documentElement.lang.startsWith(l), lang);
    await upload('{broken');
    await page.getByRole('alert').filter({ hasText: lang === 'en' ? 'Choose a valid JSON backup' : 'Geçerli bir JSON yedeği' }).waitFor();
    await page.screenshot({ path: `reports/qa-restore-month/error-${lang}.png`, fullPage: true });
  }
  await page.locator('button[lang=en]').click();
  const d = iso(new Date());
  await page.evaluate(() => localStorage.setItem('sc-lang', 'en'));
  await page.goto(srv.url + '/month/' + d.slice(0, 7));
  await page.waitForFunction(() => document.documentElement.lang.startsWith('en'));
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  await page.locator('#ex-name').fill('Physics final with a long descriptive title');
  const examDate = new Date(); examDate.setDate(examDate.getDate() + 5);
  await page.locator('#ex-date').fill(iso(examDate));
  await page.locator('#ex-topics').fill('Kinematics\nForces');
  await page.locator('#ex-from').selectOption('1080');
  await page.locator('#ex-to').selectOption('1380');
  await page.locator('.exam-list li').first().waitFor();
  await page.getByRole('button', { name: 'Put it on the days' }).click();
  await page.locator('.exam-row').waitFor();
  for (const lang of ['en', 'tr']) {
    await page.goto(srv.url + '/settings');
    await page.locator(`button[lang=${lang}]`).click();
    await page.goto(srv.url + '/month/' + d.slice(0, 7));
    await page.locator('.exam-row').waitFor();
    for (const width of [360, 390, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang} month at ${width}`);
      await page.screenshot({ path: `reports/qa-restore-month/month-${lang}-${width}.png`, fullPage: true });
    }
  }
  await page.goto(srv.url + '/settings#s-features');
  await page.locator('[data-testid="feature-note"]').waitFor();
  await page.screenshot({ path: 'reports/qa-restore-month/features.png' });
  console.log('PASS preview, cancellation, restore, EN/TR errors, exam overflow and feature note');
} catch (e) { console.log((await page.locator('body').innerText()).slice(0, 1600)); await page.screenshot({path:'reports/qa-restore-month/failure.png'}); throw e; } finally { await browser.close(); srv.stop(); await srv.exited; }

