// The first-run setup, swept: every answer to the first question, every day to start from, the ruler's extremes,
// no metric (allowed) and every metric, both languages, both themes and screens from a phone to a wide monitor. Checks that
// nothing overflows, no text is cut where it must be read, the page throws nothing, the buttons stay on screen on
// a short laptop, and what is saved matches what was chosen.
//   npm run build && node tools/e2e/welcome.mjs [--shots dir]
import { chromium } from 'playwright-core';
import { client, startServer } from '../lib/server.mjs';
import { findBrowser } from '../lib/browser.mjs';

const arg = (name, def) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : def);
const shots = arg('shots', '');
let failed = 0, passed = 0;
const check = (name, ok, info = '') => { if (ok) passed++; else { failed++; console.log(`FAIL  ${name}${info ? `  (${info})` : ''}`); } };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: findBrowser() });
let n = 0;
async function account(lang) {
  const api = client(srv.url);
  const st = (await api.call('/api/auth/state')).body;
  const email = `sweep${++n}.person@example.test`;
  if (st.setup) await api.call('/api/auth/setup', { email, password: 'Demo-password-1', signupMode: 'open', lang });
  else {
    const form = st.form;
    await new Promise((r) => setTimeout(r, 3100));
    await api.call('/api/auth/register', { email, password: 'Demo-password-1', lang, form, website: '' });
  }
  return api;
}
async function open(api, { width, height = 900, lang = 'en', theme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
  await ctx.addCookies([{ name: api.cookie.split('=')[0], value: api.cookie.split('=').slice(1).join('='), url: srv.url }]);
  await ctx.addInitScript((t) => { localStorage.setItem('sc-theme', t); localStorage.setItem('sc-motion', 'reduce'); }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(srv.url + '/');
  await page.locator('.welcome-card').waitFor({ timeout: 8000 });
  return { ctx, page, errors };
}
// what must never happen on a step: the page wider than the window, text cut in the form, the foot off screen
async function sound(page, label) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const cut = [...document.querySelectorAll('.welcome-main *')].filter((el) => {
      const s = getComputedStyle(el);
      return el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && s.overflow !== 'visible' && s.display !== 'inline';
    }).map((el) => el.textContent.trim().slice(0, 30));
    const card = document.querySelector('.welcome-card').getBoundingClientRect();
    const out = [...document.querySelectorAll('.welcome-main *')].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width && (b.right > card.right + 1 || b.left < card.left - 1);
    }).map((el) => el.className || el.tagName).slice(0, 3);
    return { wide: doc.scrollWidth > doc.clientWidth + 1, cut, out };
  });
  check(`${label}: no sideways scroll`, !r.wide);
  check(`${label}: no text cut in the form`, !r.cut.length, r.cut.join(' | '));
  check(`${label}: nothing sticks out of the card`, !r.out.length, r.out.join(' | '));
}
const next = (page) => page.locator('.welcome-foot .btn.primary').click();
const ends = (page) => page.locator('.day-span [role=slider]');

