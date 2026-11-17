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
const setActive = async (active, sessions, more = {}) => { const x = (await api.get('day:' + D)).value ?? {}; await api.put('day:' + D, { ...x, focus: { ...(x.focus ?? {}), active, sessions: sessions ?? x.focus?.sessions ?? [], ...(sessions ? { skippedRounds: 0 } : {}), ...more } }); };
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
  // a round skipped within its first minute is called off: no session, no round moved on, no break (user, 2026-11-17)
  const quick = await until(async () => { const x = await doc(); return x.focus.active == null ? x : null; });
  check('skipping within the first minute asks nothing and counts nothing', quick && quick.focus.sessions.length === 0 && await p.locator('.skip-choice').count() === 0);
  check('and does not move the round on or start a break', !(quick.focus.skippedRounds > 0) && quick.focus.active == null);

  await setActive(run(25, 10), []);
  await open();
  await btn('Skip').click();
  await p.locator('.skip-choice').waitFor();
  const text = await p.locator('.skip-choice').innerText();
  check('after a minute, skipping asks what to count, with both durations', /Skip this focus\?/.test(text) && /so far \(10 min\)/.test(text) && /whole session \(25 min\)/.test(text) && /Keep going/.test(text));
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
  // blocks around the real time: "now" must contain the clock and the later ones must fit before midnight, so late in
  // the evening the spacing tightens (k scales the offsets; at 23:10 the last block still ends before 24:00)
  const at = Math.max(200, nowMin), k = Math.min(1, (1439 - at) / 180);
  const mk = (id, label, kind, start, end) => ({ id, label, kind, start, end, note: '' });
  const planDay = async (blocks, sessions = []) => {
    const x = (await api.get('day:' + D)).value;
    const cols = structuredClone(x.columns); cols[0].blocks = blocks;
    await api.put('day:' + D, { ...x, columns: cols, focus: { active: null, sessions } });
  };
  const plan = [mk('pa', 'Alpha now', 'deep', at - 20, at + Math.round(40 * k)), mk('pb', 'Beta later', 'shallow', at + Math.round(60 * k), at + Math.round(100 * k)), mk('pc', 'Gamma later', 'deep', at + Math.round(120 * k), at + Math.round(180 * k)), mk('pd', 'Delta past', 'deep', at - 200, at - 140)];
  await planDay(plan, [session(1, 40, { blockId: 'pd', label: 'Delta past' })]);
  await open();
  const chip = p.locator('.bp-chip');
  const chipText = await chip.innerText();
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  check('starting straight away is unplanned: the chip offers to link a block and names the one running now', /Link to a block/.test(chipText) && /now: Alpha now/.test(chipText) && await chip.locator('.bp-time.num').count() === 0);
  check('the old Now / Change row and the hidden select are gone', await p.locator('.focus-block-row, #fc-block').count() === 0 && await p.locator('#fc-task, #fc-intent').count() === 0);
  const h0 = await p.locator('.focus-panel').evaluate((e) => e.getBoundingClientRect().height);
  await chip.click();
  await p.locator('.bp-sheet').waitFor();
  check('pressing the chip opens a list over the card, and the card does not change height', Math.abs(h0 - await p.locator('.focus-panel').evaluate((e) => e.getBoundingClientRect().height)) < 1);
  const combo = p.locator('.bp-sheet').getByRole('combobox');
  check('the search field is a combobox with focus', await combo.count() === 1 && await p.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'));
  const names = () => p.locator('.bp-sheet').getByRole('option').evaluateAll((els) => els.map((e) => e.querySelector('.bp-name').textContent));
  check('the list: unplanned focus, then the running block, the ones to come and those past', JSON.stringify(await names()) === JSON.stringify(['Unplanned focus', 'Alpha now', 'Beta later', 'Gamma later', 'Delta past']));
  check('with headings for now, up next and earlier', JSON.stringify(await p.locator('.bp-heading').allInnerTexts()) === JSON.stringify(['Now', 'Up next', 'Earlier']));
  check('each shows its hours; the minutes already focused show too', (await p.locator('.bp-sheet').getByRole('option').nth(2).innerText()).includes(`${hh(at + Math.round(60 * k))}–${hh(at + Math.round(100 * k))}`) && /40 m focused/.test(await p.locator('.bp-sheet').getByRole('option').nth(4).innerText()));
  check('past blocks are muted', await p.locator('.bp-option.is-past').count() === 1 && await p.locator('.bp-option.is-past').evaluate((e) => getComputedStyle(e).color) !== await p.locator('.bp-option').first().evaluate((e) => getComputedStyle(e).color));
  check('unplanned focus, the current choice, is marked selected and active', await p.locator('.bp-sheet').getByRole('option').first().getAttribute('aria-selected') === 'true' && await combo.getAttribute('aria-activedescendant') === await p.locator('.bp-sheet').getByRole('option').first().getAttribute('id'));
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  check('the arrow keys move the active option', await combo.getAttribute('aria-activedescendant') === await p.locator('.bp-sheet').getByRole('option').nth(3).getAttribute('id'));
  await p.keyboard.press('Enter');
  await p.locator('.bp-sheet').waitFor({ state: 'detached' });
  check('a chosen block shows on the chip with its hours and its kind', chipText !== await chip.innerText() && (await chip.innerText()).includes(`${hh(at + Math.round(120 * k))}–${hh(at + Math.round(180 * k))}`) && await chip.locator('.bp-kind.deep').count() === 1);
  check('Enter chooses it: the chip changes and keyboard focus returns to it', /Gamma later/.test(await chip.innerText()) && await p.evaluate(() => document.activeElement?.classList.contains('bp-chip')));
  await chip.click();
  await p.keyboard.type('beta');
  check('typing filters by name', JSON.stringify(await names()) === JSON.stringify(['Unplanned focus', 'Beta later']));
  await p.keyboard.press('Escape');
  check('Esc closes it without changing the choice', await p.locator('.bp-sheet').count() === 0 && /Gamma later/.test(await chip.innerText()) && await p.evaluate(() => document.activeElement?.classList.contains('bp-chip')));
  await chip.click();
  await p.keyboard.type('zzz');
  check('no match says so and keeps the unplanned focus', await p.locator('.bp-none').isVisible() && await p.locator('.bp-sheet').getByRole('option').count() === 1);
  await p.keyboard.press('Enter');
  check('unplanned focus chooses no block', /Link to a block/.test(await chip.innerText()) && await chip.locator('.bp-time.num').count() === 0);
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

  // ---------- 2b. an unplanned session tied to a block afterwards ----------
  await planDay(plan, [session(1, 30, { blockId: null, label: 'Unplanned focus', kind: null })]);
  const m0 = (await doc()).metrics?.deep ?? 0;
  await open();
  await p.locator('.session-link').first().click();
  await p.locator('.focus-sessions .bp-sheet').waitFor();
  await p.locator('.focus-sessions .bp-sheet').getByRole('option', { name: /Alpha now/ }).click();
  const linked = await until(async () => { const x = await doc(); return x.focus.sessions[0]?.blockId === 'pa' ? x : null; });
  check('an unplanned session can be linked to a block later: its name and kind follow the block', linked && linked.focus.sessions[0].label === 'Alpha now' && linked.focus.sessions[0].kind === 'deep');
  check('linking it to a deep block adds its minutes to the deep focus metric', linked && Math.abs((linked.metrics?.deep ?? 0) - m0 - 0.5) < 0.01);
  check('a linked session no longer offers the link', await p.locator('.session-link').count() === 0);

  // ---------- 3. the running controls ----------
  await planDay([]);
  await setActive(run(25, 8), []);
  await open();
  const names3 = await p.locator('.focus-controls .btn, .focus-secondary .btn').allInnerTexts();
  check('the tab order is Pause, Reset, +5, Skip, Stop', JSON.stringify(names3) === JSON.stringify(['Pause', 'Reset', '+5 min', 'Skip', 'Stop']));
  const styleOf = (loc) => loc.evaluate((e) => { const c = getComputedStyle(e); return { r: c.borderTopLeftRadius + '/' + c.borderTopRightRadius + '/' + c.borderBottomRightRadius + '/' + c.borderBottomLeftRadius, h: Math.round(e.getBoundingClientRect().height), fs: c.fontSize, fw: c.fontWeight }; });
  const all = p.locator('.focus-controls .btn, .focus-secondary .btn');
  const shapes = [];
  for (let i = 0; i < 5; i++) shapes.push(await styleOf(all.nth(i)));
  check('every control has the same corner radius (Stop is no longer square)', new Set(shapes.map((x) => x.r)).size === 1 && !/^0px/.test(shapes[4].r) && shapes[4].r.startsWith('999px') || shapes[4].r.startsWith('3.35544e+07px'));
  check('the quiet row has one size and weight', new Set(shapes.slice(1).map((x) => `${x.h}/${x.fs}/${x.fw}`)).size === 1);
  // the same focus ring and shape when reached by the keyboard
  const rings = [];
  await p.locator('h1').click();
  for (let i = 0; i < 24 && rings.length < 5; i++) {
    await p.keyboard.press('Tab');
    const r = await p.evaluate(() => { const e = document.activeElement; if (!e?.closest('.focus-controls, .focus-secondary')) return null; const c = getComputedStyle(e); return { t: e.textContent, ring: `${c.outlineStyle}/${c.outlineWidth}/${c.outlineColor}/${c.outlineOffset}`, r: `${c.borderTopLeftRadius}/${c.borderBottomRightRadius}` }; });
    if (r) rings.push(r);
  }
  check('the keyboard reaches them in that order', JSON.stringify(rings.map((x) => x.t)) === JSON.stringify(names3));
  check('and each shows the same focus ring and shape', new Set(rings.map((x) => x.ring)).size === 1 && !/^none/.test(rings[0].ring) && new Set(rings.map((x) => x.r)).size === 1 && rings[0].r === `${shapes[0].r.split('/')[0]}/${shapes[0].r.split('/')[0]}`);
  // the same hover
  const hovers = [];
  for (const name of ['Reset', '+5 min', 'Skip', 'Stop']) { await btn(name).hover(); await p.waitForTimeout(300); hovers.push(await btn(name).evaluate((e) => getComputedStyle(e).backgroundColor)); }
  check('the quiet buttons share one hover', new Set(hovers).size === 1 && hovers[0] !== 'rgba(0, 0, 0, 0)');
  // the second press for Reset and Stop turns danger
  const calm = await btn('Stop').evaluate((e) => getComputedStyle(e).color);
  await btn('Stop').click();
  const asked = await p.locator('.focus-stop.danger').count() === 1 && /Discard 8 min/.test(await p.locator('.focus-stop').innerText());
  check('asking to discard turns Stop to the danger tone (a second press is needed)', asked && await btn('Discard 8 min?').evaluate((e) => getComputedStyle(e).color) !== calm && (await doc()).focus.active?.phase === 'focus');
  check('Stop keeps the same shape while it asks', (await styleOf(p.locator('.focus-stop'))).r === shapes[0].r);
  await btn('Reset').click();
  check('Reset asks the same way', await p.locator('.focus-secondary .danger').count() === 1 && await p.locator('.focus-stop.danger').count() === 0);
  await p.waitForTimeout(4300);
  check('and the question times out', await p.locator('.focus-secondary .danger').count() === 0);
  // mini timer and room use the same shape
  const cardRadius = shapes[0].r;
  await open('/');
  await p.locator('.mini-timer').hover();
  const mini = [];
  for (const n of ['+5 min', 'Skip']) mini.push((await styleOf(p.locator('.mini-timer').getByRole('button', { name: n, exact: true }))).r);
  mini.push((await styleOf(p.locator('.mini-timer .mt-pause'))).r);
  check('the mini timer buttons match the card', mini.every((r) => r === cardRadius));
  await open('/focus');
  await btn('Focus room').click();
  await p.locator('.focus-room').waitFor();
  const room = [];
  for (const n of ['Pause', '+5 min', 'Skip', 'Stop']) room.push((await styleOf(p.locator('.focus-room').getByRole('button', { name: n, exact: true }))).r);
  check('and so do the focus room buttons', room.every((r) => r === cardRadius));
  await p.keyboard.press('Escape');
  // disabled looks the same in strict mode and in a shared room
  await api.put('settings', { ...settings0, focus: { ...settings0.focus, strict: true } });
  await open();
  const dis = [];
  for (const n of ['Pause', 'Reset', 'Skip', 'Stop']) dis.push(await btn(n).evaluate((e) => ({ d: e.disabled, o: getComputedStyle(e).opacity, c: getComputedStyle(e).cursor })));
  check('strict mode disables Pause, Reset, Skip and Stop in one look; +5 stays', dis.every((x) => x.d && x.o === dis[0].o && x.c === 'not-allowed') && await btn('+5 min').isEnabled());
  await btn('Reset').hover(); await p.waitForTimeout(300);
  check('a disabled control shows no hover', await btn('Reset').evaluate((e) => getComputedStyle(e).backgroundColor) === 'rgba(0, 0, 0, 0)');
  await api.put('settings', settings0);
  await setActive(run(25, 8, { roomId: 'room-x' }), []);
  await open();
  check('a shared room disables only Reset, in the same look', await btn('Reset').isDisabled() && await btn('Skip').isEnabled() && await btn('Stop').isEnabled() && (await btn('Reset').evaluate((e) => getComputedStyle(e).opacity)) === dis[0].o);
  await setActive(null, []);
  let trApi;
  // a phone: one row, 44 px targets, also while a button asks
  for (const [lang, pw] of [['en', 390], ['tr', 390], ['en', 360], ['tr', 360]]) {
    const phoneApi = lang === 'en' ? api : (trApi ??= await demoAccount(client(s.url), { lang: 'tr', email: 'deniz@kuzey.test' }));
    const phoneCtx = await b.newContext({ viewport: { width: pw, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    await phoneCtx.addCookies([{ name: 'sc_session', value: phoneApi.cookie.split('=')[1], url: s.url }]);
    const q = await phoneCtx.newPage();
    const pk = 'day:' + D, pd = (await phoneApi.get(pk)).value;
    await phoneApi.put(pk, { ...pd, focus: { sessions: [], active: run(25, 8) } });
    await q.goto(s.url + '/focus');
    await q.locator('.focus-secondary').waitFor();
    const row = () => q.evaluate(() => { const bs = [...document.querySelectorAll('.focus-secondary .btn')].map((e) => e.getBoundingClientRect()); const box = document.querySelector('.focus-secondary').getBoundingClientRect(); return { oneRow: new Set(bs.map((r) => Math.round(r.top))).size === 1, min: Math.min(...bs.map((r) => r.height)), inside: bs.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1), page: document.documentElement.scrollWidth <= document.documentElement.clientWidth }; });
    let m = await row();
    check(`phone ${pw} (${lang}): the controls sit on one row, 44 px tall, inside the card`, m.oneRow && m.min >= 44 && m.inside && m.page);
    await q.locator('.focus-stop').tap();
    await q.waitForTimeout(200);
    m = await row();
    check(`phone ${pw} (${lang}): still one row while Stop asks`, m.oneRow && m.inside && m.page && await q.locator('.focus-stop.danger').count() === 1);
    await q.locator('.focus-secondary .btn').first().tap();
    await q.waitForTimeout(200);
    m = await row();
    if (!(m.oneRow && m.inside && m.page)) console.log(JSON.stringify(m));
    check(`phone ${pw} (${lang}): still one row while Reset asks`, m.oneRow && m.inside && m.page);
    await phoneCtx.close();
  }
  // ---------- 4. resetting the cycle ----------
  await api.put('settings', { ...settings0, focus: { ...settings0.focus, longEvery: 2, autoFocus: false, autoBreak: true } });
  await planDay([]);
  await setActive(null, []);
  await open();
  const idleHeight0 = await p.locator('.focus-panel').evaluate((e) => e.getBoundingClientRect().height);
  check('with no session the cycle has no reset button', await p.locator('.focus-cycle-reset').count() === 0);
  await setActive(null, [session(1)], { cycleFrom: 0 });
  await open();
  const cyc = () => p.evaluate(() => ({ done: document.querySelectorAll('.focus-rounds i.done').length, cur: document.querySelectorAll('.focus-rounds i.current').length, dots: document.querySelectorAll('.focus-rounds i').length, text: document.querySelector('.focus-cycle-summary').innerText, sub: document.querySelector('.focus-title .sub').innerText }));
  let cy = await cyc();
  check('after one session and its break the card shows 1/2 and offers to reset', cy.done === 1 && cy.dots === 2 && /Session 1\/2/.test(cy.text) && /Reset cycle/.test(cy.text) && /A long break comes after this session/.test(cy.sub));
  check('the reset button does not change the card height', Math.abs(idleHeight0 - await p.locator('.focus-panel').evaluate((e) => e.getBoundingClientRect().height)) < 1);
  await btn('Reset cycle').click();
  const afterReset = await until(async () => { const x = await doc(); return x.focus.cycleFrom === 1 ? x : null; });
  check('Reset cycle writes where the cycle began and keeps the session', afterReset && afterReset.focus.sessions.length === 1 && afterReset.focus.cycleFrom === 1);
  cy = await cyc();
  check('the dots, the count and the long-break hint start over', cy.done === 0 && /Session 0\/2/.test(cy.text) && !/Reset cycle/.test(cy.text) && /A long break after 2 more sessions/.test(cy.sub) && /1 session/.test(cy.sub));
  await p.reload();
  await p.locator('.focus-cycle-summary').waitFor();
  check('and it stays so after a reload', (await cyc()).done === 0 && await p.locator('.focus-cycle-reset').count() === 0);
  // the next sessions count from the new cycle: the second logged session is round one, so its break is short; the long break comes after round two
  await setActive(run(25, 8), undefined);
  await open();
  cy = await cyc();
  check('a running focus is round 1 of the new cycle', /Session 1\/2/.test(cy.text) && cy.cur === 1 && cy.done === 0);
  await btn('Skip').click();
  await choiceBtn(/^Count the whole session/).click();
  const b1 = await until(async () => { const x = await doc(); return x.focus.active?.phase === 'short' || x.focus.active?.phase === 'long' ? x : null; });
  check('the second session of the day is round one: a short break, not a long one', b1 && b1.focus.sessions.length === 2 && b1.focus.active.phase === 'short' && b1.focus.cycleFrom === 1);
  await setActive(null, undefined);
  await setActive(run(25, 8), undefined);
  await open();
  await btn('Skip').click();
  await choiceBtn(/^Count the whole session/).click();
  const b2 = await until(async () => { const x = await doc(); return x.focus.active && x.focus.active.phase !== 'focus' ? x : null; });
  check('round two of the new cycle brings the long break', b2 && b2.focus.sessions.length === 3 && b2.focus.active.phase === 'long' && b2.focus.active.plannedMin === settings0.focus.longMin);
  cy = await cyc();
  check('and the long break shows the full cycle', cy.done === 2 && cy.cur === 0);
  // the mini timer counts from the new cycle too, and can reset it
  await api.put('settings', { ...settings0, focus: { ...settings0.focus, longEvery: 4, autoFocus: false } });
  await setActive(run(25, 8), [session(1), session(2), session(3)], { cycleFrom: 1 });
  await open('/');
  await p.locator('.mini-timer').hover();
  check('the mini timer shows round 3 of 4 (two sessions since the reset)', /Session 3\/4/.test(await p.locator('.mini-timer .mt-meta').innerText()));
  await p.locator('.mini-timer .mt-cycle').click();
  await until(async () => (await doc()).focus.cycleFrom === 3);
  await p.locator('.mini-timer').hover();
  check('Reset cycle in the mini timer starts over at round 1, and the button goes', /Session 1\/4/.test(await p.locator('.mini-timer .mt-meta').innerText()) && await p.locator('.mini-timer .mt-cycle').count() === 0);
  // a long break decided by the long-break rule after a cycle with a stale reset point (sessions removed since) never goes below zero
  await setActive(null, [session(1)], { cycleFrom: 9 });
  await open();
  check('a reset point past the sessions counts as an empty cycle', (await cyc()).done === 0);
  await api.put('settings', settings0);
  await setActive(null, []);

  console.log(`\n${passed} passed, 0 failed`);
} catch (e) {
  console.error('FAIL ' + e.message);
  process.exitCode = 1;
} finally {
  await b.close();
  s.stop();
}
