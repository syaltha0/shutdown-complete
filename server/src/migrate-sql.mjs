// Ordered schema history. Version zero includes all pre-versioning releases.
import { DatabaseSync } from 'node:sqlite';
export const migrations = [
(db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_feeds (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, timezone TEXT NOT NULL, tasks INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      email_verified INTEGER NOT NULL DEFAULT 0,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_last_step INTEGER NOT NULL DEFAULT 0,
      recovery TEXT NOT NULL DEFAULT '[]',
      lang TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      remember INTEGER NOT NULL DEFAULT 0,
      ua TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS user_docs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      alg INTEGER NOT NULL,
      sign_count INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used TEXT
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      max_uses INTEGER,
      uses INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS invite_requests (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      note TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL
    );
    DROP TABLE IF EXISTS sessions; -- the single-password sessions of the first version
  `);

  // invites made before they could name an address are for anyone
  if (!db.prepare('PRAGMA table_info(invites)').all().some((c) => c.name === 'email')) db.exec("ALTER TABLE invites ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  // accounts made before sign-up approval existed are approved
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'approved')) db.exec('ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1');
  // a new password before anything else: 1 = the password rules got stricter (a password that already meets them is
  // accepted at the next sign-in), 2 = a temporary password from the command line
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'must_change')) db.exec('ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0');
  // focusing together (social.mjs): what a person lets friends see, friendships, who is focusing, shared sessions
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'share_online')) db.exec('ALTER TABLE users ADD COLUMN share_online INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'share_focus')) {
    db.exec('ALTER TABLE users ADD COLUMN share_focus INTEGER NOT NULL DEFAULT 0');
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'share_label')) {
    db.exec('ALTER TABLE users ADD COLUMN share_label INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (a, b)
    );
    CREATE TABLE IF NOT EXISTS presence (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      ends_at TEXT,
      room_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      minutes INTEGER NOT NULL,
      starts_at TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_online (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS room_links (hash TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS room_direct (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(room_id,user_id));
    CREATE TABLE IF NOT EXISTS room_people (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (room_id, user_id)
    );
    -- team projects (teams.mjs): one shared document per project, kept by its owner, edited by its members
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- CalDAV (caldav.mjs): a password per device for apps that sign in with a name and a password (two-step sign-in
    -- cannot be typed into them), only its sha256 kept; and the link to a Nextcloud whose task lists are kept in step
    CREATE TABLE IF NOT EXISTS app_passwords (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used TEXT
    );
    CREATE TABLE IF NOT EXISTS dav_links (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      secret TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT '{}',
      last_sync TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id)
    );
  `);

},
(db) => {
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keys TEXT NOT NULL, timezone TEXT NOT NULL, created TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS push_sent (
    endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
    id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(endpoint, id)
  )`);
},
(db) => {
  db.exec('ALTER TABLE user_docs ADD COLUMN fmt INTEGER NOT NULL DEFAULT 1');
  db.exec('ALTER TABLE teams ADD COLUMN fmt INTEGER NOT NULL DEFAULT 1');
},
];
export const SCHEMA_VERSION = migrations.length;
export function assertSchemaVersion(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 0 || version > SCHEMA_VERSION) throw new Error(`Unsupported database schema version ${version}; this application supports up to ${SCHEMA_VERSION}.`);
  return version;
}
export function migrate(db, steps = migrations) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = assertSchemaVersion(db);
    for (let i = version; i < steps.length; i++) {
      steps[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function migrateFile(file) {
  const db = new DatabaseSync(file);
  try { db.exec('PRAGMA foreign_keys = ON'); migrate(db); } finally { db.close(); }
}
