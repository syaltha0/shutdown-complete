// The kept draft of a save that lost to another device (409), field by field: the diff in plain words (block names and
// times, notes, task texts, workday), the confirmed restore, copy and ignore, on the day, week, month, quarter,
// settings and the task lists. Two browser contexts of one account, against a throwaway server.
//   npm run build && node tools/e2e/conflict-draft-fields.mjs [--shots <dir>]   (pictures of the notice, the diff and the confirmation)
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const check = (ok, label) => { if (!ok) throw Error('FAIL ' + label); console.log('PASS ' + label); };
const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
const weekOf = (d) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7)); const y = new Date(x.getFullYear(), 0, 4); const n = 1 + Math.round(((x - y) / 864e5 - 3 + ((y.getDay() + 6) % 7)) / 7); return `${x.getFullYear()}-W${String(n).padStart(2, '0')}`; };
const NOTICE = 'This page changed on another device. Your changes were kept.';
const BTN = {
  en: { show: 'Show my changes', hide: 'Hide', ignore: 'Ignore', restore: 'Restore mine', yes: 'Yes, restore', cancel: 'Cancel', copy: 'Copy text', copied: 'Copied' },
  tr: { show: 'Değişikliklerimi göster', hide: 'Gizle', ignore: 'Yok say', restore: 'Benimkini geri yükle', yes: 'Evet, geri yükle', cancel: 'Vazgeç', copy: 'Metni kopyala', copied: 'Kopyalandı' },
};
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const poll = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await wait(100); } return false; };
const draftKeys = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sc-drafts:')).length);
const EMPTY = { metrics: {}, shutdown: { done: false, at: null, steps: {} } };

async function setup(lang) {
  const s = await startServer(), api = await demoAccount(client(s.url), { lang }), b = await launch();
  const open = async (opts = {}) => {
    const c = await b.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'], ...opts });
    await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    const p = await c.newPage(); p.on('pageerror', (e) => { throw e; });
    return p;
  };
  return { s, api, b, open, end: async () => { await b.close(); s.stop(); } };
}
const column = (n) => (cells) => cells.evaluateAll((els, k) => els.filter((_, i) => i % 2 === k).map((e) => e.innerText).join('\n'), n);
const dayDoc = (lang, label, notes) => ({ ...EMPTY, columns: [{ from: null, closedAt: null, blocks: [{ id: 'b1', start: 540, end: 600, label, note: '', kind: 'deep' }] }], tasks: [{ id: 't1', text: lang === 'en' ? 'Write the report' : 'Raporu yaz', done: false }], notes });

