// A part of a screen that cannot load says so and offers a retry; it is not shown as empty or as "not connected".
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';

const s = await startServer(), api = await demoAccount(client(s.url), { lang: 'en' }), b = await launch();
const c = await b.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
await c.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: s.url }]);
const p = await c.newPage();
const check = (ok, label) => { if (!ok) throw Error('FAIL ' + label); console.log('PASS ' + label); };
const day = new Date(); day.setHours(12, 0, 0, 0);
const week = weekOf(iso(day));

// `fail` toggles: the matching requests answer 503 (or break the connection) until turned off
const fail = { review: true, apps: true, nextcloud: true, backups: true, mode: '503' };
const answer = (key) => (route) => (fail[key] ? (fail.mode === 'net' ? route.abort('failed') : route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' })) : route.continue());
await p.route('**/api/review/*', answer('review'));
await p.route('**/api/account/app-passwords', answer('apps'));
await p.route('**/api/account/nextcloud', answer('nextcloud'));
await p.route('**/api/admin/backups', answer('backups'));

try {
  for (const mode of ['503', 'net']) {
    fail.mode = mode; fail.review = fail.apps = fail.nextcloud = fail.backups = true;
    // ---- week review
    await p.goto(`${s.url}/review/${week}`); await p.locator('.title-row').waitFor();
    await p.locator('[role=alert]', { hasText: 'Could not load' }).waitFor();
    check(await p.locator('.wr-stats').count() === 0 && await p.locator('.skeleton').count() === 0, `${mode}: week review shows the error, not a skeleton or numbers`);
    fail.review = false;
    await p.getByRole('button', { name: 'Retry' }).click();
    await p.locator('.wr-stats').waitFor();
    check(await p.locator('[role=alert]').count() === 0, `${mode}: week review loads after Retry and the error is gone`);

    // ---- task apps and Nextcloud (account tab)
    await p.goto(`${s.url}/settings/account`);
    await p.locator('#a-dav').waitFor(); await p.locator('#a-nc').waitFor();
    const apps = p.locator('section[aria-labelledby="a-dav"]'), nc = p.locator('section[aria-labelledby="a-nc"]');
    await apps.locator('[role=alert]').waitFor(); await nc.locator('[role=alert]').waitFor();
    check(await apps.locator('.dav-facts').count() === 0 && await nc.locator('#a-nc-url').count() === 0, `${mode}: task apps and Nextcloud show the error, not an empty list or the link form`);
    fail.apps = fail.nextcloud = false;
    await apps.getByRole('button', { name: 'Retry' }).click(); await apps.locator('.dav-facts').waitFor();
    await nc.getByRole('button', { name: 'Retry' }).click(); await nc.locator('#a-nc-url').waitFor();
    check(await apps.locator('[role=alert]').count() === 0 && await nc.locator('[role=alert]').count() === 0, `${mode}: both load after Retry`);

    // ---- backups (server tab, owner)
    await p.goto(`${s.url}/settings/server`);
    const bk = p.locator('section[aria-labelledby="s-backup"]');
    await bk.locator('[role=alert]').waitFor();
    check(await bk.getByRole('button', { name: 'Make a backup now' }).count() === 0 && await bk.locator('.muted').count() === 0, `${mode}: backups show the error, not "no backups yet"`);
    fail.backups = false;
    await bk.getByRole('button', { name: 'Retry' }).click();
    await bk.locator('.row-actions').waitFor();
    check(await bk.locator('[role=alert]').count() === 0, `${mode}: backups load after Retry`);
  }
} finally { await b.close(); s.stop(); }
