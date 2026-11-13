import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const stage = process.env.CARD_STAGE ?? 'after';
const out = 'reports/shots/focus-card';
mkdirSync(out, { recursive: true });
const s = await startServer();
const b = await launch();
const measures = [];
try {
  for (const lang of ['tr', 'en']) {
    const api = await demoAccount(client(s.url), { lang });
    const c = await b.newContext({ reducedMotion: 'reduce' });
    await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    const p = await c.newPage();
    for (const state of ['idle', 'running', 'paused', 'short', 'long', 'note']) {
      const key = 'day:' + iso(new Date());
      const d = (await api.get(key)).value;
      const phase = ['short', 'long', 'note'].includes(state) ? (state === 'long' ? 'long' : 'short') : 'focus';
      const min = phase === 'focus' ? 25 : phase === 'long' ? 15 : 5;
      d.focus = { ...d.focus, sessions: state === 'note' ? [{ id: 'shot-session', blockId: null, label: '', minutes: 25, start: new Date(Date.now()-1500000).toISOString(), end: new Date().toISOString() }] : [], active: state === 'idle' ? null : { blockId: null, sessionId: state === 'note' ? 'shot-session' : undefined, label: '', phase, plannedMin: min, startedAt: new Date().toISOString(), endsAt: new Date(Date.now()+min*60000).toISOString(), pausedLeft: state === 'paused' ? min*60 : null } };
      await api.put(key, d);
      await p.goto(s.url + '/focus');
      await p.locator('.focus-stage').waitFor(); await p.evaluate(() => document.fonts.ready);
      for (const width of [1440, 1024, 390, 360]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 900 });
        await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await p.waitForTimeout(350);
        await p.screenshot({ path: `${out}/${stage}-${lang}-${state}-${width}-${theme}.png`, fullPage: true });
        const m = await p.locator('.focus-panel').evaluate(el => ({ height: el.getBoundingClientRect().height, overflow: el.scrollWidth > el.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth }));
        measures.push({ lang, state, width, theme, ...m });
        if (m.overflow || m.pageOverflow) throw Error('overflow ' + JSON.stringify(measures.at(-1)));
      }
    }
    await p.getByRole('button', { name: lang === 'en' ? 'Focus room' : 'Odak odası', exact: true }).click();
    await p.locator('.focus-room').waitFor();
    for (const width of [1440, 1024, 390, 360]) for (const theme of ['light', 'dark']) {
      await p.setViewportSize({ width, height: 900 });
      await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await p.waitForTimeout(350);
      await p.screenshot({ path: `${out}/${stage}-${lang}-room-${width}-${theme}.png` });
    }
    await c.close();
  }
  console.log(`PASS ${measures.length} screenshots, no overflow`);
} finally {
  writeFileSync(`${out}/${stage}-measurements.json`, JSON.stringify(measures, null, 2));
  await b.close(); s.stop();
}