// ---------- every width, both languages and themes: the three steps sound ----------
const WIDTHS = [[360, 740], [390, 844], [768, 1024], [1024, 768], [1100, 800], [1366, 768], [1440, 900], [1920, 1080]];
for (const lang of ['en', 'tr']) {
  for (const theme of ['light', 'dark']) {
    const api = await account(lang);
    for (const [width, height] of WIDTHS) {
      const { ctx, page, errors } = await open(api, { width, height, lang, theme });
      const tag = `${lang} ${theme} ${width}x${height}`;
      await page.locator('#w-name').fill(lang === 'tr' ? 'Şebnem Yılmaz-Öztürk' : 'Maximiliana Bartholomew-Featherstonehaugh');
      for (const k of [0, 1, 2, 3]) await page.locator('.wtile').nth(k).click();
      await sound(page, `${tag} step 1`);
      const cardH = async () => Math.round(await page.locator('.welcome-card').evaluate((el) => el.getBoundingClientRect().height));
      const h1 = await cardH();
      // one very long word (the input allows 80 characters): shown cut, nothing pushed off
      await page.locator('#w-name').fill('Ulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaşulaş');
      await sound(page, `${tag} step 1 one long word`);
      check(`${tag}: a long name is shown cut`, (await page.locator('.welcome-step h1').textContent()).includes('…'));
      await page.locator('#w-name').fill(lang === 'tr' ? 'Şebnem Yılmaz-Öztürk' : 'Maximiliana Bartholomew-Featherstonehaugh');
      if (shots && theme === 'light') await page.screenshot({ path: `${shots}/${lang}-${width}-1.png`, fullPage: true });
      await next(page);
      await sound(page, `${tag} step 2`);
      const h2 = await cardH();
      await page.locator('.hday').nth(4).click(); // a long day: the note shows
      await sound(page, `${tag} step 2 long`);
      if (shots && theme === 'light') await page.screenshot({ path: `${shots}/${lang}-${width}-2.png`, fullPage: true });
      await next(page);
      for (let k = 0; k < 8; k++) if ((await page.locator('.wtile').nth(k).getAttribute('aria-pressed')) !== 'true') await page.locator('.wtile').nth(k).click();
      await sound(page, `${tag} step 3 all metrics`);
      const h3 = await cardH();
      if (width >= 1040 && height >= 700) check(`${tag}: the card keeps one height through the steps`, h1 === h2 && h2 === h3, `${h1} ${h2} ${h3}`);
      if (shots && theme === 'light') await page.screenshot({ path: `${shots}/${lang}-${width}-3.png`, fullPage: true });
      // the buttons are reachable without scrolling on screens tall enough for a laptop
      if (height >= 740 && width >= 1024) {
        const foot = await page.locator('.welcome-foot .btn.primary').boundingBox();
        check(`${tag}: the button is on the first screen`, foot && foot.y + foot.height <= height, foot && `${Math.round(foot.y + foot.height)} > ${height}`);
      }
      check(`${tag}: no page errors`, !errors.length, errors.join('; '));
      await ctx.close();
    }
  }
}

