import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

// Going through the inbox one task at a time (every action, undo, keys, phone) and ticking tasks in the agenda.
// TRIAGE_SHOTS=<dir> also writes screenshots.
const shots = process.env.TRIAGE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const W = {
  en: { start: n => `Go through inbox (${n})`, today: 'Today', tomorrow: 'Tomorrow', pick: 'Pick date', set: /^Set date/, list: 'Move to list', star: 'Star', del: 'Delete', skip: 'Skip', undo: 'Undo', empty: 'Inbox is empty', left: 'Done for now', close: 'Close', done: t => `Done: ${t}`, task: 'Task', note: 'Note' },
  tr: { start: n => `Gelen kutusunu sırayla işle (${n})`, today: 'Bugün', tomorrow: 'Yarın', pick: 'Tarih seç', set: /^Tarihi ayarla/, list: 'Listeye taşı', star: 'Yıldızla', del: 'Sil', skip: 'Atla', undo: 'Geri al', empty: 'Gelen kutusu boş', left: 'Şimdilik bu kadar', close: 'Kapat', done: t => `Tamamlandı: ${t}`, task: 'Görev', note: 'Not' },
};
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const D = day(0), TOMORROW = day(1), LATER = day(5);
const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
const item = (text, extra = {}) => ({ id: 'id-' + text.toLowerCase().replace(/\W+/g, '-'), text, done: false, created: new Date().toISOString(), ...extra });
const fresh = () => ({ items: [...names.map((n, i) => item(n, i === 0 ? { notes: 'first note' } : {})), item('Dated', { due: LATER }), item('Listed', { list: 'l-work' }), item('Finished', { done: true })], lists: [{ id: 'l-work', name: 'Work' }] });
const until = async (fn, what) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } assert.fail('timed out: ' + what); };

