// End-to-end checks of the Metrics screen: picking a metric and a period, entering today's value, the comparison with
// last week, the weekday strip, the check metrics' grid, and phone width. Real browser, throwaway server.
//   npm run build && node tools/e2e/metrics.mjs [--shots <dir>]
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

const srv = await startServer();
const api = await demoAccount(client(srv.url), { lang: 'en' });
const D = iso(new Date());
const doc = async (key) => (await api.get(key)).value;
const browser = await launch();
const cookie = [{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }];
const open = async (opts) => {
  const ctx = await browser.newContext({ locale: 'en-GB', reducedMotion: 'reduce', ...opts });
  await ctx.addCookies(cookie);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${srv.url}/metrics`);
  await page.locator('.kpis').waitFor();
  await page.waitForTimeout(900);
  return { ctx, page };
};
const shot = async (page, name, full = false) => { if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png`, fullPage: full }); };
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

try {
  const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
  const metric = (name) => page.locator('.metric-seg').getByRole('button', { name, exact: true });
  const kpiSizes = await page.locator('.kpi-value').evaluateAll((els) => els.map((e) => getComputedStyle(e).fontSize));
  check('the four figures share one size', new Set(kpiSizes).size === 1, kpiSizes.join(' '));
  const lead = await page.locator('.kpi.lead .delta').textContent();
  check('this week is compared with last week', /vs same days last week/.test(lead), lead);
  const weeksShown = await page.locator('.byweek tbody tr').count();
  check('the weeks start at the first logged one (no empty lead-in)', weeksShown === 6, `${weeksShown} weeks`);
  const best = await page.locator('.wd-best').textContent();
  check('the weekday strip shows seven days and names the best one', (await page.locator('.wd-strip li').count()) === 7 && /strongest/.test(best), best);
  check('the empty "by subject" is a line, not a card', (await page.locator('.empty-line').count()) === 1 && (await page.locator('#subj-h').count()) === 0);
  await shot(page, '1-top-1440');
  await shot(page, '2-full-1440', true);

  // today's value, typed here, lands in the day document
  const box = page.locator('.te-field input');
  const num = (t) => parseFloat(String(t).replace(',', '.'));
  const before = num(await page.locator('.kpi.lead .kpi-value').textContent());
  const old = num(await box.inputValue()) || 0;
  await box.fill('2,5');
  await box.press('Enter');
  await wait(1500);
  const saved = (await doc(`day:${D}`)).metrics.deep;
  check("today's number typed here is written to the day", saved === 2.5, String(saved));
  // the week's figure moves by what was typed (not a fixed number: the demo week depends on today's weekday)
  const after = num(await page.locator('.kpi.lead .kpi-value').textContent());
  check('and the figures follow', Math.abs(after - before - (2.5 - old)) < 0.05, `${before} -> ${after} (today was ${old})`);
  await page.getByRole('button', { name: 'Clear' }).click();
  await wait(1500);
  check('clearing it removes the value from the day', (await doc(`day:${D}`)).metrics.deep === undefined);
  await box.fill('1');
  await box.press('Enter');
  await wait(1300);

  // a check metric: a grid of days, a toggle for today
  await metric('Read 20 pages').click();
  await page.locator('.daygrid').waitFor();
  check('a check metric shows a day grid, not bars', (await page.locator('.daygrid .dg-row[role="img"]').count()) >= 3 && (await page.locator('.chart svg').count()) === 0);
  // the rest of this week (none on a Sunday) is left blank
  check('days still to come are left blank', (await page.locator('.daygrid .dg-row.cur i.future').count()) === 6 - ((new Date().getDay() + 6) % 7));
  const toggle = page.locator('.te-check');
  const was = (await doc(`day:${D}`)).metrics.read === true;
  await toggle.click();
  await wait(1500);
  check("the toggle writes today's check", ((await doc(`day:${D}`)).metrics.read === true) !== was);
  check('and it shows the state', (await toggle.getAttribute('aria-pressed')) === String(!was));
  check('a check counts days, not hours', (await page.locator('.kpi-label').first().textContent()) === 'Days this week');

  // the period
  await metric('Deep focus').click();
  const rowsBefore = await page.locator('.byweek tbody tr').count();
  await page.getByRole('button', { name: 'This quarter' }).click();
  await wait(700);
  const rowsAfter = await page.locator('.byweek tbody tr').count();
  check('the period switches and the chart redraws', (await page.getByRole('button', { name: 'This quarter' }).getAttribute('aria-pressed')) === 'true' && (await page.locator('.chart svg').count()) === 1 && rowsAfter >= 1, `${rowsBefore} -> ${rowsAfter} weeks`);
  await page.getByRole('button', { name: '8 weeks' }).click();
  const anim = await page.locator('.kpi-value').first().evaluate((e) => getComputedStyle(e).animationName);
  check('with reduced motion nothing slides', anim === 'none', anim);
  await ctx.close();

  // a phone
  const ph = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  check('on a phone the metric picker is a select that fits', (await ph.page.locator('.metric-select').isVisible()) && !(await ph.page.locator('.metric-seg').isVisible()));
  check('no sideways scroll at 390px', (await overflowX(ph.page)) <= 0, String(await overflowX(ph.page)));
  await shot(ph.page, '3-phone-390');
  await shot(ph.page, '4-phone-full-390', true);
  await ph.ctx.close();
  const small = await open({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  check('no sideways scroll at 360px', (await overflowX(small.page)) <= 0, String(await overflowX(small.page)));
  const clipped = await small.page.evaluate(() => [...document.querySelectorAll('.canvas *')]
    .filter((e) => !e.closest('svg') && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible')
    .map((e) => `${e.tagName}.${e.className}`).slice(0, 5));
  check('nothing spills out of its box at 360px', clipped.length === 0, clipped.join(', '));
  await small.page.locator('.metric-select').selectOption({ label: 'Exercise' });
  await small.page.locator('.daygrid').waitFor();
  check('360px: the day grid fits too', (await overflowX(small.page)) <= 0);
  await small.ctx.close();

  const dark = await open({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await shot(dark.page, '5-dark-1440');
  await dark.ctx.close();
} finally {
  await browser.close();
  srv.stop();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
