// Passkeys (WebAuthn) without outside services: a small CBOR reader, the authenticator data, COSE keys, and the
// signature checks for the three algorithms browsers use (ES256, RS256, EdDSA). Attestation is "none": we trust the
// key the browser hands over at registration, as almost every site does.
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64url = (s) => Buffer.from(String(s || ''), 'base64url');
export const newChallenge = () => b64url(randomBytes(32));
const sha256 = (b) => createHash('sha256').update(b).digest();

/** Decodes the first CBOR item of a buffer (the subset WebAuthn uses). */
export function cbor(buf) {
  let pos = 0;
  const len = (ai) => {
    if (ai < 24) return ai;
    if (ai === 24) return buf[pos++];
    if (ai === 25) { const v = buf.readUInt16BE(pos); pos += 2; return v; }
    if (ai === 26) { const v = buf.readUInt32BE(pos); pos += 4; return v; }
    if (ai === 27) { const v = Number(buf.readBigUInt64BE(pos)); pos += 8; return v; }
    throw new Error('cbor: indefinite lengths are not supported');
  };
  const item = () => {
    const b = buf[pos++];
    const mt = b >> 5, ai = b & 31;
    switch (mt) {
      case 0: return len(ai);
      case 1: return -1 - len(ai);
      case 2: { const n = len(ai); const v = buf.subarray(pos, pos + n); pos += n; return v; }
      case 3: { const n = len(ai); const v = buf.subarray(pos, pos + n).toString('utf8'); pos += n; return v; }
      case 4: { const n = len(ai); const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: { const n = len(ai); const m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      case 6: len(ai); return item(); // a tag: keep the value
      case 7:
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22 || ai === 23) return null;
        throw new Error('cbor: unsupported simple value');
      default: throw new Error('cbor: bad major type');
    }
  };
  return item();
}

/** The authenticator data: which site, what the user did, the counter, and (at registration) the new key. */
export function parseAuthData(ad) {
  const flags = ad[32];
  const out = { rpIdHash: ad.subarray(0, 32), up: !!(flags & 0x01), uv: !!(flags & 0x04), signCount: ad.readUInt32BE(33) };
  if (flags & 0x40) {
    const idLen = ad.readUInt16BE(53);
    out.credentialId = ad.subarray(55, 55 + idLen);
    out.cose = cbor(ad.subarray(55 + idLen));
  }
  return out;
}

/** A COSE public key as a Node key object, with its algorithm. */
export function coseToKey(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && cose.get(-1) === 1) {
    return { alg: alg ?? -7, key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(cose.get(-2)), y: b64url(cose.get(-3)) }, format: 'jwk' }) };
  }
  if (kty === 3) return { alg: alg ?? -257, key: createPublicKey({ key: { kty: 'RSA', n: b64url(cose.get(-1)), e: b64url(cose.get(-2)) }, format: 'jwk' }) };
  if (kty === 1 && cose.get(-1) === 6) return { alg: alg ?? -8, key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(cose.get(-2)) }, format: 'jwk' }) };
  throw new Error('unsupported key type');
}

function checkClient(clientDataJSON, type, challenge, origin) {
  const c = JSON.parse(Buffer.from(clientDataJSON).toString('utf8'));
  if (c.type !== type) throw new Error('wrong ceremony');
  if (c.challenge !== challenge) throw new Error('wrong challenge');
  if (c.origin !== origin) throw new Error('wrong origin');
}

/** Checks a registration from navigator.credentials.create and returns the key to store. */
export function verifyRegistration(cred, { challenge, origin, rpId }) {
  const r = cred?.response || {};
  checkClient(fromB64url(r.clientDataJSON), 'webauthn.create', challenge, origin);
  const att = cbor(fromB64url(r.attestationObject));
  const ad = parseAuthData(Buffer.from(att.get('authData')));
  if (!ad.rpIdHash.equals(sha256(rpId))) throw new Error('wrong site');
  if (!ad.up) throw new Error('no user presence');
  if (!ad.credentialId || !ad.cose) throw new Error('no key');
  const { alg, key } = coseToKey(ad.cose);
  return {
    id: b64url(ad.credentialId), alg, signCount: ad.signCount,
    publicKey: key.export({ type: 'spki', format: 'der' }).toString('base64'),
    transports: Array.isArray(cred.transports) ? cred.transports.filter((t) => typeof t === 'string').slice(0, 6) : [],
  };
}

/** Checks a sign-in from navigator.credentials.get against the stored key; returns the new counter. */
export function verifyAssertion(cred, stored, { challenge, origin, rpId }) {
  const r = cred?.response || {};
  const clientDataJSON = fromB64url(r.clientDataJSON);
  checkClient(clientDataJSON, 'webauthn.get', challenge, origin);
  const authData = fromB64url(r.authenticatorData);
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(sha256(rpId))) throw new Error('wrong site');
  if (!ad.up) throw new Error('no user presence');
  const key = createPublicKey({ key: Buffer.from(stored.public_key, 'base64'), format: 'der', type: 'spki' });
  const data = Buffer.concat([authData, sha256(clientDataJSON)]);
  const sig = fromB64url(r.signature);
  const ok = stored.alg === -8 ? cryptoVerify(null, data, key, sig)
    : stored.alg === -257 ? cryptoVerify('sha256', data, key, sig)
    : cryptoVerify('sha256', data, { key, dsaEncoding: 'der' }, sig);
  if (!ok) throw new Error('bad signature');
  // a counter that goes backwards means a copied key
  if (ad.signCount !== 0 && stored.sign_count !== 0 && ad.signCount <= stored.sign_count) throw new Error('counter went back');
  return ad.signCount;
}
