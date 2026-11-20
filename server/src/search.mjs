/** Search only an account's documents and its current team memberships. */
export const normalize = s => String(s ?? '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '');
export function snippet(text, terms) {
  const chars = [...text], folded = chars.map(normalize), flat = folded.join('');
  const hit = Math.min(...terms.map(t => flat.indexOf(t)).filter(i => i >= 0));
  let offset = 0, index = 0;
  while (index < chars.length && offset < hit) offset += folded[index++].length;
  const start = Math.max(0, index - 30), end = Math.min(chars.length, start + 80);
  return (start ? '…' : '') + chars.slice(start, end).join('') + (end < chars.length ? '…' : '');
}
export function search(db, user, query, limit = 50) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (normalize(query).trim().length < 2) return [];
  const results = [];
  const docs = [...db.docs.all(user).filter(d => !d.key.startsWith('team:')), ...db.teams.of(user).filter(t => db.teams.role(t.id, user)).map(t => db.teams.doc(t.id)).filter(Boolean)];
  for (const { key, value: v } of docs) {
    if (!v) continue;
    const [scale, id] = key.split(':'), dated = /^(day|week|month|quarter|year)$/.test(scale);
    const href = dated ? `/${scale}/${id}` : key === 'inbox' ? '/tasks' : '/countdown';
    const add = (kind, title, body = '', url = href, date = dated ? id : undefined) => {
      const text = [title, body].filter(Boolean).join(' · '), folded = normalize(text);
      if (text && terms.every(t => folded.includes(t))) results.push({ key, kind, ...(date ? { date } : {}), title: title || body.slice(0, 80), snippet: snippet(text, terms), href: url });
    };
    const items = (list, kind, url = href) => { for (const x of list ?? []) { add(kind, x.text, [x.notes, x.waitingNote, x.review].filter(Boolean).join(' '), url, dated ? id : x.due || x.created?.slice(0, 10)); items(x.steps, kind, url); } };
    if (dated) {
      if (v.notes) add(scale === 'day' ? 'day-note' : 'note', '', v.notes);
      items(v.tasks, 'task'); items(v.items, 'goal'); items(v.goals, 'goal');
      for (const c of v.columns ?? []) for (const b of c.blocks ?? []) add('block', b.label, b.note);
      for (const d of v.dates ?? []) add('goal', d.text, '', href, d.date);
      if (v.experiment) add('note', '', v.experiment);
      for (const field of ['good', 'change']) if (v[field]) add('note', '', v[field]);
    }
    if (key === 'inbox') { items(v.items, 'inbox'); for (const l of v.lists ?? []) add('list', l.name, '', `/tasks/${encodeURIComponent(l.id)}`); }
    if (key === 'settings') {
      for (const c of v.countdowns ?? []) add('countdown', c.name, '', '/countdown', c.date);
      for (const e of v.exams ?? []) add('exam', e.name, [e.subject, ...(e.topics ?? [])].filter(Boolean).join(' '), '/countdown', e.date);
    }
    const boards = (list, base) => { for (const b of list ?? []) for (const l of b.lists ?? []) for (const c of l.cards ?? []) add('card', c.title, c.description, `${base}/${encodeURIComponent(b.id)}/${encodeURIComponent(c.id)}`, c.due || c.created?.slice(0, 10)); };
    if (key === 'boards') { for (const p of v.projects ?? []) boards(p.boards, `/project/${encodeURIComponent(p.id)}`); for (const b of v.boards ?? []) boards([b], '/board'); }
    if (scale === 'team') boards(v.boards, `/team/${id}`);
  }
  const sortDate = d => { if (!d) return ''; if (/^\d{4}-W/.test(d)) { const [y,w] = d.split('-W').map(Number), jan = new Date(Date.UTC(y,0,4)); jan.setUTCDate(jan.getUTCDate() - (jan.getUTCDay()+6)%7 + (w-1)*7); return jan.toISOString().slice(0,10); } return d.replace(/-Q([1-4])$/, (_,q) => `-${String((Number(q)-1)*3+1).padStart(2,'0')}`).padEnd(10, '-01'); };
  return results.sort((a,b) => sortDate(b.date).localeCompare(sortDate(a.date)) || a.key.localeCompare(b.key)).slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
}
