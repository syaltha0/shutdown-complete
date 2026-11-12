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
  await p.getByLabel('Intent').fill('Draft the second section');

  await p.getByRole('button', { name: 'Start focus', exact: true }).click();
  const a1 = await until(async () => (await doc()).focus?.active);
  check('start writes the length, break and intent', a1 && a1.plannedMin === 40 && a1.breakMin === 10 && a1.intent === 'Draft the second section');
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
  check('finishing logs a session with its intent', a3 && a3.focus.sessions.length === 1 && a3.focus.sessions[0].intent === 'Draft the second section' && a3.focus.sessions[0].minutes >= 9);
  check('the break has the chosen length', a3.focus.active.plannedMin === 10 && a3.focus.active.sessionId === a3.focus.sessions[0].id);

  const note = p.getByLabel('A note on the session');
  await note.fill('Got through the outline; the data table is next.');
  await note.press('Enter');
  const a4 = await until(async () => (await doc()).focus.sessions[0].note);
  check('the note is saved on the session', a4 === 'Got through the outline; the data table is next.');
  await p.locator('.session .more').waitFor();
  const shown = await p.locator('.session .more').innerText();
  check("Today's sessions shows the intent and note", shown.includes('Draft the second section') && shown.includes('data table'));

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
  await p.keyboard.press('Escape');
  await p.locator('.focus-room').waitFor({ state: 'hidden' });
  check('Esc closes the room', true);

  console.log(`${passed} passed, 0 failed`);
} finally { await b.close(); s.stop(); }
