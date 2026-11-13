import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const out = 'reports/shots/widget-today', stage = process.env.WIDGET_STAGE || 'after';
mkdirSync(out, { recursive: true });
const s = await startServer(), b = await launch(), measures = [];
try {
  for (const lang of ['tr', 'en']) {
    const api = await demoAccount(client(s.url), { lang });
    const c = await b.newContext({ reducedMotion: 'reduce' });
    await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    const p = await c.newPage(), key = 'day:' + iso(new Date());
    const settings = (await api.get('settings')).value;
    for (const state of ['zero', 'partial', 'complete', 'running', 'empty', 'captured', 'inbox-off']) {
      const d = (await api.get(key)).value, n = new Date(), now = n.getHours() * 60 + n.getMinutes();
      d.metrics.deep = state === 'zero' ? 0 : state === 'complete' ? 3 : 1;
      d.columns.at(-1).blocks = state === 'empty' ? [] : [{ id: 'next', label: lang === 'tr' ? 'Bölüm taslağı' : 'Chapter draft', start: now + 30, end: now + 90, kind: 'deep' }];
      if (state === 'running') d.columns.at(-1).blocks.unshift({ id: 'current', label: 'Research', start: now - 10, end: now + 20, kind: 'deep' });
      await api.put(key, d);
      await api.put('settings', { ...settings, features: { ...settings.features, inbox: state !== 'inbox-off' } });
      await p.goto(s.url + '/focus'); await p.locator('.focus-widgets').waitFor(); await p.evaluate(() => document.fonts.ready);
      if (state === 'captured') {
        await p.locator('#fw-capture').fill(lang === 'tr' ? 'Yarın için bir fikir' : 'An idea for tomorrow');
        await p.locator('#fw-capture').press('Enter'); await p.waitForTimeout(500);
        if (stage === 'after') {
          await p.locator('.fw-next').focus(); await p.keyboard.press('Tab');
          const visible = await p.locator('#fw-capture').evaluate(el => el === document.activeElement && el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none');
          if (!visible) throw Error('Keyboard focus is not visible');
        }
      }
      for (const width of [1440, 1024, 390]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 });
        await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await p.locator('.focus-widgets').evaluate(el => el.scrollIntoView({ block: 'center' }));
        await p.screenshot({ path: `${out}/${stage}-${lang}-${state}-${width}-${theme}.png`, fullPage: true });
        await p.locator('.focus-widgets').screenshot({ path: `${out}/${stage}-${lang}-${state}-${width}-${theme}-widget.png` });
        const m = await p.locator('.focus-widgets').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth }));
        measures.push({ lang, state, width, theme, ...m });
        if (m.overflow || m.pageOverflow) throw Error(JSON.stringify(measures.at(-1)));
      }
    }
    await c.close();
  }
  console.log(`PASS ${measures.length} screenshots; no overflow`);
} finally { writeFileSync(`${out}/${stage}-measurements.json`, JSON.stringify(measures, null, 2)); await b.close(); s.stop(); }
