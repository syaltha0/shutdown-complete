import { createECDH, createCipheriv, hkdfSync, createPrivateKey, sign, randomBytes } from 'node:crypto';

const decode = (s) => Buffer.from(s, 'base64url');
export function vapidKeys() {
  const e = createECDH('prime256v1'); e.generateKeys();
  return { publicKey: e.getPublicKey().toString('base64url'), privateKey: e.getPrivateKey().toString('base64url') };
}
export function authorization(endpoint, keys, subject, now = Date.now()) {
  const pub = decode(keys.publicKey);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url'), d: keys.privateKey } });
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 3600, sub: subject })}`;
  return `vapid t=${data}.${sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}, k=${keys.publicKey}`;
}
// RFC 8291 / RFC 8188: one final aes128gcm record, fresh ephemeral ECDH key and salt.
export function encryptPush(payload, keys, salt = randomBytes(16), privateKey) {
  const e = createECDH('prime256v1');
  if (privateKey) e.setPrivateKey(privateKey); else e.generateKeys();
  const pub = e.getPublicKey(), ua = decode(keys.p256dh);
  const hk = (ikm, s, info, len) => Buffer.from(hkdfSync('sha256', ikm, s, info, len));
  const ikm = hk(e.computeSecret(ua), decode(keys.auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua, pub]), 32);
  const cek = hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  if (plain.length > 3993) throw new Error('Push payload too large');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const size = Buffer.alloc(4); size.writeUInt32BE(4096);
  return Buffer.concat([salt, size, Buffer.from([65]), pub, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

// Restrict endpoints to browser push services, preventing arbitrary outbound requests.
export function validSubscription(b) {
  try {
    const u = new URL(b.endpoint);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.hash || b.endpoint.length > 2048) return false;
    if (!['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].some((h) => u.hostname === h || (h === 'web.push.apple.com' && u.hostname.endsWith('.' + h)))) return false;
    const p = decode(b.keys.p256dh), auth = decode(b.keys.auth);
    if (p.length !== 65 || p[0] !== 4 || auth.length !== 16) return false;
    const e = createECDH('prime256v1'); e.generateKeys(); e.computeSecret(p);
    new Intl.DateTimeFormat('en', { timeZone: b.timeZone });
    return typeof b.timeZone === 'string';
  } catch { return false; }
}

// ---- what is sent, and when: pure helpers (unit tested) ----
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PLANNED = 240;           // the longest a focus phase can run (client/src/lib/focus.ts)
const LATE = 15 * 60_000;          // a phase that ended longer ago than this is not announced any more
const DAILY_WINDOW = 20;           // minutes after its time that a morning or evening reminder may still go out
const PER_USER_HOUR = 240;         // pushes one account may cause per hour, over all its devices
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** When the running focus or break phase ends (ms), or null when nothing is running (none, paused, malformed). */
export function phaseEnd(active) {
  if (!active || typeof active !== 'object' || active.pausedLeft != null) return null;
  const start = Date.parse(active.startedAt), planned = Number(active.plannedMin);
  if (!Number.isFinite(start) || !Number.isFinite(planned) || planned <= 0 || planned > MAX_PLANNED) return null;
  return start + planned * 60_000;
}

/** The shutdown time to remind at when none was chosen: the end of the workday set up in Settings, otherwise 17:30. */
export function closingTime(settings) {
  const h = settings?.endHour;
  return settings?.setupDone && !settings.wholeDay && Number.isInteger(h) && h >= 12 && h <= 23 ? `${String(h).padStart(2, '0')}:00` : '17:30';
}

/** The notification choices of an account, with the defaults filled in. */
export function notifyChoices(settings) {
  const n = settings?.notify && typeof settings.notify === 'object' ? settings.notify : {};
  const time = (t, fallback) => (typeof t === 'string' && TIME.test(t) ? t : fallback);
  return { focus: n.focus !== false, morning: n.morning === true, morningAt: time(n.morningAt, '08:30'), evening: n.evening === true, eveningAt: time(n.eveningAt, closingTime(settings)), weekends: n.weekends === true };
}

/** What to send when the running phase ends: the kind, a stable id (a longer phase is a new announcement), and whether to offer the next phase's button. */
export function focusPlan(active, settings) {
  const at = phaseEnd(active);
  if (at == null) return null;
  const focus = active.phase === 'focus', f = settings?.focus ?? {};
  return { at, id: `focus:${active.startedAt}:${active.plannedMin}`, type: focus ? 'focus-end' : 'break-end', act: focus ? f.autoBreak === false : !f.autoFocus };
}

const zones = new Map();
function localParts(ms, timeZone) {
  let fmt = zones.get(timeZone);
  if (!fmt) { fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }); zones.set(timeZone, fmt); }
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export function pushService(db, { subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com', send = fetch, clock = Date.now, timers = true } = {}) {
  let keys = db.meta.get('vapid');
  if (!keys) { keys = JSON.stringify(vapidKeys()); db.meta.set('vapid', keys); }
  keys = JSON.parse(keys);
  let running = false;
  const sent = new Map();   // user -> times of recent pushes (the per-account limit)
  const armed = new Map();  // user -> timer for that account's next focus end

  const allowed = (user, at) => {
    const recent = (sent.get(user) ?? []).filter((t) => t > at - 3600_000);
    if (recent.length >= PER_USER_HOUR) { sent.set(user, recent); return false; }
    recent.push(at); sent.set(user, recent); return true;
  };

  // One push to one device, once: the claim is the deduplication, an expired subscription is dropped.
  // Only a short type (and a count) leaves here, encrypted for that device; no endpoint or key is ever logged.
  async function deliver(sub, id, payload, ttl, at) {
    if (!db.push.claim(sub.endpoint, id, at)) return;
    if (!allowed(sub.user_id, at)) { db.push.release(sub.endpoint, id); return; }
    try {
      const res = await send(sub.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: authorization(sub.endpoint, keys, subject), TTL: String(ttl), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body: encryptPush(JSON.stringify(payload), JSON.parse(sub.keys)) });
      if (res.status === 404 || res.status === 410) db.push.remove(sub.user_id, sub.endpoint);
      else if (res.status === 429 || res.status >= 500) db.push.release(sub.endpoint, id);
      await res.body?.cancel();
    } catch { /* keep the claim after an ambiguous delivery to avoid duplicates */ }
  }

  const dayDoc = (user, date) => db.docs.get(user, `day:${date}`)?.value;

  async function blocks(sub, settings, local, at) {
    const before = settings?.reminders?.before;
    if (!Number.isFinite(before) || before < 0 || before > 1440) return;
    for (const b of dayDoc(sub.user_id, local.date)?.columns?.at(-1)?.blocks ?? []) {
      if (!Number.isFinite(b.start) || local.minute < b.start - before || local.minute >= b.start + 5) continue;
      await deliver(sub, `${local.date}:${b.id}:${b.start}`, { type: 'block' }, 300, at);
    }
  }

  /** The focus or break phase running for this device's day: today's document, or yesterday's for a session begun before midnight. */
  function plansFor(sub, settings, local) {
    if (!notifyChoices(settings).focus) return [];
    return [local.date, addDays(local.date, -1)].map((d) => focusPlan(dayDoc(sub.user_id, d)?.focus?.active, settings)).filter(Boolean);
  }
  async function focus(sub, settings, local, at) {
    for (const p of plansFor(sub, settings, local)) {
      if (p.at > at || at - p.at > LATE) continue;
      await deliver(sub, p.id, { type: p.type, ...(p.act ? { act: 1 } : {}) }, 600, at);
    }
  }

  async function daily(sub, settings, local, at) {
    const n = notifyChoices(settings);
    if (local.weekend && !n.weekends) return;
    const due = (t) => { const d = local.minute - minutes(t); return d >= 0 && d < DAILY_WINDOW; };
    const day = dayDoc(sub.user_id, local.date);
    if (n.morning && due(n.morningAt)) {
      const count = (day?.columns?.at(-1)?.blocks ?? []).length;
      await deliver(sub, `morning:${local.date}`, { type: 'morning', ...(count > 0 ? { n: Math.min(count, 99) } : {}) }, 1800, at);
    }
    if (n.evening && due(n.eveningAt) && !day?.shutdown?.done) await deliver(sub, `evening:${local.date}`, { type: 'evening' }, 1800, at);
  }

  async function check(sub, at) {
    try {
      const settings = db.docs.get(sub.user_id, 'settings')?.value;
      const local = localParts(at, sub.timezone);
      await blocks(sub, settings, local, at);
      await focus(sub, settings, local, at);
      await daily(sub, settings, local, at);
    } catch { /* one malformed document must not stop reminders for other accounts */ }
  }

  /** The focus announcements waiting for this account: what, and when each goes out (arms the timer; the tests read it). */
  function pending(user, at = clock()) {
    const settings = db.docs.get(user, 'settings')?.value, out = [];
    for (const sub of db.push.forUser(user)) {
      try { for (const p of plansFor(sub, settings, localParts(at, sub.timezone))) if (p.at > at - LATE) out.push({ ...p, endpoint: sub.endpoint }); } catch { /* ignore */ }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  function arm(user, at = clock()) {
    clearTimeout(armed.get(user)); armed.delete(user);
    if (!timers) return;
    const next = pending(user, at).find((p) => p.at > at);
    if (!next) return;
    // the phase is read again when its time comes, so a pause, extension, skip or stop in between cannot send a stale push
    const t = setTimeout(() => { armed.delete(user); refresh(user).catch(() => {}); }, Math.min(next.at - at + 300, 2 ** 31 - 1));
    t.unref(); armed.set(user, t);
  }

  /** The account's documents changed (or a timer fired): send what is due and arm the next focus end. */
  async function refresh(user, at = clock()) {
    for (const sub of db.push.forUser(user)) await check(sub, at);
    arm(user, at);
  }

  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      db.push.prune(now.getTime() - 2 * 86400_000);
      const users = new Set();
      for (const sub of db.push.all()) { users.add(sub.user_id); await check(sub, now.getTime()); }
      for (const u of users) arm(u, now.getTime());
    } finally { running = false; }
  }
  return { publicKey: keys.publicKey, tick, refresh, pending, start() { const t = setInterval(() => void tick(), 60000); t.unref(); void tick(); return t; } };
}
