import { releaseChecker, storage, warnings } from './server-status.mjs';
import { feedStatus } from './calendar.mjs';
import { plannerIcs } from './publication.mjs';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { openDb } from './db.mjs';
import { pushService, validSubscription } from './push.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import {
  clearLimit, describeAgent, limited, newRecoveryCodes, newTotpSecret, otpauthUrl, passwordProblem, randomToken,
  sha256, useRecoveryCode, validEmail, verifyTotp,
} from './auth.mjs';
import { clientIp } from './net.mjs';
import { bodyLimits, securityHeaders } from './hardening.mjs';
import { socialRoutes } from './social.mjs';
import { teamRoutes } from './teams.mjs';
import { davRoutes } from './caldav.mjs';
import { davSync } from './davsync.mjs';
import { applyPendingRestore, backups } from './backup.mjs';
import { review, WEEK, weeklyMails } from './weekly.mjs';
import { mailEnabled, sendMail, sendApproved, sendInvite, sendPasswordChanged, sendRequest, sendReset, sendVerify, sendWaiting } from './mail.mjs';
import { b64url, newChallenge, verifyAssertion, verifyRegistration } from './webauthn.mjs';
import { eventsBetween, feedProblem, forgetFeed, loadFeed, parseFeed, RANGE_DAYS } from './calendar.mjs';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || resolve('data');
const STATIC_DIR = process.env.STATIC_DIR || resolve('client/dist');
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const COOKIE = 'sc_session';
const SHORT = 12 * 3600_000; // a session without "remember me": twelve hours from the last use
const LONG = 30 * 24 * 3600_000; // with "remember me": thirty days from the last use
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? (PROD ? 'true' : 'false')) === 'true';
const LANGS = new Set(['en', 'tr']);
// AGPL-3.0: people using a modified copy over a network must be offered its source. Point this at your fork.
const SOURCE_URL = process.env.SOURCE_URL || 'https://github.com/syaltha0/shutdown-complete';

// a restore asked for at the last run is put in place before the database opens (backup.mjs)
applyPendingRestore(DATA_DIR);
const db = openDb(resolve(DATA_DIR, 'planner.db'));
const bk = backups({ db, dataDir: DATA_DIR });
db.sessions.prune();
setInterval(() => db.sessions.prune(), 3600_000).unref();

// Keys an account may store.
const KEY = /^(day:\d{4}-\d{2}-\d{2}|week:\d{4}-W\d{2}|month:\d{4}-\d{2}|quarter:\d{4}-Q[1-4]|settings|inbox|boards)$/;

// Who may create an account: anyone ('open'), anyone but the owner approves each new account ('approve'), only
// people with an invite link ('invite'), or nobody ('closed'). An invite link works in every mode but 'closed', and
// an account made with one needs no approval.
const MODES = new Set(['open', 'approve', 'invite', 'closed']);
const signupMode = () => { const m = db.meta.get('signups', 'open'); return MODES.has(m) ? m : 'open'; };
/** The password rules: 'basic' (8 characters, a capital, a symbol) unless the owner chose 'strong' in Settings > Server. */
const passwordPolicy = () => (db.meta.get('password_policy', 'basic') === 'strong' ? 'strong' : 'basic');
const weakness = (pw, email, name) => passwordProblem(pw, email, name, passwordPolicy());
const signupsOpen = () => ['open', 'approve'].includes(signupMode());
// With sign-ups open, they can be kept to some e-mail domains (a company, a school); others then need an invite.
const DOMAIN = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const signupDomains = () => (db.meta.get('signup_domains', '') || '').split(',').filter(Boolean);
const domainsFrom = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/))
  .map((d) => String(d).trim().toLowerCase().replace(/^@+/, '')).filter((d) => DOMAIN.test(d)))].slice(0, 50);
const domainOk = (email) => {
  const list = signupDomains(), host = String(email).trim().toLowerCase().split('@')[1] || '';
  return !list.length || list.some((d) => host === d || host.endsWith(`.${d}`));
};

// Bots: a sign-up form carries a signed note of when it was handed out, and a field people never see. A form sent back
// within a few seconds, or with that field filled in, is not from a person. No third-party service is involved.
const FORM_MIN = 3000, FORM_MAX = 24 * 3600_000;
const formSecret = db.meta.get('form_secret') || (() => { const k = randomBytes(32).toString('hex'); db.meta.set('form_secret', k); return k; })();
const formSign = (ts) => createHmac('sha256', formSecret).update(`signup:${ts}`).digest('base64url');
const formToken = () => { const ts = Date.now(); return `${ts}.${formSign(ts)}`; };
/** null when the form looks human; otherwise why not ('too-fast' comes with how long to wait). */
function formProblem(b) {
  if (String(b.website || '').trim()) return { error: 'try-again' };
  const [ts, sig] = String(b.form || '').split('.');
  const t = Number(ts), want = formSign(t);
  if (!t || !sig || sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { error: 'try-again' };
  const age = Date.now() - t;
  if (age < FORM_MIN) return { error: 'too-fast', wait: FORM_MIN - age };
  if (age > FORM_MAX) return { error: 'try-again' };
  return null;
}
// A few lines from the owner, shown above the sign-up form ("This server is for our family", "Data stays at home").
const signupNote = () => db.meta.get('signup_note', '') || '';
const inviteOf = (token) => (token ? db.invites.valid(sha256(String(token))) : null);
const baseUrl = (c) => APP_URL || `${c.req.header('x-forwarded-proto') || (COOKIE_SECURE ? 'https' : 'http')}://${c.req.header('x-forwarded-host') || c.req.header('host')}`;
const lang = (l) => (LANGS.has(l) ? l : 'en');
const fail = (c, error, status = 400) => c.json({ error }, status);
const body = (c) => c.req.json().catch(() => ({}));

// ---------------- passkeys: the site they belong to, and short-lived challenges ----------------
const rpIdOf = (c) => (APP_URL ? new URL(APP_URL).hostname : (c.req.header('x-forwarded-host') || c.req.header('host') || 'localhost').replace(/:\d+$/, ''));
const originOf = (c) => (APP_URL ? new URL(APP_URL).origin : baseUrl(c));
const challenges = new Map(); // challenge -> { userId, until }
function rememberChallenge(userId = null) {
  const ch = newChallenge();
  challenges.set(ch, { userId, until: Date.now() + 5 * 60_000 });
  for (const [k, v] of challenges) if (v.until < Date.now() || challenges.size > 5000) challenges.delete(k);
  return ch;
}
function takeChallenge(clientDataB64) {
  try {
    const ch = JSON.parse(Buffer.from(clientDataB64 || '', 'base64url').toString('utf8')).challenge;
    const v = challenges.get(ch);
    challenges.delete(ch);
    return v && v.until > Date.now() ? { challenge: ch, ...v } : null;
  } catch { return null; }
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, verified: !!u.email_verified,
    totp: !!u.totp_enabled, recoveryLeft: u.totp_enabled ? JSON.parse(u.recovery || '[]').length : 0, mustChange: u.must_change || 0,
  };
}

