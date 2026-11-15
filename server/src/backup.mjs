// Backups of the whole server: the database copied whole (SQLite's VACUUM INTO gives a consistent copy while the
// planner runs) and gzipped into DATA_DIR/backups, once a day after BACKUP_HOUR (default 3, the server's time) and
// whenever the owner asks; the newest BACKUP_KEEP (default 7) are kept. A restore puts the chosen copy in place at the
// next start (the copy is checked first, and what is there now is kept as a backup of its own); the server then stops,
// so Docker's restart policy (or whoever runs it) starts it again.
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { assertSchemaVersion, migrateFile } from './migrate-sql.mjs';
const appVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// Stored inside the snapshot so downloads remain a single portable .db.gz file.
function writeManifest(file) {
  const copy = new DatabaseSync(file);
  try {
    const manifest = { appVersion, schemaVersion: assertSchemaVersion(copy), createdAt: new Date().toISOString() };
    copy.prepare("INSERT INTO meta (key, value) VALUES ('backup_manifest', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(manifest));
  } finally { copy.close(); }
}
function prepareRestore(file) {
  if (!isPlannerDb(file)) throw new Error('Backup is damaged or has an unsupported schema.');
  const before = new DatabaseSync(file, { readOnly: true });
  let version;
  try { version = assertSchemaVersion(before); } finally { before.close(); }
  migrateFile(file);
  // Preserve a manifest on same-version restores; update it only after an upgrade.
  const after = new DatabaseSync(file);
  try {
    const schemaVersion = assertSchemaVersion(after);
    if (version !== schemaVersion) {
      const raw = after.prepare("SELECT value FROM meta WHERE key='backup_manifest'").get()?.value;
      if (raw) {
        const manifest = { ...JSON.parse(raw), sourceSchemaVersion: version, schemaVersion };
        after.prepare("UPDATE meta SET value=? WHERE key='backup_manifest'").run(JSON.stringify(manifest));
      }
    }
  } finally { after.close(); }
}

const NAME = /^planner-[\w-]+\.db\.gz$/;
const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Before the database is opened: a restore asked for at the last run is put in place. */
export function applyPendingRestore(dataDir, log = console.log) {
  const pending = join(dataDir, 'restore-pending.db');
  if (!existsSync(pending)) return false;
  prepareRestore(pending);
  const file = join(dataDir, 'planner.db');
  if (existsSync(file)) {
    const current = new DatabaseSync(file);
    try { current.exec(`VACUUM INTO '${join(dataDir, `before-restore-${Date.now()}.db`).replace(/'/g, "''")}'`); }
    finally { current.close(); }
  }
  for (const x of ['', '-wal', '-shm']) rmSync(file + x, { force: true });
  renameSync(pending, file);
  log('Restored the planner from a backup.');
  return true;
}

/** Whether a file is a planner database (it opens and has accounts). */
function isPlannerDb(file) {
  let d = null;
  try {
    d = new DatabaseSync(file, { readOnly: true });
    if (d.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') return false;
    const schemaVersion = assertSchemaVersion(d);
    const rawManifest = d.prepare("SELECT value FROM meta WHERE key='backup_manifest'").get()?.value;
    if (rawManifest) {
      const manifest = JSON.parse(rawManifest);
      if (manifest.schemaVersion !== schemaVersion || typeof manifest.appVersion !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) return false;
    }
    d.prepare('SELECT id, email, password FROM users LIMIT 0').all();
    d.prepare('SELECT user_id, key, value, version FROM user_docs LIMIT 0').all();
    d.prepare('SELECT key, value FROM meta LIMIT 0').all();
    const hasLinks = d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dav_links'").get();
    if (hasLinks && d.prepare('SELECT 1 FROM dav_links LIMIT 1').get()) {
      if (!/^[a-f0-9]{64}$/i.test(d.prepare("SELECT value FROM meta WHERE key='dav_key'").get()?.value || '')) return false;
    }
    return d.prepare('PRAGMA foreign_key_check').all().length === 0;
  } catch (error) { if (error.message.startsWith('Unsupported database schema version')) throw error; return false; } finally { try { d?.close(); } catch { /* not open */ } }
}
const remove = (f) => { try { rmSync(f, { force: true }); } catch { /* held open a moment longer: left for the next tidy-up */ } };

/** Offline recovery into an empty directory only. Never opens or replaces an existing server database. */
export async function restoreInto(source, target) {
  mkdirSync(target, { recursive: true });
  if (readdirSync(target).length) throw new Error('Restore target must be empty; use a new DATA_DIR.');
  const pending = join(target, 'restore-pending.db');
  try {
    const buf = await readFile(source);
    await writeFile(pending, buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf, { flag: 'wx', mode: 0o600 });
    prepareRestore(pending);
    renameSync(pending, join(target, 'planner.db'));
  } catch (e) { remove(pending); throw e; }
}

export function backups({ db, dataDir, keep = Number(process.env.BACKUP_KEEP) || 7, hour = Number(process.env.BACKUP_HOUR ?? 3), log = console.log }) {
  let attempt = null;
  try { attempt = JSON.parse(db.meta.get('backup_attempt', 'null')); } catch {}
  const record = ok => { attempt = { at: new Date().toISOString(), ok }; db.meta.set('backup_attempt', JSON.stringify(attempt)); };
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });

  const list = () => readdirSync(dir).filter((f) => NAME.test(f)).map((name) => {
    const st = statSync(join(dir, name));
    return { name, size: st.size, at: st.mtime.toISOString(), kind: name.includes('-auto-') ? 'auto' : name.includes('-before-restore-') ? 'before-restore' : name.includes('-upload-') ? 'upload' : 'manual' };
  }).sort((a, b) => b.at.localeCompare(a.at));

  /** A copy now: `kind` names it (auto, manual, before-restore). The oldest beyond `keep` go. */
  async function make(kind = 'manual') {
    const tmp = join(dir, `.tmp-${Date.now()}.db`);
    try {
      db.backupTo(tmp);
      writeManifest(tmp);
      const name = `planner-${kind}-${stampOf()}.db.gz`;
      await writeFile(join(dir, name), gzipSync(await readFile(tmp), { level: 6 }));
      // the ones kept apart from the count: those made before a restore and uploaded ones
      const counted = list().filter((b) => b.kind === 'auto' || b.kind === 'manual');
      for (const old of counted.slice(keep)) rmSync(join(dir, old.name), { force: true });
      log(`Backup made: ${name}`);
      record(true);
      return name;
    } catch (e) { record(false); throw e; } finally { remove(tmp); }
  }

  /** The chosen copy checked and set to be put in place at the next start; what is there now is backed up first. */
  async function restore(name) {
    if (!NAME.test(name) || !existsSync(join(dir, name))) return { error: 'not-found' };
    const staged = join(dataDir, `.restore-${Date.now()}.db`);
    try {
      try { await writeFile(staged, gunzipSync(await readFile(join(dir, name))), { flag: 'wx', mode: 0o600 }); }
      catch { return { error: 'damaged' }; }
      try { prepareRestore(staged); } catch (error) { return { error: error.message.startsWith('Unsupported database schema version') ? error.message : 'damaged' }; }
      await make('before-restore');
      renameSync(staged, join(dataDir, 'restore-pending.db'));
      return { ok: true };
    } finally { remove(staged); }
  }

  /** A copy brought from elsewhere (a .db.gz of this planner, or a plain .db). */
  async function upload(buf) {
    let data = buf;
    if (buf[0] === 0x1f && buf[1] === 0x8b) { try { data = gunzipSync(buf); } catch { return { error: 'damaged' }; } }
    const tmp = join(dir, `.up-${Date.now()}.db`);
    await writeFile(tmp, data);
    try {
      prepareRestore(tmp);
      writeManifest(tmp);
      data = await readFile(tmp);
    } catch (error) { return { error: error.message.startsWith('Unsupported database schema version') ? error.message : 'damaged' }; }
    finally { remove(tmp); }
    const name = `planner-upload-${stampOf()}.db.gz`;
    await writeFile(join(dir, name), gzipSync(data));
    return { name };
  }

  // once a day, after the hour, if today has no automatic copy yet
  const daily = () => {
    const now = new Date(), today = stampOf(now).slice(0, 10);
    if (now.getHours() < hour || list().some((b) => b.kind === 'auto' && b.name.includes(`-auto-${today}`))) return;
    make('auto').catch((e) => log(`Backup failed: ${e.message}`));
  };
  if (hour >= 0) { setTimeout(daily, 60_000).unref(); setInterval(daily, 30 * 60_000).unref(); }

  return { status: () => attempt, list, make, restore, upload, file: (name) => (NAME.test(name) && existsSync(join(dir, name)) ? join(dir, name) : null), stream: (f) => createReadStream(f), keep, hour };
}
