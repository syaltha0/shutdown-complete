import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';
const srv = await startServer();
let browser, count = 0;
const check = (name, ok) => { assert.ok(ok, name); count++; console.log('PASS ' + name); };
try {
  const api = await demoAccount(client(srv.url), { lang: 'en' });
  const d = iso(new Date());
  await api.put('day:' + d, { columns: [{ from: null, closedAt: null, blocks: [{ id: 'one', label: 'Export study', start: 540, end: 600, kind: 'deep', subject: 'Maths', note: '' }] }], tasks: [{ id: 'task', text: 'Dated task', due: d, done: false }], notes: 'Export notes', metrics: { deep: 2 } });
  await api.put('week:2026-W46', { items: [{ id: 'goal', text: 'Weekly goal', done: false }], notes: '' });
  const make = async () => (await api.call('/api/account/calendar-feed', { timezone: 'Europe/Istanbul', tasks: true })).body.path;
  const path = await make();
  const r = await fetch(srv.url + path), text = await r.text();
  check('public token feed contains active block and dated task', r.ok && text.includes('SUMMARY:Export study') && text.includes('SUMMARY:Dated task'));
  const other = await demoAccount(client(srv.url), { lang: 'en', email: 'other@example.test' });
  check('another account has no subscription', (await other.call('/api/account/calendar-feed')).body === null);
  const replacement = await make();
  check('rotation invalidates old token', (await fetch(srv.url + path)).status === 404 && (await fetch(srv.url + replacement)).ok);
  check('unauthenticated management refused', (await client(srv.url).call('/api/account/calendar-feed')).status === 401);
  browser = await launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
  const page = await ctx.newPage();
  await page.goto(srv.url + '/settings');
  for (const [name, expected] of [['Download Markdown', ['Export study', 'Export notes', 'Weekly goal']], ['Download blocks CSV', ['Export study', 'Maths', '09:00']], ['Download metrics CSV', [d, '2']]]) {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await waiting;
    const content = await readFile(await download.path(), 'utf8');
    check(name, expected.every((s) => content.includes(s)));
  }
  await page.goto(srv.url + '/settings/account');
  await page.getByRole('button', { name: 'Renew address', exact: true }).click();
  const address = page.getByRole('textbox', { name: 'Calendar subscription', exact: true });
  await address.waitFor();
  check('account shows newly created address', (await address.inputValue()).includes('/ics/'));
  await page.getByRole('button', { name: 'Disable subscription', exact: true }).click();
  await page.getByRole('button', { name: 'Create address', exact: true }).waitFor();
  check('disable revokes subscription', (await api.call('/api/account/calendar-feed')).body === null);
  console.log(`all ${count} checks passed`);
} finally { await browser?.close(); srv.stop(); }