function startSession(c, user, remember) {
  const token = randomToken();
  const ttl = remember ? LONG : SHORT;
  db.sessions.create({
    id: randomUUID(), tokenHash: sha256(token), userId: user.id, remember,
    expiresAt: new Date(Date.now() + ttl).toISOString(), ua: (c.req.header('user-agent') || '').slice(0, 300), ip: clientIp(c),
  });
  // without "remember me" the cookie ends with the browser session as well
  setCookie(c, COOKIE, token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Lax', path: '/', ...(remember ? { maxAge: LONG / 1000 } : {}) });
}

/** The signed-in account and session, or null. Sliding expiry: every use extends the session. */
function current(c) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const s = db.sessions.byHash(sha256(token));
  if (!s || s.expires_at < new Date().toISOString()) return null;
  const user = db.users.byId(s.user_id);
  if (!user) return null;
  if (Date.now() - Date.parse(s.last_seen) > 60_000) {
    db.sessions.touch(s.id, new Date(Date.now() + (s.remember ? LONG : SHORT)).toISOString(), clientIp(c));
  }
  return { user, session: s };
}

const app = new Hono();

const headers = securityHeaders({ appUrl: APP_URL });
app.use('*', headers);
app.use('*', bodyLimits());

// Requests that change something must come from this site (a second line behind SameSite cookies).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin) {
      const host = c.req.header('x-forwarded-host') || c.req.header('host');
      const ok = (() => { try { const o = new URL(origin); return o.host === host || (APP_URL && o.origin === new URL(APP_URL).origin); } catch { return false; } })();
      if (!ok) return fail(c, 'origin', 403);
    }
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

// The task lists over CalDAV for phone and desktop task apps (caldav.mjs); they sign in with app passwords.
app.all('/dav', (c) => c.redirect('/dav/', 301));
// The link to a Nextcloud (davsync.mjs); the owner may link one on this server's own network.
const syncer = davSync({ db, feedProblem: async (u, mayPrivate) => { const p = await feedProblem(u); return p === 'private' && mayPrivate ? null : p; }, log: (m) => console.log(`[nextcloud] ${m}`) });
const dav = davRoutes(app, { db, sha256, clientIp, onChange: (u) => syncer.schedule(u) });

// ---------------- sign-in and sign-up ----------------

app.get('/api/auth/state', (c) => {
  const me = current(c);
  const mode = signupMode();
  // the owner sees a dot on Settings while accounts wait for approval or people ask for an invite
  const attention = me?.user.is_admin ? db.requests.count() + db.users.list().filter((u) => !u.approved).length : undefined;
  return c.json({ setup: db.users.count() === 0, signups: signupsOpen(), invites: mode === 'invite', approval: mode === 'approve', attention,
    domains: mode === 'open' ? signupDomains() : [], note: me ? undefined : signupNote() || undefined, form: me ? undefined : formToken(),
    policy: passwordPolicy(), mail: mailEnabled, source: SOURCE_URL, user: me ? publicUser(me.user) : null });
});

/**
 * Someone asks for an invite while sign-ups are by invitation. The same bot checks as a sign-up; the answer is the same
 * whether or not the address already has an account, so this cannot be used to find out who is here.
 */
app.post('/api/auth/request-invite', async (c) => {
  if (signupMode() !== 'invite') return fail(c, 'not-invite', 409);
  const b = await body(c);
  const bot = formProblem(b);
  if (bot) return c.json(bot, bot.error === 'too-fast' ? 425 : 400);
  if (limited(`request:${clientIp(c)}`, 5, 3600_000)) return fail(c, 'too-many', 429);
  if (!validEmail(b.email)) return fail(c, 'invalid-email');
  const email = String(b.email).trim().toLowerCase();
  if (!db.users.byEmail(email)) {
    db.requests.add(email, b.note, lang(b.lang));
    if (mailEnabled) {
      for (const a of db.users.list().filter((x) => x.is_admin)) await sendRequest(db.users.byId(a.id), email, String(b.note || '').trim().slice(0, 200), `${baseUrl(c)}/settings/server`);
    }
  }
  return c.json({ ok: true, mail: mailEnabled });
});

/** Whether an invite link can still be used (the sign-up page asks before showing its form). */
app.get('/api/auth/invite', (c) => {
  if (limited(`invite:${clientIp(c)}`, 30, 15 * 60_000)) return fail(c, 'too-many', 429);
  const inv = signupMode() !== 'closed' ? inviteOf(c.req.query('token')) : null;
  // an invite made for one address hands it to the form, which shows it filled in
  return c.json({ valid: !!inv, email: inv?.email || undefined });
});

/** The first account: the owner. It takes over the planner of the first version, if there is one. */
app.post('/api/auth/setup', async (c) => {
  if (db.users.count() > 0) return fail(c, 'done', 409);
  const b = await body(c);
  if (!validEmail(b.email)) return fail(c, 'invalid-email');
  // like a sign-up, the setup asks only for an address and a password; the name comes in the first-run setup
  b.name = String(b.name || '').trim().slice(0, 80) || String(b.email).trim().split('@')[0].slice(0, 80);
  const weak = weakness(b.password, b.email, b.name);
  if (weak) return fail(c, `weak-${weak}`);
  const user = db.users.create({ email: b.email, name: b.name, password: hashPassword(b.password), isAdmin: true, verified: true, lang: lang(b.lang) });
  // a new server takes only invited people until its owner chooses otherwise in Settings > Server
  db.meta.set('signups', MODES.has(b.signupMode) ? b.signupMode : 'invite');
  const claimed = db.claimLegacy(user.id);
  startSession(c, user, true);
  return c.json({ ok: true, claimed });
});

