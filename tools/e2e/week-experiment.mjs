import { strict as assert } from 'node:assert';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';

const s = await startServer(), b = await launch();
const waitFor = async (fn) => {
  for (let i = 0; i < 60; i++) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Document did not persist');
};
try {
  for (const lang of ['en', 'tr']) {
    const api = await demoAccount(client(s.url), { lang });
    await api.put('week:2026-W46', { items: [], notes: 'keep notes' });
    await api.put('week:2026-W47', { items: [], notes: '' });
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    const p = await c.newPage();
    const fits = async () => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), lang + ' overflow');
    await p.goto(s.url + '/review/2026-W46');
    const input = p.locator('#week-experiment');
    await input.waitFor();
    assert.equal(await p.locator('label[for="week-experiment"]').innerText(), lang === 'en'
      ? 'The one thing I will change next week (optional)'
      : 'Gelecek hafta değiştireceğim tek şey (isteğe bağlı)');
    await fits();
    assert.equal(await input.inputValue(), '');
    await p.locator('.title-actions a[href="/week/2026-W46"]').first().click();
    await p.locator('#wk-notes').waitFor();
    assert.equal((await api.get('week:2026-W46')).value.experiment, undefined);
    await p.goto(s.url + '/review/2026-W46');
    await input.fill('Read before opening email');
    await waitFor(async () => (await api.get('week:2026-W46')).value.experiment === 'Read before opening email');
    assert.equal((await api.get('week:2026-W46')).value.notes, 'keep notes');
    await p.goto(s.url + '/plan/2026-W47');
    const panel = p.getByTestId('previous-experiment');
    await panel.waitFor();
    assert.deepEqual(await panel.locator('button').allTextContents(), lang === 'en'
      ? ['It worked', 'Change', 'Drop'] : ['İşe yaradı', 'Değiştir', 'Bırak']);
    assert((await panel.innerText()).includes('Read before opening email'));
    assert((await p.locator('label[for="current-experiment"]').count()) === 0);
    for (const [i, result] of ['worked', 'change', 'drop'].entries()) {
      await panel.locator('button').nth(i).click();
      await waitFor(async () => (await api.get('week:2026-W46')).value.experimentResult === result);
      if (result === 'change') {
        await p.locator('#current-experiment').waitFor();
        assert.equal(await p.locator('#current-experiment').inputValue(), 'Read before opening email');
        await p.locator('#current-experiment').fill('Read for ten minutes');
        await waitFor(async () => (await api.get('week:2026-W47')).value.experiment === 'Read for ten minutes');
      }
      await fits();
    }
    // Optional experiment never gates the plan's next action.
    await p.locator('.welcome-foot button').last().click();
    assert.equal(await p.getByTestId('previous-experiment').count(), 0);
    await p.goto(s.url + '/week/2026-W47');
    await panel.waitFor();
    for (const [i, result] of ['worked', 'change', 'drop'].entries()) {
      await panel.locator('button').nth(i).click();
      await waitFor(async () => (await api.get('week:2026-W46')).value.experimentResult === result);
      if (result === 'change') assert.equal(await p.locator('#current-experiment').inputValue(), 'Read before opening email');
      await fits();
    }
    await p.reload();
    await panel.waitFor();
    assert.equal(await panel.locator('button[aria-pressed="true"]').count(), 1);
    await c.close();
    console.log('PASS ' + lang + ': optional review, next plan, all results on both screens, edit, persistence, 390px');
  }
} finally { await b.close(); s.stop(); }

