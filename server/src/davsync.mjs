// Keeping the task lists in step with a Nextcloud (or any CalDAV server): each list is a calendar of tasks there, and
// every few minutes (and soon after a change here) both sides are compared with what they were at the last sync:
// a change on one side is copied to the other, a task made or deleted on one side is made or deleted on the other.
// When both changed the same task, this planner's version wins. The app password for the Nextcloud is kept encrypted
// with a key of this server's own.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DEFAULT_LIST, listOf, parseTodo, removeUid, resources, upsert } from './vtodo.mjs';
import { planningDay, dayStartOf } from './planday.mjs';
import { TINT_HEX, nearestTint } from './caldav.mjs';
import { guardedFetch } from './safefetch.mjs';
import { newSyncRun, countSyncOperation, finishSyncRun } from './sync-log.mjs';
import { privateAllowed } from './calendar.mjs';

const MAX_REPLY = 16 * 1024 * 1024; // what another server may answer with, at most
const TIMEOUT = 15_000, EVERY = 5 * 60_000, SOON = 15_000;
const unxml = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// The text of the first <name>…</name>. The patterns are bounded: a reply made of endless opening tags must not make this slow.
export const xmlTag = (block, name) => {
  const open = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]{0,300}>`).exec(block);
  if (!open) return null;
  const from = open.index + open[0].length, close = new RegExp(`</(?:[\\w-]+:)?${name}>`, 'g');
  close.lastIndex = from;
  const end = close.exec(block);
  return end ? unxml(block.slice(from, end.index).trim()) : null;
};
const tag = xmlTag;
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
      if (new URL(at).origin !== new URL(link.url).origin) throw Object.assign(new Error('url'), { code: 'url' });
      const problem = await feedProblem(at, link.mayPrivate);
      if (problem) throw Object.assign(new Error(problem), { code: problem });
      let res;
      try {
        const host = new URL(at).hostname.replace(/^\[|\]$/g, '');
        res = await guardedFetch(at, { method, body, timeoutMs: TIMEOUT, maxBytes: MAX_REPLY, allowPrivate: !!link.mayPrivate || privateAllowed(host),
          headers: { authorization: link.auth, 'user-agent': 'ShutdownComplete-sync/1', ...(body ? { 'content-type': 'application/xml; charset=utf-8' } : {}), ...headers } });
      } catch (e) { throw Object.assign(new Error(e.code === 'private' ? 'private' : 'unreachable'), { code: e.code === 'private' ? 'private' : 'unreachable' }); }
      if (res.status >= 300 && res.status < 400 && res.headers.location) { const next = new URL(res.headers.location, at); if (next.origin !== new URL(link.url).origin) throw Object.assign(new Error('url'), { code: 'url' }); at = next.href; continue; }
      if (res.status === 401 || res.status === 403 && method === 'PROPFIND') throw Object.assign(new Error('auth'), { code: 'auth', status: res.status });
      if (['PUT', 'DELETE'].includes(method) && res.status >= 300) throw Object.assign(new Error(res.status === 412 ? 'conflict' : 'failed'), { code: res.status === 412 ? 'conflict' : 'failed', status: res.status });
      return { status: res.status, etag: res.headers.etag ?? null, text: res.body.toString('utf8'), url: at };
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
    if (r.status !== 207) throw Object.assign(new Error(`report ${r.status} ${href}`), { code: 'report', status: r.status });
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
    const run = newSyncRun(), started = Date.now();
    let current = null, title = '', password = '';
    const initialDoc = db.docs.get(userId, 'inbox')?.value;
    run.lists = [{ id: DEFAULT_LIST, name: inboxName(user) }, ...(initialDoc?.lists ?? [])].map(l => ({ id: l.id, name: l.name, received: 0, sent: 0, deleted: 0, skipped: 0 }));
    const state = { cals: {}, items: {}, ignored: [], ...row.state };
    try {
      password = open(row.secret);
      const link = { url: row.url, auth: `Basic ${Buffer.from(`${row.username}:${password}`).toString('base64')}`, mayPrivate: !!user.is_admin };
      const home = state.home ?? await discover(link);
      state.home = home;
      const cur = db.docs.get(userId, 'inbox') ?? { value: null, version: 0 };
      let doc = cur.value ?? { items: [] };
      const today = planningDay(new Date(), dayStartOf(db.docs.get(userId, 'settings')?.value));

      // lists <-> calendars
      const remote = await calendars(link, home), gone = new Set();
      const lists = () => [{ id: DEFAULT_LIST, name: inboxName(user) }, ...(doc.lists ?? [])];
      for (const [id, href] of Object.entries(state.cals)) {
        if (!lists().some((l) => l.id === id)) {
          // a list deleted here: its calendar goes too if this planner made it, else it is left alone from now on
          if (remote.some((r) => r.href === href)) {
            if (slug(href).startsWith('sc-')) { await call(link, 'DELETE', href); gone.add(href);
              const deleted = Object.values(state.items).filter(item => item.list === id).length;
              run.lists.push({ id, name: id, received: 0, sent: 0, deleted, skipped: 0 });
            } else state.ignored.push(href);
          }
          delete state.cals[id];
          for (const [u, s] of Object.entries(state.items)) if (s.list === id) delete state.items[u];
        } else if (!remote.some((r) => r.href === href)) {
          // its calendar deleted there: the list goes here too (the first list stays and is made there again)
          if (id !== DEFAULT_LIST) {
            const summary = run.lists.find(l => l.id === id);
            if (summary) summary.deleted += resources(doc, id).size;
          }
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
      for (const l of lists()) if (!run.lists.some(x => x.id === l.id)) run.lists.push({ id: l.id, name: l.name, received: 0, sent: 0, deleted: 0, skipped: 0 });
      for (const [listId, href] of Object.entries(state.cals)) {
        current = run.lists.find(l => l.id === listId); title = '';
        const there = await tasksOf(link, href);
        const here = new Map([...resources(doc, listId).values()].map((r) => [r.uid, r]));
        const uids = new Set([...there.keys(), ...here.keys(), ...Object.entries(state.items).filter(([, s]) => s.list === listId).map(([u]) => u)]);
        const pulls = [];
        for (const uid of uids) {
          const s = state.items[uid], L = here.get(uid), R = there.get(uid);
          title = parseTodo(L?.ics ?? R?.ics ?? '')?.text ?? '';
          const lChanged = !s || !L || L.etag !== s.hash, rChanged = !s || !R || R.etag !== s.etag;
          if (L && R) {
            if (s && !lChanged && !rChanged) { countSyncOperation(current, 'skipped'); continue; }
            if (!s || (rChanged && !lChanged)) pulls.push(R);
            else {
              const put = await call(link, 'PUT', R.href, L.ics, { 'content-type': 'text/calendar; charset=utf-8', ...(R.etag ? { 'if-match': R.etag } : {}) });
              countSyncOperation(current, 'sent');
              state.items[uid] = { list: listId, href: R.href, etag: put.status < 300 ? put.etag : null, hash: L.etag };
            }
          } else if (L) {
            if (s && !lChanged) { doc = removeUid(doc, uid); countSyncOperation(current, 'deleted'); delete state.items[uid]; continue; } // deleted there
            const at = `${href.replace(/\/?$/, '/')}${encodeURIComponent(uid)}.ics`;
            const put = await call(link, 'PUT', at, L.ics, { 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' });
            countSyncOperation(current, 'sent');
            state.items[uid] = { list: listId, href: at, etag: put.status < 300 ? put.etag : null, hash: L.etag };
          } else if (R) {
            if (s && !rChanged) { await call(link, 'DELETE', R.href, undefined, R.etag ? { 'if-match': R.etag } : {}); countSyncOperation(current, 'deleted'); delete state.items[uid]; continue; } // deleted here
            pulls.push(R);
          } else delete state.items[uid];
        }
        // tasks before their subtasks
        pulls.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
        for (const R of pulls) {
          const v = parseTodo(R.ics);
          title = v.text;
          doc = upsert(doc, listId, `${v.uid}.ics`, R.ics, today).doc;
          countSyncOperation(current, 'received');
          let etag = R.etag;
          const rolled = [...resources(doc, listId).values()].find(r => r.uid === v.uid);
          const next = rolled && parseTodo(rolled.ics);
          if (v.done && next && (!next.done || next.due !== v.due)) {
            const put = await call(link, 'PUT', R.href, rolled.ics, { 'content-type': 'text/calendar; charset=utf-8', ...(R.etag ? { 'if-match': R.etag } : {}) });
            countSyncOperation(current, 'sent');
            etag = put.etag;
          }
          state.items[v.uid] = { list: listId, href: R.href, etag, hash: null };
        }
        // what each task reads as here now, for the next comparison
        const after = new Map([...resources(doc, listId).values()].map((r) => [r.uid, r.etag]));
        for (const [u, s] of Object.entries(state.items)) if (s.list === listId && after.has(u)) s.hash = after.get(u);
      }

      if (JSON.stringify(doc) !== JSON.stringify(cur.value ?? { items: [] })) {
        const res = db.docs.put(userId, 'inbox', doc, cur.version);
        if (res.conflict) { run.error = 'busy'; schedule(userId); return { ok: false, error: 'busy' }; } // changed meanwhile: again soon
      }
      state.published = db.davLinks.get(userId)?.state.published;
      db.davLinks.saveState(userId, state, null);
      run.ok = true;
      return { ok: true };
    } catch (e) {
      run.error = e.code || 'failed';
      run.errors.push({ listId: current?.id ?? null, title, status: Number.isInteger(e.status) ? e.status : null, reason: run.error });
      log(`sync ${userId}: ${e.code || 'failed'}`);
      state.published = db.davLinks.get(userId)?.state.published;
      db.davLinks.saveState(userId, state, e.code || 'failed');
      return { ok: false, error: e.code || 'failed' };
    } finally {
      const latest = db.davLinks.get(userId);
      if (latest) db.davLinks.saveState(userId, { ...latest.state, history: finishSyncRun(latest.state.history, run, Date.now() - started, [password, row.username]) }, latest.last_error);
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
      const doc = db.docs.get(userId, 'inbox')?.value;
      return l ? { history: l.state.history ?? [], url: l.url, username: l.username, lastSync: l.last_sync, error: l.last_error, lists: Object.keys(l.state.cals ?? {}).length,
        routes: Object.keys(l.state.cals ?? {}).map(id => ({ id, name: doc?.lists?.find(x => x.id === id)?.name ?? inboxName(db.users.byId(userId)), published: l.state.published?.[id] === true })) } : null;
    },
    publish(userId, id, enabled) {
      const l = db.davLinks.get(userId);
      if (!l?.state.cals?.[id]) return false;
      db.davLinks.saveState(userId, { ...l.state, published: { ...l.state.published, [id]: enabled } }, l.last_error);
      return true;
    },
    disconnect: (userId) => { clearTimeout(timers.get(userId)); db.davLinks.remove(userId); },
  };
}