app.post('/api/auth/register', async (c) => {
  const mode = signupMode();
  if (mode === 'closed') return fail(c, 'signups-closed', 403);
  const b = await body(c);
  // turned-away bots and a person who was a moment too quick do not use up the hourly allowance
  const bot = formProblem(b);
  if (bot) return c.json(bot, bot.error === 'too-fast' ? 425 : 400);
  if (limited(`register:${clientIp(c)}`, 10, 3600_000)) return fail(c, 'too-many', 429);
  const invite = inviteOf(b.invite);
  if (mode === 'invite' && !invite) return fail(c, 'invite-invalid', 403);
  if (!validEmail(b.email)) return fail(c, 'invalid-email');
  // the sign-up form asks only for an address and a password; the name is asked in the first-run setup
  b.name = String(b.name || '').trim().slice(0, 80) || String(b.email).trim().split('@')[0].slice(0, 80);
  if (mode === 'open' && !invite && !domainOk(b.email)) return c.json({ error: 'domain', domains: signupDomains() }, 403);
  if (invite?.email && invite.email !== String(b.email).trim().toLowerCase()) return fail(c, 'invite-email', 403);
  const weak = weakness(b.password, b.email, b.name);
  if (weak) return fail(c, `weak-${weak}`);
  if (db.users.byEmail(b.email)) return fail(c, 'taken', 409);
  // the invite is spent when the account is made; a link used up a moment ago by someone else turns this one away
  if (invite && !db.invites.use(invite.id) && mode === 'invite') return fail(c, 'invite-invalid', 403);
  const approved = mode !== 'approve' || !!invite;
  const user = db.users.create({ email: b.email, name: b.name, password: hashPassword(b.password), verified: !mailEnabled, approved, lang: lang(b.lang) });
  if (!approved && mailEnabled) {
    for (const a of db.users.list().filter((x) => x.is_admin)) await sendWaiting(db.users.byId(a.id), `${user.name} <${user.email}>`, `${baseUrl(c)}/settings/server`);
  }
  if (mailEnabled) {
    const token = randomToken();
    db.tokens.create(sha256(token), 'verify', user.id, new Date(Date.now() + 24 * 3600_000).toISOString());
    await sendVerify(user, `${baseUrl(c)}/verify?token=${token}`);
    return c.json({ verify: true, pending: !approved });
  }
  db.requests.removeEmail(user.email);
  if (!approved) return c.json({ pending: true });
  startSession(c, user, true);
  return c.json({ ok: true });
});

app.post('/api/auth/verify', async (c) => {
  const b = await body(c);
  const t = db.tokens.take(sha256(b.token || ''), 'verify');
  if (!t) return fail(c, 'expired', 410);
  db.users.set(t.user_id, { email_verified: 1 });
  const u = db.users.byId(t.user_id);
  if (!u.approved) return c.json({ pending: true });
  startSession(c, u, true);
  return c.json({ ok: true });
});

app.post('/api/auth/resend', async (c) => {
  if (limited(`resend:${clientIp(c)}`, 5, 3600_000)) return fail(c, 'too-many', 429);
  const b = await body(c);
  const u = db.users.byEmail(b.email || '');
  if (mailEnabled && u && !u.email_verified) {
    db.tokens.clear(u.id, 'verify');
    const token = randomToken();
    db.tokens.create(sha256(token), 'verify', u.id, new Date(Date.now() + 24 * 3600_000).toISOString());
    await sendVerify(u, `${baseUrl(c)}/verify?token=${token}`);
  }
  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const b = await body(c);
  const email = String(b.email || '').trim().toLowerCase();
  if (limited(`login-ip:${clientIp(c)}`, 20, 15 * 60_000) || limited(`login:${email}`, 8, 15 * 60_000)) return fail(c, 'too-many', 429);
  const u = db.users.byEmail(email);
  // the same answer and roughly the same work whether or not the account exists
  const ok = verifyPassword(b.password || '', u?.password || 'scrypt$00$00');
  if (!u || !ok) return fail(c, 'wrong', 401);
  if (mailEnabled && !u.email_verified) return fail(c, 'unverified', 403);
  if (!u.approved) return fail(c, 'pending', 403);
  clearLimit(`login:${email}`);
  // the rules got stricter since this password was set: one that already meets them needs no change
  if (u.must_change === 1 && !weakness(b.password, u.email, u.name)) db.users.set(u.id, { must_change: 0 });
  if (u.totp_enabled) {
    const ticket = randomToken();
    db.tokens.create(sha256(ticket), 'login2fa', u.id, new Date(Date.now() + 5 * 60_000).toISOString(), { remember: !!b.remember });
    return c.json({ twoFactor: true, ticket });
  }
  startSession(c, u, !!b.remember);
  return c.json({ ok: true });
});

app.post('/api/auth/login/2fa', async (c) => {
  const b = await body(c);
  if (limited(`2fa:${clientIp(c)}`, 10, 15 * 60_000)) return fail(c, 'too-many', 429);
  const hash = sha256(b.ticket || '');
  const t = db.tokens.peek(hash, 'login2fa');
  if (!t) return fail(c, 'expired', 410);
  const u = db.users.byId(t.user_id);
  if (!u) return fail(c, 'expired', 410);
  // a code is six digits: a ticket allows a few tries, and an account a few more however many tickets it is given
  if (limited(`2fa-ticket:${hash}`, 5, 5 * 60_000)) { db.tokens.take(hash, 'login2fa'); return fail(c, 'too-many', 429); }
  if (limited(`2fa-user:${u.id}`, 15, 15 * 60_000)) return fail(c, 'too-many', 429);
  const code = String(b.code || '').trim();
  const step = verifyTotp(u.totp_secret, code, u.totp_last_step);
  if (step != null) {
    db.users.set(u.id, { totp_last_step: step });
  } else {
    const left = useRecoveryCode(JSON.parse(u.recovery || '[]'), code);
    if (!left) return fail(c, 'bad-code', 401);
    db.users.set(u.id, { recovery: JSON.stringify(left) });
  }
  db.tokens.take(hash, 'login2fa');
  startSession(c, u, !!t.data.remember);
  return c.json({ ok: true });
});

