import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { passwordCheck } from './passwords.mjs';

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

// ---------- TOTP (RFC 6238: 30-second steps, 6 digits, SHA-1, as every authenticator app expects) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}

/** Returns the matched time step (to block reuse), or null. Accepts one step of clock drift either way. */
export function verifyTotp(secret, code, lastStep = 0, now = Date.now()) {
  const c = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const step = Math.floor(now / 30000);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue;
    const expected = hotp(secret, s);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s;
  }
  return null;
}

export const otpauthUrl = (secret, email, issuer = 'Shutdown Complete') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------- recovery codes: ten one-time codes, stored hashed ----------
export function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => {
    const s = randomBytes(5).toString('hex');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(c)) };
}

/** Uses up a recovery code; returns the remaining hashes, or null when the code is not one of them. */
export function useRecoveryCode(hashes, code) {
  const h = sha256(String(code).trim().toLowerCase());
  const i = hashes.indexOf(h);
  return i < 0 ? null : hashes.filter((_, k) => k !== i);
}

// ---------- rate limits, kept in memory ----------
const buckets = new Map();
/** true when `key` has already made `max` attempts within `windowMs`; otherwise records this one */
export function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { buckets.set(key, list); return true; }
  list.push(now);
  buckets.set(key, list);
  return false;
}
export const clearLimit = (key) => buckets.delete(key);
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600_000)) buckets.delete(k); }, 600_000).unref();

// ---------- a readable name for a session's device ----------
export function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

// ---------- passwords ----------
/** Why a password cannot be used under the server's policy ('basic' or 'strong'), or null. See passwords.mjs. */
export const passwordProblem = (pw, email = '', name = '', policy = 'basic') => passwordCheck(pw, { email, name }, policy).problem;

export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()) && String(e).length <= 254;
