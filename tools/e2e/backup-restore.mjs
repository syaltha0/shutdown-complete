// Real account/API writes, whole-server backup, offline CLI restore into an empty directory.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createECDH, createHmac, createHash, randomBytes } from 'node:crypto';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';

const root = mkdtempSync(join(tmpdir(), 'planner-recovery-'));
const servers = [];
let browser;
function totp(secret) {
  const bits = [...secret].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(counter).digest(), offset = h[19] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const start = async (dataDir) => { const s = await startServer({ dataDir, env: { CALENDAR_ALLOW_PRIVATE: 'on' } }); servers.push(s); return s; };
const ok = (r) => { assert.equal(r.status, 200); return r.body; };
const cli = (file, target) => spawnSync(process.execPath, ['server/src/cli.mjs', 'restore-new', file, target], { encoding: 'utf8' });
// Read-only independent comparison: no direct database seeding or authentication bypass.
function snapshot(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  try { return Object.fromEntries(d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => [name, d.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()])); }
  finally { d.close(); }
}
try {
  const source = await start(join(root, 'source'));
  const remote = await start(join(root, 'remote'));
  const a = await demoAccount(client(source.url));
  const b = await demoAccount(client(source.url), { lang: 'tr' });
  const nc = await demoAccount(client(remote.url));
  const password = ok(await nc.call('/api/account/app-passwords', { name: 'Recovery remote' })).password;
  ok(await a.call('/api/account/nextcloud', { url: remote.url, username: 'robin@hale.test', password }, 'PUT'));
  const appPassword = ok(await a.call('/api/account/app-passwords', { name: 'Recovery phone' })).password;
  const feed = ok(await a.call('/api/account/calendar-feed', { timezone: 'Europe/Istanbul', tasks: true }));
  const settings = (await a.get('settings')).value;
  await a.put('settings', { ...settings, calendars: [{ id: 'subscription', name: 'Calendar', url: remote.url + '/calendar.ics' }] });
  await a.put('inbox', { lists: [{ id: 'inbox', name: 'Inbox' }], items: [{ id: 'keep', text: 'Keep me', done: false }], trash: [{ item: { id: 'trash', text: 'Recover me' }, deletedAt: new Date().toISOString() }], filters: [{ id: 'filter', name: 'Saved', query: 'Keep' }] });
  await a.put('boards', { boards: [{ id: 'board', name: 'Project', columns: [{ id: 'todo', name: 'To do', items: [{ id: 'card', text: 'Card' }] }] }] });
  const secret = ok(await b.call('/api/account/totp/start', {})).secret;
  const recovery = ok(await b.call('/api/account/totp/enable', { code: totp(secret) })).recoveryCodes;
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/recovery-test';
  ok(await a.call('/api/push', { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }, timeZone: 'Europe/Istanbul' }));
  const idA = ok(await a.call('/api/account')).id;
  ok(await a.call('/api/friends', { email: 'deniz@kuzey.test' }));
  ok(await b.call(`/api/friends/${idA}/accept`, {}));
  const team = ok(await a.call('/api/teams', { name: 'Recovery project' }));
  ok(await a.call(`/api/teams/${team.id}/members`, { id: ok(await b.call('/api/account')).id }));
  const teams = ok(await a.call('/api/teams'));
  ok(await a.call('/api/rooms', { minutes: 25, label: 'Recovery room' }));
  browser = await launch();
  const ctx = await browser.newContext({ locale: 'en-GB' });
  await ctx.addCookies([{ name: 'sc_session', value: a.cookie.split('=')[1], url: source.url }]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(source.url + '/settings/account');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await page.getByText('Passkey added.').waitFor({ timeout: 10000 });
  const passkeys = ok(await a.call('/api/account/passkeys'));
  assert.equal(passkeys.length, 1);
  const accounts = [a, b];
  const exports = await Promise.all(accounts.map(async (api) => ok(await api.call('/api/export')).docs));
  const made = ok(await a.call('/api/admin/backups', {}));
  const name = made.list.find(x => x.kind === 'manual').name;
  const file = join(source.dir, 'backups', name);
  const target = join(root, 'restored');
  assert.equal(cli(file, target).status, 0, 'CLI recovery succeeds');
  assert.notEqual(cli(file, target).status, 0, 'CLI refuses existing destination');
  const copy = snapshot(join(target, 'planner.db'));
  const unpacked = join(root, 'expected.db');
  writeFileSync(unpacked, gunzipSync(readFileSync(file)), { mode: 0o600 });
  const expected = snapshot(unpacked);
  assert.deepEqual(Object.keys(copy), Object.keys(expected));
  for (const name of Object.keys(expected)) {
    // Never let assertion diagnostics dump authentication material on a failing run.
    const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    assert.equal(digest(copy[name]), digest(expected[name]), `all rows match in ${name}`);
  }
  assert.ok(copy.meta.some(x => x.key === 'dav_key'));
  // Corrupt archives and unsupported schema versions must fail without installing a database.
  const bad = join(root, 'bad.gz'); writeFileSync(bad, 'invalid');
  assert.notEqual(cli(bad, join(root, 'bad-target')).status, 0);
  assert.equal(existsSync(join(root, 'bad-target', 'planner.db')), false);
  const future = new DatabaseSync(unpacked); future.exec('PRAGMA user_version=999'); future.close();
  writeFileSync(bad, gzipSync(readFileSync(unpacked)));
  assert.notEqual(cli(bad, join(root, 'future-target')).status, 0);
  assert.equal(existsSync(join(root, 'future-target', 'planner.db')), false);
  const missingKey = new DatabaseSync(unpacked);
  missingKey.exec("PRAGMA user_version=0; DELETE FROM meta WHERE key='dav_key'"); missingKey.close();
  writeFileSync(bad, gzipSync(readFileSync(unpacked)));
  assert.notEqual(cli(bad, join(root, 'missing-key-target')).status, 0, 'encrypted links without their key must be rejected');
  console.log('PASS full database equality; corrupt/future backup rejection; existing target protection');
  const restored = await start(target);
  for (const [i, email] of ['robin@hale.test', 'deniz@kuzey.test'].entries()) {
    const api = client(restored.url);
    const login = ok(await api.call('/api/auth/login', { email, password: 'Demo-password-1' }));
    if (i === 1) {
      assert.equal(login.twoFactor, true);
      ok(await api.call('/api/auth/login/2fa', { ticket: login.ticket, code: recovery[0] }));
    }
    assert.deepEqual(ok(await api.call('/api/export')).docs, exports[i], 'all account documents match through API');
  }
  const api = client(restored.url);
  ok(await api.call('/api/auth/login', { email: 'robin@hale.test', password: 'Demo-password-1' }));
  assert.deepEqual(ok(await api.call('/api/account/passkeys')), passkeys);
  assert.equal(ok(await api.call('/api/push?endpoint=' + encodeURIComponent(endpoint))).subscribed, true);
  assert.equal(ok(await api.call('/api/friends')).friends.length, 1);
  assert.deepEqual(ok(await api.call('/api/teams')), teams);
  await ctx.clearCookies();
  await page.goto(restored.url + '/login');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.waitForURL(restored.url + '/', { timeout: 10000 });
  assert.equal((await fetch(restored.url + '/dav/', { method: 'PROPFIND', headers: { authorization: `Basic ${Buffer.from('robin@hale.test:' + appPassword).toString('base64')}`, depth: '0' } })).status, 207);
  assert.equal((await fetch(restored.url + feed.path)).status, 200);
  const synced = ok(await api.call('/api/account/nextcloud/sync', {}));
  assert.ok(!synced.error, 'encrypted remote credentials decrypt and authenticate after recovery');
  console.log('PASS two accounts, documents, CalDAV, ICS, Nextcloud, active 2FA recovery, passkey sign-in, push and friends');
} finally {
  await browser?.close();
  for (const s of servers) s.stop();
  await Promise.all(servers.map(s => s.exited));
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