// sign in with a passkey: any passkey of this site (discoverable), no e-mail needed
app.post('/api/auth/passkey/options', (c) => {
  if (limited(`pk-opt:${clientIp(c)}`, 30, 15 * 60_000)) return fail(c, 'too-many', 429);
  return c.json({ challenge: rememberChallenge(), rpId: rpIdOf(c), timeout: 120000, userVerification: 'preferred' });
});

app.post('/api/auth/passkey', async (c) => {
  if (limited(`pk:${clientIp(c)}`, 20, 15 * 60_000)) return fail(c, 'too-many', 429);
  const b = await body(c);
  const ch = takeChallenge(b.credential?.response?.clientDataJSON);
  if (!ch) return fail(c, 'expired', 410);
  const stored = db.passkeys.get(String(b.credential?.id || ''));
  if (!stored) return fail(c, 'unknown-passkey', 401);
  try {
    const count = verifyAssertion(b.credential, stored, { challenge: ch.challenge, origin: originOf(c), rpId: rpIdOf(c) });
    db.passkeys.use(stored.id, count);
  } catch {
    return fail(c, 'bad-passkey', 401);
  }
  const u = db.users.byId(stored.user_id);
  if (mailEnabled && !u.email_verified) return fail(c, 'unverified', 403);
  if (!u.approved) return fail(c, 'pending', 403);
  startSession(c, u, b.remember !== false);
  return c.json({ ok: true });
});

app.post('/api/auth/logout', (c) => {
  const me = current(c);
  if (me) db.sessions.remove(me.session.id, me.user.id);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.post('/api/auth/forgot', async (c) => {
  if (limited(`forgot:${clientIp(c)}`, 5, 3600_000)) return fail(c, 'too-many', 429);
  const b = await body(c);
  const u = db.users.byEmail(b.email || '');
  if (mailEnabled && u) {
    db.tokens.clear(u.id, 'reset');
    const token = randomToken();
    db.tokens.create(sha256(token), 'reset', u.id, new Date(Date.now() + 3600_000).toISOString());
    await sendReset({ ...u, lang: lang(b.lang || u.lang) }, `${baseUrl(c)}/reset?token=${token}`);
  }
  // the same answer whether or not the address has an account
  return c.json({ ok: true, mail: mailEnabled });
});

app.post('/api/auth/reset', async (c) => {
  const b = await body(c);
  const hash = sha256(b.token || '');
  const t = db.tokens.peek(hash, 'reset');
  if (!t) return fail(c, 'expired', 410);
  const u = db.users.byId(t.user_id);
  const weak = weakness(b.password, u.email, u.name);
  if (weak) return fail(c, `weak-${weak}`);
  db.tokens.take(hash, 'reset');
  db.users.set(u.id, { password: hashPassword(b.password), email_verified: 1, must_change: 0 });
  db.sessions.removeAll(u.id);
  sendPasswordChanged(u);
  return c.json({ ok: true });
});

app.get('/ics/:file', (c) => {
  const file = c.req.param('file');
  if (!/^[A-Za-z0-9_-]{43}\.ics$/.test(file)) return c.notFound();
  const feed = db.feeds.find(sha256(file.slice(0, -4)));
  if (!feed) return c.notFound();
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  return c.body(plannerIcs(db.docs.all(feed.user_id), feed.timezone, !!feed.tasks), 200, { 'Content-Type': 'text/calendar; charset=utf-8' });
});

// ---------------- everything below needs a session ----------------

app.use('/api/*', async (c, next) => {
  const me = current(c);
  if (!me) return fail(c, 'signed-out', 401);
  c.set('me', me);
  // an account that must pick a new password can see its account, sign out and change the password, nothing else
  if (me.user.must_change && !/^\/api\/(account(\/password)?|session)$/.test(c.req.path)) return fail(c, 'must-change', 403);
  await next();
});

const me = (c) => c.get('me');
const uid = (c) => me(c).user.id;
const push = pushService(db);
push.start();
app.get('/api/push', (c) => c.json({ publicKey: push.publicKey, subscribed: db.push.has(uid(c), c.req.query('endpoint') || '') }));
app.post('/api/push', async (c) => {
  if (limited(`push:${uid(c)}`, 30, 3600_000)) return fail(c, 'too-many', 429);
  const b = await body(c);
  if (!validSubscription(b)) return fail(c, 'subscription');
  if (db.push.all().filter((s) => s.user_id === uid(c)).length >= 20 && !db.push.has(uid(c), b.endpoint)) return fail(c, 'too-many', 429);
  db.push.put(uid(c), b);
  return c.json({ ok: true });
});
app.delete('/api/push', async (c) => { const b = await body(c); db.push.remove(uid(c), String(b.endpoint || '')); return c.json({ ok: true }); });

app.get('/api/session', (c) => c.json({ ok: true }));
app.get('/api/account/calendar-feed', (c) => c.json(db.feeds.get(uid(c)) ?? null));
app.post('/api/account/calendar-feed', async (c) => {
  const b = await c.req.json();
  try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }).format(); } catch { return fail(c, 'invalid-timezone'); }
  if (typeof b.timezone !== 'string' || !/^[A-Za-z0-9_+\-/]+$/.test(b.timezone)) return fail(c, 'invalid-timezone');
  const token = randomBytes(32).toString('base64url');
  db.feeds.set(uid(c), sha256(token), b.timezone, !!b.tasks);
  c.header('Cache-Control', 'no-store');
  return c.json({ path: `/ics/${token}.ics` });
});
app.delete('/api/account/calendar-feed', (c) => { db.feeds.remove(uid(c)); return c.json(null); });

app.get('/api/account', (c) => c.json({ ...publicUser(me(c).user), mail: mailEnabled }));

app.patch('/api/account', async (c) => {
  const b = await body(c);
  const fields = {};
  if (typeof b.name === 'string' && b.name.trim()) fields.name = b.name.trim().slice(0, 80);
  if (LANGS.has(b.lang)) fields.lang = b.lang;
  db.users.set(uid(c), fields);
  return c.json(publicUser(db.users.byId(uid(c))));
});

app.post('/api/account/password', async (c) => {
  const { user, session } = me(c);
  const b = await body(c);
  if (limited(`pw:${user.id}`, 10, 15 * 60_000)) return fail(c, 'too-many', 429);
  if (!verifyPassword(b.current || '', user.password)) return fail(c, 'wrong', 401);
  const weak = weakness(b.password, user.email, user.name);
  if (weak) return fail(c, `weak-${weak}`);
  if (user.must_change && verifyPassword(b.password, user.password)) return fail(c, 'same');
  db.users.set(user.id, { password: hashPassword(b.password), must_change: 0 });
  db.sessions.removeOthers(user.id, session.id);
  sendPasswordChanged(user);
  return c.json({ ok: true });
});

