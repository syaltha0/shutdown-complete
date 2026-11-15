import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCipheriv } from 'node:crypto';
import { openDb } from '../src/db.mjs';
import { davSync } from '../src/davsync.mjs';
import { resources, parseTodo } from '../src/vtodo.mjs';

const task = (id, text = id, list) => ({ id, text, done: false, created: '2026-11-01T10:00:00.000Z', ...(list ? { list } : {}) });
const resource = (t) => [...resources({ items: [t] }, t.list ?? 'inbox').values()][0];
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Real HTTP and SQLite; the hook runs after applying a remote operation, before its reply.
// No sleeps, background sync, application endpoints or production test hooks are needed.
async function fixture(t, doc) {
  const db = openDb(':memory:');
  const user = db.users.create({ email: 'sync@example.test', name: 'Sync', password: 'unused', isAdmin: true });
  const id = user.id, remote = new Map(), requests = [];
  const calendars = ['inbox', ...(doc.lists ?? []).map(l => l.id)];
  let sequence = 0, hook = null, failReport = null;
  const store = (item) => {
    const r = resource(item), path = `/home/sc-${item.list ?? 'inbox'}/${item.id}.ics`;
    remote.set(path, { ics: r.ics, etag: `"remote-${++sequence}"` });
    return path;
  };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const path = req.url;
    requests.push({ method: req.method, path, headers: req.headers });
    const reply = (status, text = '', headers = {}) => { res.writeHead(status, headers); res.end(text); };
    if (req.method === 'PROPFIND') {
      return reply(207, '<d:multistatus>' + calendars.map(l => `<d:response><d:href>/home/sc-${l}/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype><d:displayname>${l}</d:displayname></d:prop></d:propstat></d:response>`).join('') + '</d:multistatus>');
    }
    if (req.method === 'REPORT') {
      if (path === failReport) { failReport = null; return reply(503); }
      return reply(207, '<d:multistatus>' + [...remote].filter(([p]) => p.startsWith(path)).map(([p, r]) => `<d:response><d:href>${p}</d:href><d:propstat><d:prop><d:getetag>${xml(r.etag)}</d:getetag><c:calendar-data>${xml(r.ics)}</c:calendar-data></d:prop></d:propstat></d:response>`).join('') + '</d:multistatus>');
    }
    const old = remote.get(path);
    if ((req.headers['if-none-match'] === '*' && old) || (req.headers['if-match'] && req.headers['if-match'] !== old?.etag)) return reply(412);
    if (req.method === 'PUT' || req.method === 'DELETE') {
      const etag = `"remote-${++sequence}"`;
      if (req.method === 'PUT') remote.set(path, { ics: body, etag }); else remote.delete(path);
      if (hook) { const fn = hook; hook = null; fn(req.method); }
      return reply(req.method === 'PUT' ? (old ? 204 : 201) : 204, '', { etag });
    }
    reply(405);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const key = Buffer.alloc(32, 1), iv = Buffer.alloc(12, 2), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update('fixture-password'), cipher.final()]);
  db.meta.set('dav_key', key.toString('hex'));
  db.davLinks.set(id, url, 'fixture-user', [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.'));
  db.davLinks.saveState(id, { home: `${url}/home/`, cals: Object.fromEntries(calendars.map(l => [l, `${url}/home/sc-${l}/`])), items: {}, ignored: [] });
  const sync = davSync({ db, feedProblem: async () => null });
  t.after(async () => { sync.disconnect(id); await new Promise(resolve => server.close(resolve)); });
  const read = () => db.docs.get(id, 'inbox');
  const write = (value) => { const result = db.docs.put(id, 'inbox', value, read()?.version ?? 0); assert.ok(result.doc); };
  write(doc);
  return { db, id, remote, requests, store, read, write, sync: () => sync.sync(id),
    hook(fn) { hook = fn; }, fail(path) { failReport = path; },
    assertEtags() { for (const item of Object.values(db.davLinks.get(id).state.items)) assert.equal(item.etag, remote.get(new URL(item.href).pathname)?.etag); },
  };
}

test('a: a successful PUT followed by a concurrent edit preserves the edit without duplicating its UID', async t => {
  const f = await fixture(t, { items: [task('local', 'Before')] });
  f.store(task('incoming'));
  f.hook(method => { assert.equal(method, 'PUT'); f.write({ ...f.read().value, items: [task('local', 'User edit')] }); });
  assert.deepEqual(await f.sync(), { ok: false, error: 'busy' });
  assert.equal(f.read().value.items[0].text, 'User edit');
  assert.deepEqual(await f.sync(), { ok: true });
  assert.equal(f.read().value.items.find(x => x.id === 'local').text, 'User edit');
  assert.equal(parseTodo(f.remote.get('/home/sc-inbox/local.ics').ics).text, 'User edit');
  assert.equal(f.read().value.items.filter(x => x.id === 'local').length, 1);
  assert.equal(f.requests.filter(r => r.method === 'PUT' && r.headers['if-none-match'] === '*').length, 1);
  f.assertEtags();
});

test('b: a successful DELETE followed by a concurrent addition keeps the addition and the deletion', async t => {
  const f = await fixture(t, { items: [task('deleted')] });
  assert.deepEqual(await f.sync(), { ok: true });
  f.write({ items: [] });
  f.store(task('incoming'));
  f.hook(method => { assert.equal(method, 'DELETE'); f.write({ items: [task('added')] }); });
  assert.deepEqual(await f.sync(), { ok: false, error: 'busy' });
  assert.deepEqual(await f.sync(), { ok: true });
  assert.ok(f.read().value.items.some(x => x.id === 'added'));
  assert.ok(!f.read().value.items.some(x => x.id === 'deleted'));
  assert.ok(!f.remote.has('/home/sc-inbox/deleted.ics'));
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  f.assertEtags();
});

test('c: retry after a partial failure retains uncommitted pulls and never creates the same UID twice', async t => {
  const f = await fixture(t, { lists: [{ id: 'second', name: 'Second' }], items: [task('outgoing')] });
  f.store(task('incoming'));
  f.fail('/home/sc-second/');
  assert.deepEqual(await f.sync(), { ok: false, error: 'report' });
  assert.ok(!f.read().value.items.some(x => x.id === 'incoming'));
  assert.deepEqual(await f.sync(), { ok: true });
  assert.ok(f.read().value.items.some(x => x.id === 'incoming'));
  assert.ok(f.remote.has('/home/sc-inbox/incoming.ics'));
  const before = f.read().version;
  assert.deepEqual(await f.sync(), { ok: true });
  assert.equal(f.read().version, before);
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 1);
  assert.equal(f.remote.size, 2);
  f.assertEtags();
});

test('d: when both sides edit an already synced task, the planner wins on both sides', async t => {
  // Existing davsync policy: simultaneous changes to a known UID favor the planner.
  const f = await fixture(t, { items: [task('shared')] });
  assert.deepEqual(await f.sync(), { ok: true });
  f.store(task('shared', 'Remote edit'));
  f.write({ items: [task('shared', 'Planner edit')] });
  assert.deepEqual(await f.sync(), { ok: true });
  assert.equal(f.read().value.items[0].text, 'Planner edit');
  assert.equal(parseTodo(f.remote.get('/home/sc-inbox/shared.ics').ics).text, 'Planner edit');
  f.assertEtags();
});
