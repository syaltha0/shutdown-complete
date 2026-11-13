// Outgoing requests to an address a user typed (calendar feeds, a Nextcloud). Checking the host name first and then
// letting fetch() resolve it again leaves a gap (DNS rebinding: the second answer is a private address), so here the
// address that is actually connected to is checked, in the lookup of the connection itself, on every hop.
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/** The 16 bytes of an IPv6 address, or null. Reads `::`, and an IPv4 tail (`::ffff:1.2.3.4`). */
function v6bytes(ip) {
  let s = String(ip).toLowerCase().split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const p = tail[1].split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return null;
    s = s.slice(0, -tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (h) => (h ? h.split(':') : []);
  const head = groups(halves[0]), rest = halves.length === 2 ? groups(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const all = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const out = Buffer.alloc(16);
  all.forEach((g, i) => out.writeUInt16BE(parseInt(g, 16), i * 2));
  return out;
}

/** An address a public calendar has no business at: this machine, private and special-use ranges, multicast. */
export function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c <= 2) || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  const v = v6bytes(ip);
  if (!v) return true; // not an address we can read: do not trust it
  const zeros = (from, to) => v.subarray(from, to).every((x) => x === 0);
  const v4 = (o) => privateAddress(`${v[o]}.${v[o + 1]}.${v[o + 2]}.${v[o + 3]}`);
  if (zeros(0, 10) && v[10] === 0xff && v[11] === 0xff) return v4(12); // ::ffff:a.b.c.d (also written ::ffff:7f00:1)
  if (zeros(0, 12)) return true; // ::, ::1 and the old IPv4-compatible ::a.b.c.d
  if (v[0] === 0x00 && v[1] === 0x64 && v[2] === 0xff && v[3] === 0x9b) return zeros(4, 12) ? v4(12) : true; // NAT64 64:ff9b::/96, 64:ff9b:1::/48
  if (v[0] === 0x20 && v[1] === 0x02) return v4(2); // 6to4 2002::/16
  if (v[0] === 0x20 && v[1] === 0x01 && v[2] === 0x00 && v[3] === 0x00) return true; // Teredo 2001::/32
  if (v[0] === 0x20 && v[1] === 0x01 && v[2] === 0x0d && v[3] === 0xb8) return true; // documentation 2001:db8::/32
  return (v[0] & 0xfe) === 0xfc || (v[0] === 0xfe && (v[1] & 0xc0) >= 0x80) || v[0] === 0xff; // fc00::/7, fe80::/10 and fec0::/10, ff00::/8
}

/** A lookup for a connection that refuses private answers unless `allowPrivate`. */
export function guardedLookup(allowPrivate, resolve = dnsLookup) {
  return (host, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    resolve(host, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err);
      if (!addrs.length || (!allowPrivate && addrs.some((a) => privateAddress(a.address)))) return cb(Object.assign(new Error('private'), { code: 'private' }));
      if (opts.all) return cb(null, addrs);
      return cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

const fail = (code) => Object.assign(new Error(code), { code });

/**
 * One request, no redirects followed (the caller decides about each hop). Resolves to { status, headers, body: Buffer }.
 * Errors carry `code`: 'private', 'too-big', 'unreachable'.
 */
export function guardedFetch(raw, { method = 'GET', headers = {}, body, timeoutMs = 10_000, maxBytes = 5 * 1024 * 1024, allowPrivate = false, resolve } = {}) {
  return new Promise((ok, no) => {
    let u;
    try { u = new URL(raw); } catch { return no(fail('url')); }
    if (!['http:', 'https:'].includes(u.protocol)) return no(fail('url'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && isIP(host) && privateAddress(host)) return no(fail('private'));
    const lib = u.protocol === 'https:' ? https : http;
    let done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const req = lib.request(u, { method, headers: { 'accept-encoding': 'gzip, deflate, br', ...headers }, lookup: guardedLookup(allowPrivate, resolve) }, (res) => {
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const decoder = enc === 'gzip' ? createGunzip() : enc === 'deflate' ? createInflate() : enc === 'br' ? createBrotliDecompress() : null;
      const src = decoder ? res.pipe(decoder) : res;
      const chunks = [];
      let size = 0;
      src.on('data', (d) => {
        size += d.length;
        if (size > maxBytes) { req.destroy(); end(no, fail('too-big')); return; }
        chunks.push(d);
      });
      src.on('end', () => end(ok, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      src.on('error', () => end(no, fail('unreachable')));
      res.on('error', () => end(no, fail('unreachable')));
    });
    const timer = setTimeout(() => { req.destroy(); end(no, fail('unreachable')); }, timeoutMs);
    req.on('error', (e) => end(no, fail(e.code === 'private' ? 'private' : 'unreachable')));
    if (body) req.write(body);
    req.end();
  });
}
