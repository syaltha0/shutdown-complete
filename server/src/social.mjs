// Focusing together. Accounts on the same server can be friends (one asks by e-mail address, the other accepts);
// friends see whether the other is in a focus session right now (if that person shares it) and, if they share that
// too, the block's name. A shared session (a "room") starts now for a set length; the friends invited can join it
// while it runs, and each one's timer then ends at the same moment. Nothing about a person reaches anyone who is
// not their friend, and asking for a friend gives the same answer whether or not the address has an account.

const STALE = 3 * 3600_000; // a presence not refreshed for this long is gone (a closed laptop)
const MAX_INVITE = 50; // friends one shared session can invite
const MAX_ENDS = 6 * 3600_000; // a timer cannot claim to end further ahead than this

/** @param {import('hono').Hono} app */
export function socialRoutes(app, { db, me, uid, fail, body, limited }) {
  const nowIso = () => new Date().toISOString();

  /** What a friend may see of someone right now, or null. */
  function presenceOf(userId) {
    const u = db.users.byId(userId);
    if (!u || !u.share_focus) return null;
    const p = db.social.presence(userId);
    if (!p || Date.now() - Date.parse(p.updated_at) > STALE) return null;
    if (p.state !== 'paused' && p.ends_at && Date.parse(p.ends_at) < Date.now()) return null;
    return { state: p.state, endsAt: p.ends_at, label: u.share_label ? p.label : '', roomId: p.room_id || null };
  }

  function roomView(r, viewer) {
    const people = db.social.roomPeople(r.id).filter((x) => x.joined && x.user_id !== viewer).map((x) => db.users.byId(x.user_id)?.name).filter(Boolean);
    return { id: r.id, host: db.users.byId(r.host)?.name ?? '', minutes: r.minutes, startsAt: r.starts_at, label: r.label, people };
  }
  const live = (r) => Date.parse(r.starts_at) + r.minutes * 60_000 > Date.now();

  app.get('/api/friends', (c) => {
    const id = uid(c), u = me(c).user;
    const rows = db.social.of(id);
    const friends = rows.filter((r) => r.status === 'accepted').map((r) => ({ id: r.other, name: r.name, status: presenceOf(r.other) }));
    const incoming = rows.filter((r) => r.status === 'pending' && r.requested_by !== id).map((r) => ({ id: r.other, name: r.name, email: r.email }));
    const outgoing = rows.filter((r) => r.status === 'pending' && r.requested_by === id).map((r) => ({ id: r.other, name: r.name, email: r.email }));
    const friendIds = new Set(rows.filter((r) => r.status === 'accepted').map((r) => r.other));
    const invites = db.social.invitesFor(id).filter((r) => live(r) && friendIds.has(r.host)).map((r) => roomView(r, id));
    const mine = db.social.presence(id);
    const roomRow = mine?.room_id ? db.social.room(mine.room_id) : null;
    const room = roomRow && live(roomRow) ? roomView(roomRow, id) : null;
    return c.json({ friends, incoming, outgoing, invites, room, share: { focus: !!u.share_focus, label: !!u.share_label } });
  });

  app.post('/api/friends', async (c) => {
    const id = uid(c);
    if (limited(`friend:${id}`, 20, 3600_000)) return fail(c, 'too-many', 429);
    const b = await body(c);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!email.includes('@') || email.length > 254) return fail(c, 'invalid-email');
    if (email === me(c).user.email.toLowerCase()) return fail(c, 'self');
    const other = db.users.byEmail(email);
    if (other && other.approved) db.social.ask(id, other.id);
    return c.json({ ok: true });
  });
  app.post('/api/friends/:id/accept', (c) => {
    if (!db.social.accept(uid(c), c.req.param('id'))) return fail(c, 'gone', 404);
    return c.json({ ok: true });
  });
  app.delete('/api/friends/:id', (c) => { db.social.remove(uid(c), c.req.param('id')); return c.json({ ok: true }); });
  app.put('/api/friends/share', async (c) => {
    const b = await body(c);
    const fields = {};
    if (typeof b.focus === 'boolean') fields.share_focus = b.focus ? 1 : 0;
    if (typeof b.label === 'boolean') fields.share_label = b.label ? 1 : 0;
    db.users.set(uid(c), fields);
    const u = db.users.byId(uid(c));
    return c.json({ focus: !!u.share_focus, label: !!u.share_label });
  });

  /** The client says what its focus timer is doing; null when nothing runs. */
  app.put('/api/presence', async (c) => {
    // the client writes on each change of its timer (debounced); a loop or a script is held back
    if (limited(`presence:${uid(c)}`, 600, 3600_000)) return fail(c, 'too-many', 429);
    const b = await body(c);
    const STATES = new Set(['focus', 'short', 'long', 'paused']);
    if (!b || !STATES.has(b.state)) { db.social.clearPresence(uid(c)); return c.json({ ok: true }); }
    const at = typeof b.endsAt === 'string' ? Date.parse(b.endsAt) : NaN;
    const ends = Number.isFinite(at) ? new Date(Math.min(at, Date.now() + MAX_ENDS)).toISOString() : null;
    const roomId = typeof b.roomId === 'string' && db.social.inRoom(b.roomId, uid(c)) ? b.roomId : null;
    const label = typeof b.label === 'string' ? b.label.replace(/\p{Cc}/gu, ' ').trim().slice(0, 80) : '';
    db.social.setPresence(uid(c), b.state, label, ends, roomId);
    return c.json({ ok: true });
  });

  /** A shared session: starts now, for `minutes`; the friends named are invited. */
  app.post('/api/rooms', async (c) => {
    const id = uid(c);
    if (limited(`room:${id}`, 30, 3600_000)) return fail(c, 'too-many', 429);
    const b = await body(c);
    const minutes = Math.round(Number(b.minutes));
    if (!(minutes >= 5 && minutes <= 180)) return fail(c, 'minutes');
    const friends = new Set(db.social.of(id).filter((r) => r.status === 'accepted').map((r) => r.other));
    const invite = [...new Set(Array.isArray(b.invite) ? b.invite : [])].filter((x) => typeof x === 'string' && friends.has(x));
    if (invite.length > MAX_INVITE) return fail(c, 'too-many-invites');
    const room = db.social.createRoom(id, minutes, nowIso(), typeof b.label === 'string' ? b.label.slice(0, 80) : '', invite);
    return c.json({ id: room.id, startsAt: room.starts_at, minutes: room.minutes });
  });
  const friendsWith = (u, other) => db.social.of(u).some((r) => r.other === other && r.status === 'accepted');
  app.post('/api/rooms/:id/join', (c) => {
    const r = db.social.room(c.req.param('id'));
    // an invitation lapses with the friendship: someone unfriended cannot join (and so appear in) the host's session
    if (!r || !live(r) || !db.social.invited(r.id, uid(c)) || !friendsWith(uid(c), r.host)) return fail(c, 'gone', 404);
    db.social.join(r.id, uid(c));
    return c.json({ id: r.id, startsAt: r.starts_at, minutes: r.minutes, label: r.label });
  });
  app.delete('/api/rooms/:id/invite', (c) => { db.social.decline(c.req.param('id'), uid(c)); return c.json({ ok: true }); });
}
