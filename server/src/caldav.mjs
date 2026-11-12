// The planner's task lists over CalDAV (RFC 4791), so task apps can keep them: DAVx5 with Tasks.org / OpenTasks / jtx
// Board on a phone, Thunderbird, Apple Reminders. Each list is a calendar holding VTODOs (vtodo.mjs); the account's
// `inbox` document stays the one place they live, written with the same version check as the planner's own writes.
// Apps sign in with the account's e-mail and an app password made in Settings (one per device, revocable), never the
// account password: two-step sign-in cannot be typed into them.
//
//   /.well-known/caldav            -> /dav/
//   /dav/                          the root: who is signed in
//   /dav/principals/<user>/        the account: where its calendars are
//   /dav/calendars/<user>/         the calendars: one per list
//   /dav/calendars/<user>/<list>/  a list: its tasks (and subtasks) as <uid>.ics
import { randomUUID } from 'node:crypto';
import { DEFAULT_LIST, ctagOf, findUid, listOf, removeUid, resources, upsert } from './vtodo.mjs';
import { todayIso } from './recur.mjs';

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"';
const PREFIX = { 'DAV:': 'd', 'urn:ietf:params:xml:ns:caldav': 'c', 'http://calendarserver.org/ns/': 'cs', 'http://apple.com/ns/ical/': 'ic' };
const LIST_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const TINT_HEX = { blue: '#1D5FBF', green: '#2E7D32', amber: '#B45309', red: '#C4242A', grey: '#6B7280' };
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The colour a client asks for, as the nearest of the lists' tints. */
export function nearestTint(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return undefined;
  const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const want = rgb(m[1]);
  return Object.entries(TINT_HEX).map(([k, v]) => [k, rgb(v.slice(1)).reduce((n, x, i) => n + (x - want[i]) ** 2, 0)]).sort((a, b) => a[1] - b[1])[0][0];
}

/** The properties a PROPFIND or REPORT asks for, as namespace + name (none: all we have). */
function askedProps(xml) {
  if (!xml || /<(\w+:)?allprop\b/.test(xml)) return null;
  const ns = { '': 'DAV:' };
  for (const m of xml.matchAll(/xmlns(?::(\w+))?="([^"]*)"/g)) ns[m[1] ?? ''] = m[2];
  const prop = /<(?:(\w+):)?prop\b[^>]*>([\s\S]*?)<\/(?:\w+:)?prop>/.exec(xml);
  if (!prop) return null;
  return [...prop[2].matchAll(/<(?:(\w+):)?([\w-]+)[^>]*?\/?>/g)].map((m) => ({ ns: ns[m[1] ?? ''] ?? 'DAV:', name: m[2] }));
}
const hrefsOf = (xml) => [...String(xml).matchAll(/<(?:\w+:)?href>([^<]*)<\/(?:\w+:)?href>/g)].map((m) => decodeURIComponent(m[1].trim()));