// ---------------------------------------------------------------------------------------------------------------
const W = await setup('en');
try {
  const { s, api, open } = W, T = BTN.en;
  const day = addD(iso(new Date()), 2);
  await api.put('day:' + day, dayDoc('en', 'Morning focus', 'base'));
  const A = await open(), B = await open();
  for (const p of [A, B]) { await p.goto(`${s.url}/day/${day}`); await p.locator('.notes-area').waitFor(); }
  const notice = B.locator('.draft');

  // a normal save says nothing at all
  await A.locator('.notes-area').fill('from device A'); await wait(1500);
  check((await api.get('day:' + day)).value.notes === 'from device A' && await A.locator('.draft').count() === 0 && (await A.locator('.stamp').innerText()).trim() === '', 'a normal save stays silent');
  // another device also renames the block on the server
  const cur = (await api.get('day:' + day)).value;
  await api.put('day:' + day, { ...cur, columns: [{ ...cur.columns[0], blocks: [{ ...cur.columns[0].blocks[0], label: 'Server block', start: 570, end: 630 }] }] });

  // the second device (stale) saves: 409
  await B.locator('.notes-area').fill('from device B');
  check(await poll(async () => await notice.count() === 1), 'the stale device gets the notice');
  check((await notice.innerText()).includes(NOTICE) && await B.locator('.notes-area').inputValue() === 'from device A', 'the screen shows the server version and the notice says the changes were kept');
  const stored = await B.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('sc-drafts:')).map(([k, v]) => [k, JSON.parse(v)]));
  check(stored.length === 1 && stored[0][0].endsWith('day:' + day) && stored[0][1][0].value.notes === 'from device B' && stored[0][1][0].at > 0, 'the draft (document, time, local content) is in localStorage');
  check((await api.get('day:' + day)).value.notes === 'from device A', 'the server was not changed');

  // the diff, in plain fields
  await notice.getByRole('button', { name: T.show }).click();
  const cells = notice.locator('.draft-cell');
  const sv = await column(0)(cells), mine = await column(1)(cells);
  check(sv.includes('09:30–10:30') && sv.includes('Server block') && sv.includes('from device A') && sv.includes('Write the report'), 'the server column: block name and time, task, notes');
  check(mine.includes('09:00–10:00') && mine.includes('Morning focus') && mine.includes('from device B') && mine.includes('Write the report'), 'my column: block name and time, task, notes');
  const changed = await notice.locator('li.changed').allInnerTexts();
  check(changed.some((x) => x.includes('Server block')) && changed.some((x) => x.includes('Morning focus')) && changed.every((x) => !x.includes('Write the report')), 'only the lines that differ are marked');
  check(!/[{}"]/.test(sv + mine), 'no raw JSON in the view');

  // survives a reload
  await B.reload(); await B.locator('.notes-area').waitFor();
  check(await poll(async () => await notice.count() === 1), 'the notice is still there after a reload');

  // restore needs a confirmation, and can be cancelled
  await notice.getByRole('button', { name: T.show }).click();
  await notice.getByRole('button', { name: T.restore }).click();
  check(await notice.getByRole('button', { name: T.yes }).isVisible() && (await api.get('day:' + day)).value.notes === 'from device A', 'restore asks first and writes nothing yet');
  await notice.getByRole('button', { name: T.cancel }).click();
  check(await notice.getByRole('button', { name: T.restore }).isVisible(), 'cancel returns to the choices');
  await notice.getByRole('button', { name: T.restore }).click();
  await notice.getByRole('button', { name: T.yes }).click();
  check(await poll(async () => (await api.get('day:' + day)).value.notes === 'from device B'), 'restoring writes my version to the server as a new version');
  const after = (await api.get('day:' + day)).value;
  check(after.columns[0].blocks[0].label === 'Morning focus' && await poll(async () => await notice.count() === 0) && await draftKeys(B) === 0, 'my blocks are back, the notice and the draft are gone');
  await A.reload(); await A.locator('.notes-area').waitFor();
  check(await A.locator('.notes-area').inputValue() === 'from device B', 'the other device sees it after loading');

  // copy and ignore, on a second conflict (the first device wrote meanwhile)
  await api.put('day:' + day, { ...(await api.get('day:' + day)).value, notes: 'A again' });
  await B.locator('.notes-area').fill('B second try');
  check(await poll(async () => await notice.count() === 1), 'a second conflict is caught the same way');
  await notice.getByRole('button', { name: T.show }).click();
  await notice.getByRole('button', { name: T.copy }).click();
  check(await poll(async () => (await B.evaluate(() => navigator.clipboard.readText())).includes('B second try')) && await notice.getByRole('button', { name: T.copied }).count() === 1, 'copy puts my text on the clipboard');
  await notice.getByRole('button', { name: T.ignore }).click();
  check(await notice.count() === 0 && await draftKeys(B) === 0 && (await api.get('day:' + day)).value.notes === 'A again', 'ignore deletes the draft and leaves the server alone');
  await B.reload(); await B.locator('.notes-area').waitFor(); await wait(300);
  check(await notice.count() === 0, 'no notice after a reload once ignored');

  // only the last three drafts of a document are kept
  for (let i = 1; i <= 4; i++) {
    await api.put('day:' + day, { ...(await api.get('day:' + day)).value, notes: `server ${i}` });
    await B.locator('.notes-area').fill(`mine ${i}`); await wait(1500);
    await poll(async () => (await B.evaluate((t) => Object.values(localStorage).filter((v) => v.includes(t)).length, `mine ${i}`)) > 0);
  }
  const kept = await B.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('sc-drafts:')).map(([, v]) => JSON.parse(v).map((d) => d.value.notes)));
  check(kept.length === 1 && kept[0].length === 3 && kept[0][0] === 'mine 4' && !kept[0].includes('mine 1'), 'the last three drafts of a document are kept (newest first)');
  await notice.getByRole('button', { name: T.ignore }).click();

  // the same on the other documents: week, month, quarter (notes), settings (workday), tasks (inbox)
  const wk = weekOf(day), mo = day.slice(0, 7), q = `${day.slice(0, 4)}-Q${Math.floor((+day.slice(5, 7) - 1) / 3) + 1}`;
  for (const [path, key, sel] of [[`/week/${wk}`, `week:${wk}`, '#wk-notes'], [`/month/${mo}`, `month:${mo}`, '#m-notes'], [`/quarter/${q}`, `quarter:${q}`, '#q-notes']]) {
    const X = await open(), Y = await open(), kind = key.split(':')[0];
    for (const p of [X, Y]) { await p.goto(s.url + path); await p.locator(sel).waitFor(); }
    const was = (await api.get(key)).value;
    await api.put(key, { ...was, notes: 'server side' });
    await Y.locator(sel).fill('my side');
    const n = Y.locator('.draft');
    check(await poll(async () => await n.count() === 1), `${kind}: the notice appears`);
    await n.getByRole('button', { name: T.show }).click();
    check((await n.locator('.draft-lines.prose').allInnerTexts()).join('|').includes('my side') && (await n.locator('li.changed').allInnerTexts()).includes('server side'), `${kind}: the notes differ in plain text`);
    await n.getByRole('button', { name: T.restore }).click(); await n.getByRole('button', { name: T.yes }).click();
    check(await poll(async () => (await api.get(key)).value.notes === 'my side'), `${kind}: restore writes my notes`);
    await X.context().close(); await Y.context().close();
  }
  {
    const X = await open(), Y = await open();
    for (const p of [X, Y]) { await p.goto(s.url + '/settings'); await p.locator('#s-end').waitFor(); }
    const was = (await api.get('settings')).value;
    await api.put('settings', { ...was, startHour: 6, endHour: 20 });
    await Y.locator('#s-end').selectOption('22');
    const n = Y.locator('.draft');
    check(await poll(async () => await n.count() === 1), 'settings: the notice appears');
    await n.getByRole('button', { name: T.show }).click();
    const t = await n.innerText();
    check(t.includes('06:00–20:00') && t.includes(`${String(was.startHour).padStart(2, '0')}:00–22:00`), 'settings: the workday hours differ in plain words');
    await n.getByRole('button', { name: T.restore }).click(); await n.getByRole('button', { name: T.yes }).click();
    check(await poll(async () => (await api.get('settings')).value.endHour === 22), 'settings: restore writes my workday');
    await X.context().close(); await Y.context().close();
  }
  {
    await api.put('inbox', { items: [{ id: 'i1', text: 'Shared task', done: false }] });
    const X = await open(), Y = await open();
    for (const p of [X, Y]) { await p.goto(s.url + '/tasks'); await p.locator('#tk-new').waitFor(); }
    await Y.route('**/api/doc/inbox', (r) => (r.request().method() === 'GET' ? r.abort() : r.continue())); // keep this device stale
    await api.put('inbox', { items: [{ id: 'i1', text: 'Shared task', done: false }, { id: 'i2', text: 'Added elsewhere', done: false }] });
    await Y.locator('#tk-new').fill('Added on this device'); await Y.locator('#tk-new').press('Enter');
    const n = Y.locator('.draft');
    check(await poll(async () => await n.count() === 1, 8000), 'tasks: the notice appears');
    await n.getByRole('button', { name: T.show }).click();
    const c2 = n.locator('.draft-cell'), sv2 = await column(0)(c2), me2 = await column(1)(c2);
    check(sv2.includes('Added elsewhere') && !sv2.includes('Added on this device') && me2.includes('Added on this device') && !me2.includes('Added elsewhere') && me2.includes('Shared task'), 'tasks: the task texts differ, side by side');
    await n.getByRole('button', { name: T.restore }).click(); await n.getByRole('button', { name: T.yes }).click();
    check(await poll(async () => (await api.get('inbox')).value.items.some((i) => i.text === 'Added on this device')) && !(await api.get('inbox')).value.items.some((i) => i.text === 'Added elsewhere'), 'tasks: restore writes my list');
    await X.context().close(); await Y.context().close();
  }
  console.log('ALL PASS');
} finally { await W.end(); }

