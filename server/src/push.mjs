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

export function pushService(db, { subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com', send = fetch } = {}) {
  let keys = db.meta.get('vapid');
  if (!keys) { keys = JSON.stringify(vapidKeys()); db.meta.set('vapid', keys); }
  keys = JSON.parse(keys);
  let running = false;
  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      db.push.prune(now.getTime() - 2 * 86400_000);
      for (const sub of db.push.all()) {
        try {
          const settings = db.docs.get(sub.user_id, 'settings')?.value;
          const before = settings?.reminders?.before;
          if (!Number.isFinite(before) || before < 0 || before > 1440) continue;
          const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: sub.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
          const date = `${parts.year}-${parts.month}-${parts.day}`, minute = Number(parts.hour) * 60 + Number(parts.minute);
          const day = db.docs.get(sub.user_id, `day:${date}`)?.value;
          for (const b of day?.columns?.at(-1)?.blocks ?? []) {
            if (!Number.isFinite(b.start) || minute < b.start - before || minute >= b.start + 5) continue;
            const id = `${date}:${b.id}:${b.start}`;
            if (!db.push.claim(sub.endpoint, id, now.getTime())) continue;
            try {
              // Only a generic wake-up signal leaves the server: no document content or dates.
              const res = await send(sub.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: authorization(sub.endpoint, keys, subject), TTL: '300', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body: encryptPush('{"type":"block"}', JSON.parse(sub.keys)) });
              if (res.status === 404 || res.status === 410) db.push.remove(sub.user_id, sub.endpoint);
              else if (!res.ok) db.push.release(sub.endpoint, id);
              await res.body?.cancel();
            } catch { /* keep the claim after an ambiguous delivery to avoid duplicates */ }
          }
        } catch { /* one malformed document must not stop reminders for other accounts */ }
      }
    } finally { running = false; }
  }
  return { publicKey: keys.publicKey, tick, start() { const t = setInterval(() => void tick(), 60000); t.unref(); void tick(); return t; } };
}
