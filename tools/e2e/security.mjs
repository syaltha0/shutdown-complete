// Security checks against a real server: sign-in limits that a header cannot get around, two-step brute force, request
// sizes, response headers and the content policy in a browser, cookies, cross-site requests, other accounts' data,
// calendar addresses that point inside the network. Run after `npm run build`.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { base32Decode } from '../../server/src/auth.mjs';

let count = 0;
const check = (name, ok, extra) => { assert.ok(ok, name + (extra ? ` ${extra}` : '')); count++; console.log('PASS ' + name); };
const PW = 'Demo-password-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const totp = (secret, now = Date.now()) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest(), o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
};
// a server that turns a body away may hang up while the client is still sending it: that counts as refused too
const status = async (p) => { try { return (await p).status; } catch { return 413; } finally { await sleep(1000); } };
const raw = (srv, path, { method = 'GET', headers = {}, body, cookie } = {}) =>
  fetch(srv.url + path, { method, headers: { ...(cookie ? { cookie } : {}), ...headers }, body, redirect: 'manual' });

const srv = await startServer();
const owner = client(srv.url);
let browser;
try {
  // ---------- accounts: an owner, and two ordinary people ----------
  check('the first account is made', (await owner.call('/api/auth/setup', { email: 'owner@sec.test', password: PW, signupMode: 'open' })).status === 200);
  const forms = [];
  for (let i = 0; i < 2; i++) forms.push((await client(srv.url).call('/api/auth/state')).body.form);
  await sleep(3200);
  const ann = client(srv.url), bob = client(srv.url);
  for (const [who, email, form] of [[ann, 'ann@sec.test', forms[0]], [bob, 'bob@sec.test', forms[1]]]) {
    assert.equal((await who.call('/api/auth/register', { email, password: PW, form, website: '' })).status, 200);
  }

  // ---------- 1. sign-in limits cannot be skipped by writing the client address ----------
  const login = (email, headers = {}) => fetch(srv.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ email, password: 'nope' }) });
  let limited = 0;
  for (let i = 0; i < 30; i++) {
    const r = await login(`ghost${i}@sec.test`, { 'x-forwarded-for': `6.6.${i}.${i}, 198.51.100.77` });
    if (r.status === 429) limited++;
  }
  check('changing the first X-Forwarded-For entry does not give a new sign-in allowance', limited >= 8, `limited=${limited}`);
  check('the same applies to the app-password limit of CalDAV', await (async () => {
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const r = await raw(srv, '/dav/', { method: 'PROPFIND', headers: { authorization: `Basic ${Buffer.from(`ann@sec.test:wrongwrongwrongwrongwrong${i}`).toString('base64')}`, 'x-forwarded-for': `7.7.${i}.1, 198.51.100.78` } });
      if (r.status === 429) n++;
    }
    return n > 0;
  })());
  // the error is the same whether or not an account exists
  const wrong1 = await (await login('ann@sec.test', { 'x-forwarded-for': '198.51.100.90' })).json();
  const wrong2 = await (await login('nobody-here@sec.test', { 'x-forwarded-for': '198.51.100.91' })).json();
  check('a wrong password and an unknown account get the same answer', wrong1.error === 'wrong' && wrong2.error === 'wrong');
  const forgot = async (email) => { const r = await raw(srv, '/api/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.92' }, body: JSON.stringify({ email }) }); return [r.status, await r.json()]; };
  check('password reset says the same for known and unknown addresses', JSON.stringify(await forgot('ann@sec.test')) === JSON.stringify(await forgot('who@sec.test')));

  // ---------- 2. two-step sign-in cannot be guessed at ----------
  const start = (await ann.call('/api/account/totp/start', {})).body;
  check('two-step sign-in is turned on', (await ann.call('/api/account/totp/enable', { code: totp(start.secret) })).status === 200);
  const fresh = async () => { const r = await (await fetch(srv.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.50' }, body: JSON.stringify({ email: 'ann@sec.test', password: PW }) })).json(); return r.ticket; };
  const try2fa = async (ticket, code) => (await fetch(srv.url + '/api/auth/login/2fa', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.9.${Math.floor(Math.random() * 250)}.1, 198.51.100.51` }, body: JSON.stringify({ ticket, code }) })).status;
  const ticket = await fresh();
  const wrongCodes = [];
  const bad = String((Number(totp(start.secret)) + 1) % 1e6).padStart(6, '0');
  for (let i = 0; i < 5; i++) wrongCodes.push(await try2fa(ticket, bad));
  check('five wrong codes are answered as wrong', wrongCodes.every((s) => s === 401), wrongCodes.join());
  check('a ticket stops taking codes after five tries, even the right one', (await try2fa(ticket, totp(start.secret))) === 429 && (await try2fa(ticket, totp(start.secret))) === 410);
  check('a new ticket works with the right code', (await try2fa(await fresh(), totp(start.secret, Date.now() + 30000))) === 200);

  // ---------- 3. request sizes ----------
  const big = JSON.stringify({ value: { a: 'x'.repeat(2 * 1024 * 1024) }, version: 0 });
  check('a 2 MB document is refused before it is read', (await status(ann.call('/api/doc/settings', JSON.parse(big), 'PUT'))) === 413);
  check('so is a 2 MB body to the public sign-in', (await status(fetch(srv.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big }))) === 413);
  const pw = (await ann.call('/api/account/app-passwords', { name: 'sec' })).body.password;
  const dav = (path, method, body) => raw(srv, path, { method, body, headers: { authorization: `Basic ${Buffer.from(`ann@sec.test:${pw}`).toString('base64')}`, 'x-forwarded-for': '198.51.100.60' } });
  const annId = (await ann.call('/api/account')).body.id, bobId = (await bob.call('/api/account')).body.id;
  check('a 3 MB CalDAV body is refused', (await status(dav(`/dav/calendars/${annId}/inbox/x.ics`, 'PUT', 'x'.repeat(3 * 1024 * 1024)))) === 413);
  check('a CalDAV question of 100 KB is not an app question', (await dav(`/dav/calendars/${annId}/`, 'PROPFIND', '<prop '.repeat(17_000))).status === 413);
  check('a normal PROPFIND is still answered', (await dav(`/dav/calendars/${annId}/`, 'PROPFIND', '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>')).status === 207);
  check('a normal document is still accepted', (await ann.call('/api/doc/settings', { value: { a: 'x' }, version: 0 }, 'PUT')).status === 200);

  // ---------- 4. headers, cookies, cross-site ----------
  const home = await raw(srv, '/'), csp = home.headers.get('content-security-policy') || '';
  const html = await home.text();
  check('the page has a content policy that forbids framing and other people\'s scripts', /frame-ancestors 'none'/.test(csp) && /script-src 'self' 'sha256-/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp));
  check('the other headers are there', home.headers.get('x-content-type-options') === 'nosniff' && home.headers.get('referrer-policy') === 'same-origin' && home.headers.get('x-frame-options') === 'DENY');
  check('plain http gets no HSTS, a proxied https request does', !home.headers.has('strict-transport-security') && (await raw(srv, '/', { headers: { 'x-forwarded-proto': 'https' } })).headers.has('strict-transport-security'));
  const state = await raw(srv, '/api/auth/state');
  check('API answers are not stored', state.headers.get('cache-control') === 'no-store');
  const cors = await raw(srv, '/api/auth/state', { headers: { origin: 'https://evil.example' } });
  check('no other site is let in by CORS', !cors.headers.has('access-control-allow-origin'));
  const pre = await raw(srv, '/api/doc/settings', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' } });
  check('a preflight from another site gets no permission', !pre.headers.has('access-control-allow-origin'));
  const cookie = (await raw(srv, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bob@sec.test', password: PW }) })).headers.get('set-cookie') || '';
  check('the session cookie is HttpOnly and SameSite=Lax', /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie));
  const evil = await raw(srv, '/api/account/password', { method: 'POST', cookie: ann.cookie, headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ current: PW, password: 'Another-pass-9' }) });
  check('a change asked for from another site is refused', evil.status === 403 && (await evil.json()).error === 'origin');
  check('a change from the planner\'s own site is not', (await raw(srv, '/api/account', { method: 'PATCH', cookie: ann.cookie, headers: { 'content-type': 'application/json', origin: srv.url }, body: JSON.stringify({ name: 'Ann' }) })).status === 200);
  const out = client(srv.url); out.cookie = bob.cookie;
  await out.call('/api/auth/logout', {});
  check('signing out ends the session on the server too', (await raw(srv, '/api/account', { cookie: bob.cookie })).status === 401);

  // ---------- 5. other people's data ----------
  const bob2 = client(srv.url); await bob2.call('/api/auth/login', { email: 'bob@sec.test', password: PW });
  await ann.put('day:2026-11-13', { columns: [], tasks: [{ id: 't', text: 'ann-private', done: false }] });
  check('another account reads its own day, not the one of someone else', (await bob2.get('day:2026-11-13')).value === null);
  check('and does not find it in its export', !JSON.stringify((await bob2.call('/api/export')).body).includes('ann-private'));
  const teamId = (await ann.call('/api/teams', { name: 'Ann only' })).body.id;
  check('a team project is closed to someone who is not in it', (await bob2.call(`/api/doc/team:${teamId}`)).status === 404 && (await bob2.call(`/api/doc/team:${teamId}`, { value: { x: 1 }, version: 1 }, 'PUT')).status === 404 && (await bob2.call('/api/teams')).body.length === 0);
  check('nor can they add themselves or delete it', (await bob2.call(`/api/teams/${teamId}/members`, { id: bobId })).status === 404 && (await bob2.call(`/api/teams/${teamId}`, undefined, 'DELETE')).status === 404);
  check('the owner\'s settings are for the owner only', (await bob2.call('/api/admin/state')).status === 403 && (await bob2.call('/api/admin/invites', { days: 1 })).status === 403 && (await bob2.call('/api/admin/backups')).status === 403 && (await bob2.call('/api/admin/password-policy', { policy: 'basic' }, 'PUT')).status === 403);
  const annAuth = { authorization: `Basic ${Buffer.from(`ann@sec.test:${pw}`).toString('base64')}`, 'x-forwarded-for': '198.51.100.61' };
  check('an app password does not open another account\'s calendars', (await raw(srv, `/dav/calendars/${bobId}/`, { method: 'PROPFIND', headers: annAuth })).status === 403 && (await raw(srv, `/dav/calendars/${annId}/`, { method: 'PROPFIND', headers: annAuth })).status === 207);
  check('an app password is not an account password', (await fetch(srv.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.62' }, body: JSON.stringify({ email: 'ann@sec.test', password: pw }) })).status === 401);
  check('the API wants a session', (await raw(srv, '/api/doc/settings')).status === 401 && (await raw(srv, '/api/admin/state')).status === 401);
  const room = (await ann.call('/api/rooms', { minutes: 25, invite: [] })).body;
  check('a shared session cannot be joined without an invitation', (await bob2.call(`/api/rooms/${room.id}/join`, {})).status === 404);

  // ---------- 6. an address inside the network is not fetched ----------
  let hits = 0;
  const inner = createServer((req, res) => { hits++; res.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'); });
  await new Promise((r) => inner.listen(0, '127.0.0.1', r));
  const port = inner.address().port;
  for (const u of [`http://127.0.0.1:${port}/a.ics`, `http://[::ffff:127.0.0.1]:${port}/a.ics`, `http://[::ffff:7f00:1]:${port}/a.ics`, `http://localhost:${port}/a.ics`, `http://[::1]:${port}/a.ics`]) {
    const r = await bob2.call('/api/calendar/check', { url: u });
    check(`a calendar address is refused: ${u.replace(/:\d{4,5}\//, ':PORT/')}`, r.status === 400 && /private|unreachable/.test(r.body.error), JSON.stringify(r.body));
  }
  const link = await bob2.call('/api/account/nextcloud', { url: `http://[::ffff:7f00:1]:${port}/`, username: 'u', password: 'p' }, 'PUT');
  check('an ordinary account cannot link a Nextcloud inside the network either', link.status === 400, JSON.stringify(link.body));
  check('and nothing reached the machine', hits === 0, `hits=${hits}`);
  inner.close();

  // ---------- 7. the content policy does not break the screens ----------
  browser = await launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'sc_session', value: ann.cookie.split('=')[1], url: srv.url }]);
  const page = await ctx.newPage();
  const violations = [], failures = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', (e) => failures.push(e.message));
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.error('Refused to ' + e.violatedDirective + ' ' + e.blockedURI)); });
  const paths = ['/', '/week', '/month', '/inbox', '/boards', '/focus', '/habits', '/metrics', '/shutdown', '/settings', '/settings/account', '/settings/server', '/together', '/countdowns'];
  for (const p of paths) { await page.goto(srv.url + p, { waitUntil: 'networkidle' }).catch(() => {}); await sleep(250); }
  const anon = await browser.newContext(); const guest = await anon.newPage();
  guest.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await guest.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.error('Refused to ' + e.violatedDirective + ' ' + e.blockedURI)); });
  for (const p of ['/login', '/register', '/forgot']) { await guest.goto(srv.url + p, { waitUntil: 'networkidle' }).catch(() => {}); await sleep(250); }
  check('no screen is blocked by the content policy', violations.length === 0, violations.slice(0, 3).join(' | '));
  check('the theme script that runs first is allowed by its hash', await page.evaluate(() => !!document.documentElement.dataset.theme));
  const injected = await page.evaluate(() => { window.__x = 0; const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.append(s); return window.__x; });
  check('an injected inline script does not run', injected === 0);
  check('the app itself has no page errors', failures.length === 0, failures.slice(0, 2).join(' | '));

  // ---------- 8. dependencies ----------
  const hono = JSON.parse(readFileSync(new URL('../../node_modules/hono/package.json', import.meta.url), 'utf8')).version.split('.').map(Number);
  check('hono is past its middleware-skipping advisories (4.13.16 and later)', hono[0] > 4 || (hono[0] === 4 && (hono[1] > 13 || (hono[1] === 13 && hono[2] >= 16))), hono.join('.'));
  console.log(`all ${count} checks passed`);
} finally { await browser?.close(); srv.stop(); }

// ---------- 9. over HTTPS the cookie is Secure ----------
const tls = await startServer({ env: { COOKIE_SECURE: 'true' } });
try {
  const a = client(tls.url);
  const r = await fetch(tls.url + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'o@sec.test', password: PW, signupMode: 'invite' }) });
  check('with COOKIE_SECURE the session cookie is Secure', /;\s*Secure/i.test(r.headers.get('set-cookie') || ''));
  void a;
  console.log(`all ${count} checks passed`);
} finally { tls.stop(); }