// ---------- every answer to the first question: hours, metrics and the sketch follow ----------
{
  const USES = ['school', 'work', 'personal', 'projects'];
  const api = await account('en'); // nothing is saved until the end, so one account serves every answer (sign-ups are rate limited)
  for (let mask = 1; mask < 16; mask++) {
    const { ctx, page, errors } = await open(api, { width: 1440 });
    const chosen = USES.filter((_, k) => mask & (1 << k));
    await page.locator('#w-name').fill('Robin');
    if (mask === 1) {
      // a block already drawn stays the same element when another answer is added (it glides, it does not rise again)
      await page.locator('.wtile').nth(0).click();
      const first = await page.locator('.welcome-sketch .ws-block').first().elementHandle();
      await page.locator('.wtile').nth(2).click();
      check('adding an answer keeps the blocks already drawn', await first.evaluate((el) => el.isConnected));
      await page.locator('.wtile').nth(2).click();
      await page.locator('.wtile').nth(0).click();
      check('before an answer the sketch has no blocks', (await page.locator('.welcome-sketch .ws-block').count()) === 0);
      const labels = await page.locator('.welcome-sketch .ws-line span').allTextContents();
      check('before an answer the day is 09:00-17:00, its end labelled', labels[0] === '09:00' && labels[labels.length - 1] === '17:00' && (await page.locator('.welcome-sketch .ws-line').count()) === 9, labels.join(' '));
      // the labels sit on their lines, evenly: no two closer than the rest
      const ys = await page.locator('.welcome-sketch .ws-line span').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      const gaps = ys.slice(1).map((v, i) => v - ys[i]);
      check('the hour labels are evenly spaced, the last pair too', Math.max(...gaps) - Math.min(...gaps) < 2, gaps.map(Math.round).join(','));
      check('the sketch shows no current time', (await page.locator('.welcome-sketch .ws-now, .ds-now').count()) === 0);
    }
    for (const u of chosen) await page.locator('.wtile').nth(USES.indexOf(u)).click();
    const blocks = await page.locator('.welcome-sketch .ws-block').count();
    if (mask === 1) check('the sketch takes no clicks', (await page.locator('.welcome-sketch').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none');
    check(`${chosen}: the sketch draws blocks`, blocks >= 1 && blocks <= 4, String(blocks));
    await next(page);

    const a = Number(await ends(page).nth(0).getAttribute('aria-valuenow').catch(() => '0'));
    const whole = (await ends(page).count()) === 0;
    const b2 = Number(await ends(page).nth(1).getAttribute('aria-valuenow').catch(() => '0'));
    check(`${chosen}: the hours stay 09:00-17:00`, a === 9 && b2 === 17 && !whole, `${a}-${b2} whole=${whole}`);
    await next(page);
    const metrics = await page.locator('.wtile[aria-pressed="true"]').count();
    check(`${chosen}: metrics are picked in advance`, metrics >= 1, String(metrics));
    check(`${chosen}: no page errors`, !errors.length, errors.join('; '));
    await ctx.close();
  }
}

// ---------- the ruler's extremes, every day to start from, and what is saved ----------
{
  const api = await account('en');
  const { ctx, page, errors } = await open(api, { width: 1440 });
  await page.locator('#w-name').fill('Robin');
  await page.locator('.wtile').nth(1).click();
  await page.keyboard.press('Enter'); // the tile just chosen has the focus: Enter moves on, it does not untick it
  check('Enter on a chosen tile moves on', (await page.locator('.welcome-step h1').textContent()).includes('hours') && (await page.locator('.welcome-summary').textContent()).length > 0);
  const DAYS = [[6, 14], [8, 18], [9, 17], [12, 22], [7, 23]];
  for (let k = 0; k < 5; k++) {
    await page.locator('.hday').nth(k).click();
    check(`day ${k} sets both ends`, Number(await ends(page).nth(0).getAttribute('aria-valuenow')) === DAYS[k][0] && Number(await ends(page).nth(1).getAttribute('aria-valuenow')) === DAYS[k][1]);
  }
  await page.locator('.hday').nth(5).click();
  check('the whole day hides the ends and warns kindly', (await ends(page).count()) === 0 && (await page.locator('.wh-hint.long').count()) === 1);
  await page.locator('.hday').nth(2).click();
  // the earliest one-hour day, then the latest
  await ends(page).nth(0).focus(); await page.keyboard.press('Home');
  await ends(page).nth(1).focus(); for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
  check('the shortest day is one hour, at midnight', (await ends(page).nth(0).getAttribute('aria-valuenow')) === '0' && (await ends(page).nth(1).getAttribute('aria-valuenow')) === '1');
  await sound(page, 'one hour at 00');
  await ends(page).nth(1).focus(); await page.keyboard.press('End');
  await ends(page).nth(0).focus(); for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  check('the latest day ends at 24', (await ends(page).nth(0).getAttribute('aria-valuenow')) === '23' && (await ends(page).nth(1).getAttribute('aria-valuenow')) === '24');
  await sound(page, 'one hour at 23');
  check('one hour reads "1 hour"', (await page.locator('.wh-line').textContent()).includes('1 hour a day'));
  const knobs = await ends(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  check('the two ends never cover each other', knobs[0].right <= knobs[1].left + 1, `${knobs[0].right} ${knobs[1].left}`);
  if (shots) await page.screenshot({ path: `${shots}/one-hour.png`, fullPage: true });
  await ends(page).nth(0).focus(); for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowLeft'); // 10 -> 24: 14 hours
  check('a long day shows the note', (await page.locator('.wh-hint.long').count()) === 1);
  await page.keyboard.press('Enter'); // from a ruler's end
  check('Enter on the ruler moves on', (await page.locator('.welcome-step h1').textContent()).includes('keep count'));
  // no metric is allowed (some want nothing to count); then two
  for (let k = 0; k < 8; k++) if ((await page.locator('.wtile').nth(k).getAttribute('aria-pressed')) === 'true') await page.locator('.wtile').nth(k).click();
  check('no metric: finishing is still offered', (await page.locator('.welcome-foot .btn.primary').getAttribute('aria-disabled')) !== 'true' && (await page.locator('.welcome-need').count()) === 0);
  await page.locator('.wtile').nth(1).click(); // words
  await page.locator('.wtile').nth(7).click(); // journal
  await next(page);
  await page.waitForURL(/\/day\//, { timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const st = (await api.get('settings')).value;
  check('saved: the hours', st.startHour === 10 && st.endHour === 24 && !st.wholeDay, `${st.startHour}-${st.endHour}`);
  check('saved: the metrics', st.metrics.map((m) => m.id).join(',') === 'words,journal', st.metrics.map((m) => m.id).join(','));
  check('saved: the answers', st.profile.uses.join(',') === 'work' && st.setupDone === true);
  check('no page errors', !errors.length, errors.join('; '));
  await ctx.close();
}

// ---------- finishing with nothing to count ----------
{
  const api = await account('en');
  const { ctx, page, errors } = await open(api, { width: 1440 });
  await page.locator('#w-name').fill('Robin');
  await page.locator('.wtile').nth(0).click();
  await next(page); await next(page);
  for (let k = 0; k < 8; k++) if ((await page.locator('.wtile').nth(k).getAttribute('aria-pressed')) === 'true') await page.locator('.wtile').nth(k).click();
  await next(page);
  await page.waitForURL(/\/day\//, { timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const st = (await api.get('settings')).value;
  check('finishing with no metric saves none and the hours 09-17', st.setupDone && st.metrics.length === 0 && st.startHour === 9 && st.endHour === 17, JSON.stringify([st.metrics.length, st.startHour, st.endHour]));
  check('no page errors (no metric)', !errors.length, errors.join('; '));
  await ctx.close();
}

// ---------- skipping keeps what was answered; run again from Settings, Cancel changes nothing ----------
{
  const api = await account('tr');
  const { ctx, page } = await open(api, { width: 390, lang: 'tr' });
  check('the Enter key shows on the button only where there is a fine pointer', (await page.locator('.enter-key').isVisible()) === (await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)));
  await page.locator('#w-name').fill('Deniz Kuzey');
  await page.locator('.wtile').nth(1).click(); // İş
  await page.getByRole('button', { name: 'Şimdilik geç' }).click();
  await page.locator('.welcome').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  check('skipping leaves the setup', (await page.locator('.welcome').count()) === 0);
  check('skipping drops the draft', (await page.evaluate(() => sessionStorage.getItem('sc-welcome-2'))) === null);
  await new Promise((r) => setTimeout(r, 1200));
  let st = (await api.get('settings')).value;
  check('skipping keeps the answers so far', st.setupDone && st.profile?.uses?.join(',') === 'work' && st.startHour === 9 && st.endHour === 17, JSON.stringify([st.profile, st.startHour, st.endHour]));
  check('skipping keeps the name', (await api.call('/api/account')).body.name === 'Deniz Kuzey');
  await ctx.close();
  // as the Settings button does
  await api.put('settings', { ...st, setupDone: false, tourDone: false, setupAgain: true });
  const again = await open(api, { width: 1440, lang: 'tr' });
  check('run again: it says so', (await again.page.locator('.welcome-step h1').textContent()) === 'Kurulumu güncelle');
  check('run again: the current answers are chosen', (await again.page.locator('#w-name').inputValue()) === 'Deniz Kuzey' && (await again.page.locator('.wtile').nth(1).getAttribute('aria-pressed')) === 'true');
  check('run again: the Enter key shows on the button with a keyboard', await again.page.locator('.enter-key').isVisible());
  await again.page.locator('.wtile').nth(0).click(); // a change, then Cancel
  await again.page.getByRole('button', { name: 'Vazgeç' }).click();
  await again.page.waitForURL(/\/settings/, { timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  st = (await api.get('settings')).value;
  check('run again, Cancel: back to Settings, nothing changed', again.page.url().endsWith('/settings') && st.setupDone && st.tourDone && !st.setupAgain && st.profile.uses.join(',') === 'work' && st.startHour === 9, JSON.stringify([again.page.url(), st.profile, st.startHour]));
  check('run again: no page errors', !again.errors.length, again.errors.join('; '));
  await again.ctx.close();
}

await browser.close();
srv.stop();
console.log(failed ? `${failed} of ${passed + failed} checks failed` : `all ${passed} checks passed`);
process.exit(failed ? 1 : 0);
