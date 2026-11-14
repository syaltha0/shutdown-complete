import { planningDay, dayStartOf } from './planday.mjs';
import { rollOn } from './recur.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Accounts, their sessions, one-time tokens and each account's planner documents.
// Documents are JSON keyed by scope (day:2026-10-21, week:2026-W43, month:2026-10, quarter:2026-Q4, settings);
// `version` increases on every write so two devices cannot silently overwrite each other.
export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    PRAGMA foreign_keys = ON;
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

  const now = () => new Date().toISOString();
  const hasLegacy = !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'docs'").get();

  const q = {
    metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
    metaSet: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    users: db.prepare('SELECT id, email, name, is_admin, email_verified, totp_enabled, approved, must_change, created_at FROM users ORDER BY created_at'),
    // the online parts start off: a new account shares nothing until it says so (Focus -> friends)
    userInsert: db.prepare('INSERT INTO users (id, email, name, password, is_admin, email_verified, approved, lang, created_at, share_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'),
    userDelete: db.prepare('DELETE FROM users WHERE id = ?'),

    sessionInsert: db.prepare('INSERT INTO user_sessions (id, token_hash, user_id, created_at, last_seen, expires_at, remember, ua, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    sessionByHash: db.prepare('SELECT * FROM user_sessions WHERE token_hash = ?'),
    sessionTouch: db.prepare('UPDATE user_sessions SET last_seen = ?, expires_at = ?, ip = ? WHERE id = ?'),
    sessionsOf: db.prepare('SELECT id, created_at, last_seen, expires_at, remember, ua, ip FROM user_sessions WHERE user_id = ? ORDER BY last_seen DESC'),
    sessionDelete: db.prepare('DELETE FROM user_sessions WHERE id = ? AND user_id = ?'),
    sessionDeleteOthers: db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND id <> ?'),
    sessionDeleteAll: db.prepare('DELETE FROM user_sessions WHERE user_id = ?'),
    sessionPrune: db.prepare('DELETE FROM user_sessions WHERE expires_at < ?'),

    tokenInsert: db.prepare('INSERT INTO tokens (token_hash, kind, user_id, expires_at, data) VALUES (?, ?, ?, ?, ?)'),
    tokenGet: db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND kind = ?'),
    tokenDelete: db.prepare('DELETE FROM tokens WHERE token_hash = ?'),
    tokenDeleteKind: db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?'),
    tokenPrune: db.prepare('DELETE FROM tokens WHERE expires_at < ?'),

    pkInsert: db.prepare('INSERT INTO passkeys (id, user_id, public_key, alg, sign_count, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    pkGet: db.prepare('SELECT * FROM passkeys WHERE id = ?'),
    pkOf: db.prepare('SELECT id, name, created_at, last_used, transports FROM passkeys WHERE user_id = ? ORDER BY created_at'),
    pkUse: db.prepare('UPDATE passkeys SET sign_count = ?, last_used = ? WHERE id = ?'),
    pkDelete: db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?'),
    inviteInsert: db.prepare('INSERT INTO invites (id, token_hash, created_by, created_at, expires_at, max_uses, note, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    inviteByHash: db.prepare('SELECT * FROM invites WHERE token_hash = ?'),
    invites: db.prepare('SELECT id, created_at, expires_at, max_uses, uses, note, email FROM invites ORDER BY created_at DESC'),
    inviteUse: db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND (max_uses IS NULL OR uses < max_uses)'),
    inviteDelete: db.prepare('DELETE FROM invites WHERE id = ?'),
    reqUpsert: db.prepare(`INSERT INTO invite_requests (id, email, note, lang, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET note = excluded.note, lang = excluded.lang, created_at = excluded.created_at`),
    reqList: db.prepare('SELECT * FROM invite_requests ORDER BY created_at DESC'),
    reqGet: db.prepare('SELECT * FROM invite_requests WHERE id = ?'),
    reqDelete: db.prepare('DELETE FROM invite_requests WHERE id = ?'),
    reqDeleteEmail: db.prepare('DELETE FROM invite_requests WHERE email = ?'),
    reqCount: db.prepare('SELECT COUNT(*) AS n FROM invite_requests'),
    frOf: db.prepare(`SELECT f.status, f.requested_by, CASE WHEN f.a = ?1 THEN f.b ELSE f.a END AS other, u.name, u.email
      FROM friends f JOIN users u ON u.id = CASE WHEN f.a = ?1 THEN f.b ELSE f.a END WHERE f.a = ?1 OR f.b = ?1 ORDER BY u.name`),
    frGet: db.prepare('SELECT * FROM friends WHERE a = ? AND b = ?'),
    frInsert: db.prepare('INSERT INTO friends (a, b, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?)'),
    frAccept: db.prepare("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending' AND requested_by != ?"),
    frDelete: db.prepare('DELETE FROM friends WHERE a = ? AND b = ?'),
    prGet: db.prepare('SELECT * FROM presence WHERE user_id = ?'),
    prSet: db.prepare(`INSERT INTO presence (user_id, state, label, ends_at, room_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, label = excluded.label, ends_at = excluded.ends_at, room_id = excluded.room_id, updated_at = excluded.updated_at`),
    prDelete: db.prepare('DELETE FROM presence WHERE user_id = ?'),
    roomInsert: db.prepare('INSERT INTO rooms (id, host, minutes, starts_at, label, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    roomGet: db.prepare('SELECT * FROM rooms WHERE id = ?'),
    rpInsert: db.prepare('INSERT OR IGNORE INTO room_people (room_id, user_id, joined) VALUES (?, ?, ?)'),
    rpOf: db.prepare('SELECT * FROM room_people WHERE room_id = ?'),
    rpGet: db.prepare('SELECT * FROM room_people WHERE room_id = ? AND user_id = ?'),
    rpJoin: db.prepare('UPDATE room_people SET joined = 1 WHERE room_id = ? AND user_id = ?'),
    rpDelete: db.prepare('DELETE FROM room_people WHERE room_id = ? AND user_id = ? AND joined = 0'),
    teamInsert: db.prepare('INSERT INTO teams (id, owner, value, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'),
    teamGet: db.prepare('SELECT * FROM teams WHERE id = ?'),
    teamOf: db.prepare('SELECT t.*, m.role FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.created_at'),
    teamUpdate: db.prepare('UPDATE teams SET value = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'),
    teamDelete: db.prepare('DELETE FROM teams WHERE id = ?'),
    tmInsert: db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'),
    tmGet: db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'),
    tmOf: db.prepare('SELECT m.user_id AS id, m.role, u.name, u.email FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.added_at'),
    tmDelete: db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?'),
    rpInvites: db.prepare('SELECT r.* FROM rooms r JOIN room_people p ON p.room_id = r.id WHERE p.user_id = ? AND p.joined = 0 ORDER BY r.starts_at DESC'),
    apInsert: db.prepare('INSERT INTO app_passwords (id, user_id, name, hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    apOf: db.prepare('SELECT id, name, created_at, last_used FROM app_passwords WHERE user_id = ? ORDER BY created_at'),
    apByHash: db.prepare('SELECT * FROM app_passwords WHERE hash = ?'),
    apUse: db.prepare('UPDATE app_passwords SET last_used = ? WHERE id = ?'),
    apDelete: db.prepare('DELETE FROM app_passwords WHERE id = ? AND user_id = ?'),
    dlGet: db.prepare('SELECT * FROM dav_links WHERE user_id = ?'),
    dlAll: db.prepare('SELECT user_id FROM dav_links'),
    dlSet: db.prepare(`INSERT INTO dav_links (user_id, url, username, secret, state, created_at) VALUES (?, ?, ?, ?, '{}', ?)
      ON CONFLICT(user_id) DO UPDATE SET url = excluded.url, username = excluded.username, secret = excluded.secret, state = '{}', last_sync = NULL, last_error = NULL`),
    dlState: db.prepare('UPDATE dav_links SET state = ?, last_sync = ?, last_error = ? WHERE user_id = ?'),
    dlDelete: db.prepare('DELETE FROM dav_links WHERE user_id = ?'),
    docGet: db.prepare('SELECT key, value, version, updated_at FROM user_docs WHERE user_id = ? AND key = ?'),
    docRange: db.prepare('SELECT key, value, version, updated_at FROM user_docs WHERE user_id = ? AND key >= ? AND key <= ? ORDER BY key'),
    docAll: db.prepare('SELECT key, value, version, updated_at FROM user_docs WHERE user_id = ? ORDER BY key'),
    docInsert: db.prepare('INSERT INTO user_docs (user_id, key, value, version, updated_at) VALUES (?, ?, ?, 1, ?)'),
    docUpdate: db.prepare('UPDATE user_docs SET value = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND key = ? AND version = ?'),
    docUpsert: db.prepare(`INSERT INTO user_docs (user_id, key, value, version, updated_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, version = user_docs.version + 1, updated_at = excluded.updated_at`),
  };

  const row = (r) => (r ? { key: r.key, value: JSON.parse(r.value), version: r.version, updatedAt: r.updated_at } : null);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keys TEXT NOT NULL, timezone TEXT NOT NULL, created TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS push_sent (
    endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
    id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(endpoint, id)
  )`);
  return {
    tx,
    feeds: {
      get: (u) => db.prepare('SELECT timezone, tasks FROM calendar_feeds WHERE user_id = ?').get(u),
      find: (h) => db.prepare('SELECT * FROM calendar_feeds WHERE token_hash = ?').get(h),
      set: (u, h, z, t) => db.prepare('INSERT OR REPLACE INTO calendar_feeds VALUES (?, ?, ?, ?)').run(u, h, z, t ? 1 : 0),
      remove: (u) => db.prepare('DELETE FROM calendar_feeds WHERE user_id = ?').run(u),
    },
    push: {
      all: () => db.prepare('SELECT * FROM push_subscriptions').all(),
      forUser: (u) => db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(u),
      has: (u, e) => !!db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(u, e),
      put: (u, b) => db.prepare('INSERT INTO push_subscriptions VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, keys=excluded.keys, timezone=excluded.timezone').run(b.endpoint, u, JSON.stringify(b.keys), b.timeZone, now()),
      remove: (u, e) => db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(u, e),
      claim: (e, id, at) => db.prepare('INSERT OR IGNORE INTO push_sent VALUES (?, ?, ?)').run(e, id, at).changes > 0,
      release: (e, id) => db.prepare('DELETE FROM push_sent WHERE endpoint=? AND id=?').run(e, id),
      prune: (at) => db.prepare('DELETE FROM push_sent WHERE at < ?').run(at),
    },
    meta: {
      get: (k, fallback = null) => q.metaGet.get(k)?.value ?? fallback,
      set: (k, v) => q.metaSet.run(k, String(v)),
    },
    users: {
      count: () => q.userCount.get().n,
      byId: (id) => q.userById.get(id) ?? null,
      byEmail: (email) => q.userByEmail.get(String(email).trim()) ?? null,
      list: () => q.users.all(),
      create({ email, name, password, isAdmin = false, verified = false, approved = true, lang = 'en' }) {
        const id = randomUUID();
        q.userInsert.run(id, String(email).trim(), String(name).trim(), password, isAdmin ? 1 : 0, verified ? 1 : 0, approved ? 1 : 0, lang, now());
        return q.userById.get(id);
      },
      set(id, fields) {
        const cols = Object.keys(fields);
        if (!cols.length) return;
        db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
      },
      remove: (id) => tx(() => { db.prepare('DELETE FROM user_docs WHERE user_id = ?').run(id); q.userDelete.run(id); }),
      // stricter password rules: everyone but the owner who chose them picks a new password at their next sign-in
      // (unless theirs already meets them); back to the basic rules, those flags go (a temporary password's stays)
      askNewPasswords: (exceptId) => db.prepare('UPDATE users SET must_change = 1 WHERE id != ? AND must_change = 0').run(exceptId),
      forgetPolicyFlags: () => db.prepare('UPDATE users SET must_change = 0 WHERE must_change = 1').run(),
    },
    sessions: {
      create: (s) => q.sessionInsert.run(s.id, s.tokenHash, s.userId, now(), now(), s.expiresAt, s.remember ? 1 : 0, s.ua, s.ip),
      byHash: (h) => q.sessionByHash.get(h) ?? null,
      touch: (id, expiresAt, ip) => q.sessionTouch.run(now(), expiresAt, ip, id),
      of: (userId) => q.sessionsOf.all(userId),
      remove: (id, userId) => q.sessionDelete.run(id, userId),
      removeOthers: (userId, keepId) => q.sessionDeleteOthers.run(userId, keepId),
      removeAll: (userId) => q.sessionDeleteAll.run(userId),
      prune: () => { q.sessionPrune.run(now()); q.tokenPrune.run(now()); },
    },
    // invite links: only a hash of each link's secret is kept, so the link itself is shown once, when it is made
    invites: {
      create({ tokenHash, createdBy = null, expiresAt = null, maxUses = null, note = '', email = '' }) {
        const id = randomUUID();
        q.inviteInsert.run(id, tokenHash, createdBy, now(), expiresAt, maxUses, String(note).slice(0, 80), String(email).trim().toLowerCase());
        return id;
      },
      /** The invite behind a link's secret hash, if it can still be used. */
      valid(tokenHash) {
        const i = q.inviteByHash.get(tokenHash);
        if (!i) return null;
        if (i.expires_at && i.expires_at < now()) return null;
        if (i.max_uses != null && i.uses >= i.max_uses) return null;
        return i;
      },
      use: (id) => q.inviteUse.run(id).changes === 1,
      list: () => q.invites.all(),
      remove: (id) => q.inviteDelete.run(id),
    },
    // people asking for an invite while sign-ups are by invitation; one request per address (the latest note wins)
    requests: {
      add: (email, note, lang) => q.reqUpsert.run(randomUUID(), String(email).trim().toLowerCase(), String(note || '').trim().slice(0, 200), lang, now()),
      list: () => q.reqList.all(),
      get: (id) => q.reqGet.get(id) ?? null,
      remove: (id) => q.reqDelete.run(id),
      removeEmail: (email) => q.reqDeleteEmail.run(String(email).trim().toLowerCase()),
      count: () => q.reqCount.get().n,
    },
    // friendships are stored once per pair, the smaller id first
    social: {
      heartbeat: (u) => db.prepare('INSERT INTO social_online VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seen=excluded.seen').run(u, Date.now()),
      online: (u) => db.prepare('SELECT u.id, u.name FROM users u JOIN social_online o ON o.user_id=u.id WHERE u.share_online=1 AND u.approved=1 AND o.seen>? AND u.id!=? ORDER BY u.name LIMIT 100').all(Date.now()-70000,u),
      link: (hash, room, expires) => db.prepare('INSERT INTO room_links VALUES (?,?,?)').run(hash,room,expires),
      redeem: (hash, u) => tx(() => {
        const l = db.prepare('SELECT * FROM room_links WHERE hash=? AND expires>?').get(hash,Date.now());
        if (!l) return null;
        const r = q.roomGet.get(l.room_id);
        if (!r || r.host===u || Date.parse(r.starts_at)+r.minutes*60000<=Date.now()) return null;
        db.prepare('DELETE FROM room_links WHERE hash=?').run(hash);
        q.rpInsert.run(r.id,u,1); q.rpJoin.run(r.id,u);
        return r;
      }),
      direct: (room,u) => { q.rpInsert.run(room,u,0); db.prepare('INSERT OR IGNORE INTO room_direct VALUES (?,?)').run(room,u); },
      isDirect: (room,u) => !!db.prepare('SELECT 1 FROM room_direct WHERE room_id=? AND user_id=?').get(room,u),
      of: (u) => q.frOf.all(u),
      ask(u, other) {
        const [a, b] = u < other ? [u, other] : [other, u];
        const f = q.frGet.get(a, b);
        if (!f) { q.frInsert.run(a, b, 'pending', u, now()); return 'asked'; }
        if (f.status === 'pending' && f.requested_by !== u) { q.frAccept.run(a, b, u); return 'accepted'; }
        return f.status;
      },
      accept(u, other) {
        const [a, b] = u < other ? [u, other] : [other, u];
        return q.frAccept.run(a, b, u).changes === 1;
      },
      remove(u, other) { const [a, b] = u < other ? [u, other] : [other, u]; q.frDelete.run(a, b); },
      presence: (u) => q.prGet.get(u) ?? null,
      setPresence: (u, state, label, endsAt, roomId) => q.prSet.run(u, state, label, endsAt, roomId, now()),
      clearPresence: (u) => q.prDelete.run(u),
      createRoom(host, minutes, startsAt, label, invite) {
        const id = randomUUID();
        tx(() => {
          q.roomInsert.run(id, host, minutes, startsAt, label, now());
          q.rpInsert.run(id, host, 1);
          for (const u of invite) q.rpInsert.run(id, u, 0);
        });
        return q.roomGet.get(id);
      },
      room: (id) => q.roomGet.get(id) ?? null,
      roomPeople: (id) => q.rpOf.all(id),
      invited: (id, u) => !!q.rpGet.get(id, u),
      inRoom: (id, u) => !!q.rpGet.get(id, u)?.joined,
      join: (id, u) => q.rpJoin.run(id, u),
      decline: (id, u) => { q.rpDelete.run(id, u); db.prepare('DELETE FROM room_direct WHERE room_id=? AND user_id=?').run(id,u); },
      invitesFor: (u) => q.rpInvites.all(u),
    },
    // a team project's document reads like a planner document (key team:<id>), for its members only
    teams: {
      create(owner, value) {
        const id = randomUUID().replace(/-/g, '').slice(0, 16);
        tx(() => { q.teamInsert.run(id, owner, JSON.stringify(value), now(), now()); q.tmInsert.run(id, owner, 'owner', now()); });
        return id;
      },
      get: (id) => q.teamGet.get(id) ?? null,
      of: (u) => q.teamOf.all(u),
      role: (id, u) => q.tmGet.get(id, u)?.role ?? null,
      members: (id) => q.tmOf.all(id),
      doc(id) { const t = q.teamGet.get(id); return t ? { key: `team:${id}`, value: JSON.parse(t.value), version: t.version, updatedAt: t.updated_at } : null; },
      put(id, value, version) {
        if (q.teamUpdate.run(JSON.stringify(value), now(), id, version).changes === 0) return { conflict: this.doc(id) };
        return { doc: this.doc(id) };
      },
      add: (id, u) => q.tmInsert.run(id, u, 'member', now()),
      drop: (id, u) => q.tmDelete.run(id, u),
      remove: (id) => q.teamDelete.run(id),
    },
    tokens: {
      create: (hash, kind, userId, expiresAt, data = {}) => q.tokenInsert.run(hash, kind, userId, expiresAt, JSON.stringify(data)),
      take(hash, kind) {
        const t = q.tokenGet.get(hash, kind);
        if (!t) return null;
        q.tokenDelete.run(hash);
        return t.expires_at > now() ? { ...t, data: JSON.parse(t.data) } : null;
      },
      peek(hash, kind) {
        const t = q.tokenGet.get(hash, kind);
        return t && t.expires_at > now() ? { ...t, data: JSON.parse(t.data) } : null;
      },
      clear: (userId, kind) => q.tokenDeleteKind.run(userId, kind),
    },
    passkeys: {
      add: (userId, p, name) => q.pkInsert.run(p.id, userId, p.publicKey, p.alg, p.signCount, JSON.stringify(p.transports), String(name).slice(0, 80), now()),
      get: (id) => q.pkGet.get(id) ?? null,
      of: (userId) => q.pkOf.all(userId).map((p) => ({ ...p, transports: JSON.parse(p.transports) })),
      use: (id, count) => q.pkUse.run(count, now(), id),
      remove: (id, userId) => q.pkDelete.run(id, userId),
    },
    appPasswords: {
      add(u, name, hash) { const id = randomUUID(); q.apInsert.run(id, u, String(name).slice(0, 80), hash, now()); return id; },
      of: (u) => q.apOf.all(u),
      byHash: (hash) => q.apByHash.get(hash) ?? null,
      use: (id) => q.apUse.run(now(), id),
      remove: (id, u) => q.apDelete.run(id, u),
    },
    davLinks: {
      get(u) { const l = q.dlGet.get(u); return l ? { ...l, state: JSON.parse(l.state) } : null; },
      users: () => q.dlAll.all().map((r) => r.user_id),
      set: (u, url, username, secret) => q.dlSet.run(u, url, username, secret, now()),
      saveState: (u, state, error = null) => q.dlState.run(JSON.stringify(state), now(), error, u),
      remove: (u) => q.dlDelete.run(u),
    },
    docs: {
      get: (u, key) => row(q.docGet.get(u, key)),
      range: (u, from, to) => q.docRange.all(u, from, to).map(row),
      all: (u) => q.docAll.all(u).map(row),
      // write only if the caller saw the latest version (0 = "I believe it does not exist yet")
      put(u, key, value, version) {
        return tx(() => {
        const previous = key.startsWith('day:') ? row(q.docGet.get(u, key))?.value : null;
        const json = JSON.stringify(value);
        if (version === 0) {
          try { q.docInsert.run(u, key, json, now()); } catch { return { conflict: row(q.docGet.get(u, key)) }; }
        } else if (q.docUpdate.run(json, now(), u, key, version).changes === 0) {
          return { conflict: row(q.docGet.get(u, key)) };
        }
        if (key.startsWith('day:')) {
          const completed = (value.tasks ?? []).filter((t) => t.done && t.plannedRepeat && !(previous?.tasks ?? []).find((x) => x.id === t.id)?.done);
          if (completed.length) {
            const inbox = row(q.docGet.get(u, 'inbox'));
            if (inbox?.value) {
              const next = { ...inbox.value, items: inbox.value.items.map((t) => completed.some((c) => { const p = c.plannedRepeat; return t.repeat && p.id === t.id && p.due === t.due && p.start === t.start && p.doneCount === (t.doneCount ?? 0); }) ? { ...t, ...rollOn(t, planningDay(new Date(), dayStartOf(row(q.docGet.get(u, 'settings'))?.value))) } : t) };
              q.docUpdate.run(JSON.stringify(next), now(), u, 'inbox', inbox.version);
            }
          }
        }
        return { doc: row(q.docGet.get(u, key)) };
        });
      },
      importAll: (u, docs) => tx(() => { for (const d of docs) q.docUpsert.run(u, d.key, JSON.stringify(d.value), now()); }),
    },
    /** A consistent copy of the whole database into a new file, while it is in use. */
    backupTo: (file) => db.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`),
    /** The first version kept one planner without accounts; the first account to be created takes it over. */
    claimLegacy(userId) {
      if (!hasLegacy) return 0;
      return tx(() => {
        const n = db.prepare('INSERT OR IGNORE INTO user_docs (user_id, key, value, version, updated_at) SELECT ?, key, value, version, updated_at FROM docs').run(userId).changes;
        db.exec('DROP TABLE docs');
        return n;
      });
    },
  };
}
