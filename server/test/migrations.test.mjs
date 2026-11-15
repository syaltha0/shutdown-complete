import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { migrate, migrations, SCHEMA_VERSION } from '../src/migrate-sql.mjs';
import { upgradeDocument } from '../src/migrate-docs.mjs';
import { openDb } from '../src/db.mjs';
import { backups, restoreInto, applyPendingRestore } from '../src/backup.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'planner-version-test-'));
// Independent pre-versioning 0.8.4 account/document schema, not produced by migrate().
function legacy(file) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    password TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, email_verified INTEGER NOT NULL DEFAULT 0,
    totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last_step INTEGER NOT NULL DEFAULT 0,
    recovery TEXT NOT NULL DEFAULT '[]', lang TEXT NOT NULL DEFAULT 'en', created_at TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0,
    share_online INTEGER NOT NULL DEFAULT 0, share_focus INTEGER NOT NULL DEFAULT 0, share_label INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE user_docs (user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
      value TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,key));
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO users(id,email,name,password,created_at) VALUES ('u','test@example.test','Test','hash','2026-01-01');`);
  for (const key of ['day:2026-11-15','week:2026-W46','month:2026-11','quarter:2026-Q4','year:2026','settings','inbox','boards']) {
    db.prepare('INSERT INTO user_docs VALUES (?,?,?,?,?)').run('u', key, JSON.stringify({ unchanged: key, nested: [1, 'c'] }), 17, '2026-11-15');
  }
  return db;
}

test('empty database migrates to latest schema and reopens idempotently', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db); migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('PRAGMA table_info(user_docs)').all().find(c => c.name === 'fmt').dflt_value, '1');
  db.close();
});
test('0.8.4 documents retain exact content, counters and timestamps on migration and reads', () => {
  const file = join(dir(), 'old.db'); const db = legacy(file);
  const before = db.prepare('SELECT * FROM user_docs ORDER BY key').all();
  migrate(db);
  assert.deepEqual(db.prepare('SELECT user_id,key,value,version,updated_at FROM user_docs ORDER BY key').all(), before);
  db.close();
  const app = openDb(file);
  for (const row of before) {
    const doc = app.docs.get('u', row.key);
    assert.deepEqual(doc.value, JSON.parse(row.value));
    assert.equal(doc.version, 17); assert.equal(doc.updatedAt, row.updated_at); assert.equal(doc.fmt, 1);
  }
  assert.throws(() => app.docs.put('u', 'settings', {}, 17, 2), /Unsupported settings document format/);
});
test('older column-detection upgrades are transactional and tolerate existing columns', () => {
  const db = legacy(join(dir(), 'older.db'));
  db.exec('ALTER TABLE users DROP COLUMN approved; ALTER TABLE users DROP COLUMN share_label; ALTER TABLE users DROP COLUMN share_focus;');
  migrate(db);
  assert.equal(db.prepare('SELECT approved,share_focus,share_label FROM users').get().approved, 1);
  db.close();
});
test('failed migration rolls back DDL, content and user_version together', () => {
  const db = new DatabaseSync(':memory:');
  assert.throws(() => migrate(db, [migrations[0], d => { d.exec('CREATE TABLE rollback_test (id)'); throw Error('failed step'); }]), /failed step/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n, 0);
  db.close();
});
test('future database version is rejected before mutation', () => {
  const file = join(dir(), 'future.db'); const db = legacy(file);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`); db.close();
  assert.throws(() => openDb(file), /Unsupported database schema version/);
});
test('pure document converter chains are ordered and leave the source unchanged', () => {
  const source = { list: ['old'] };
  const registry = { day: [v => ({ ...v, list: [...v.list, 'v2'] }), v => ({ ...v, ready: true })] };
  assert.deepEqual(upgradeDocument('day:2026-11-15', source, 1, registry), { value: { list: ['old','v2'], ready: true }, fmt: 3 });
  assert.deepEqual(source, { list: ['old'] });
  assert.deepEqual(upgradeDocument('day:x', {}, 2, registry), { value: { ready: true }, fmt: 3 });
  for (const fmt of [0, -1, 4, 1.5, '1', null]) assert.throws(() => upgradeDocument('day:x', {}, fmt, registry), /Unsupported/);
});
test('manifestless gzipped legacy backup restores and upgrades without losing documents', async () => {
  const root = dir(), source = join(root, 'legacy.db'); const db = legacy(source);
  const expected = db.prepare('SELECT key,value,version FROM user_docs ORDER BY key').all(); db.close();
  writeFileSync(source + '.gz', gzipSync(readFileSync(source)));
  const target = join(root, 'restored'); await restoreInto(source + '.gz', target);
  const restored = new DatabaseSync(join(target, 'planner.db'));
  assert.equal(restored.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(restored.prepare('SELECT key,value,version FROM user_docs ORDER BY key').all(), expected);
  restored.close();
});
test('future-schema backup rejects offline recovery, upload and pending restore explicitly', async () => {
  const root = dir(), source = join(root, 'future.db'); const db = legacy(source);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`); db.close();
  await assert.rejects(restoreInto(source, join(root, 'target')), /Unsupported database schema version/);
  const service = backups({ db: openDb(join(root, 'planner.db')), dataDir: root, hour: -1, log() {} });
  assert.match((await service.upload(readFileSync(source))).error, /Unsupported database schema version/);
  writeFileSync(join(root, 'restore-pending.db'), readFileSync(source));
  assert.throws(() => applyPendingRestore(root), /Unsupported database schema version/);
});
test('new backup embeds application version, schema version and creation time', async () => {
  const root = dir(), app = openDb(join(root, 'planner.db'));
  const service = backups({ db: app, dataDir: root, hour: -1, log() {} });
  const name = await service.make();
  const copy = join(root, 'copy.db'); writeFileSync(copy, gunzipSync(readFileSync(service.file(name))));
  const db = new DatabaseSync(copy);
  const manifest = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='backup_manifest'").get().value);
  assert.equal(manifest.appVersion, JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version);
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION); assert.ok(Number.isFinite(Date.parse(manifest.createdAt))); db.close();
  assert.deepEqual(await service.restore(name), { ok: true });
});

test('writes, imports and optimistic conflict counters remain independent of fmt', () => {
  const file = join(dir(), 'writes.db'); legacy(file).close();
  const app = openDb(file);
  const saved = app.docs.put('u', 'settings', { theme: 'dark' }, 17);
  assert.equal(saved.doc.version, 18); assert.equal(saved.doc.fmt, 1);
  assert.equal(app.docs.put('u', 'settings', {}, 17).conflict.version, 18);
  app.docs.importAll('u', [{ key: 'settings', value: { theme: 'light' }, fmt: 1 }]);
  assert.equal(app.docs.get('u', 'settings').version, 19);
  assert.throws(() => app.docs.importAll('u', [
    { key: 'settings', value: { rejected: true } }, { key: 'inbox', value: {}, fmt: 2 },
  ]), /Unsupported inbox document format/);
  assert.deepEqual(app.docs.get('u', 'settings').value, { theme: 'light' });
  const team = app.teams.create('u', { name: 'Team' });
  assert.equal(app.teams.doc(team).fmt, 1);
  assert.equal(app.teams.put(team, { name: 'Updated' }, 1).doc.version, 2);
});
test('manifest on an old-schema backup retains provenance after upgrade', async () => {
  const root = dir(), file = join(root, 'manifested.db'); const db = legacy(file);
  const manifest = { appVersion: '0.8.4', schemaVersion: 0, createdAt: '2026-11-15T00:00:00.000Z' };
  db.prepare("INSERT INTO meta VALUES ('backup_manifest', ?)").run(JSON.stringify(manifest)); db.close();
  const target = join(root, 'restored'); await restoreInto(file, target);
  const restored = new DatabaseSync(join(target, 'planner.db'));
  assert.deepEqual(JSON.parse(restored.prepare("SELECT value FROM meta WHERE key='backup_manifest'").get().value), { ...manifest, schemaVersion: SCHEMA_VERSION, sourceSchemaVersion: 0 });
  restored.close();
});