// ---------------------------------------------------------------------------------------------------------------
// pictures: the notice, the diff and the confirmation, at 1440 and 390, light and dark, English and Turkish
if (shotsAt) {
  for (const lang of ['en', 'tr']) {
    const V = await setup(lang);
    try {
      const day = addD(iso(new Date()), 2), T = BTN[lang];
      const seed = dayDoc(lang, lang === 'en' ? 'Morning focus' : 'Sabah odağı', 'base');
      await V.api.put('day:' + day, seed);
      for (const scheme of ['light', 'dark']) for (const [w, h] of [[1440, 900], [390, 844]]) {
        const A = await V.open({ viewport: { width: w, height: h }, colorScheme: scheme }), B = await V.open({ viewport: { width: w, height: h }, colorScheme: scheme });
        for (const p of [A, B]) { await p.goto(`${V.s.url}/day/${day}`); await p.locator('.notes-area').waitFor(); }
        const cur = (await V.api.get('day:' + day)).value;
        await V.api.put('day:' + day, { ...cur, columns: [{ ...cur.columns[0], blocks: [{ ...cur.columns[0].blocks[0], label: lang === 'en' ? 'Server block' : 'Sunucu bloğu', start: 570, end: 630 }] }], notes: lang === 'en' ? 'Notes written on the other device.' : 'Diğer cihazda yazılan notlar.' });
        await B.locator('.notes-area').fill(lang === 'en' ? 'Notes written on this device.' : 'Bu cihazda yazılan notlar.');
        await B.locator('.draft').waitFor(); await wait(300);
        await B.screenshot({ path: `${shotsAt}/${lang}-${scheme}-${w}-notice.png` });
        await B.locator('.draft').getByRole('button', { name: T.show }).click(); await wait(200);
        await B.screenshot({ path: `${shotsAt}/${lang}-${scheme}-${w}-diff.png` });
        await B.locator('.draft').getByRole('button', { name: T.restore }).click(); await wait(200);
        await B.screenshot({ path: `${shotsAt}/${lang}-${scheme}-${w}-confirm.png` });
        await A.context().close(); await B.context().close();
        await V.api.put('day:' + day, seed);
      }
    } finally { await V.end(); }
  }
}