app.get('/api/account/sessions', (c) => {
  const { user, session } = me(c);
  return c.json(db.sessions.of(user.id).map((s) => ({
    id: s.id, device: describeAgent(s.ua), ip: s.ip, created: s.created_at, lastSeen: s.last_seen, remember: !!s.remember, current: s.id === session.id,
  })));
});
app.delete('/api/account/sessions/:id', (c) => { db.sessions.remove(c.req.param('id'), uid(c)); return c.json({ ok: true }); });
app.post('/api/account/sessions/others', (c) => { db.sessions.removeOthers(uid(c), me(c).session.id); return c.json({ ok: true }); });

// two-step sign-in: start (a new secret and its QR code), confirm with a code, turn off with the password
app.post('/api/account/totp/start', async (c) => {
  const { user } = me(c);
  if (user.totp_enabled) return fail(c, 'already', 409);
  const secret = newTotpSecret();
  db.users.set(user.id, { totp_secret: secret, totp_last_step: 0 });
  const uri = otpauthUrl(secret, user.email);
  const qr = await QRCode.toString(uri, { type: 'svg', margin: 0, color: { dark: '#0a0a0a', light: '#ffffff' } });
  return c.json({ secret, uri, qr });
});

app.post('/api/account/totp/enable', async (c) => {
  const { user } = me(c);
  const b = await body(c);
  if (user.totp_enabled || !user.totp_secret) return fail(c, 'not-started', 409);
  const step = verifyTotp(user.totp_secret, b.code);
  if (step == null) return fail(c, 'bad-code', 401);
  const { codes, hashes } = newRecoveryCodes();
  db.users.set(user.id, { totp_enabled: 1, totp_last_step: step, recovery: JSON.stringify(hashes) });
  return c.json({ ok: true, recoveryCodes: codes });
});

app.post('/api/account/totp/disable', async (c) => {
  const { user } = me(c);
  const b = await body(c);
  if (limited(`pw:${user.id}`, 10, 15 * 60_000)) return fail(c, 'too-many', 429);
  if (!verifyPassword(b.password || '', user.password)) return fail(c, 'wrong', 401);
  db.users.set(user.id, { totp_enabled: 0, totp_secret: null, recovery: '[]', totp_last_step: 0 });
  return c.json({ ok: true });
});

app.post('/api/account/totp/recovery', async (c) => {
  const { user } = me(c);
  const b = await body(c);
  if (!user.totp_enabled) return fail(c, 'not-enabled', 409);
  if (limited(`pw:${user.id}`, 10, 15 * 60_000)) return fail(c, 'too-many', 429);
  if (!verifyPassword(b.password || '', user.password)) return fail(c, 'wrong', 401);
  const { codes, hashes } = newRecoveryCodes();
  db.users.set(user.id, { recovery: JSON.stringify(hashes) });
  return c.json({ recoveryCodes: codes });
});

// the account's passkeys
app.get('/api/account/passkeys', (c) => c.json(db.passkeys.of(uid(c)).map((p) => ({ id: p.id, name: p.name, created: p.created_at, lastUsed: p.last_used }))));

