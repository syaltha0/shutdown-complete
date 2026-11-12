// End-to-end checks of the task lists over CalDAV: the server side (what DAVx5, Tasks.org, Thunderbird do: find the
// account, list the calendars, read, write, delete, make a list) and the link to a Nextcloud (davsync.mjs), here a
// second account of a throwaway server playing the Nextcloud.
//   npm run build && node tools/e2e/caldav.mjs
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const D = iso(new Date());
const addD = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };

const srv = await startServer({ env: { CALENDAR_ALLOW_PRIVATE: 'on' } });
const api = await demoAccount(client(srv.url), { lang: 'en' });
const email = (await api.call('/api/account')).body.email;
await api.put('inbox', { lists: [{ id: 'school', name: 'School', color: 'green' }], items: [
  { id: 'a1', text: 'Maths homework', done: false, list: 'school', due: D, priority: 1, tags: ['exam', 'maths'], notes: 'Pages 40-44,\nall odd ones', steps: [{ id: 's1', text: 'Question 1', done: true }] },
  { id: 'a2', text: 'Water the plants', done: false, due: D, repeat: { every: 2, unit: 'day' } },
] });

try {
  // ---------- app passwords ----------
  const made = await api.call('/api/account/app-passwords', { name: 'Phone' });
  const pw = made.body.password;
  check('an app password is made and shown once', /^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/.test(pw) && made.body.passwords.length === 1 && made.body.url.endsWith('/dav/'));
  const auth = (p = pw, e = email) => `Basic ${Buffer.from(`${e}:${p}`).toString('base64')}`;
  const dav = (method, path, body, headers = {}) => fetch(srv.url + path, { method, redirect: 'manual', body, headers: { authorization: auth(), 'content-type': 'application/xml; charset=utf-8', ...headers } });
  const text = async (r) => r.text();

  check('/.well-known/caldav leads to /dav/', (await fetch(`${srv.url}/.well-known/caldav`, { method: 'PROPFIND', redirect: 'manual' })).headers.get('location') === '/dav/');
  check('without a password the server asks for one', (await fetch(`${srv.url}/dav/`, { method: 'PROPFIND' })).status === 401);
  check('a wrong password is refused', (await dav('PROPFIND', '/dav/', '', { authorization: auth('aaaaa-bbbbb-ccccc-ddddd') })).status === 401);
  const login = (await api.call('/api/auth/login', { email, password: 'x' })).status;
  check('the account password does not work for apps', (await dav('PROPFIND', '/dav/', '', { authorization: auth('Demo-password-1') })).status === 401, String(login));

  const root = await text(await dav('PROPFIND', '/dav/', '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', { depth: '0' }));
  const principal = /<d:current-user-principal><d:href>([^<]+)</.exec(root)?.[1];
  check('the root names the account', !!principal && principal.startsWith('/dav/principals/'));
  const pr = await text(await dav('PROPFIND', principal, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/><d:displayname/></d:prop></d:propfind>', { depth: '0' }));
  const home = /<c:calendar-home-set><d:href>([^<]+)</.exec(pr)?.[1];
  check('the account says where its calendars are', !!home && home.startsWith('/dav/calendars/'));
  const cals = await text(await dav('PROPFIND', home, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><cs:getctag/><ic:calendar-color/></d:prop></d:propfind>', { depth: '1' }));
  check('each list is a calendar of tasks', cals.includes('<d:displayname>Inbox</d:displayname>') && cals.includes('<d:displayname>School</d:displayname>') && (cals.match(/<c:comp name="VTODO"\/>/g) || []).length === 2);
  check('a list’s colour goes with it', cals.includes('#2E7D32'));
  const school = `${home}school/`;

  const q = await text(await dav('REPORT', school, '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>', { depth: '1' }));
  check('a list lists its tasks and subtasks', q.includes('a1.ics') && q.includes('s1.ics') && !q.includes('a2.ics'));
  const got = await dav('GET', `${school}a1.ics`);
  const ics = await got.text();
  check('a task reads as a VTODO', got.status === 200 && ics.includes('SUMMARY:Maths homework') && ics.includes(`DUE;VALUE=DATE:${D.replace(/-/g, '')}`) && ics.includes('PRIORITY:1') && ics.includes('CATEGORIES:exam,maths') && ics.includes('DESCRIPTION:Pages 40-44\\,\\nall odd ones'));
  const sub = await (await dav('GET', `${school}s1.ics`)).text();
  check('a subtask points at its task', sub.includes('RELATED-TO;RELTYPE=PARENT:a1') && sub.includes('STATUS:COMPLETED'));
  const etag = got.headers.get('etag');

  // ---------- writing ----------
  const vtodo = (uid, lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VTODO', `UID:${uid}`, 'DTSTAMP:20261030T100000Z', ...lines, 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
  const ics2 = ics.replace('SUMMARY:Maths homework', 'SUMMARY:Maths homework (all)');
  check('a stale change is refused', (await dav('PUT', `${school}a1.ics`, ics2, { 'if-match': '"stale"', 'content-type': 'text/calendar' })).status === 412);
  const put = await dav('PUT', `${school}a1.ics`, ics2, { 'if-match': etag, 'content-type': 'text/calendar' });
  check('a change from an app is kept', put.status === 204 && !!put.headers.get('etag') && (await api.get('inbox')).value.items.find((x) => x.id === 'a1').text === 'Maths homework (all)');
  check('what the planner keeps beyond iCalendar survives an app’s change', (await api.get('inbox')).value.items.find((x) => x.id === 'a1').steps?.length === 1);
  const add = await dav('PUT', `${school}new-1.ics`, vtodo('new-1', ['SUMMARY:Lab report', `DUE;VALUE=DATE:${addD(D, 3).replace(/-/g, '')}`, 'PRIORITY:3', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'CATEGORIES:lab']), { 'if-none-match': '*', 'content-type': 'text/calendar' });
  let t = (await api.get('inbox')).value.items.find((x) => x.id === 'new-1');
  check('a task made in an app joins the list', add.status === 201 && t?.list === 'school' && t.due === addD(D, 3) && t.priority === 1 && t.repeat?.unit === 'week' && t.repeat.days.join() === '0,3' && t.tags?.[0] === 'lab', JSON.stringify(t));
  check('making it twice is refused', (await dav('PUT', `${school}new-1.ics`, vtodo('new-1', ['SUMMARY:x']), { 'if-none-match': '*' })).status === 412);
  await dav('PUT', `${school}sub-9.ics`, vtodo('sub-9', ['SUMMARY:Write the method', 'RELATED-TO:new-1']), { 'content-type': 'text/calendar' });
  t = (await api.get('inbox')).value.items.find((x) => x.id === 'new-1');
  check('a subtask made in an app joins its task', t.steps?.some((s) => s.id === 'sub-9' && s.text === 'Write the method'));
  // done in an app that does not roll repeating tasks on: it comes back on its next date
  const inboxHref = `${home}inbox/`;
  const w = await (await dav('GET', `${inboxHref}a2.ics`)).text();
  await dav('PUT', `${inboxHref}a2.ics`, w.replace(/STATUS:[A-Z-]+/, 'STATUS:COMPLETED').replace('END:VTODO', `COMPLETED:${D.replace(/-/g, '')}T090000Z\r\nEND:VTODO`), { 'content-type': 'text/calendar' });
  t = (await api.get('inbox')).value.items.find((x) => x.id === 'a2');
  check('a repeating task completed in an app comes back in 2 days', !t.done && t.due === addD(D, 2) && t.doneCount === 1, JSON.stringify(t));
  await dav('PUT', `${school}a1.ics`, (await (await dav('GET', `${school}a1.ics`)).text()).replace(/STATUS:[A-Z-]+/, 'STATUS:COMPLETED'), { 'content-type': 'text/calendar' });
  t = (await api.get('inbox')).value.items.find((x) => x.id === 'a1');
  check('a one-off completed in an app is done', t.done && t.doneAt === D);
  check('not a task: refused', (await dav('PUT', `${school}ev.ics`, 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:ev\r\nEND:VEVENT\r\nEND:VCALENDAR')).status === 415);

  check('deleting a subtask takes it from its task', (await dav('DELETE', `${school}sub-9.ics`)).status === 204 && !(await api.get('inbox')).value.items.find((x) => x.id === 'new-1').steps?.length);
  check('deleting a task', (await dav('DELETE', `${school}new-1.ics`)).status === 204 && !(await api.get('inbox')).value.items.some((x) => x.id === 'new-1'));

  // ---------- lists ----------
  check('a list made in an app', (await dav('MKCALENDAR', `${home}errands/`, '<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>Errands</d:displayname><ic:calendar-color>#C0392BFF</ic:calendar-color></d:prop></d:set></c:mkcalendar>')).status === 201
    && (await api.get('inbox')).value.lists.some((l) => l.id === 'errands' && l.name === 'Errands' && l.color === 'red'));
  await dav('PROPPATCH', `${home}errands/`, '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>Shopping</d:displayname></d:prop></d:set></d:propertyupdate>');
  check('renamed in an app', (await api.get('inbox')).value.lists.find((l) => l.id === 'errands').name === 'Shopping');
  check('the first list cannot be deleted', (await dav('DELETE', inboxHref)).status === 403);
  check('another list can', (await dav('DELETE', `${home}errands/`)).status === 204 && !(await api.get('inbox')).value.lists.some((l) => l.id === 'errands'));

  // ---------- others ----------
  const api2 = await demoAccount(client(srv.url), { lang: 'tr' });
  const other = (await api2.call('/api/account')).body;
  check('another account’s calendars are closed', (await dav('PROPFIND', `/dav/calendars/${other.id}/`, '', { depth: '1' })).status === 403);
  const revoke = made.body.passwords[0].id;
  await api.call(`/api/account/app-passwords/${revoke}`, undefined, 'DELETE');
  check('a revoked password stops working', (await dav('PROPFIND', '/dav/', '', { depth: '0' })).status === 401);

  // ---------- the link to a "Nextcloud": the second account, through this server's own /dav/ ----------
  const nc = (await api2.call('/api/account/app-passwords', { name: 'Planner sync' })).body.password;
  const ncInbox = async () => (await api2.get('inbox')).value ?? { items: [] };
  const mine = async () => (await api.get('inbox')).value;
  const syncA = async () => (await api.call('/api/account/nextcloud/sync', {})).body;
  const bad = await api.call('/api/account/nextcloud', { url: `${srv.url}/`, username: other.email, password: 'wrong-password' }, 'PUT');
  check('a wrong Nextcloud password is said so', bad.status === 400 && bad.body.error === 'auth', JSON.stringify(bad.body));
  const linked = await api.call('/api/account/nextcloud', { url: `${srv.url}/`, username: other.email, password: nc }, 'PUT');
  check('linked: found through /.well-known/caldav, first sync done', linked.status === 200 && !linked.body.error && linked.body.lists >= 2, JSON.stringify(linked.body));
  let there = await ncInbox();
  check('each list became a calendar there', there.lists?.some((l) => l.id === 'sc-school' && l.name === 'School' && l.color === 'green') && there.lists.some((l) => l.id === 'sc-inbox'));
  check('with its tasks and subtasks', there.items.some((x) => x.id === 'a1' && x.list === 'sc-school' && x.done) && there.items.some((x) => x.id === 'a2' && x.repeat?.every === 2));
  check('their calendar of tasks became a list here', (await mine()).lists.some((l) => l.name === 'Gelen kutusu'));

  // changed there -> here
  there = await ncInbox();
  await api2.put('inbox', { ...there, items: there.items.map((x) => (x.id === 'a2' ? { ...x, text: 'Water the plants and the herbs', priority: 5 } : x)) });
  await api2.put('inbox', { ...(await ncInbox()), items: [...(await ncInbox()).items, { id: 'nc-1', text: 'Made in Nextcloud', done: false, list: 'sc-school', due: addD(D, 1) }] });
  await syncA();
  let here = await mine();
  check('a change made there comes here', here.items.find((x) => x.id === 'a2')?.text === 'Water the plants and the herbs' && here.items.find((x) => x.id === 'a2').priority === 5);
  check('a task made there comes into the right list', here.items.find((x) => x.id === 'nc-1')?.list === 'school');

  // changed here -> there
  await api.put('inbox', { ...here, items: [...here.items.map((x) => (x.id === 'nc-1' ? { ...x, notes: 'from the planner' } : x)), { id: 'pl-1', text: 'Made in the planner', done: false, created: new Date().toISOString() }] });
  await syncA();
  there = await ncInbox();
  check('a change made here goes there', there.items.find((x) => x.id === 'nc-1')?.notes === 'from the planner');
  check('a task made here goes there', there.items.find((x) => x.id === 'pl-1')?.list === 'sc-inbox');

  // both changed: the planner's version wins
  await api2.put('inbox', { ...there, items: there.items.map((x) => (x.id === 'pl-1' ? { ...x, text: 'Their words' } : x)) });
  here = await mine();
  await api.put('inbox', { ...here, items: here.items.map((x) => (x.id === 'pl-1' ? { ...x, text: 'Our words' } : x)) });
  await syncA();
  check('both changed: this planner’s version wins on both sides', (await mine()).items.find((x) => x.id === 'pl-1')?.text === 'Our words' && (await ncInbox()).items.find((x) => x.id === 'pl-1')?.text === 'Our words');

  // deleted on one side
  there = await ncInbox();
  await api2.put('inbox', { ...there, items: there.items.filter((x) => x.id !== 'nc-1') });
  here = await mine();
  await api.put('inbox', { ...here, items: here.items.filter((x) => x.id !== 'pl-1') });
  await syncA();
  check('deleted there: deleted here', !(await mine()).items.some((x) => x.id === 'nc-1'));
  check('deleted here: deleted there', !(await ncInbox()).items.some((x) => x.id === 'pl-1'));

  // nothing changed: nothing moves
  const v1 = (await api.get('inbox')).version, v2 = (await api2.get('inbox')).version;
  await syncA();
  check('a sync with nothing new writes nothing', (await api.get('inbox')).version === v1 && (await api2.get('inbox')).version === v2);

  // a list made here becomes a calendar there; deleted here, its calendar goes too
  here = await mine();
  await api.put('inbox', { ...here, lists: [...here.lists, { id: 'trip', name: 'Trip' }], items: [...here.items, { id: 'tr-1', text: 'Passport', done: false, list: 'trip' }] });
  await syncA();
  check('a new list here: a new calendar there', (await ncInbox()).items.some((x) => x.id === 'tr-1' && x.list === 'sc-trip'));
  here = await mine();
  await api.put('inbox', { ...here, lists: here.lists.filter((l) => l.id !== 'trip'), items: here.items.filter((x) => x.list !== 'trip') });
  await syncA();
  check('deleted here: its calendar there goes too', !(await ncInbox()).lists.some((l) => l.id === 'sc-trip'));

  // a calendar deleted there: its list goes here too
  here = await mine();
  await api.put('inbox', { ...here, lists: [...here.lists, { id: 'gym', name: 'Gym' }], items: [...here.items, { id: 'gy-1', text: 'Leg day', done: false, list: 'gym' }] });
  await syncA();
  there = await ncInbox();
  await api2.put('inbox', { ...there, lists: there.lists.filter((l) => l.id !== 'sc-gym'), items: there.items.filter((x) => x.list !== 'sc-gym') });
  await syncA();
  check('a calendar deleted there: its list goes here', !(await mine()).lists.some((l) => l.id === 'gym') && !(await mine()).items.some((x) => x.id === 'gy-1'));

  // ---------- in Settings ----------
  {
    const browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' });
    await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.url}/settings/account`);
    await page.locator('#a-dav').waitFor({ timeout: 8000 });
    check('Settings shows the address and the user name for task apps', (await page.locator('.dav-facts').textContent()).includes('/dav/') && (await page.locator('.dav-facts').textContent()).includes(email));
    await page.locator('#a-dav-name').fill('Tablet');
    await page.getByRole('button', { name: 'Make an app password' }).click();
    const shownPw = (await page.locator('.dav-pw code').textContent({ timeout: 5000 })).trim();
    const works = await fetch(`${srv.url}/dav/`, { method: 'PROPFIND', headers: { depth: '0', authorization: auth(shownPw) } });
    check('an app password made there is shown once and works', /^[a-z2-9-]{23}$/.test(shownPw) && works.status === 207);
    check('the Nextcloud link shows where it is linked', (await page.locator('section[aria-labelledby="a-nc"]').textContent()).includes('Linked to'));
    await page.getByRole('button', { name: 'Sync now' }).click();
    await page.getByRole('button', { name: 'Sync now' }).waitFor({ timeout: 8000 });
    check('Sync now runs from Settings', !(await page.locator('section[aria-labelledby="a-nc"]').locator('.err-line').count()));
    await page.screenshot({ path: process.env.SHOT ?? 'NUL' }).catch(() => {});
    check('no errors on the settings page', !errors.length, errors.join(' | '));
    await browser.close();
  }

  const st = (await api.call('/api/account/nextcloud')).body;
  check('the link tells when it last synced, no error', !!st.lastSync && !st.error, JSON.stringify(st));
  await api.call('/api/account/nextcloud', undefined, 'DELETE');
  check('unlinked', (await api.call('/api/account/nextcloud')).body === null);
} finally {
  srv.stop();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