/** A multistatus answer: for each address, the asked properties we have (200) and those we do not (404). */
function multistatus(entries, asked) {
  const body = entries.map(({ href, props }) => {
    const want = asked ?? Object.keys(props).map((k) => ({ ns: k.split('|')[0], name: k.split('|')[1] }));
    const have = [], missing = [];
    for (const w of want) {
      const v = props[`${w.ns}|${w.name}`];
      const p = PREFIX[w.ns];
      if (v === undefined) missing.push(p ? `<${p}:${w.name}/>` : `<x:${w.name} xmlns:x="${xmlEsc(w.ns)}"/>`);
      else have.push(`<${p}:${w.name}>${v}</${p}:${w.name}>`);
    }
    return `<d:response><d:href>${xmlEsc(href)}</d:href>`
      + (have.length ? `<d:propstat><d:prop>${have.join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` : '')
      + (missing.length ? `<d:propstat><d:prop>${missing.join('')}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>` : '')
      + '</d:response>';
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ${NS}>${body}</d:multistatus>`;
}
const D = (n) => `DAV:|${n}`, C = (n) => `urn:ietf:params:xml:ns:caldav|${n}`, CS = (n) => `http://calendarserver.org/ns/|${n}`, IC = (n) => `http://apple.com/ns/ical/|${n}`;

/** @param {import('hono').Hono} app */
export function davRoutes(app, { db, sha256, clientIp, onChange = () => {} }) {
  // wrong passwords, per address: 30 in ten minutes and the address waits (right ones are not counted)
  const fails = new Map();
  const failing = (ip) => (fails.get(ip) ?? []).filter((t) => Date.now() - t < 600_000);
  setInterval(() => { for (const [ip] of fails) if (!failing(ip).length) fails.delete(ip); }, 600_000).unref();
  const xml = (c, status, text) => c.body(text, status, { 'Content-Type': 'application/xml; charset=utf-8' });
  const deny = (c) => c.body('Sign in with your e-mail and an app password from Settings', 401, { 'WWW-Authenticate': 'Basic realm="Shutdown Complete", charset="UTF-8"' });

  /** The account an app signs in as: its e-mail and one of its app passwords (failures counted per address). */
  function account(c) {
    const h = c.req.header('authorization') || '';
    if (!h.startsWith('Basic ')) return null;
    const [email, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    const pw = rest.join(':').replace(/[\s-]/g, '').toLowerCase();
    const ip = clientIp(c);
    if (failing(ip).length >= 30) return 'limited';
    const row = pw && db.appPasswords.byHash(sha256(pw));
    const user = row && db.users.byId(row.user_id);
    if (!user || user.email.toLowerCase() !== String(email).trim().toLowerCase() || !user.approved) { fails.set(ip, [...failing(ip), Date.now()]); return null; }
    db.appPasswords.use(row.id);
    return user;
  }

  // ---- the task lists, read and written ----
  const inboxName = (u) => (u.lang === 'tr' ? 'Gelen kutusu' : 'Inbox');
  const docOf = (u) => db.docs.get(u.id, 'inbox') ?? { value: null, version: 0 };
  const listsOf = (u, doc) => [{ id: DEFAULT_LIST, name: inboxName(u) }, ...(doc?.lists ?? [])];
  /** A change to the tasks, tried again if the planner wrote in between. */
  function write(u, change) {
    for (let i = 0; i < 5; i++) {
      const cur = docOf(u);
      const next = change(cur.value ?? { items: [] });
      if (next === null) return null;
      const res = db.docs.put(u.id, 'inbox', next, cur.version);
      if (!res.conflict) { onChange(u.id); return next; }
    }
    throw new Error('busy');
  }

  const base = (u) => `/dav/calendars/${u.id}/`;
  const principal = (u) => `/dav/principals/${u.id}/`;
  const privileges = '<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:write-properties/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege><d:privilege><d:read-current-user-privilege-set/></d:privilege>';
  const userProps = (u) => ({
    [D('current-user-principal')]: `<d:href>${principal(u)}</d:href>`,
    [D('principal-URL')]: `<d:href>${principal(u)}</d:href>`,
    [D('displayname')]: xmlEsc(u.name),
    [C('calendar-home-set')]: `<d:href>${base(u)}</d:href>`,
    [C('calendar-user-address-set')]: `<d:href>mailto:${xmlEsc(u.email)}</d:href>`,
    [D('owner')]: `<d:href>${principal(u)}</d:href>`,
    [D('current-user-privilege-set')]: privileges,
  });
  const listProps = (u, l, res) => ({
    [D('resourcetype')]: '<d:collection/><c:calendar/>',
    [D('displayname')]: xmlEsc(l.name),
    [C('supported-calendar-component-set')]: '<c:comp name="VTODO"/>',
    [C('supported-calendar-data')]: '<c:calendar-data content-type="text/calendar" version="2.0"/>',
    [D('supported-report-set')]: '<d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report>',
    [CS('getctag')]: ctagOf(res),
    [D('getetag')]: ctagOf(res),
    [D('owner')]: `<d:href>${principal(u)}</d:href>`,
    [D('current-user-principal')]: `<d:href>${principal(u)}</d:href>`,
    [D('current-user-privilege-set')]: privileges,
    ...(l.color && TINT_HEX[l.color] ? { [IC('calendar-color')]: TINT_HEX[l.color] } : {}),
  });
  const itemProps = (r, withData) => ({
    [D('getetag')]: r.etag,
    [D('getcontenttype')]: 'text/calendar; charset=utf-8; component=vtodo',
    [D('resourcetype')]: '',
    ...(withData ? { [C('calendar-data')]: xmlEsc(r.ics) } : {}),
  });

  /** What an address names, for the signed-in account. */
  function locate(u, path) {
    const p = path.replace(/\/+$/, '/');
    if (p === '/dav/' || p === '/dav') return { kind: 'root' };
    let m = /^\/dav\/principals\/([^/]+)\/?$/.exec(p);
    if (m) return m[1] === u.id ? { kind: 'principal' } : { kind: 'other' };
    m = /^\/dav\/calendars\/([^/]+)\/?$/.exec(p);
    if (m) return m[1] === u.id ? { kind: 'home' } : { kind: 'other' };
    m = /^\/dav\/calendars\/([^/]+)\/([^/]+)\/?$/.exec(path);
    if (m && path.endsWith('/')) return m[1] === u.id ? { kind: 'list', list: decodeURIComponent(m[2]) } : { kind: 'other' };
    m = /^\/dav\/calendars\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
    if (m) return m[1] === u.id ? { kind: 'item', list: decodeURIComponent(m[2]), name: decodeURIComponent(m[3]) } : { kind: 'other' };
    return { kind: 'none' };
  }

  app.all('/.well-known/caldav', (c) => c.redirect('/dav/', 301));

  app.all('/dav/*', async (c) => {
    const method = c.req.method.toUpperCase();
    if (method === 'OPTIONS') return c.body(null, 200, { DAV: '1, 3, calendar-access', Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR' });
    const u = account(c);
    if (u === 'limited') return c.body('Too many tries', 429);
    if (!u) return deny(c);
    const where = locate(u, decodeURI(new URL(c.req.url).pathname));
    if (where.kind === 'other') return c.body('Not yours', 403);
    if (where.kind === 'none') return c.body('Not found', 404);
    const doc = docOf(u).value ?? { items: [] };
    const lists = listsOf(u, doc);
    const list = where.list ? lists.find((l) => l.id === where.list) : null;
    if ((where.kind === 'list' || where.kind === 'item') && !list && method !== 'MKCALENDAR' && method !== 'MKCOL') return c.body('No such list', 404);
    const body = ['PROPFIND', 'REPORT', 'PROPPATCH', 'MKCALENDAR', 'MKCOL', 'PUT'].includes(method) ? await c.req.text() : '';
    const depth = c.req.header('depth') ?? (method === 'PROPFIND' ? 'infinity' : '0');

    switch (method) {
      case 'PROPFIND': {
        const asked = askedProps(body);
        const out = [];
        if (where.kind === 'root') out.push({ href: '/dav/', props: { [D('resourcetype')]: '<d:collection/>', ...userProps(u) } });
        if (where.kind === 'principal') out.push({ href: principal(u), props: { [D('resourcetype')]: '<d:principal/>', ...userProps(u) } });
        if (where.kind === 'home') {
          out.push({ href: base(u), props: { [D('resourcetype')]: '<d:collection/>', ...userProps(u) } });
          if (depth !== '0') for (const l of lists) out.push({ href: `${base(u)}${encodeURIComponent(l.id)}/`, props: listProps(u, l, resources(doc, l.id)) });
        }
        if (where.kind === 'list') {
          const res = resources(doc, list.id);
          out.push({ href: `${base(u)}${encodeURIComponent(list.id)}/`, props: listProps(u, list, res) });
          if (depth !== '0') for (const [name, r] of res) out.push({ href: `${base(u)}${encodeURIComponent(list.id)}/${encodeURIComponent(name)}`, props: itemProps(r, false) });
        }
        if (where.kind === 'item') {
          const r = resources(doc, list.id).get(where.name);
          if (!r) return c.body('Not found', 404);
          out.push({ href: c.req.path, props: itemProps(r, false) });
        }
        return xml(c, 207, multistatus(out, asked));
      }

      case 'REPORT': {
        if (where.kind !== 'list') return c.body('Reports are made on a list', 403);
        const asked = askedProps(body);
        const withData = !asked || asked.some((a) => a.name === 'calendar-data');
        const res = resources(doc, list.id);
        const at = `${base(u)}${encodeURIComponent(list.id)}/`;
        if (/calendar-multiget/.test(body)) {
          const out = hrefsOf(body).map((h) => {
            const r = res.get(h.split('/').pop());
            return r ? { href: h, props: itemProps(r, withData) } : { href: h, props: {} };
          });
          return xml(c, 207, multistatus(out, asked));
        }
        // calendar-query: everything here is a VTODO; a filter asking for VEVENTs finds nothing
        if (/name="VEVENT"/i.test(body)) return xml(c, 207, multistatus([], asked));
        return xml(c, 207, multistatus([...res].map(([name, r]) => ({ href: `${at}${encodeURIComponent(name)}`, props: itemProps(r, withData) })), asked));
      }

      case 'GET': case 'HEAD': {
        if (where.kind !== 'item') return c.body('Not a task', 405);
        const r = resources(doc, list.id).get(where.name);
        if (!r) return c.body('Not found', 404);
        return c.body(method === 'HEAD' ? null : r.ics, 200, { 'Content-Type': 'text/calendar; charset=utf-8', ETag: r.etag });
      }

      case 'PUT': {
        if (where.kind !== 'item') return c.body('Tasks are put into a list', 405);
        if (body.length > 256 * 1024) return c.body('Too large', 413);
        const cur = resources(doc, list.id).get(where.name);
        const ifMatch = c.req.header('if-match'), ifNone = c.req.header('if-none-match');
        if (ifNone === '*' && cur) return c.body('Already there', 412);
        if (ifMatch && (!cur || (ifMatch !== '*' && ifMatch !== cur.etag))) return c.body('Changed since', 412);
        let error = null;
        try {
          write(u, (d) => {
            const r = upsert(d, list.id, where.name, body, todayIso());
            if (r.error) { error = r.error; return null; }
            // a task moved here from another list in the app: it leaves that list
            return r.doc;
          });
        } catch { return c.body('Busy, try again', 503); }
        if (error) return c.body('Only VTODOs are kept here', 415);
        const fresh = docOf(u).value;
        const now = [...resources(fresh, list.id)].find(([n]) => n === where.name)?.[1]
          ?? [...resources(fresh, list.id).values()].find((r) => r.uid === /UID:([^\r\n]+)/.exec(body)?.[1]);
        return c.body(null, cur ? 204 : 201, now ? { ETag: now.etag } : {});
      }

      case 'DELETE': {
        if (where.kind === 'item') {
          const r = resources(doc, list.id).get(where.name);
          if (!r) return c.body('Not found', 404);
          const ifMatch = c.req.header('if-match');
          if (ifMatch && ifMatch !== '*' && ifMatch !== r.etag) return c.body('Changed since', 412);
          write(u, (d) => removeUid(d, r.uid));
          return c.body(null, 204);
        }
        if (where.kind === 'list') {
          if (list.id === DEFAULT_LIST) return c.body('The first list stays', 403);
          write(u, (d) => ({ ...d, lists: (d.lists ?? []).filter((l) => l.id !== list.id), items: d.items.filter((t) => listOf(t) !== list.id) }));
          return c.body(null, 204);
        }
        return c.body('Not here', 405);
      }

      case 'MKCALENDAR': case 'MKCOL': {
        if (where.kind !== 'list') return c.body('Lists are made in the calendars', 403);
        if (list) return c.body('Already there', 405);
        if (!LIST_ID.test(where.list)) return c.body('Use letters, digits, - and _ in the address', 403);
        const name = /<(?:\w+:)?displayname>([^<]*)</.exec(body)?.[1]?.trim() || where.list;
        const color = nearestTint(/<(?:\w+:)?calendar-color[^>]*>([^<]*)</.exec(body)?.[1]);
        write(u, (d) => ({ ...d, lists: [...(d.lists ?? []), { id: where.list, name: name.slice(0, 60), ...(color ? { color } : {}) }] }));
        return c.body(null, 201);
      }

      case 'PROPPATCH': {
        if (where.kind !== 'list') return xml(c, 207, multistatus([], []));
        const name = /<(?:\w+:)?displayname>([^<]*)</.exec(body)?.[1]?.trim();
        const color = nearestTint(/<(?:\w+:)?calendar-color[^>]*>([^<]*)</.exec(body)?.[1]);
        if (list.id !== DEFAULT_LIST && (name || color)) {
          write(u, (d) => ({ ...d, lists: (d.lists ?? []).map((l) => (l.id === list.id ? { ...l, ...(name ? { name: name.slice(0, 60) } : {}), ...(color ? { color } : {}) } : l)) }));
        }
        const set = [...body.matchAll(/<(?:(\w+):)?(displayname|calendar-color|calendar-order|calendar-description)\b/g)].map((m) => m[2]);
        const props = Object.fromEntries(set.map((n) => [n === 'displayname' ? D(n) : n === 'calendar-description' ? C(n) : IC(n), '']));
        return xml(c, 207, multistatus([{ href: c.req.path, props }], null));
      }
    }
    return c.body('Not supported', 405);
  });

  // ---- app passwords, from Settings ----
  const newPassword = () => {
    const a = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    let s = '';
    for (let i = 0; i < 20; i++) s += a[parseInt(bytes.slice(i * 3, i * 3 + 3), 16) % a.length];
    return s.match(/.{5}/g).join('-');
  };
  return {
    list: (u) => db.appPasswords.of(u).map((p) => ({ id: p.id, name: p.name, created: p.created_at, lastUsed: p.last_used })),
    /** A new app password: shown once, kept as its sha256. */
    create(u, name) {
      const pw = newPassword();
      db.appPasswords.add(u, name, sha256(pw.replace(/-/g, '')));
      return pw;
    },
    remove: (u, id) => db.appPasswords.remove(id, u),
    findUid,
  };
}
