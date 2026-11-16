import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const srv = await startServer();
const browser = await launch();
try {
  for (const lang of ['en', 'tr']) for (const theme of ['light', 'dark']) for (const width of [390, 360]) {
    const api = await demoAccount(client(srv.url), { lang });
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 740 }, reducedMotion: 'reduce' });
    await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
    const page = await ctx.newPage();
    await page.goto(srv.url + '/settings');
    await page.locator('#s-theme').waitFor();
    await page.locator('#s-colour + * button').nth(theme === 'light' ? 0 : 1).click();
    const original = page.url();
    const bar = page.locator('.tabbar');
    assert.equal(await bar.locator(':scope > *').count(), 5);
    await bar.getByRole('button', { name: lang === 'tr' ? 'Görev ekle' : 'Add task', exact: true }).click();
    const input = page.locator('.quick-capture input');
    assert.equal(await input.evaluate(e => e === document.activeElement), true);
    await input.fill(lang === 'tr' ? 'yarın 10:00 Rapor' : 'Report tomorrow 10am');
    await input.press('Enter');
    await page.locator('.quick-capture').waitFor({ state: 'detached' });
    assert.equal(page.url(), original);
    let doc;
    for (let attempt = 0; attempt < 50; attempt++) {
      doc = (await api.get('inbox')).value;
      if (doc?.items.some(x => x.text === (lang === 'tr' ? 'Rapor' : 'Report'))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const task = doc.items.find(x => x.text === (lang === 'tr' ? 'Rapor' : 'Report'));
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(task?.due, iso(tomorrow)); assert.equal(task?.dueTime, '10:00');
    await bar.locator('button').last().click();
    await page.locator('.more-card a[href^="/week/"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.more-head button').click();
    const preference = page.getByLabel(lang === 'tr' ? 'Alt çubukta Hafta yerine Ekle' : 'Show Add instead of Week in the bottom bar');
    await preference.uncheck();
    await bar.locator('a[href^="/week/"]').waitFor();
    assert.equal(await bar.locator(':scope > *').count(), 5);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await bar.locator(':scope > *').evaluateAll(es => es.every(e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })));
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await bar.isVisible(), false);
    const count = await page.locator('.rail a').count();
    await preference.check();
    assert.equal(await page.locator('.rail a').count(), count);
    assert.equal(await page.locator('.rail button').count(), 0);
    console.log(`PASS quick capture ${lang} ${theme} ${width}; desktop rail unchanged`);
    await ctx.close();
  }
} finally { await browser.close(); await srv.stop(); }
