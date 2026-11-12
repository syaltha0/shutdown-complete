// The Focus screen: length and break choice, start/pause, +5 min, finishing with a note, skipping the break, the room.
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
const ring = () => p.locator('.focus-read b').innerText();

try {
  await p.goto(s.url + '/focus');
  await p.locator('.focus-setup').waitFor();
  check('the default length shows on the ring', (await ring()) === '25:00');

  // a preset, then a custom length (5 to 120), then a break
  await p.getByRole('button', { name: '45 min', exact: true }).first().click();
  check('a preset length sets the ring', (await ring()) === '45:00');
  await p.locator('#fc-len-l + .segmented').getByRole('button', { name: 'Custom', exact: true }).click();
  await p.getByLabel('Custom length in minutes').fill('500');
  await p.getByLabel('Custom length in minutes').blur();
  check('a custom length is kept within 120 minutes', (await ring()) === '120:00');
  await p.getByLabel('Custom length in minutes').fill('3');
  await p.getByLabel('Custom length in minutes').blur();
  check('and at least 5', (await ring()) === '05:00');
  await p.getByLabel('Custom length in minutes').fill('40');
  await p.getByLabel('Custom length in minutes').blur();
  check('a custom length of 40 shows', (await ring()) === '40:00');
  await p.locator('#fc-brk-l + .segmented').getByRole('button', { name: '10 min', exact: true }).click();

  await p.getByRole('button', { name: 'Start focus', exact: true }).click();
  const a1 = await until(async () => (await doc()).focus?.active);
  check('start writes the length and break', a1 && a1.plannedMin === 40 && a1.breakMin === 10);
  check('the setup gives way to the controls', await p.locator('.focus-setup').count() === 0 && await p.getByRole('button', { name: 'Pause', exact: true }).isVisible());

  await p.getByRole('button', { name: 'Pause', exact: true }).click();
  check('pause keeps the time left', !!(await until(async () => (await doc()).focus?.active?.pausedLeft != null)));
  await p.getByRole('button', { name: '+5 min', exact: true }).click();
  const a2 = await until(async () => { const a = (await doc()).focus?.active; return a?.plannedMin === 45 ? a : null; });
  check('+5 min extends a paused timer', a2 && a2.pausedLeft > a1.plannedMin * 60 - 30);
  await p.getByRole('button', { name: 'Resume', exact: true }).click();
  check('resume carries on', !!(await until(async () => (await doc()).focus?.active?.pausedLeft === null)));
  await p.getByRole('button', { name: '+5 min', exact: true }).click();
  check('+5 min extends a running timer', !!(await until(async () => (await doc()).focus?.active?.plannedMin === 50)));

  // ten minutes in: finish now logs the session and starts the break the person chose
  const d = await doc();
  d.focus.active.startedAt = new Date(Date.now() - 10 * 60000).toISOString();
  await api.put('day:' + D, d);
  await p.reload();
  await p.getByRole('button', { name: 'Finish now', exact: true }).click();
  const a3 = await until(async () => { const x = await doc(); return x.focus?.active?.phase === 'short' ? x : null; });
  check('finishing logs a session', a3 && a3.focus.sessions.length === 1 && a3.focus.sessions[0].minutes >= 9);
  check('the break has the chosen length', a3.focus.active.plannedMin === 10 && a3.focus.active.sessionId === a3.focus.sessions[0].id);

  const note = p.getByLabel('A note on the session');
  await note.fill('Got through the outline; the data table is next.');
  await note.press('Enter');
  const a4 = await until(async () => (await doc()).focus.sessions[0].note);
  check('the note is saved on the session', a4 === 'Got through the outline; the data table is next.');
  await p.locator('.session .more').waitFor();
  const shown = await p.locator('.session .more').innerText();
  check("Today's sessions shows the note", shown.includes('data table'));

  await p.getByRole('button', { name: 'Skip the break', exact: true }).click();
  check('skipping the break ends it', !!(await until(async () => (await doc()).focus.active === null)));
  check('the setup returns', await p.locator('.focus-setup').isVisible());

  // a long list of sessions scrolls inside its card (newest first, the total stays), and the two columns stay level
  const dd = await doc();
  const now0 = Date.now();
  dd.focus = { active: null, sessions: Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, blockId: null, label: 'Session ' + (i + 1), kind: null, start: new Date(now0 - (10 - i) * 3600e3).toISOString(), end: new Date(now0 - (10 - i) * 3600e3 + 25 * 60000).toISOString(), minutes: 25 })) };
  await api.put('day:' + D, dd);
  const settings0 = (await api.get('settings')).value;
  for (const friends of [true, false]) {
    await api.put('settings', { ...settings0, features: { ...(settings0.features ?? {}), friends } });
    for (const w of [1440, 390, 360]) {
      await p.setViewportSize({ width: w, height: 900 });
      await p.goto(s.url + '/focus');
      await p.locator('.session-scroll').waitFor();
      const m = await p.evaluate(() => {
        const sc = document.querySelector('.session-scroll'), tot = document.querySelector('.session.total'), panel = document.querySelector('.focus-panel'), stack = document.querySelector('.focus-grid > .stack');
        const five = [...sc.children].slice(0, 5).reduce((n, r) => n + r.offsetHeight, 0);
        return { over: sc.scrollHeight > sc.clientHeight, h: sc.clientHeight, five, first: sc.querySelector('.l').textContent, tot: tot.getBoundingClientRect().bottom <= sc.parentElement.getBoundingClientRect().bottom + 1 && tot.getBoundingClientRect().top >= sc.getBoundingClientRect().bottom - 1,
          pb: panel.getBoundingClientRect().bottom, sb: stack.lastElementChild.getBoundingClientRect().bottom, side: panel.getBoundingClientRect().right <= stack.getBoundingClientRect().left + 1, hasFr: !!document.querySelector('.friends'), x: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
      });
      const tag = `friends ${friends ? 'on' : 'off'}, ${w}px`;
      check(`sessions scroll inside the card, newest first, total below (${tag})`, m.over && m.h >= m.five - 1 && (w > 1000 || m.h <= m.five + 1) && m.first === 'Session 9' && m.tot);
      check(`friends card follows the setting, no sideways scroll (${tag})`, m.hasFr === friends && m.x);
      if (w === 1440) check(`the timer card is as tall as the right column (${tag})`, m.side && Math.abs(m.pb - m.sb) <= 1);
    }
  }
  await api.put('settings', settings0);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(s.url + '/focus');

  // no horizontal overflow at 360px, and the room opens and closes with Esc
  await p.setViewportSize({ width: 360, height: 800 });
  check('no sideways scroll at 360px', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.getByRole('button', { name: 'Focus room', exact: true }).click();
  await p.locator('.focus-room').waitFor();
  check('the focus room opens', true);
  check('keyboard focus moves into the room', await p.evaluate(() => document.querySelector('.focus-room').contains(document.activeElement)));
  for (let i = 0; i < 25; i++) await p.keyboard.press('Tab');
  check('and Tab stays inside it', await p.evaluate(() => document.querySelector('.focus-room').contains(document.activeElement)));
  await p.keyboard.press('Escape');
  await p.locator('.focus-room').waitFor({ state: 'hidden' });
  check('Esc closes the room', true);
  check('focus goes back to the Focus room button', await p.evaluate(() => document.activeElement?.textContent === 'Focus room'));

  // ---------- the timer's state, against edge cases ----------
  const setActive = async (key, active, sessions) => { const x = (await api.get(key)).value ?? {}; await api.put(key, { ...x, focus: { active, sessions: sessions ?? x.focus?.sessions ?? [] } }); };
  const run = (min, ago, extra = {}) => ({ phase: 'focus', startedAt: new Date(Date.now() - ago * 60000).toISOString(), plannedMin: min, pausedLeft: null, blockId: null, label: 'Edge', ...extra });
  const btn = (name) => p.getByRole('button', { name, exact: true });

  // a session begun before midnight carries on (it lives in yesterday's document) and is logged there
  const Y = iso(new Date(Date.now() - 864e5));
  await setActive('day:' + D, null, []);
  await setActive('day:' + Y, run(25, 10), []);
  await p.goto(s.url + '/focus');
  await btn('Pause').waitFor({ timeout: 4000 });
  check("a session begun before midnight still shows after it", (await p.locator('.focus-read .focus-label').innerText()) === 'Edge');
  await btn('Finish now').click();
  const yd = await until(async () => { const v = (await api.get('day:' + Y)).value; return v.focus.active?.phase === 'short' ? v : null; });
  check("it is logged on the day it began, and its break follows", yd && yd.focus.sessions.length === 1 && (await doc()).focus.sessions.length === 0);
  await btn('Skip the break').click();
  check('the carried break ends too', !!(await until(async () => (await api.get('day:' + Y)).value.focus.active === null)));

  // a tab that slept through the end logs the session at its planned end, not when it woke
  const slept = run(25, 120);
  await setActive('day:' + D, slept, []);
  await p.goto(s.url + '/focus');
  const sd = await until(async () => { const v = await doc(); return v.focus.sessions.length === 1 ? v : null; });
  check('a session that ran out while asleep ends at its planned time', sd && Math.abs(Date.parse(sd.focus.sessions[0].end) - (Date.parse(slept.startedAt) + 25 * 60000)) < 1500 && sd.focus.sessions[0].minutes === 25);
  check('and its break, long over too, is not left running', !!(await until(async () => (await doc()).focus.active === null)));

  // a start written by a device whose clock runs ahead never shows more than the phase holds
  await setActive('day:' + D, run(25, -10), []);
  await p.goto(s.url + '/focus');
  await btn('Pause').waitFor();
  check('a clock ahead shows at most the whole phase', (await ring()) === '25:00');

  // +5 min stops at four hours
  await setActive('day:' + D, run(238, 1), []);
  await p.goto(s.url + '/focus');
  await btn('+5 min').click();
  check('+5 min stops at 240 minutes', !!(await until(async () => (await doc()).focus.active?.plannedMin === 240)));
  check('and the button then rests', await btn('+5 min').isDisabled());

  // a double click on Finish now logs once and keeps the break it started
  await setActive('day:' + D, run(25, 12), []);
  await p.goto(s.url + '/focus');
  await btn('Finish now').waitFor();
  await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.textContent === 'Finish now'); x.click(); x.click(); });
  await p.waitForTimeout(1500);
  const dc = await doc();
  check('a double click on Finish now does not skip the break', dc.focus.sessions.length === 1 && dc.focus.active?.phase === 'short');

  // a note typed during the break is kept when the break is skipped straight away
  await p.getByLabel('A note on the session').fill('Kept without leaving the field');
  await p.evaluate(() => [...document.querySelectorAll('button')].find((e) => e.textContent === 'Skip the break').click());
  check('a note survives the break ending', (await until(async () => (await doc()).focus.sessions[0].note)) === 'Kept without leaving the field');

  // another device pauses it: this one sees it on coming back to the tab
  await setActive('day:' + D, run(25, 3), []);
  await p.goto(s.url + '/focus');
  await btn('Pause').waitFor();
  const other = await doc();
  other.focus.active.pausedLeft = 600;
  await api.put('day:' + D, other);
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  check("another device's pause shows when the tab is looked at again", await btn('Resume').waitFor({ timeout: 4000 }).then(() => true, () => false));
  check('with its time left', (await ring()) === '10:00');
  check('the state is spoken to screen readers', (await p.locator('.focus-stage [role="status"]').innerText()) === 'Focus · paused');

  // Stop after a few minutes asks first; the second press discards
  await btn('Stop').click();
  check('Stop asks before throwing minutes away', await p.getByRole('button', { name: /^Discard \d+ min\?$/ }).isVisible() && !!(await doc()).focus.active);
  await p.getByRole('button', { name: /^Discard \d+ min\?$/ }).click();
  check('and the second press discards', !!(await until(async () => (await doc()).focus.active === null)));

  // the setup has no task or intent fields (user: not needed); start, then on a break the filled button is the way back to work
  check('no task or intent field in the setup', await p.locator('#fc-task, #fc-intent').count() === 0);
  await p.getByRole('button', { name: 'Start focus', exact: true }).click();
  check('Start focus starts it', !!(await until(async () => (await doc()).focus.active?.phase === 'focus')));
  await btn('Finish now').waitFor();
  await setActive('day:' + D, run(25, 3, { phase: 'short', plannedMin: 5 }), []);
  await p.reload();
  check('on a break, Skip the break is the primary button', await p.locator('.focus-controls .btn.primary').innerText() === 'Skip the break');
  await setActive('day:' + D, null, []);

  // ---------- focusing together: what the server accepts ----------
  const ece = client(s.url);
  const form = (await ece.call('/api/auth/state')).body.form;
  await new Promise((r) => setTimeout(r, 3100));
  await ece.call('/api/auth/register', { email: 'ece@hale.test', password: 'Kalem defter mavi!', lang: 'en', form, website: '' });
  await ece.call('/api/friends/share', { focus: true, label: true }, 'PUT');
  check('an address longer than any e-mail is refused', (await ece.call('/api/friends', { email: 'a'.repeat(300) + '@hale.test' })).status === 400);
  await ece.call('/api/friends', { email: 'robin@hale.test' });
  const eceId = (await api.call('/api/friends')).body.incoming[0]?.id;
  await api.call(`/api/friends/${eceId}/accept`, {});
  await ece.call('/api/presence', { state: 'focus', label: 'Phy\u0000sics\nnow', endsAt: '3000-01-01T00:00:00Z' }, 'PUT');
  const seen = (await api.call('/api/friends')).body.friends.find((f) => f.id === eceId)?.status;
  check('a friend sees no control characters in a shared label', seen && !/[\u0000-\u001f]/.test(seen.label) && seen.label.startsWith('Phy'));
  check('an end far in the future is held to a few hours', seen && Date.parse(seen.endsAt) <= Date.now() + 6 * 3600e3 + 5000);
  const room = (await api.call('/api/rooms', { minutes: 25, invite: [eceId, eceId, { x: 1 }, 7] })).body;
  check('an invitation list with repeats and junk still makes one room', !!room?.id);
  await api.call(`/api/friends/${eceId}`, null, 'DELETE');
  check('after unfriending, the invitation is gone', (await ece.call('/api/friends')).body.invites.length === 0);
  check('and the room cannot be joined', (await ece.call(`/api/rooms/${room.id}/join`, {})).status === 404);
  let limitedAt = 0;
  for (let i = 0; i < 620 && !limitedAt; i++) if ((await ece.call('/api/presence', { state: 'paused', label: '' }, 'PUT')).status === 429) limitedAt = i + 1;
  check('presence updates are rate limited', limitedAt > 500 && limitedAt <= 601);

  console.log(`${passed} passed, 0 failed`);
} finally { await b.close(); s.stop(); }
