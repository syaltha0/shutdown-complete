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

const NAME = /^planner-[\w-]+\.db\.gz$/;
const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Before the database is opened: a restore asked for at the last run is put in place. */
export function applyPendingRestore(dataDir, log = console.log) {
  const pending = join(dataDir, 'restore-pending.db');
  if (!existsSync(pending)) return false;
  const file = join(dataDir, 'planner.db');
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
    return !!d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  } catch { return false; } finally { try { d?.close(); } catch { /* not open */ } }
}
const remove = (f) => { try { rmSync(f, { force: true }); } catch { /* held open a moment longer: left for the next tidy-up */ } };

export function backups({ db, dataDir, keep = Number(process.env.BACKUP_KEEP) || 7, hour = Number(process.env.BACKUP_HOUR ?? 3), log = console.log }) {
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
      const name = `planner-${kind}-${stampOf()}.db.gz`;
      await writeFile(join(dir, name), gzipSync(await readFile(tmp), { level: 6 }));
      // the ones kept apart from the count: those made before a restore and uploaded ones
      const counted = list().filter((b) => b.kind === 'auto' || b.kind === 'manual');
      for (const old of counted.slice(keep)) rmSync(join(dir, old.name), { force: true });
      log(`Backup made: ${name}`);
      return name;
    } finally { remove(tmp); }
  }

  /** The chosen copy checked and set to be put in place at the next start; what is there now is backed up first. */
  async function restore(name) {
    if (!NAME.test(name) || !existsSync(join(dir, name))) return { error: 'not-found' };
    const pending = join(dataDir, 'restore-pending.db');
    try { await writeFile(pending, gunzipSync(await readFile(join(dir, name)))); } catch { rmSync(pending, { force: true }); return { error: 'damaged' }; }
    if (!isPlannerDb(pending)) { remove(pending); return { error: 'damaged' }; }
    await make('before-restore');
    return { ok: true };
  }

  /** A copy brought from elsewhere (a .db.gz of this planner, or a plain .db). */
  async function upload(buf) {
    let data = buf;
    if (buf[0] === 0x1f && buf[1] === 0x8b) { try { data = gunzipSync(buf); } catch { return { error: 'damaged' }; } }
    const tmp = join(dir, `.up-${Date.now()}.db`);
    await writeFile(tmp, data);
    const ok = isPlannerDb(tmp);
    remove(tmp);
    if (!ok) return { error: 'damaged' };
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

  return { list, make, restore, upload, file: (name) => (NAME.test(name) && existsSync(join(dir, name)) ? join(dir, name) : null), stream: (f) => createReadStream(f), keep, hour };
}
