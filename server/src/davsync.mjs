// Keeping the task lists in step with a Nextcloud (or any CalDAV server): each list is a calendar of tasks there, and
// every few minutes (and soon after a change here) both sides are compared with what they were at the last sync:
// a change on one side is copied to the other, a task made or deleted on one side is made or deleted on the other.
// When both changed the same task, this planner's version wins. The app password for the Nextcloud is kept encrypted
// with a key of this server's own.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DEFAULT_LIST, listOf, parseTodo, removeUid, resources, upsert } from './vtodo.mjs';
import { todayIso } from './recur.mjs';
import { TINT_HEX, nearestTint } from './caldav.mjs';

const TIMEOUT = 15_000, EVERY = 5 * 60_000, SOON = 15_000;
const unxml = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (block, name) => { const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(block); return m ? unxml(m[1].trim()) : null; };
/** The responses of a multistatus, each with its address and its (found) properties' raw text. */
const responses = (xml) => String(xml).split(/<(?:[\w-]+:)?response[\s>]/).slice(1).map((r) => {
  const ok = r.split(/<(?:[\w-]+:)?propstat[\s>]/).slice(1).filter((p) => /HTTP\/1\.\d 2\d\d/.test(tag(p, 'status') ?? 'HTTP/1.1 200')).join('');
  return { href: decodeURIComponent(tag(r, 'href') ?? ''), props: ok || r };
});
const slug = (s) => String(s).replace(/\/+$/, '').split('/').pop().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'list';

