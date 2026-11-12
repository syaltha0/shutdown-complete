// Team projects. A project on the boards page is either personal (inside the account's own `boards` document) or a
// team project: one shared document (key team:<id>, read and written through /api/doc like any other, with the same
// version check) kept by the account that made it and edited by the members it adds. Members are added from the
// owner's friends (social.mjs), so nobody can be put into a project by a stranger; a member may leave, the owner may
// remove members or delete the project. Nothing about a project reaches anyone who is not a member.

/** @param {import('hono').Hono} app */
export function teamRoutes(app, { db, uid, fail, body, limited }) {
  const view = (t, viewer) => ({
    id: t.id,
    role: t.role ?? db.teams.role(t.id, viewer),
    owner: t.owner === viewer,
    members: db.teams.members(t.id).map((m) => ({ id: m.id, name: m.name, role: m.role, you: m.id === viewer })),
    value: JSON.parse(t.value),
    version: t.version,
    updatedAt: t.updated_at,
  });
  const clean = (b) => ({
    name: String(b.name || '').trim().slice(0, 120),
    description: String(b.description || '').trim().slice(0, 2000),
  });

  /** The team projects the account is a member of, with their documents (small; the boards page shows them all). */
  app.get('/api/teams', (c) => c.json(db.teams.of(uid(c)).map((t) => view(t, uid(c)))));

  app.post('/api/teams', async (c) => {
    const id = uid(c);
    if (limited(`team:${id}`, 30, 3600_000)) return fail(c, 'too-many', 429);
    const { name, description } = clean(await body(c));
    if (!name) return fail(c, 'name');
    const tid = db.teams.create(id, { name, description, boards: [], created: new Date().toISOString().slice(0, 10) });
    return c.json(view(db.teams.get(tid), id));
  });

  /** The owner adds one of their friends. */
  app.post('/api/teams/:id/members', async (c) => {
    const id = uid(c), t = db.teams.get(c.req.param('id'));
    if (!t || db.teams.role(t.id, id) !== 'owner') return fail(c, 'not-the-owner', 404);
    const other = String((await body(c)).id || '');
    const friend = db.social.of(id).some((r) => r.other === other && r.status === 'accepted');
    if (!friend) return fail(c, 'not-a-friend');
    db.teams.add(t.id, other);
    return c.json(view(t, id));
  });

  /** The owner removes a member, or a member leaves. The owner cannot leave (they delete the project). */
  app.delete('/api/teams/:id/members/:user', (c) => {
    const id = uid(c), t = db.teams.get(c.req.param('id')), who = c.req.param('user');
    const role = t ? db.teams.role(t.id, id) : null;
    if (!t || !role) return fail(c, 'not-a-member', 404);
    if (who === t.owner) return fail(c, 'owner-stays');
    if (who !== id && role !== 'owner') return fail(c, 'not-the-owner', 403);
    db.teams.drop(t.id, who);
    return c.json({ ok: true });
  });

  app.delete('/api/teams/:id', (c) => {
    const t = db.teams.get(c.req.param('id'));
    if (!t || db.teams.role(t.id, uid(c)) !== 'owner') return fail(c, 'not-the-owner', 404);
    db.teams.remove(t.id);
    return c.json({ ok: true });
  });
}
