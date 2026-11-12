import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, createECDH } from 'node:crypto';
import { encryptPush, authorization, vapidKeys, validSubscription, pushService } from '../src/push.mjs';
import { openDb } from '../src/db.mjs';

test('RFC 8291 section 5 exact ciphertext test vector', () => {
  // https://www.rfc-editor.org/rfc/rfc8291.html#section-5
  const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  const body = encryptPush('When I grow up, I want to be a watermelon', {
    auth: 'BTBZMqHH6r4Tts7J_aSIgg', p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  }, Buffer.from(expected, 'base64url').subarray(0, 16), Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  assert.equal(body.toString('base64url'), expected);
});

test('VAPID ES256 signature and audience, expiry, subject', () => {
  const keys = vapidKeys(), now = 1700000000000;
  const header = authorization('https://fcm.googleapis.com/send/example', keys, 'mailto:admin@example.org', now);
  const [h, p, sig] = header.split('t=')[1].split(',')[0].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 3600, sub: 'mailto:admin@example.org' });
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  assert.equal(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true);
});

const subscription = () => {
  const e = createECDH('prime256v1'); e.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/send/test', keys: { p256dh: e.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') }, timeZone: 'Europe/Istanbul' };
};
test('subscription rejects private URLs, lookalike hosts and invalid keys', () => {
  const s = subscription(); assert.ok(validSubscription(s));
  for (const endpoint of ['http://fcm.googleapis.com/send/x', 'https://127.0.0.1/push', 'https://fcm.googleapis.com.attacker.test/push']) assert.equal(validSubscription({ ...s, endpoint }), false);
  assert.equal(validSubscription({ ...s, keys: { ...s.keys, p256dh: 'bad' } }), false);
});

function fixture() {
  const db = openDb(':memory:');
  const u = db.users.create({ email: 'test@example.org', name: 'Test', password: 'not-used' });
  const s = subscription(); db.push.put(u.id, s);
  db.docs.put(u.id, 'settings', { reminders: { before: 5 } }, 0);
  db.docs.put(u.id, 'day:2026-11-12', { columns: [{ blocks: [{ id: 'old', start: 600 }] }, { blocks: [{ id: 'current', start: 600 }] }] }, 0);
  return { db, u, s };
}
test('scheduler uses local day, active column and persistent deduplication; keys survive restart', async () => {
  const { db } = fixture(); let sends = 0;
  const send = async () => { sends++; return new Response(null, { status: 201 }); };
  const p = pushService(db, { send });
  await p.tick(new Date('2026-11-12T06:54:00Z')); assert.equal(sends, 0);
  await p.tick(new Date('2026-11-12T06:55:00Z')); assert.equal(sends, 1);
  const next = pushService(db, { send }); assert.equal(next.publicKey, p.publicKey);
  await next.tick(new Date('2026-11-12T06:56:00Z')); assert.equal(sends, 1);
});
test('expired push subscriptions are removed and ownership is checked', async () => {
  for (const status of [404, 410]) {
    const { db, s } = fixture(); db.push.remove('someone-else', s.endpoint); assert.equal(db.push.all().length, 1);
    await pushService(db, { send: async () => new Response(null, { status }) }).tick(new Date('2026-11-12T06:55:00Z'));
    assert.equal(db.push.all().length, 0);
  }
});
