// Ctrl+K understands lines: "12 Nov" / "hafta 47" go there, "block 3pm 1h deep Draft" adds a block (with Undo), "task …" adds a task.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';

const s = await startServer(), b = await launch();
const shots = 'reports/palette-natural';
mkdirSync(shots, { recursive: true });
const now = new Date(), Y = now.getFullYear(), D = iso(now);
const day = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d); };
const nextMonday = day((1 - now.getDay() + 7) % 7 || 7);
const pad = (n) => String(n).padStart(2, '0');

try {
  for (const lang of ['en', 'tr']) {
    const api = await demoAccount(client(s.url), { lang });
    const context = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
    const p = await context.newPage();
    await p.goto(s.url + '/');
    await p.locator('.rail').waitFor({ state: 'attached' });
    const box = p.locator('.command-palette').getByRole('combobox'), options = p.locator('.command-palette').getByRole('option');
    const open = async (text = '') => { await p.keyboard.press('Control+k'); await box.waitFor(); if (text) await box.fill(text); };
    const first = async () => (await options.first().innerText()).replace(/\s+/g, ' ');
    const go = async (text, url) => { await open(text); await options.first().waitFor(); assert.match(await first(), lang === 'tr' ? /^Git: / : /^Go: /, `${text}: ${await first()}`); await p.keyboard.press('Enter'); await p.waitForURL('**' + url); await p.locator('.command-palette').waitFor({ state: 'detached' }); };

    // go to a date or period, with words of either language whatever the interface language is
    await go('12 Nov', `/day/${Y}-11-12`);
    await go('12 Kasım', `/day/${Y}-11-12`);
    await go('12.11', `/day/${Y}-11-12`);
    await go('tomorrow', `/day/${day(1)}`);
    await go('yarın', `/day/${day(1)}`);
    await go('dün', `/day/${day(-1)}`);
    await go('pazartesi', `/day/${nextMonday}`);
    await go('monday', `/day/${nextMonday}`);
    await go('week 47', `/week/${Y}-W47`);
    await go('hafta 47', `/week/${Y}-W47`);
    await go('gelecek hafta', `/week/${weekOf(day(7))}`);
    await go('next week', `/week/${weekOf(day(7))}`);
    await go('Aralık', `/month/${Y}-12`);
    await go('December', `/month/${Y}-12`);
    await go('2027', '/year/2027');
    await go('Q1', `/quarter/${Y}-Q1`);
    await go('çeyrek 2', `/quarter/${Y}-Q2`);
    // what it does not understand it leaves alone
    await open('12'); assert.ok(!/^(Go|Git): /.test(await first().catch(() => '')));
    await p.keyboard.press('Escape');
    await open('31 şubat'); assert.ok(!/^(Go|Git): /.test(await first().catch(() => '')));
    await p.keyboard.press('Escape');

    // a block: preview first, Enter adds it, the note offers Undo
    await p.goto(s.url + '/');
    await p.locator('.rail').waitFor({ state: 'attached' });
    const plan = async (d = D) => (await api.get(`day:${d}`)).value ?? { columns: [{ blocks: [] }] };
    const taken = (await plan()).columns.at(-1).blocks;
    const free = [5, 6, 7, 20, 21, 22].find((h) => !taken.some((x) => x.start < (h + 1) * 60 && h * 60 < x.end));
    assert.ok(free != null, 'a free hour for the block');
    const at = `${pad(free)}:00`, to = `${pad(free + 1)}:00`;
    const line = lang === 'tr' ? `blok ${at} 1s derin Palet taslağı` : `block ${at} 1h deep Palette draft`;
    const label = lang === 'tr' ? 'Palet taslağı' : 'Palette draft';
    await open(line);
    const preview = await first();
    assert.ok(preview.startsWith(lang === 'tr' ? 'Ekle: Blok' : 'Add: Block'), preview);
    assert.ok(preview.includes(`${at}–${to}`) && preview.includes(label), preview);
    assert.ok(preview.includes(lang === 'tr' ? 'Derin' : 'Deep'), preview);
    assert.equal(await p.locator('.command-palette .palette-note').count(), 0, 'no overlap, no note');
    await p.screenshot({ path: `${shots}/${lang}-block-preview-1440.png` });
    await p.keyboard.press('Enter');
    await p.locator('.command-palette').waitFor({ state: 'detached' });
    const note = p.locator('.undo-note');
    await note.waitFor();
    assert.ok((await note.innerText()).includes(label), await note.innerText());
    const saved = async (find, d = D) => { for (let i = 0; i < 40; i++) { const f = (await plan(d)).columns.at(-1).blocks.find(find); if (f) return f; await p.waitForTimeout(250); } return undefined; };
    const added = await saved((x) => x.label === label);
    assert.deepEqual([added.start, added.end, added.kind], [free * 60, (free + 1) * 60, 'deep']);
    await p.goto(`${s.url}/day/${D}`);
    await p.locator('.rail').waitFor({ state: 'attached' });
    assert.ok(await p.getByText(label).first().isVisible(), 'the Day screen shows the new block');
    await p.keyboard.press('Control+k'); await box.waitFor();
    await box.fill(lang === 'tr' ? `blok ${at} 30dk toplantı Çakışan` : `block ${pad(free)}:15 30m meeting Clashing`);
    assert.ok((await p.locator('.command-palette .palette-note').first().innerText()).includes(label), 'the overlap is named in the preview');
    await p.screenshot({ path: `${shots}/${lang}-block-overlap-1440.png` });
    await p.keyboard.press('Escape');

    // Undo takes the block out again
    await p.goto(s.url + '/');
    await p.locator('.rail').waitFor({ state: 'attached' });
    await open(lang === 'tr' ? `blok ${at} 1s derin Geri alınacak` : `block ${at} 1h deep To undo`);
    await p.keyboard.press('Enter');
    const fresh = p.locator('.undo-note', { hasText: /Geri alınacak|To undo/ });
    await fresh.waitFor();
    await fresh.getByRole('button', { name: lang === 'tr' ? 'Geri al' : 'Undo', exact: true }).click();
    await fresh.waitFor({ state: 'detached' });
    await p.waitForTimeout(1500);
    assert.ok(!(await plan()).columns.at(-1).blocks.some((x) => /Geri alınacak|To undo/.test(x.label)), 'Undo removed the block');
    assert.ok((await plan()).columns.at(-1).blocks.some((x) => x.label === label), 'the first block stays');

    // a block on another day, from the words of the line
    await open(lang === 'tr' ? 'blok yarın 10:30-11:15 Yarınki iş' : 'block tomorrow 10:30am-11:15am Tomorrow job');
    assert.match(await first(), new RegExp(`10:30–11:15`));
    await p.keyboard.press('Enter');
    await p.locator('.command-palette').waitFor({ state: 'detached' });
    const tomorrow = await saved((x) => /Yarınki iş|Tomorrow job/.test(x.label), day(1));
    assert.deepEqual([tomorrow.start, tomorrow.end], [630, 675]);

    // a task for the inbox, read by the quick-add grammar
    await open(lang === 'tr' ? 'görev Palet görevi yarın 14:30 !1 @palet' : 'task Palette task tomorrow 14:30 !1 @palette');
    const taskPreview = await first();
    assert.ok(taskPreview.startsWith(lang === 'tr' ? 'Ekle: Görev' : 'Add: Task') && taskPreview.includes('14:30'), taskPreview);
    await p.keyboard.press('Enter');
    await p.locator('.command-palette').waitFor({ state: 'detached' });
    await p.waitForTimeout(1500);
    const item = (await api.get('inbox')).value.items.find((x) => x.text === (lang === 'tr' ? 'Palet görevi' : 'Palette task'));
    assert.ok(item, 'the task is in the inbox');
    assert.deepEqual([item.due, item.dueTime, item.priority, item.tags], [day(1), '14:30', 1, [lang === 'tr' ? 'palet' : 'palette']]);
    const taskNote = p.locator('.undo-note', { hasText: /Palet görevi|Palette task/ });
    await taskNote.getByRole('button', { name: lang === 'tr' ? 'Geri al' : 'Undo', exact: true }).click();
    await p.waitForTimeout(1500);
    assert.ok(!(await api.get('inbox')).value.items.some((x) => x.id === item.id), 'Undo removed the task');

    // the old forms still work, and "Geçmişte" still searches
    await open('Task: Old form'); await p.keyboard.press('Enter'); await p.locator('.command-palette').waitFor({ state: 'detached' });
    await open('chapter'); await p.locator('.palette-history-heading, .command-palette [role=status]').first().waitFor();
    await p.keyboard.press('Escape');

    // light, dark, phone
    for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']]) {
      await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await open(lang === 'tr' ? `blok ${pad(free)}:15 45dk kişisel Uzun bir ad ile çakışan örnek blok` : `block ${pad(free)}:15 45m personal A long name with an overlapping example block`);
      await options.first().waitFor();
      const m = await p.evaluate(() => { const d = document.querySelector('.command-palette').getBoundingClientRect(); return { right: d.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; });
      assert.ok(m.right <= m.vw + 1 && m.sw <= m.vw, `no sideways overflow at ${width}: ${JSON.stringify(m)}`);
      await p.screenshot({ path: `${shots}/${lang}-${width}-${theme}.png` });
      await p.keyboard.press('Escape');
    }
    await context.close();
  }
  console.log('PASS palette-natural: go to dates and periods (TR+EN), block preview/add/overlap/undo, other-day block, task add/undo, old forms, light/dark/phone');
} finally { await b.close(); await s.stop(); }