app.post('/api/account/passkeys/options', (c) => {
  const { user } = me(c);
  return c.json({
    challenge: rememberChallenge(user.id),
    rp: { name: 'Shutdown Complete', id: rpIdOf(c) },
    user: { id: b64url(Buffer.from(user.id)), name: user.email, displayName: user.name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    excludeCredentials: db.passkeys.of(user.id).map((p) => ({ type: 'public-key', id: p.id, transports: p.transports })),
    attestation: 'none',
    timeout: 120000,
  });
});

app.post('/api/account/passkeys', async (c) => {
  const { user } = me(c);
  const b = await body(c);
  const ch = takeChallenge(b.credential?.response?.clientDataJSON);
  if (!ch || ch.userId !== user.id) return fail(c, 'expired', 410);
  try {
    const p = verifyRegistration(b.credential, { challenge: ch.challenge, origin: originOf(c), rpId: rpIdOf(c) });
    if (db.passkeys.get(p.id)) return fail(c, 'already', 409);
    db.passkeys.add(user.id, p, String(b.name || '').trim() || 'Passkey');
    return c.json({ ok: true });
  } catch {
    return fail(c, 'bad-passkey', 400);
  }
});

app.delete('/api/account/passkeys/:id', (c) => { db.passkeys.remove(c.req.param('id'), uid(c)); return c.json({ ok: true }); });

app.post('/api/account/delete', async (c) => {
  const { user } = me(c);
  const b = await body(c);
  if (limited(`pw:${user.id}`, 10, 15 * 60_000)) return fail(c, 'too-many', 429);
  if (!verifyPassword(b.password || '', user.password)) return fail(c, 'wrong', 401);
  const admins = db.users.list().filter((u) => u.is_admin);
  if (user.is_admin && admins.length === 1 && db.users.count() > 1) return fail(c, 'last-admin', 409);
  db.users.remove(user.id);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// ---------------- the owner's settings for this installation ----------------

socialRoutes(app, { db, me, uid, fail, body, limited });

// app passwords for CalDAV apps: listed, made (shown once), revoked
const davInfo = (c) => ({ passwords: dav.list(uid(c)), url: `${originOf(c)}/dav/`, user: me(c).user.email });
app.get('/api/account/app-passwords', (c) => c.json(davInfo(c)));
app.post('/api/account/app-passwords', async (c) => {
  if (limited(`app-pw:${uid(c)}`, 20, 3600_000)) return fail(c, 'too-many', 429);
  const name = String((await body(c)).name || '').trim().slice(0, 80);
  if (!name) return fail(c, 'name');
  const password = dav.create(uid(c), name);
  return c.json({ ...davInfo(c), password });
});
// the link to a Nextcloud: its state, made (after the address and password are tried), synced now, undone
app.get('/api/account/nextcloud', (c) => c.json(syncer.status(uid(c))));
app.put('/api/account/nextcloud/lists/:id', async (c) => {
  const b = await body(c);
  if (typeof b.published !== 'boolean' || !syncer.publish(uid(c), c.req.param('id'), b.published)) return fail(c, 'missing', 400);
  return c.json(syncer.status(uid(c)));
});
app.put('/api/account/nextcloud', async (c) => {
  if (limited(`nextcloud:${uid(c)}`, 20, 3600_000)) return fail(c, 'too-many', 429);
  const b = await body(c);
  if (!b.url || !b.username || !b.password) return fail(c, 'missing');
  const r = await syncer.connect(uid(c), { url: b.url, username: String(b.username).trim(), password: String(b.password).trim() }, !!me(c).user.is_admin);
  if (r.error) return fail(c, r.error, 400);
  return c.json(syncer.status(uid(c)));
});
app.post('/api/account/nextcloud/sync', async (c) => { const result = await syncer.sync(uid(c)); return c.json({ ...syncer.status(uid(c)), result }); });
app.delete('/api/account/nextcloud', (c) => { syncer.disconnect(uid(c)); return c.json(null); });
app.delete('/api/account/app-passwords/:id', (c) => { dav.remove(uid(c), c.req.param('id')); return c.json(davInfo(c)); });
teamRoutes(app, { db, uid, fail, body, limited });

app.use('/api/admin/*', async (c, next) => { if (!me(c).user.is_admin) return fail(c, 'forbidden', 403); await next(); });
const inviteRow = (i) => ({ id: i.id, created: i.created_at, expires: i.expires_at, maxUses: i.max_uses, uses: i.uses, note: i.note, email: i.email || '',
  live: (!i.expires_at || i.expires_at > new Date().toISOString()) && (i.max_uses == null || i.uses < i.max_uses) });
const userRows = () => db.users.list().map((u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, verified: !!u.email_verified,
  totp: !!u.totp_enabled, approved: !!u.approved, mustChange: !!u.must_change, created: u.created_at }));
app.get('/api/admin/state', (c) => c.json({
  signups: signupsOpen(), mode: signupMode(), domains: signupDomains(), note: signupNote(), mail: mailEnabled, users: userRows(), invites: db.invites.list().map(inviteRow),
  requests: requestRows(), policy: passwordPolicy(),
}));

/**
 * Choose the password rules. Turning the strong rules on asks the owner for their current password and, unless it
 * already meets them, a new one that does. Everyone else picks a new password at their next sign-in (one that already
 * meets the rules is accepted then without a change). Going back to the basic rules lets everyone be.
 */
app.put('/api/admin/password-policy', async (c) => {
  const { user, session } = me(c);
  const b = await body(c);
  if (b.policy !== 'strong') {
    db.meta.set('password_policy', 'basic');
    db.users.forgetPolicyFlags();
    return c.json({ policy: 'basic' });
  }
  if (limited(`pw:${user.id}`, 10, 15 * 60_000)) return fail(c, 'too-many', 429);
  if (!verifyPassword(b.current || '', user.password)) return fail(c, 'wrong', 401);
  const fits = !passwordProblem(b.current, user.email, user.name, 'strong');
  if (!fits) {
    if (!b.password) return fail(c, 'own-password', 409);
    const weak = passwordProblem(b.password, user.email, user.name, 'strong');
    if (weak) return fail(c, `weak-${weak}`);
    db.users.set(user.id, { password: hashPassword(b.password) });
    db.sessions.removeOthers(user.id, session.id);
    sendPasswordChanged(user);
  }
  db.meta.set('password_policy', 'strong');
  db.users.askNewPasswords(user.id);
  return c.json({ policy: 'strong', changed: !fits });
});
app.put('/api/admin/state', async (c) => {
  const b = await body(c);
  if (typeof b.signups === 'boolean') db.meta.set('signups', b.signups ? 'open' : 'closed');
  if (MODES.has(b.mode)) db.meta.set('signups', b.mode);
  if (b.domains !== undefined) db.meta.set('signup_domains', domainsFrom(b.domains).join(','));
  if (typeof b.note === 'string') db.meta.set('signup_note', b.note.replace(/\r/g, '').trim().slice(0, 400));
  return c.json({ signups: signupsOpen(), mode: signupMode(), domains: signupDomains(), note: signupNote() });
});
const requestRows = () => db.requests.list().map((r) => ({ id: r.id, email: r.email, note: r.note, created: r.created_at }));
/** Say yes to an invite request: an invite for that address (one use, a week), sent by e-mail when it is set up. */
app.post('/api/admin/requests/:id/invite', async (c) => {
  const r = db.requests.get(c.req.param('id'));
  if (!r) return fail(c, 'gone', 404);
  const token = randomToken();
  db.invites.create({ tokenHash: sha256(token), createdBy: uid(c), note: '', email: r.email, maxUses: 1, expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString() });
  db.requests.remove(r.id);
  const link = `${baseUrl(c)}/register?invite=${token}`;
  const sent = !!(mailEnabled && await sendInvite(r.email, r.lang, me(c).user.name, link, 7));
  return c.json({ link, sent, email: r.email, requests: requestRows(), invites: db.invites.list().map(inviteRow) });
});
app.delete('/api/admin/requests/:id', (c) => { db.requests.remove(c.req.param('id')); return c.json({ requests: requestRows() }); });

/** Let a waiting account in (and tell its owner, when there is e-mail). */
app.post('/api/admin/users/:id/approve', async (c) => {
  const u = db.users.byId(c.req.param('id'));
  if (!u) return fail(c, 'gone', 404);
  if (!u.approved) {
    db.users.set(u.id, { approved: 1 });
    if (mailEnabled) await sendApproved(u, `${baseUrl(c)}/login`);
  }
  return c.json({ users: userRows() });
});
/** Turn a waiting account away: it is deleted. Approved accounts are not removed from here. */
app.delete('/api/admin/users/:id', (c) => {
  const u = db.users.byId(c.req.param('id'));
  if (u && !u.approved && !u.is_admin) db.users.remove(u.id);
  return c.json({ users: userRows() });
});
/** A new invite link: for one person or several, for a few days or until it is revoked. The link is shown only now. */
app.post('/api/admin/invites', async (c) => {
  const b = await body(c);
  const days = Number(b.days), uses = Number(b.uses);
  const email = String(b.email || '').trim().toLowerCase();
  if (email && !validEmail(email)) return fail(c, 'invalid-email');
  if (email && db.users.byEmail(email)) return fail(c, 'taken', 409);
  const token = randomToken();
  const id = db.invites.create({
    tokenHash: sha256(token), createdBy: uid(c), note: b.note || '', email,
    expiresAt: days > 0 ? new Date(Date.now() + Math.min(days, 365) * 24 * 3600_000).toISOString() : null,
    maxUses: uses > 0 ? Math.min(Math.floor(uses), 1000) : null,
  });
  const link = `${baseUrl(c)}/register?invite=${token}`;
  // with e-mail set up, an invite for an address goes out by itself
  const sent = !!(email && mailEnabled && await sendInvite(email, lang(b.lang), me(c).user.name, link, days > 0 ? Math.min(days, 365) : 0));
  return c.json({ id, link, sent, invites: db.invites.list().map(inviteRow) });
});
const runningVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const fetchRelease = releaseChecker(SOURCE_URL, runningVersion);
let releasePending;
const checkRelease = async () => {
 let saved; try { saved = JSON.parse(db.meta.get('status_release', 'null')); } catch {}
 if(saved && saved.source === SOURCE_URL && Date.now()-saved.at < 86400000) return saved.value;
 if(releasePending) return releasePending;
 releasePending = (async () => { const value = await fetchRelease(); db.meta.set('status_release', JSON.stringify({source:SOURCE_URL,at:Date.now(),value})); return value; })();
 try { return await releasePending; } finally { releasePending = null; }
};
app.get('/api/admin/server-status', async (c) => {
 if (limited(`status:${uid(c)}`, 30, 60000)) return fail(c, 'too-many', 429);
 const list = bk.list(), users = db.users.list(), links = users.map(u => syncer.status(u.id)).filter(x => x?.url);
 const next = new Date(); next.setHours(bk.hour,0,0,0); if(next <= new Date()) next.setDate(next.getDate()+1);
 const result = { version: runningVersion, release: await checkRelease(), uptime: Math.floor(process.uptime()),
 backup: { last: list[0] ? {at:list[0].at,size:list[0].size} : null, attempt: bk.status(), count:list.length, keep:bk.keep, next:bk.hour>=0?next.toISOString():null },
 storage:await storage(DATA_DIR), accounts:users.length, pending:db.requests.count()+users.filter(u=>!u.approved).length,
 push:db.push.all().length, config:{vapid:!!push.publicKey,smtp:mailEnabled,appUrl:!!process.env.APP_URL},
 nextcloud:{count:links.length, last:links.map(x=>x.lastSync).filter(Boolean).sort().at(-1)??null,errors:links.filter(x=>x.error).length}, calendars:feedStatus() };
 return c.json({...result,warnings:warnings(result)});
});
// ---- backups of the whole server (backup.mjs) ----
app.get('/api/admin/backups', (c) => c.json({ list: bk.list(), keep: bk.keep, hour: bk.hour }));
app.post('/api/admin/backups', async (c) => {
  if (limited(`backup:${uid(c)}`, 12, 3600_000)) return fail(c, 'too-many', 429);
  await bk.make('manual');
  return c.json({ list: bk.list(), keep: bk.keep, hour: bk.hour });
});
app.get('/api/admin/backups/:name', (c) => {
  const f = bk.file(c.req.param('name'));
  if (!f) return fail(c, 'not-found', 404);
  return new Response(bk.stream(f), { headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${c.req.param('name')}"` } });
});
app.post('/api/admin/backups/upload', async (c) => {
  if (limited(`backup:${uid(c)}`, 12, 3600_000)) return fail(c, 'too-many', 429);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length || buf.length > 512 * 1024 * 1024) return fail(c, 'damaged');
  const r = await bk.upload(buf);
  if (r.error) return fail(c, r.error);
  return c.json({ list: bk.list(), keep: bk.keep, hour: bk.hour, name: r.name });
});
// a restore replaces everything, so it asks for the owner's password; the server stops and starts again on the copy
app.post('/api/admin/backups/:name/restore', async (c) => {
  const b = await body(c);
  if (limited(`pw:${uid(c)}`, 10, 15 * 60_000)) return fail(c, 'too-many', 429);
  if (!verifyPassword(b.password || '', me(c).user.password)) return fail(c, 'wrong', 401);
  const r = await bk.restore(c.req.param('name'));
  if (r.error) return fail(c, r.error, r.error === 'not-found' ? 404 : 400);
  console.log(`Restore of ${c.req.param('name')} asked for by account ${uid(c)}: stopping so it is put in place at the next start.`);
  setTimeout(() => process.exit(0), 800);
  return c.json({ ok: true, restarting: true });
});
app.delete('/api/admin/invites/:id', (c) => { db.invites.remove(c.req.param('id')); return c.json({ invites: db.invites.list().map(inviteRow) }); });

// ---------------- calendars to plan around (read-only subscription feeds, kept in the settings document) ----------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validZone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

/** The events of the account's calendars from one date to another, in the viewer's zone, by day. */
app.get('/api/calendar', async (c) => {
  const from = c.req.query('from') || '', to = c.req.query('to') || '', tz = c.req.query('tz') || 'UTC';
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return fail(c, 'range');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > RANGE_DAYS) return fail(c, 'range');
  const settings = db.docs.get(uid(c), 'settings')?.value || {};
  const cals = (Array.isArray(settings.calendars) ? settings.calendars : []).filter((x) => x && x.url).slice(0, 10);
  const days = {}, errors = [];
  await Promise.all(cals.map(async (cal) => {
    try {
      const byDay = eventsBetween(await loadFeed(cal.url), from, to, validZone(tz) ? tz : 'UTC');
      for (const [date, list] of Object.entries(byDay)) for (const e of list) (days[date] ||= []).push({ ...e, cal: cal.id });
    } catch (e) { errors.push({ id: cal.id, error: e.code || 'unreachable' }); }
  }));
  for (const list of Object.values(days)) list.sort((a, b) => a.start - b.start);
  return c.json({ days, errors });
});

/** Tries a feed address before it is saved: can it be fetched, is it a calendar, how many events are coming. */
app.post('/api/calendar/check', async (c) => {
  if (limited(`calcheck:${uid(c)}`, 20, 15 * 60_000)) return fail(c, 'too-many', 429);
  const b = await body(c);
  const url = String(b.url || '').trim();
  if (!url) return fail(c, 'url');
  forgetFeed(url);
  try {
    const feed = await loadFeed(url);
    const now = new Date(), from = now.toISOString().slice(0, 10), to = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const upcoming = Object.values(eventsBetween(feed, from, to, validZone(b.tz) ? b.tz : 'UTC')).reduce((n, l) => n + l.length, 0);
    return c.json({ ok: true, upcoming });
  } catch (e) {
    return fail(c, `cal-${e.code || 'unreachable'}`);
  }
});

// A timetable from a calendar file, for the weekly schedule: the classes of the first two weeks that have any (within
// half a year), each with its weekdays and hours in the viewer's time zone. Nothing is kept.
app.post('/api/schedule/ics', async (c) => {
    if (limited(`schedics:${uid(c)}`, 30, 15 * 60_000)) return fail(c, 'too-many', 429);
    const b = await body(c);
    const text = String(b.ics || '');
    if (!/BEGIN:VCALENDAR/i.test(text) || text.length > 5 * 1024 * 1024) return fail(c, 'not-a-calendar');
    const tz = validZone(b.tz) ? b.tz : 'UTC';
    const day = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const from = new Date().toISOString().slice(0, 10);
    const all = eventsBetween(parseFeed(text), from, day(from, 183), tz);
    const first = Object.keys(all).sort()[0];
    const slots = [];
    if (first) {
      for (const [date, list] of Object.entries(all)) {
        if (date >= day(first, 14)) continue;
        const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
        for (const e of list) if (!e.allDay && e.title) slots.push({ title: e.title.slice(0, 120), day: weekday, start: e.start, end: e.end });
      }
    }
    const seen = new Map();
    for (const s of slots) {
      const k = `${s.title.toLowerCase()}|${s.start}|${s.end}`;
      const cur = seen.get(k) ?? { title: s.title, days: [], start: s.start, end: s.end };
      if (!cur.days.includes(s.day)) cur.days.push(s.day);
      seen.set(k, cur);
    }
    return c.json({ slots: [...seen.values()].map((x) => ({ ...x, days: x.days.sort() })).sort((x, y) => x.days[0] - y.days[0] || x.start - y.start).slice(0, 200) });
});

// a week in review (weekly.mjs), and every Sunday by e-mail to those who ask for it
app.get('/api/review/:week', (c) => (WEEK.test(c.req.param('week')) ? c.json({ ...review(db, uid(c), c.req.param('week')), mail: mailEnabled }) : fail(c, 'week')));
if (mailEnabled) weeklyMails({ db, send: sendMail, baseUrl: () => APP_URL || `http://localhost:${PORT}` });

// ---------------- the planner's documents, one set per account ----------------

const TEAM_KEY = /^team:([a-f0-9]{16})$/;

app.get('/api/doc/:key', (c) => {
  const key = c.req.param('key');
  const team = TEAM_KEY.exec(key);
  if (team) return db.teams.role(team[1], uid(c)) ? c.json(db.teams.doc(team[1])) : fail(c, 'not-a-member', 404);
  if (!KEY.test(key)) return fail(c, 'Unknown key');
  return c.json(db.docs.get(uid(c), key) ?? { key, value: null, version: 0, updatedAt: null });
});

app.put('/api/doc/:key', async (c) => {
  const key = c.req.param('key');
  const team = TEAM_KEY.exec(key);
  if (!team && !KEY.test(key)) return fail(c, 'Unknown key');
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.value !== 'object' || b.value === null || !Number.isInteger(b.version)) return fail(c, 'Expected { value, version }');
  if (JSON.stringify(b.value).length > 512 * 1024) return fail(c, 'Document too large', 413);
  if (team) {
    if (!db.teams.role(team[1], uid(c))) return fail(c, 'not-a-member', 404);
    const res = db.teams.put(team[1], b.value, b.version);
    if (res.conflict) return c.json({ error: 'Changed by someone else', current: res.conflict }, 409);
    return c.json(res.doc);
  }
  const res = db.docs.put(uid(c), key, b.value, b.version);
  if (res.conflict) return c.json({ error: 'Changed on another device', current: res.conflict }, 409);
  if (key === 'inbox') syncer.schedule(uid(c));
  // a focus timer or the notification choices changed: send what is due and plan the push for the new end time
  if (key === 'settings' || key.startsWith('day:')) void push.refresh(uid(c)).catch(() => {});
  return c.json(res.doc);
});

app.get('/api/docs', (c) => {
  const from = c.req.query('from') || '', to = c.req.query('to') || '';
  if (!from || !to || from.split(':')[0] !== to.split(':')[0]) return fail(c, 'Expected from and to of one kind');
  return c.json(db.docs.range(uid(c), from, to));
});

app.get('/api/export', (c) => {
  c.header('Content-Disposition', `attachment; filename="planner-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json({ app: 'shutdown-complete', exportedAt: new Date().toISOString(), docs: db.docs.all(uid(c)) });
});

app.post('/api/import', async (c) => {
  const b = await c.req.json().catch(() => null);
  const docs = b?.docs;
  if (!Array.isArray(docs) || !docs.every((d) => d && KEY.test(d.key) && typeof d.value === 'object' && d.value)) return fail(c, 'not-an-export');
  db.docs.importAll(uid(c), docs);
  return c.json({ ok: true, count: docs.length });
});

app.all('/api/*', (c) => fail(c, 'Not found', 404));

// The built client, with the SPA fallback to index.html.
if (existsSync(STATIC_DIR)) {
  const index = readFileSync(resolve(STATIC_DIR, 'index.html'), 'utf8');
  headers.setIndex(index);
  app.use('/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
  app.use('*', serveStatic({ root: STATIC_DIR }));
  app.get('*', (c) => c.html(index));
}

serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || '0.0.0.0' }, (info) => {
  console.log(`Shutdown Complete listening on :${info.port}${db.users.count() === 0 ? ' — open it in a browser to create the first account' : ''}`);
  if (mailEnabled && !APP_URL) console.warn('WARNING: SMTP_URL is set but APP_URL is not. Links in e-mails (password reset, address confirmation, invites) are then built from the request\'s Host header, which a visitor can choose. Set APP_URL to your public address.');
  if (!mailEnabled) console.log('E-mail is off (no SMTP_URL): sign-ups are not verified, and passwords are reset with: node server/src/cli.mjs reset-password <email>');
});
