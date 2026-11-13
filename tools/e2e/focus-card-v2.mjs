// The Focus card's second pass: Skip (with the three ways to count it), the block picker, the controls' shared look,
// and resetting the cycle. Run `npm run build` first.
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const s = await startServer();
const api = await demoAccount(client(s.url), { lang: 'en' });
const b = await launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
const p = await c.newPage();
const D = iso(new Date());
let passed = 0;
const check = (name, ok) => { if (!ok) throw Error(name); passed++; console.log('PASS ' + name); };
const doc = async () => (await api.get('day:' + D)).value;
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await p.waitForTimeout(150); } return false; };
const settings0 = (await api.get('settings')).value;
const run = (min, ago, extra = {}) => ({ phase: 'focus', startedAt: new Date(Date.now() - ago * 60000).toISOString(), plannedMin: min, pausedLeft: null, blockId: null, label: 'Edge', ...extra });
const setActive = async (active, sessions, more = {}) => { const x = (await api.get('day:' + D)).value ?? {}; await api.put('day:' + D, { ...x, focus: { ...(x.focus ?? {}), active, sessions: sessions ?? x.focus?.sessions ?? [], ...more } }); };
const btn = (name) => p.getByRole('button', { name, exact: true });
const choiceBtn = (re) => p.getByRole('button', { name: re });
const open = async (path = '/focus') => { await p.goto(s.url + path); await p.locator('.focus-panel, .mini-timer').first().waitFor(); };
const session = (i, minutes = 25, extra = {}) => ({ id: `s${i}`, blockId: null, label: 'Earlier', kind: null, start: `${D}T09:00:00`, end: `${D}T09:25:00`, minutes, ...extra });

