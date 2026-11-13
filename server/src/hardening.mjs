// Response headers and request size limits, kept apart from the routes.
import { createHash } from 'node:crypto';
import { bodyLimit } from 'hono/body-limit';

/** The Content-Security-Policy for the built app: its own files, the one inline script it carries (by hash), Google Fonts. */
export function contentSecurityPolicy(indexHtml = '') {
  const hashes = [...String(indexHtml).matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    // a browser hashes the script as the HTML parser read it: line ends as \n
    .map((m) => `'sha256-${createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    // React sets some styles on elements (style attributes), which a strict style-src would turn away
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Headers for every response. `setIndex` hands over the built index.html so the policy can name its inline script.
 * HSTS only when the request came over HTTPS (directly or by the proxy's say-so), never over plain http.
 */
export function securityHeaders({ appUrl = '' } = {}) {
  let csp = contentSecurityPolicy('');
  const mw = async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    if (/^text\/html/i.test(c.res.headers.get('content-type') || '')) c.header('Content-Security-Policy', csp);
    if (c.req.path.startsWith('/api/') && !c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store');
    const https = (c.req.header('x-forwarded-proto') || '').split(',')[0].trim() === 'https' || c.req.url.startsWith('https:') || appUrl.startsWith('https:');
    if (https) c.header('Strict-Transport-Security', 'max-age=15552000');
  };
  mw.setIndex = (html) => { csp = contentSecurityPolicy(html); };
  return mw;
}

const MB = 1024 * 1024;
/** How much of a request body is read before it is turned away (413). The backup upload has its own check in its route. */
export const bodyLimitFor = (path) => {
  if (path === '/api/admin/backups/upload') return 0;
  if (path === '/api/import') return 16 * MB;
  if (path === '/api/schedule/ics') return 6 * MB;
  if (path.startsWith('/dav/')) return 1 * MB;
  if (path.startsWith('/api/')) return 1 * MB;
  return 64 * 1024;
};
const limiters = new Map();
export function bodyLimits() {
  return async (c, next) => {
    const max = bodyLimitFor(c.req.path);
    if (!max || c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
    if (!limiters.has(max)) limiters.set(max, bodyLimit({ maxSize: max, onError: (cc) => cc.json({ error: 'too-large' }, 413) }));
    return limiters.get(max)(c, next);
  };
}
