// End-to-end checks of the task lists (/tasks): lists and collections, details, repeating tasks, completed ones, putting
// tasks on a day, search and order, phones; in a real browser against a throwaway server.
//   npm run build && node tools/e2e/tasks.mjs [--shots <dir>]
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const shot = async (page, name) => { if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png` }); };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
const wd = (d) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7; // Monday = 0
const D = iso(new Date());

const srv = await startServer();
const api = await demoAccount(client(srv.url), { lang: 'en' });
// a task list written before the lists existed: plain items, no list
await api.put('inbox', { items: [{ id: 'old1', text: 'Old inbox item', done: false }] });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' });
await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('page error:', e.message); });
const tasks = async () => (await api.get('inbox')).value;
const task = async (text) => (await tasks()).items.find((x) => x.text === text);
const row = (text) => page.locator('.tk-row', { hasText: text });
const open = async (text) => { await row(text).locator('.tk-open').click(); await page.locator('.tk-detail').waitFor(); };
const detail = page.locator('.tk-detail');
const add = async (text) => { await page.locator('#tk-new').fill(text); await page.locator('#tk-new').press('Enter'); };

try {
  await page.goto(`${srv.url}/tasks`);
  await page.locator('.tk-main').waitFor({ timeout: 8000 });
  check('the rail calls it Tasks', (await page.locator('.rail a[href="/tasks"] .label').textContent()) === 'Tasks');
  check('an item from before the lists shows in All and in the Inbox list', await row('Old inbox item').isVisible() && (await page.locator('.tk-lists button', { hasText: 'Inbox' }).locator('.num').textContent()) === '1');

  // ---------- lists ----------
  await page.getByRole('button', { name: '+ New list' }).click();
  await page.locator('#tk-list-name').fill('School');
  await page.locator('#tk-list-name').press('Enter');
  await page.waitForURL(/\/tasks\/l/);
  check('a new list opens', (await page.locator('#tk-h').textContent()) === 'School');
  await add('Maths homework');
  await add('Physics lab report');
  await wait(1000);
  const school = (await tasks()).lists?.[0];
  check('a task written in a list belongs to it', school?.name === 'School' && (await task('Maths homework'))?.list === school.id);
  await page.locator('.tk-lists li', { hasText: 'School' }).locator('.tk-list-menu').click();
  await page.locator('.kb-pop .tk-tint.c-green').click();
  await wait(900);
  check('a list takes a colour', (await tasks()).lists[0].color === 'green' && await page.locator('.tk-lists li', { hasText: 'School' }).locator('.tk-dot.c-green').isVisible());
  await page.keyboard.press('Escape');

  // ---------- details: dates, priority, progress, tags, notes, subtasks ----------
  await open('Maths homework');
  await detail.locator('input[type=date]').nth(1).fill(D);
  await detail.getByRole('button', { name: 'High' }).click();
  await detail.locator('#tk-tag').fill('exam');
  await detail.locator('#tk-tag').press('Enter');
  await detail.locator('.tk-notes').fill('Pages 40-44, all odd ones');
  await detail.locator('.tk-range').fill('40');
  await detail.locator('.checklist .adder input').fill('Question 1');
  await detail.locator('.checklist .adder input').press('Enter');
  await wait(1100);
  let m = await task('Maths homework');
  check('details are saved: due, priority, tag, notes, progress, a subtask', m.due === D && m.priority === 1 && m.tags?.[0] === 'exam' && m.notes?.startsWith('Pages') && m.percent === 40 && m.steps?.[0]?.text === 'Question 1', JSON.stringify(m));
  check('the row shows the due day, progress, subtasks, the tag and the star', await row('Maths homework').locator('.today', { hasText: 'due today' }).isVisible()
    && await row('Maths homework').locator('.tk-pc').isVisible() && await row('Maths homework').getByText('0/1 subtasks').isVisible()
    && await row('Maths homework').locator('.lbl', { hasText: 'exam' }).isVisible() && await row('Maths homework').locator('.tk-star.on').isVisible());
  await shot(page, 'detail');

  // ---------- collections ----------
  const count = async (name) => Number(await page.locator('.tk-views button', { hasText: name }).first().locator('.num').textContent() || 0);
  check('Today, Next 7 days, Important and In progress gather it', await count('Today') === 1 && await count('Next 7 days') === 1 && await count('Important') === 1 && await count('In progress') === 1);
  check('the rail counts what is due by today', (await page.locator('.rail-item .count').textContent()) === '1');
  await page.locator('.tk-views button', { hasText: 'Important' }).click();
  await add('Renew the passport');
  await wait(900);
  check('a task written in Important is starred', (await task('Renew the passport'))?.priority === 1);
  await page.locator('.tk-views button', { hasText: 'Today' }).first().click();
  await add('Call the dentist');
  await wait(900);
  check('a task written in Today is due today', (await task('Call the dentist'))?.due === D);
  await row('Renew the passport').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
  check('Today shows only what is due or started by today', !(await row('Renew the passport').count()) && await row('Call the dentist').isVisible());
  check('a collection names the list of each task', await row('Maths homework').locator('.tk-in', { hasText: 'School' }).isVisible());

  // ---------- repeating ----------
  await page.locator('.tk-views button', { hasText: 'All' }).click();
  await add('Water the plants');
  await open('Water the plants');
  await detail.locator('#tk-rep').selectOption('every2');
  await wait(900);
  let w = await task('Water the plants');
  check('a rule without a date starts today', w.repeat?.every === 2 && w.repeat.unit === 'day' && w.due === D);
  await row('Water the plants').locator('.check').click();
  await wait(900);
  w = await task('Water the plants');
  check('every 2 days: ticked, it comes back in two days, still open', !w.done && w.due === addD(D, 2) && w.doneCount === 1, JSON.stringify(w));
  check('the note says when it comes back', (await page.locator('.undo-note').textContent()).includes('Next'));
  await page.locator('.undo-note').getByRole('button', { name: 'Undo' }).click();
  await wait(900);
  check('and the tick can be undone', (await task('Water the plants')).due === D);

  // weekly on chosen days: the next chosen weekday after today
  await add('Gym');
  await open('Gym');
  await detail.locator('#tk-rep').selectOption('custom');
  await detail.locator('.tk-every select').selectOption('week');
  const pick = [(wd(D) + 2) % 7, (wd(D) + 5) % 7].sort();
  for (const i of pick) await detail.locator('.day-chips button').nth(i).click();
  await detail.locator('input[type=date]').nth(1).fill(D);
  await wait(900);
  await row('Gym').locator('.check').click();
  await wait(900);
  const g = await task('Gym');
  const want = [1, 2, 3, 4, 5, 6, 7].map((n) => addD(D, n)).find((d) => pick.includes(wd(d)));
  check('every week on two days: the next of them', g.due === want, `${g.due} vs ${want}`);
  check('its words name the days', (await row('Gym').locator('.tk-rep').textContent()).startsWith('every week on'));

  // monthly from the 31st keeps the 31st after a short month
  await api.put('inbox', { ...(await tasks()), items: [...(await tasks()).items, { id: 'm31', text: 'Pay the rent', done: false, due: '2026-01-31', repeat: { every: 1, unit: 'month' } }] });
  await page.reload();
  await row('Pay the rent').locator('.check').click();
  await wait(900);
  const rent = await task('Pay the rent');
  const now = new Date();
  const last = (y, mo) => new Date(y, mo + 1, 0).getDate();
  let y = 2026, mo = 0, nxt;
  do { mo++; if (mo > 11) { mo = 0; y++; } nxt = `${y}-${String(mo + 1).padStart(2, '0')}-${String(Math.min(31, last(y, mo))).padStart(2, '0')}`; } while (nxt <= D);
  check('every month from the 31st: late months skipped, the 31st kept', rent.due === nxt && rent.repeat.monthDay === 31, `${rent.due} vs ${nxt} (${now.toDateString()})`);

  // after it is done: counted from today
  await open('Pay the rent');
  await detail.locator('#tk-rep').selectOption('weekly');
  await detail.locator('.tk-check-row input').check();
  await wait(900);
  await row('Pay the rent').locator('.check').click();
  await wait(900);
  check('"after it is done": a week from today', (await task('Pay the rent')).due === addD(D, 7));
  await page.keyboard.press('Escape');

  // ---------- completed ----------
  await page.locator('.tk-lists button', { hasText: 'School' }).click();
  await row('Physics lab report').locator('.check').click();
  await wait(900);
  check('a one-off task is done, not deleted', (await task('Physics lab report'))?.done === true && (await task('Physics lab report')).doneAt === D);
  check('a list folds its completed tasks away', !(await row('Physics lab report').count()) && await page.getByRole('button', { name: 'Show 1 completed' }).isVisible());
  await page.getByRole('button', { name: 'Show 1 completed' }).click();
  check('and shows them struck through', await page.locator('.tk-row.done', { hasText: 'Physics lab report' }).isVisible());
  await page.locator('.tk-views button', { hasText: 'Completed' }).click();
  check('the Completed collection lists it', await row('Physics lab report').isVisible());
  await page.getByRole('button', { name: 'Delete completed' }).click();
  await wait(900);
  check('completed tasks can be deleted together', !(await task('Physics lab report')));

  // ---------- onto a day ----------
  await page.locator('.tk-views button', { hasText: 'All' }).click();
  await open('Call the dentist');
  await detail.locator('.tk-plan').getByRole('button', { name: 'Tomorrow' }).click();
  await wait(1100);
  check('a one-off task moves onto a day', !(await task('Call the dentist')) && (await api.get(`day:${addD(D, 1)}`)).value.tasks.some((x) => x.text === 'Call the dentist'));
  await open('Water the plants');
  await detail.locator('.tk-plan').getByRole('button', { name: 'Today' }).click();
  await wait(1100);
  check('a repeating task is copied onto the day and comes back', (await api.get(`day:${D}`)).value.tasks.some((x) => x.text === 'Water the plants' && !x.repeat) && (await task('Water the plants'))?.due === addD(D, 2));

  // ---------- search and order ----------
  await page.locator('.tk-search input').fill('passport');
  check('search finds by words', (await page.locator('.tk-main .tk-row').count()) === 1);
  await page.locator('.tk-search input').fill('odd ones');
  check('search finds by notes', await row('Maths homework').isVisible());
  await page.locator('.tk-search input').fill('question');
  check('search finds a task by the title of its subtask', await row('Maths homework').isVisible() && (await page.locator('.tk-main .tk-row').count()) === 1);
  await page.locator('.tk-search input').fill('odd  maths exam');
  check('search needs every word, in any order and field', await row('Maths homework').isVisible() && (await page.locator('.tk-main .tk-row').count()) === 1);
  await page.locator('.tk-search input').fill('maths passport');
  check('a word that matches nothing leaves no task', (await page.locator('.tk-main .tk-row').count()) === 0);
  await page.locator('.tk-search input').fill('');
  await page.locator('.tk-sort select').selectOption('title');
  const titles = await page.locator('.tk-main .tk-row .tk-title').allTextContents();
  check('ordered by title', titles.join() === [...titles].sort((a, b) => a.localeCompare(b)).join(), titles.join(' | '));
  await shot(page, 'all');

  // ---------- tags as views ----------
  await page.locator('.tk-tag-views button', { hasText: 'exam' }).click();
  check('a tag is a view of its own', (await page.locator('#tk-h').textContent()) === '#exam' && await row('Maths homework').isVisible() && (await page.locator('.tk-main .tk-row').count()) === 1);
  await add('Revise chapter 3');
  await wait(900);
  check('a task written in a tag view gets the tag', (await task('Revise chapter 3'))?.tags?.includes('exam'));

  // ---------- dragging ----------
  const dragTo = async (from, to, dy = 0) => {
    const a = await from.boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x + b.width / 2 - a.x) * i / 8, a.y + (b.y + b.height / 2 + dy - a.y) * i / 8);
    await page.mouse.up();
    await wait(900);
  };
  await page.locator('.tk-views button', { hasText: 'All' }).click();
  await page.locator('.tk-sort select').selectOption('title');
  const before = await page.locator('.tk-main .tk-row .tk-title').allTextContents();
  await dragTo(row(before[0]).locator('.tk-grip'), row(before[2]), 12);
  const after = await page.locator('.tk-main .tk-row .tk-title').allTextContents();
  check('a task dragged below another moves there, in one’s own order', after.indexOf(before[0]) === 2 && (await page.locator('.tk-sort select').inputValue()) === 'manual', after.join(' | '));
  await page.reload();
  await page.locator('.tk-main .tk-row').first().waitFor();
  check('that order is kept', (await page.locator('.tk-main .tk-row .tk-title').allTextContents()).join() === after.join());
  await dragTo(row('Gym').locator('.tk-grip'), page.locator('.tk-lists button', { hasText: 'School' }));
  check('a task dropped on a list moves into it', (await task('Gym')).list === (await tasks()).lists[0].id);
  await dragTo(row('Old inbox item').locator('.tk-grip'), page.locator('.tk-views button', { hasText: 'Important' }));
  check('a task dropped on Important is starred', (await task('Old inbox item')).priority === 1);
  await dragTo(row('Old inbox item').locator('.tk-grip'), page.locator('.tk-tag-views button', { hasText: 'exam' }));
  check('a task dropped on a tag gets it', (await task('Old inbox item')).tags?.includes('exam'));

  // ---------- from the lists onto the day's hours ----------
  await page.goto(`${srv.url}/day/${D}`);
  const fl = page.locator('.from-lists');
  await fl.waitFor({ timeout: 6000 });
  await shot(page, 'day');
  check('the day shows the lists’ tasks due today or starred', await fl.getByText('Maths homework').isVisible() && await fl.getByText('Renew the passport').isVisible() && !(await fl.getByText('Pay the rent').count()));
  const body = page.locator('.col.active .col-body');
  await dragTo(fl.locator('li', { hasText: 'Renew the passport' }).locator('.tk-grip'), body, -60);
  const dayDoc = (await api.get(`day:${D}`)).value;
  const blocks = dayDoc.columns.at(-1).blocks;
  check('dropped on the hours it becomes a block', blocks.some((b) => b.label === 'Renew the passport'), JSON.stringify(blocks.map((b) => b.label)));
  check('and joins the day’s tasks, leaving the lists', dayDoc.tasks.some((x) => x.text === 'Renew the passport') && !(await task('Renew the passport')));
  await page.keyboard.press('Escape');
  await fl.locator('li', { hasText: 'Maths homework' }).getByRole('button').last().click();
  await wait(1000);
  check('+ adds a task to the day without a block', (await api.get(`day:${D}`)).value.tasks.some((x) => x.text === 'Maths homework') && !(await task('Maths homework')));
  await page.goto(`${srv.url}/tasks`);
  await page.locator('.tk-main').waitFor();

  // ---------- the list gone, with undo ----------
  await page.locator('.tk-lists li', { hasText: 'School' }).locator('.tk-list-menu').click();
  await page.getByRole('button', { name: 'Delete the list and its tasks' }).click();
  await wait(900);
  check('a list is deleted with its tasks', !(await tasks()).lists?.length && !(await task('Gym')));
  await page.locator('.undo-note').getByRole('button', { name: 'Undo' }).click();
  await wait(900);
  check('and comes back with them', (await tasks()).lists?.length === 1 && !!(await task('Gym')));

  // ---------- quick add: dates, list, priority, tags, rules in either language ----------
  await page.locator('.tk-lists li', { hasText: 'School' }).locator('button[data-drop]').click();
  await page.locator('#tk-h').filter({ hasText: 'School' }).waitFor();
  await page.locator('#tk-new').fill('Essay tomorrow at 9 #School !1 @study');
  const preview = await page.locator('#tk-add-help').textContent();
  check('quick add previews what it understood', /Detected: Essay/.test(preview) && /09:00/.test(preview) && /School/.test(preview), preview);
  await page.locator('#tk-new').press('Enter');
  await add('Okuma her pazartesi');
  await add('Review every friday');
  await page.locator('#tk-new').fill('Call tomorrow !1');
  await page.getByRole('button', { name: 'Keep as plain text' }).click();
  await page.locator('#tk-new').press('Enter');
  await wait(1100);
  const qa = await task('Essay'), tomorrow = addD(D, 1);
  check('quick add sets due, time, list, priority and tag', qa?.due === tomorrow && qa.dueTime === '09:00' && qa.priority === 1 && qa.tags?.join() === 'study' && qa.list === school.id, JSON.stringify(qa));
  const trWeekly = await task('Okuma'), enWeekly = await task('Review');
  check('quick add reads Turkish and English weekly rules', trWeekly?.repeat?.unit === 'week' && trWeekly.repeat.days?.join() === '0' && enWeekly?.repeat?.days?.join() === '4' && wd(trWeekly.due) === 0 && wd(enWeekly.due) === 4, JSON.stringify([trWeekly?.repeat, enWeekly?.repeat]));
  const literal = await task('Call tomorrow !1');
  check('plain text opt-out keeps the whole title', literal && !literal.due && !literal.priority);
  await page.locator('#tk-new').fill('Read 9 pages');
  check('numbers alone are not a time', (await page.locator('#tk-add-help').textContent()).startsWith('Try:'));
  await page.locator('#tk-new').fill('');
  await shot(page, 'quick-add');

  // ---------- Turkish words for a rule ----------
  // ---------- phones ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${srv.url}/tasks`);
  await page.locator('.tk-main').waitFor();
  check('on a phone the lists are a select', await page.locator('.tk-pick select').isVisible() && !(await page.locator('.tk-side').isVisible()));
  check('nothing runs off the screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await open('Gym');
  const box = await detail.boundingBox();
  check('details cover the screen as a sheet', box && box.x <= 1 && box.width >= 380);
  await shot(page, 'phone');
  check('no errors on the page', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  srv.stop();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