const srv = await startServer(), browser = await launch();
try {
  for (const [lang, theme, width] of [['en', 'light', 1440], ['tr', 'dark', 1440], ['en', 'dark', 390], ['tr', 'light', 390]]) {
    const w = W[lang], phone = width < 700;
    const api = await demoAccount(client(srv.url), { lang });
    const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, reducedMotion: 'reduce' });
    await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
    const page = await ctx.newPage();
    const tag = `${lang} ${theme} ${width}`;
    await page.goto(srv.url + '/settings'); await page.locator('#s-theme').waitFor();
    await page.locator('#s-colour + * button').nth(theme === 'light' ? 0 : 1).click();
    await api.put('inbox', fresh());
    const inbox = async () => (await api.get('inbox')).value;
    const dayDoc = async (d) => (await api.get('day:' + d)).value ?? { tasks: [] };
    const ids = async () => (await inbox()).items.map(x => x.text);
    const dlg = page.locator('dialog.triage');
    const progress = async (text) => { await until(async () => (await dlg.locator('.triage-count').textContent()) === text, 'progress ' + text); };
    const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}-${lang}-${theme}-${width}.png` }); };

    await page.goto(srv.url + '/tasks/inbox');
    const start = page.getByRole('button', { name: w.start(8), exact: true });
    await start.click();
    await dlg.waitFor();
    assert.equal(await dlg.getByLabel(w.task, { exact: true }).inputValue(), 'Alpha');
    assert.equal(await dlg.getByLabel(w.note, { exact: true }).inputValue(), 'first note');
    await progress('1 / 8');
    assert.equal(await dlg.getByRole('progressbar').getAttribute('aria-valuenow'), '0');
    await shot('card');

    // typing letters in the text field does not trigger a decision
    const text = dlg.getByLabel(w.task, { exact: true });
    await text.fill('tyds Alpha');
    await text.press('Enter');
    assert.equal(await text.inputValue(), 'tyds Alpha');
    await progress('1 / 8');
    await text.fill('Alpha edited');

    // Today (button), then Undo (in the card) brings it back
    await dlg.getByRole('button', { name: w.today, exact: true }).click();
    await progress('2 / 8');
    await until(async () => (await dayDoc(D)).tasks.some(t => t.text === 'Alpha edited'), 'alpha on today');
    assert((await ids()).every(t => t !== 'Alpha edited'));
    await shot('after-action');
    await dlg.locator('.triage-undo').getByRole('button', { name: w.undo, exact: true }).click();
    await progress('1 / 8');
    await until(async () => (await ids()).includes('Alpha edited') && !(await dayDoc(D)).tasks.some(t => t.text === 'Alpha edited'), 'alpha back');
    assert.equal(await text.inputValue(), 'Alpha edited');

    // Tomorrow (key Y)
    await page.keyboard.press('y');
    await progress('2 / 8');
    await until(async () => (await dayDoc(TOMORROW)).tasks.some(t => t.text === 'Alpha edited'), 'alpha tomorrow');

    // Pick date (key D, then the form)
    await page.keyboard.press('d');
    const dateInput = dlg.getByLabel(w.pick, { exact: true });
    await dateInput.waitFor();
    await shot('date');
    await dateInput.fill(LATER);
    await dlg.getByRole('button', { name: w.set }).click();
    await progress('3 / 8');
    await until(async () => (await dayDoc(LATER)).tasks.some(t => t.text === 'Bravo'), 'bravo on later date');

    // Move to list (key L, then 1); Ctrl+Z takes it back; then by button
    await page.keyboard.press('l');
    await dlg.getByRole('button', { name: 'Work' }).waitFor();
    await shot('lists');
    await page.keyboard.press('1');
    await progress('4 / 8');
    await until(async () => (await inbox()).items.find(x => x.text === 'Charlie')?.list === 'l-work', 'charlie in Work');
    await page.keyboard.press('Control+z');
    await progress('3 / 8');
    await until(async () => (await inbox()).items.find(x => x.text === 'Charlie')?.list === undefined, 'charlie back in inbox');
    await dlg.getByRole('button', { name: w.list, exact: true }).click();
    await dlg.getByRole('button', { name: 'Work' }).click();
    await progress('4 / 8');
    await until(async () => (await inbox()).items.find(x => x.text === 'Charlie')?.list === 'l-work', 'charlie in Work again');

    // Star (key S), undo in the card, star again
    await page.keyboard.press('s');
    await progress('5 / 8');
    await until(async () => (await inbox()).items.find(x => x.text === 'Delta')?.priority === 1, 'delta starred');
    await dlg.locator('.triage-undo').getByRole('button', { name: w.undo, exact: true }).click();
    await progress('4 / 8');
    await until(async () => (await inbox()).items.find(x => x.text === 'Delta')?.priority === undefined, 'delta unstarred');
    await dlg.getByRole('button', { name: w.star, exact: true }).click();
    await progress('5 / 8');
    await until(async () => (await inbox()).items.find(x => x.text === 'Delta')?.priority === 1, 'delta starred again');

    // Delete (key Delete), Ctrl+Z, delete again
    await page.keyboard.press('Delete');
    await progress('6 / 8');
    await until(async () => { const b = await inbox(); return !b.items.some(x => x.text === 'Echo') && b.trash?.some(x => x.item.text === 'Echo'); }, 'echo deleted');
    await page.keyboard.press('Control+z');
    await progress('5 / 8');
    await until(async () => (await ids()).includes('Echo'), 'echo restored');
    await dlg.getByRole('button', { name: w.del, exact: true }).click();
    await progress('6 / 8');
    await until(async () => !(await ids()).includes('Echo'), 'echo deleted again');

    // Skip (key →): the task stays as it was
    await page.keyboard.press('ArrowRight');
    await progress('7 / 8');
    assert((await ids()).includes('Foxtrot'));
    await dlg.locator('.triage-undo').getByRole('button', { name: w.undo, exact: true }).click();
    await progress('6 / 8');
    await page.keyboard.press('ArrowRight');
    await progress('7 / 8');

    // Tomorrow (button), Skip (button)
    await dlg.getByRole('button', { name: w.tomorrow, exact: true }).click();
    await progress('8 / 8');
    await until(async () => (await dayDoc(TOMORROW)).tasks.some(t => t.text === 'Golf'), 'golf tomorrow');
    await dlg.getByRole('button', { name: w.skip, exact: true }).click();

    // the end: Foxtrot, Delta (starred) and Hotel are still in the inbox
    await dlg.getByRole('heading', { name: w.left }).waitFor();
    assert.match(await dlg.locator('.triage-done').textContent(), /3/);
    assert.equal(await dlg.getByRole('progressbar').getAttribute('aria-valuenow'), '8');
    await shot('done');
    await dlg.getByRole('button', { name: w.close, exact: true }).last().click();
    await dlg.waitFor({ state: 'detached' });
    await until(async () => (await ids()).sort().join() === ['Charlie', 'Dated', 'Delta', 'Finished', 'Foxtrot', 'Hotel', 'Listed'].join(), 'inbox as expected');

    // the rest (Delta, Foxtrot, Hotel): delete all three with the key; then "inbox is empty"; Esc closes
    await page.reload();
    const left = page.getByRole('button', { name: w.start(3), exact: true });
    await left.waitFor();
    await left.click();
    await dlg.waitFor();
    // A task already starred still advances, and undo restores its priority and position.
    await page.keyboard.press('s');
    await progress('2 / 3');
    await until(async () => (await inbox()).items.find(x => x.text === 'Delta')?.priority === undefined, 'existing star removed');
    await page.keyboard.press('Control+z');
    await progress('1 / 3');
    await until(async () => (await inbox()).items.find(x => x.text === 'Delta')?.priority === 1, 'existing star restored');
    for (let i = 1; i <= 3; i++) { await progress(`${i} / 3`); await page.keyboard.press('Delete'); }
    await dlg.getByRole('heading', { name: w.empty }).waitFor();
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
    await until(async () => !(await ids()).some(t => ['Delta', 'Foxtrot', 'Hotel'].includes(t)), 'all deleted');
    assert.equal(await page.getByRole('button', { name: /^(Go through inbox|Gelen kutusunu sırayla işle)/ }).count(), 0);

    // Esc closes at once, from the card
    await api.put('inbox', fresh());
    await page.reload();
    await page.getByRole('button', { name: w.start(8), exact: true }).click();
    await dlg.waitFor();
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
    assert.equal((await ids()).length, 11);

    if (phone) {
      await page.getByRole('button', { name: w.start(8), exact: true }).click();
      await dlg.waitFor();
      await shot('phone-card');
      const small = await dlg.locator('button').evaluateAll(es => es.filter(e => !(e instanceof HTMLButtonElement && e.disabled)).map(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44 ? e.textContent + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) : ''; }).filter(Boolean));
      assert.deepEqual(small, [], 'touch targets');
      assert.deepEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth ? [] : [document.documentElement.scrollWidth, ...[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 6).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))]), [], 'no horizontal scroll');
      const box = await dlg.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width, 'card fits the screen');
      await dlg.getByRole('button', { name: w.list, exact: true }).click();
      await shot('phone-lists');
      await dlg.getByRole('button', { name: 'Work' }).click();
      await progress('2 / 8');
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' });
    }
    console.log(`PASS inbox triage ${tag}: every action, undo, keys${phone ? ', touch targets' : ''}`);

    // Agenda: a task can be ticked off (and taken back), a day's task and a task due that day
    await api.put('inbox', { items: [item('Agenda inbox task', { due: D })], lists: [] });
    const dd = await dayDoc(D);
    await api.put('day:' + D, { ...dd, tasks: [{ id: 'ag-day', text: 'Agenda day task', done: false }] });
    await page.goto(srv.url + '/agenda/' + D);
    const dayBox = page.getByLabel(w.done('Agenda day task'), { exact: true }), inboxBox = page.getByLabel(w.done('Agenda inbox task'), { exact: true });
    await dayBox.waitFor(); await inboxBox.waitFor();
    if (phone) {
      const h = await page.locator('.agenda-tick').first().evaluate(e => e.getBoundingClientRect().height);
      assert(h >= 44, 'agenda row height ' + h);
    }
    await shot('agenda');
    await dayBox.check();
    await until(async () => (await dayDoc(D)).tasks.find(t => t.id === 'ag-day')?.done === true, 'day task done');
    assert(await page.locator('.agenda-task.done', { hasText: 'Agenda day task' }).count() === 1);
    await shot('agenda-ticked');
    await page.getByRole('button', { name: w.undo, exact: true }).click();
    await until(async () => (await dayDoc(D)).tasks.find(t => t.id === 'ag-day')?.done === false, 'day task open again');
    assert.equal(await dayBox.isChecked(), false);
    await dayBox.check();
    await until(async () => (await dayDoc(D)).tasks.find(t => t.id === 'ag-day')?.done === true, 'day task done again');
    await dayBox.uncheck();
    await until(async () => (await dayDoc(D)).tasks.find(t => t.id === 'ag-day')?.done === false, 'day task unticked');
    await inboxBox.check();
    await until(async () => { const t = (await inbox()).items.find(x => x.text === 'Agenda inbox task'); return t?.done === true && t.doneAt === D; }, 'inbox task done');
    await page.getByRole('button', { name: w.undo, exact: true }).click();
    await until(async () => (await inbox()).items.find(x => x.text === 'Agenda inbox task')?.done === false, 'inbox task open again');
    console.log(`PASS agenda ticking ${tag}: day task and dated task, undo`);
    await ctx.close();
  }
} finally { await browser.close(); await srv.stop(); }
