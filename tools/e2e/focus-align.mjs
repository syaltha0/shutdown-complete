// The last card on the right lines up with the four-week chart (top and bottom), unless that would squeeze the
// sessions list below two rows; the page never scrolls on a desktop window.
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const s = await startServer(); const b = await launch();
let passed = 0;
try {
  const api = await demoAccount(client(s.url), { lang: 'tr' }); const D = iso(new Date());
  const c = await b.newContext({ viewport: { width: 1904, height: 1015 }, reducedMotion: 'reduce' });
  await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
  const p = await c.newPage(); const st0 = (await api.get('settings')).value;
  const day0 = (await api.get('day:' + D)).value;
  const blockId = day0.columns?.[0]?.blocks?.find?.(x => x.kind === 'deep')?.id ?? null;
  for (const [name, friends, n, byblock] of [['fr-on_0', true, 0, false], ['fr-off_0', false, 0, false], ['fr-on_6_block', true, 6, true], ['fr-off_6_block', false, 6, true], ['fr-off_3', false, 3, false]]) {
    await api.put('settings', { ...st0, features: { ...(st0.features ?? {}), friends } });
    const d = (await api.get('day:' + D)).value; const t = Date.now();
    d.focus = { active: null, sessions: Array.from({ length: n }, (_, i) => ({ id: 'x' + i, blockId: byblock ? blockId : null, label: byblock ? 'Bölüm taslağı' : 'Oturum ' + (i + 1), kind: byblock ? 'deep' : null, start: new Date(t - (n + 1 - i) * 3600e3).toISOString(), end: new Date(t - (n + 1 - i) * 3600e3 + 25 * 60000).toISOString(), minutes: 25 })) };
    await api.put('day:' + D, d);
    for (const [w, h] of [[1904, 1015], [1440, 789]]) {
      await p.setViewportSize({ width: w, height: h }); await p.goto(s.url + '/focus'); await p.locator('.focus-history').waitFor(); await p.waitForTimeout(600);
      const m = await p.evaluate(() => { const H = document.querySelector('.focus-history').getBoundingClientRect(); const L = [...document.querySelectorAll('.focus-grid > .stack > *')].at(-1); const R = L.getBoundingClientRect(); return { last: L.className.replace('panel ', ''), aligned: document.querySelector('.focus-grid').hasAttribute('data-align-rows'), topDiff: Math.round(R.top - H.top), bottomDiff: Math.round(R.bottom - H.bottom), scroll: document.documentElement.scrollHeight - innerHeight }; });
      const tag = `${name} ${w}x${h}`;
      if (m.scroll !== 0 || m.bottomDiff !== 0) throw Error(`columns end together without scrolling (${tag}): ${JSON.stringify(m)}`);
      const expect = !name.includes('_block') || name === 'fr-off_6_block_never';
      if (expect && (!m.aligned || m.topDiff !== 0)) throw Error(`last card lines up with the chart (${tag}): ${JSON.stringify(m)}`);
      if (!expect && m.aligned && m.topDiff !== 0) throw Error(`alignment is exact when on (${tag})`);
      passed++;
    }
  }
  console.log(`all ${passed} checks passed`);
} finally { await b.close(); s.stop(); }