try {
  // ---------- 1. Skip ----------
  await setActive(null, []);
  await setActive(run(25, 0.2), []);
  await open();
  await btn('Skip').click();
  const quick = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' ? x : null; });
  check('skipping within the first 30 seconds asks nothing and counts nothing', quick && quick.focus.sessions.length === 0 && await p.locator('.skip-choice').count() === 0);
  check('the break after an uncounted skip is a short one', quick.focus.active.plannedMin === 5 && !quick.focus.active.sessionId);

  await setActive(run(25, 10), []);
  await open();
  await btn('Skip').click();
  await p.locator('.skip-choice').waitFor();
  const text = await p.locator('.skip-choice').innerText();
  check('after 30 seconds, skipping asks what to count, with both durations', /Skip this focus\?/.test(text) && /so far \(10 min\)/.test(text) && /whole session \(25 min\)/.test(text) && /Keep going/.test(text));
  check('keyboard focus moves into the choice', await p.evaluate(() => document.querySelector('.skip-choice').contains(document.activeElement)));
  await p.keyboard.press('Escape');
  await p.locator('.skip-choice').waitFor({ state: 'detached' });
  check('Esc keeps going: nothing is counted and the focus carries on', (await doc()).focus.active?.phase === 'focus' && (await doc()).focus.sessions.length === 0);
  check('focus returns to the Skip button', await p.evaluate(() => document.activeElement?.textContent === 'Skip'));
  await btn('Skip').click();
  await choiceBtn(/^Keep going/).click();
  check('"Keep going" also closes it', await p.locator('.skip-choice').count() === 0 && (await doc()).focus.active?.phase === 'focus');

  await btn('Skip').click();
  await choiceBtn(/^Count the time so far/).click();
  const el = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' ? x : null; });
  check('"count the time so far" logs the minutes run, then the break follows', el && el.focus.sessions.length === 1 && el.focus.sessions[0].minutes === 10 && el.focus.active.sessionId === el.focus.sessions[0].id);

  // the whole session counts: the session, the deep-work metric and the task's time all use the full length
  await setActive(null, []);
  const d0 = await doc();
  const deep = d0.columns.flatMap((x) => x.blocks).find((x) => x.kind === 'deep');
  const before = typeof d0.metrics.deep === 'number' ? d0.metrics.deep : 0;
  await setActive(run(24, 6, { blockId: deep.id, label: deep.label }), []);
  await open();
  await btn('Skip').click();
  await choiceBtn(/^Count the whole session \(24 min\)/).click();
  const fu = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' ? x : null; });
  check('"count the whole session" logs the planned length', fu && fu.focus.sessions.length === 1 && fu.focus.sessions[0].minutes === 24);
  check('and the deep-work metric follows the counted time', Math.abs(fu.metrics.deep - (before + 0.4)) < 0.011);

  // a break is skipped at once, without a question
  await setActive(run(25, 3, { phase: 'short', plannedMin: 5 }), []);
  await open();
  await btn('Skip').click();
  check('a break is skipped without asking', !!(await until(async () => (await doc()).focus.active === null)) && await p.locator('.skip-choice').count() === 0);

  // the double click on the choice logs once
  await setActive(run(25, 12), []);
  await open();
  await btn('Skip').click();
  await choiceBtn(/^Count the time so far/).waitFor();
  await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.textContent.startsWith('Count the time so far')); x.click(); x.click(); });
  await p.waitForTimeout(1200);
  check('a double click on a choice logs once', (await doc()).focus.sessions.length === 1);

  // the S key does the same as the button
  await setActive(run(25, 8), []);
  await open();
  await p.locator('h1').click();
  await p.keyboard.press('s');
  check('the S key asks too', await p.locator('.skip-choice').isVisible());
  await p.keyboard.press('Escape');

  // ---------- mini timer and room use the same choice ----------
  await setActive(run(25, 9), []);
  await open('/');
  await p.locator('.mini-timer').hover();
  await p.locator('.mini-timer').getByRole('button', { name: 'Skip', exact: true }).click();
  await p.locator('.mini-timer .skip-choice').waitFor();
  check('the mini timer asks the same question', /so far \(9 min\)/.test(await p.locator('.mini-timer .skip-choice').innerText()));
  await p.locator('.mini-timer').getByRole('button', { name: /^Count the whole session/ }).click();
  const mi = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' ? x : null; });
  check('and counts it the same way', mi && mi.focus.sessions.length === 1 && mi.focus.sessions[0].minutes === 25);

  await setActive(run(25, 9), []);
  await open('/focus');
  await btn('Focus room').click();
  await p.locator('.focus-room').waitFor();
  await p.locator('.focus-room').getByRole('button', { name: 'Skip', exact: true }).click();
  await p.locator('.focus-room .skip-choice').waitFor();
  await p.keyboard.press('Escape');
  check('in the focus room Esc closes the question, not the room', await p.locator('.focus-room .skip-choice').count() === 0 && await p.locator('.focus-room').isVisible());
  await p.locator('.focus-room').getByRole('button', { name: 'Skip', exact: true }).click();
  await choiceBtn(/^Count the time so far/).click();
  check('the room counts the time so far', !!(await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' && x.focus.sessions[0]?.minutes === 9; })));
  await p.keyboard.press('Escape');

  // ---------- strict mode ----------
  await api.put('settings', { ...settings0, focus: { ...settings0.focus, strict: true } });
  await setActive(run(25, 9), []);
  await open();
  check('strict mode locks Skip during focus', await btn('Skip').isDisabled());
  await p.locator('h1').click();
  await p.keyboard.press('s');
  check('and the S key', await p.locator('.skip-choice').count() === 0 && (await doc()).focus.active?.phase === 'focus');
  await setActive(run(25, 3, { phase: 'short', plannedMin: 5 }), []);
  await open();
  check('but a break can still be skipped', await btn('Skip').isEnabled());
  await api.put('settings', settings0);

  // ---------- 2. the block picker ----------
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const at = Math.max(200, Math.min(1200, nowMin));
  const mk = (id, label, kind, start, end) => ({ id, label, kind, start, end, note: '' });
  const planDay = async (blocks, sessions = []) => {
    const x = (await api.get('day:' + D)).value;
    const cols = structuredClone(x.columns); cols[0].blocks = blocks;
    await api.put('day:' + D, { ...x, columns: cols, focus: { active: null, sessions } });
  };
  const plan = [mk('pa', 'Alpha now', 'deep', at - 20, at + 40), mk('pb', 'Beta later', 'shallow', at + 60, at + 100), mk('pc', 'Gamma later', 'deep', at + 120, at + 180), mk('pd', 'Delta past', 'deep', at - 200, at - 140)];
  await planDay(plan, [session(1, 40, { blockId: 'pd', label: 'Delta past' })]);
  await open();
  const chip = p.locator('.bp-chip');
  const chipText = await chip.innerText();
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  check('the chip shows the block name, its hours and a deep mark', /Alpha now/.test(chipText) && chipText.includes(`${hh(at - 20)}–${hh(at + 40)}`) && await chip.locator('.bp-kind.deep').count() === 1);
  check('the old Now / Change row and the hidden select are gone', await p.locator('.focus-block-row, #fc-block').count() === 0 && await p.locator('#fc-task, #fc-intent').count() === 0);
  const h0 = await p.locator('.focus-panel').evaluate((e) => e.getBoundingClientRect().height);
  await chip.click();
  await p.locator('.bp-sheet').waitFor();
  check('pressing the chip opens a list over the card, and the card does not change height', Math.abs(h0 - await p.locator('.focus-panel').evaluate((e) => e.getBoundingClientRect().height)) < 1);
  const combo = p.locator('.bp-sheet').getByRole('combobox');
  check('the search field is a combobox with focus', await combo.count() === 1 && await p.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'));
  const names = () => p.locator('.bp-sheet').getByRole('option').evaluateAll((els) => els.map((e) => e.querySelector('.bp-name').textContent));
  check('the list: the running block, the ones to come, those past, then unplanned focus', JSON.stringify(await names()) === JSON.stringify(['Alpha now', 'Beta later', 'Gamma later', 'Delta past', 'Unplanned focus']));
  check('with headings for now, up next and earlier', JSON.stringify(await p.locator('.bp-heading').allInnerTexts()) === JSON.stringify(['Now', 'Up next', 'Earlier']));
  check('each shows its hours; the minutes already focused show too', (await p.locator('.bp-sheet').getByRole('option').nth(1).innerText()).includes(`${hh(at + 60)}–${hh(at + 100)}`) && /40 m focused/.test(await p.locator('.bp-sheet').getByRole('option').nth(3).innerText()));
  check('past blocks are muted', await p.locator('.bp-option.is-past').count() === 1 && await p.locator('.bp-option.is-past').evaluate((e) => getComputedStyle(e).color) !== await p.locator('.bp-option').first().evaluate((e) => getComputedStyle(e).color));
  check('the chosen block is marked selected and active', await p.locator('.bp-sheet').getByRole('option').first().getAttribute('aria-selected') === 'true' && await combo.getAttribute('aria-activedescendant') === await p.locator('.bp-sheet').getByRole('option').first().getAttribute('id'));
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  check('the arrow keys move the active option', await combo.getAttribute('aria-activedescendant') === await p.locator('.bp-sheet').getByRole('option').nth(2).getAttribute('id'));
  await p.keyboard.press('Enter');
  await p.locator('.bp-sheet').waitFor({ state: 'detached' });
  check('Enter chooses it: the chip changes and keyboard focus returns to it', /Gamma later/.test(await chip.innerText()) && await p.evaluate(() => document.activeElement?.classList.contains('bp-chip')));
  await chip.click();
  await p.keyboard.type('beta');
  check('typing filters by name', JSON.stringify(await names()) === JSON.stringify(['Beta later', 'Unplanned focus']));
  await p.keyboard.press('Escape');
  check('Esc closes it without changing the choice', await p.locator('.bp-sheet').count() === 0 && /Gamma later/.test(await chip.innerText()) && await p.evaluate(() => document.activeElement?.classList.contains('bp-chip')));
  await chip.click();
  await p.keyboard.type('zzz');
  check('no match says so and keeps the unplanned focus', await p.locator('.bp-none').isVisible() && await p.locator('.bp-sheet').getByRole('option').count() === 1);
  await p.keyboard.press('Enter');
  check('unplanned focus chooses no block', /Unplanned focus/.test(await chip.innerText()) && await chip.locator('.bp-time').count() === 0);
  await chip.press('ArrowDown');
  await p.locator('.bp-sheet').waitFor();
  await p.locator('.bp-sheet').getByRole('option', { name: /Beta later/ }).click();
  check('a click chooses too', /Beta later/.test(await chip.innerText()) && await chip.locator('.bp-kind:not(.deep)').count() === 1);
  await btn('Start focus').click();
  const started = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'focus' ? x : null; });
  check('the timer starts on the chosen block', started && started.focus.active.blockId === 'pb' && started.focus.active.label === 'Beta later');
  check('while it runs the chip only shows the block (locked)', await p.locator('button.bp-chip').count() === 0 && await p.locator('.bp-chip.is-locked').getAttribute('aria-disabled') === 'true' && /Beta later/.test(await p.locator('.bp-chip').innerText()));
  await p.setViewportSize({ width: 390, height: 844 });
  await setActive(null, []);
  await p.reload();
  await p.locator('.bp-chip').click();
  const fits = await p.evaluate(() => { const a = document.querySelector('.bp-sheet').getBoundingClientRect(), b = document.querySelector('.focus-panel').getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth; });
  check('on a phone the list stays inside the card with no sideways scroll', fits);
  await p.keyboard.press('Escape');
  await p.setViewportSize({ width: 1440, height: 900 });

  console.log(`\n${passed} passed, 0 failed`);
} catch (e) {
  console.error('FAIL ' + e.message);
  process.exitCode = 1;
} finally {
  await b.close();
  s.stop();
}