export function davSync({ db, feedProblem, log = () => {} }) {
  // ---- the stored password, encrypted ----
  const key = Buffer.from(db.meta.get('dav_key') || (() => { const k = randomBytes(32).toString('hex'); db.meta.set('dav_key', k); return k; })(), 'hex');
  const seal = (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); const d = Buffer.concat([c.update(s, 'utf8'), c.final()]); return [iv, c.getAuthTag(), d].map((b) => b.toString('base64')).join('.'); };
  const open = (s) => { const [iv, t, d] = s.split('.').map((b) => Buffer.from(b, 'base64')); const c = createDecipheriv('aes-256-gcm', key, iv); c.setAuthTag(t); return Buffer.concat([c.update(d), c.final()]).toString('utf8'); };

  // ---- talking to the other server ----
  /** A request to the other server, following redirects (each address checked like a linked calendar's). */
  async function call(link, method, url, body, headers = {}) {
    let at = url;
    for (let hop = 0; hop < 4; hop++) {
      const problem = await feedProblem(at, link.mayPrivate);
      if (problem) throw Object.assign(new Error(problem), { code: problem });
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
      let res;
      try {
        res = await fetch(at, { method, body, redirect: 'manual', signal: ctl.signal, headers: { authorization: link.auth, 'user-agent': 'ShutdownComplete-sync/1', ...(body ? { 'content-type': 'application/xml; charset=utf-8' } : {}), ...headers } });
      } catch { throw Object.assign(new Error('unreachable'), { code: 'unreachable' }); } finally { clearTimeout(timer); }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { at = new URL(res.headers.get('location'), at).href; continue; }
      if (res.status === 401 || res.status === 403 && method === 'PROPFIND') throw Object.assign(new Error('auth'), { code: 'auth' });
      return { status: res.status, etag: res.headers.get('etag'), text: await res.text(), url: at };
    }
    throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
  }
  const propfind = (link, url, depth, props) => call(link, 'PROPFIND', url, `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>`, { depth: String(depth) });

  /** Where the account's calendars are: tried at the address given, its /.well-known/caldav and Nextcloud's /remote.php/dav. */
  async function discover(link) {
    const root = link.url.replace(/\/+$/, '');
    for (const at of [`${root}/`, `${new URL(root).origin}/.well-known/caldav`, `${new URL(root).origin}/remote.php/dav/`]) {
      let r;
      try { r = await propfind(link, at, 0, '<d:current-user-principal/><c:calendar-home-set/>'); } catch (e) { if (e.code === 'auth') throw e; continue; }
      if (r.status !== 207) continue;
      let home = tag(responses(r.text)[0]?.props ?? '', 'calendar-home-set');
      const principal = tag(responses(r.text)[0]?.props ?? '', 'current-user-principal');
      if (!home && principal) {
        const p = await propfind(link, new URL(tag(principal, 'href') ?? principal, r.url).href, 0, '<c:calendar-home-set/>');
        home = tag(responses(p.text)[0]?.props ?? '', 'calendar-home-set');
      }
      if (home) return new URL(tag(home, 'href') ?? home, r.url).href;
    }
    throw Object.assign(new Error('no-caldav'), { code: 'no-caldav' });
  }

  /** The other side's calendars that hold tasks. */
  async function calendars(link, home) {
    const r = await propfind(link, home, 1, '<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><ic:calendar-color/>');
    // a calendar (not the account's scheduling in/outbox) that takes tasks, or says nothing of what it takes
    const takesTasks = (x) => /:calendar\b|<calendar\b/.test(tag(x.props, 'resourcetype') ?? '') && (!/<(?:[\w-]+:)?comp\b/.test(x.props) || /name="VTODO"/i.test(x.props));
    return responses(r.text).filter(takesTasks)
      .map((x) => ({ href: new URL(x.href, home).href, name: tag(x.props, 'displayname') || slug(x.href), color: nearestTint(tag(x.props, 'calendar-color')) }));
  }

  /** A calendar's tasks: address -> {etag, ics, uid, parent}. */
  async function tasksOf(link, href) {
    const r = await call(link, 'REPORT', href, '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>', { depth: '1' });
    if (r.status !== 207) throw Object.assign(new Error(`report ${r.status} ${href}`), { code: 'report' });
    const out = new Map();
    for (const x of responses(r.text)) {
      const ics = tag(x.props, 'calendar-data');
      const v = ics && parseTodo(ics);
      if (v) out.set(v.uid, { href: new URL(x.href, href).href, etag: tag(x.props, 'getetag'), ics, parent: v.parent });
    }
    return out;
  }

  // ---- one account's sync ----
  const runs = new Map(), timers = new Map();
  const inboxName = (u) => (u.lang === 'tr' ? 'Gelen kutusu' : 'Inbox');

  /** One sync at a time per account: a second one asked for meanwhile runs after it. */
  function sync(userId) {
    const p = (runs.get(userId) ?? Promise.resolve()).then(() => syncNow(userId));
    runs.set(userId, p);
    return p.finally(() => { if (runs.get(userId) === p) runs.delete(userId); });
  }
  async function syncNow(userId) {
    const row = db.davLinks.get(userId), user = db.users.byId(userId);
    if (!row || !user) return null;
    const state = { cals: {}, items: {}, ignored: [], ...row.state };
    try {
      const link = { url: row.url, auth: `Basic ${Buffer.from(`${row.username}:${open(row.secret)}`).toString('base64')}`, mayPrivate: !!user.is_admin };
      const home = state.home ?? await discover(link);
      state.home = home;
      const cur = db.docs.get(userId, 'inbox') ?? { value: null, version: 0 };
      let doc = cur.value ?? { items: [] };
      const today = todayIso();

      // lists <-> calendars
      const remote = await calendars(link, home), gone = new Set();
      const lists = () => [{ id: DEFAULT_LIST, name: inboxName(user) }, ...(doc.lists ?? [])];
      for (const [id, href] of Object.entries(state.cals)) {
        if (!lists().some((l) => l.id === id)) {
          // a list deleted here: its calendar goes too if this planner made it, else it is left alone from now on
          if (remote.some((r) => r.href === href)) {
            if (slug(href).startsWith('sc-')) { await call(link, 'DELETE', href); gone.add(href); } else state.ignored.push(href);
          }
          delete state.cals[id];
          for (const [u, s] of Object.entries(state.items)) if (s.list === id) delete state.items[u];
        } else if (!remote.some((r) => r.href === href)) {
          // its calendar deleted there: the list goes here too (the first list stays and is made there again)
          if (id !== DEFAULT_LIST) doc = { ...doc, lists: (doc.lists ?? []).filter((l) => l.id !== id), items: doc.items.filter((t) => listOf(t) !== id) };
          delete state.cals[id];
          for (const [u, s] of Object.entries(state.items)) if (s.list === id) delete state.items[u];
        }
      }
      for (const r of remote) {
        if (Object.values(state.cals).includes(r.href) || state.ignored.includes(r.href) || gone.has(r.href)) continue;
        const own = slug(r.href).startsWith('sc-') ? slug(r.href).slice(3) : null;
        if (own && lists().some((l) => l.id === own) && !state.cals[own]) { state.cals[own] = r.href; continue; }
        // a calendar of tasks made there: a list here
        let id = slug(r.href);
        while (lists().some((l) => l.id === id)) id = `${id}-2`;
        doc = { ...doc, lists: [...(doc.lists ?? []), { id, name: r.name.slice(0, 60), ...(r.color ? { color: r.color } : {}) }] };
        state.cals[id] = r.href;
      }
      for (const l of lists()) {
        if (state.cals[l.id]) continue;
        const href = `${home.replace(/\/?$/, '/')}sc-${l.id}/`;
        const made = await call(link, 'MKCALENDAR', href, `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${String(l.name).replace(/[<&]/g, '')}</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>${l.color ? `<ic:calendar-color>${TINT_HEX[l.color]}</ic:calendar-color>` : ''}</d:prop></d:set></c:mkcalendar>`);
        if (made.status >= 300 && made.status !== 405) throw Object.assign(new Error('mkcalendar'), { code: 'mkcalendar' });
        state.cals[l.id] = href;
      }

      // tasks, list by list
      for (const [listId, href] of Object.entries(state.cals)) {
        const there = await tasksOf(link, href);
        const here = new Map([...resources(doc, listId).values()].map((r) => [r.uid, r]));
        const uids = new Set([...there.keys(), ...here.keys(), ...Object.entries(state.items).filter(([, s]) => s.list === listId).map(([u]) => u)]);
        const pulls = [];
        for (const uid of uids) {
          const s = state.items[uid], L = here.get(uid), R = there.get(uid);
          const lChanged = !s || !L || L.etag !== s.hash, rChanged = !s || !R || R.etag !== s.etag;
          if (L && R) {
            if (s && !lChanged && !rChanged) continue;
            if (!s || (rChanged && !lChanged)) pulls.push(R);
            else {
              const put = await call(link, 'PUT', R.href, L.ics, { 'content-type': 'text/calendar; charset=utf-8', ...(R.etag ? { 'if-match': R.etag } : {}) });
              state.items[uid] = { list: listId, href: R.href, etag: put.status < 300 ? put.etag : null, hash: L.etag };
            }
          } else if (L) {
            if (s && !lChanged) { doc = removeUid(doc, uid); delete state.items[uid]; continue; } // deleted there
            const at = `${href.replace(/\/?$/, '/')}${encodeURIComponent(uid)}.ics`;
            const put = await call(link, 'PUT', at, L.ics, { 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' });
            state.items[uid] = { list: listId, href: at, etag: put.status < 300 ? put.etag : null, hash: L.etag };
          } else if (R) {
            if (s && !rChanged) { await call(link, 'DELETE', R.href, undefined, R.etag ? { 'if-match': R.etag } : {}); delete state.items[uid]; continue; } // deleted here
            pulls.push(R);
          } else delete state.items[uid];
        }
        // tasks before their subtasks
        pulls.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
        for (const R of pulls) {
          const v = parseTodo(R.ics);
          doc = upsert(doc, listId, `${v.uid}.ics`, R.ics, today).doc;
          state.items[v.uid] = { list: listId, href: R.href, etag: R.etag, hash: null };
        }
        // what each task reads as here now, for the next comparison
        const after = new Map([...resources(doc, listId).values()].map((r) => [r.uid, r.etag]));
        for (const [u, s] of Object.entries(state.items)) if (s.list === listId && after.has(u)) s.hash = after.get(u);
      }

      if (JSON.stringify(doc) !== JSON.stringify(cur.value ?? { items: [] })) {
        const res = db.docs.put(userId, 'inbox', doc, cur.version);
        if (res.conflict) { schedule(userId); return { ok: false, error: 'busy' }; } // changed meanwhile: again soon
      }
      db.davLinks.saveState(userId, state, null);
      return { ok: true };
    } catch (e) {
      log(`sync ${userId}: ${e.message}`);
      db.davLinks.saveState(userId, state, e.code || 'failed');
      return { ok: false, error: e.code || 'failed' };
    }
  }

  /** A sync soon (after a change here), several changes in a row making one. */
  function schedule(userId) {
    if (!db.davLinks.get(userId)) return;
    clearTimeout(timers.get(userId));
    timers.set(userId, setTimeout(() => { timers.delete(userId); sync(userId); }, SOON).unref());
  }
  setInterval(() => { for (const u of db.davLinks.users()) sync(u); }, EVERY).unref();

  return {
    sync, schedule,
    /** Linked after checking that the address answers and the password works. */
    async connect(userId, { url, username, password }, mayPrivate) {
      let u;
      try { u = new URL(String(url).trim()); } catch { return { error: 'url' }; }
      if (!['http:', 'https:'].includes(u.protocol)) return { error: 'url' };
      const link = { url: u.href, auth: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`, mayPrivate };
      try { await discover(link); } catch (e) { return { error: e.code || 'unreachable' }; }
      db.davLinks.set(userId, u.href, String(username), seal(String(password)));
      return { ok: true, result: await sync(userId) };
    },
    status(userId) {
      const l = db.davLinks.get(userId);
      return l ? { url: l.url, username: l.username, lastSync: l.last_sync, error: l.last_error, lists: Object.keys(l.state.cals ?? {}).length } : null;
    },
    disconnect: (userId) => { clearTimeout(timers.get(userId)); db.davLinks.remove(userId); },
  };
}
