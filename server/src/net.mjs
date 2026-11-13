// Who is on the other end of a request. Rate limits (sign-in, 2FA, app passwords) are kept per address, so the address
// must not be something the sender can write: X-Forwarded-For is believed only when the TCP peer is a
// reverse proxy next to the app (loopback, a private or a link-local address, e.g. nginx on this host or the Docker
// gateway). Reached directly from the internet, the socket address is used and those headers are ignored.
import { isIP } from 'node:net';

/** A loopback, private (RFC 1918 / ULA) or link-local address: where a reverse proxy of ours would connect from. */
export function isProxyPeer(addr) {
  let a = String(addr || '').toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (isIP(a) === 4) {
    const [x, y] = a.split('.').map(Number);
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
  }
  return a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
}

/**
 * The address the rate limits count. Behind a trusted proxy: the last X-Forwarded-For entry (the one the proxy
 * appended; earlier entries are whatever the client sent). Otherwise the socket address. X-Real-IP is not used: a
 * proxy that does not set it would pass the client's own through.
 */
export function clientIp(c) {
  const peer = c.env?.incoming?.socket?.remoteAddress || '';
  if (peer && isProxyPeer(peer)) {
    const hops = (c.req.header('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last && isIP(last)) return last;
  }
  return peer || 'unknown';
}
