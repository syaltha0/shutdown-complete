// The receiving end of Web Push, for the tests: a fake browser subscription (keys the way a browser makes them)
// and the RFC 8291 / RFC 8188 (aes128gcm) decryption of what the server sends it.
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const hk = (ikm, salt, info, len) => Buffer.from(hkdfSync('sha256', ikm, salt, info, len));

/** A subscription as `PushSubscription.toJSON()` gives it, plus the private half that only the browser holds. */
export function fakeSubscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('hex')}`) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    timeZone: 'Europe/Istanbul', ecdh, auth,
    /** The text the server sent (the request body of the push), or throws when it was not made for this subscription. */
    open(body) {
      const buf = Buffer.from(body);
      const salt = buf.subarray(0, 16), idlen = buf[20], as = buf.subarray(21, 21 + idlen), data = buf.subarray(21 + idlen);
      const ua = ecdh.getPublicKey();
      const ikm = hk(ecdh.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
      const d = createDecipheriv('aes-128-gcm', hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      d.setAuthTag(data.subarray(data.length - 16));
      const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
      return plain.subarray(0, plain.lastIndexOf(2)).toString();
    },
    /** What the browser registers with the planner. */
    json() { return { endpoint, keys: this.keys, timeZone: this.timeZone }; },
  };
}
