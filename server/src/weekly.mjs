// A week in review: what was planned and what got done, figured from the account's documents. The planner shows it
// (/review/<week>), and with e-mail set up it is sent every Sunday evening to those who ask for it.
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };

/** The ISO week of a day (2026-W44). */
export function weekOf(s) {
  const d = at(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const y = d.getFullYear(), ft = new Date(y, 0, 4, 12);
  ft.setDate(ft.getDate() - ((ft.getDay() + 6) % 7) + 3);
  return `${y}-W${pad(1 + Math.round((d - ft) / 6048e5))}`;
}
/** Its Monday. */
export function weekStart(id) {
  const [y, w] = id.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4, 12);
  jan4.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  return iso(jan4);
}
export const WEEK = /^\d{4}-W\d{2}$/;

/** The blocks that stood: a revised column up to where it was revised, the last one whole (as the planner's effectivePlan). */
const plan = (d) => (d?.columns ?? []).flatMap((c) => (c.blocks ?? []).flatMap((b) => (c.closedAt == null ? [b] : b.start < c.closedAt ? [{ ...b, end: Math.min(b.end, c.closedAt) }] : [])));
const mins = (bs) => bs.reduce((n, b) => n + Math.max(0, b.end - b.start), 0);

/** The figures of one week. */
function figures(db, userId, week) {
  const from = weekStart(week), dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const docs = Object.fromEntries(db.docs.range(userId, `day:${dates[0]}`, `day:${dates[6]}`).map((d) => [d.key.slice(4), d.value]));
  const settings = db.docs.get(userId, 'settings')?.value ?? {};
  const inbox = db.docs.get(userId, 'inbox')?.value ?? { items: [] };
  const weekDoc = db.docs.get(userId, `week:${week}`)?.value;
  const days = dates.map((date) => {
    const d = docs[date];
    const p = plan(d), sessions = d?.focus?.sessions ?? [];
    const tasks = (d?.tasks ?? []).filter((t) => t.text?.trim());
    return {
      date, planned: mins(p), deep: mins(p.filter((b) => b.kind === 'deep')), focused: sessions.reduce((n, s) => n + (s.minutes || 0), 0),
      sessions: sessions.length, shutdown: !!d?.shutdown?.done, tasksDone: tasks.filter((t) => t.done).length, tasksAll: tasks.length,
      revisions: Math.max(0, (d?.columns?.length ?? 1) - 1),
    };
  });
  const inWeek = (s) => !!s && s >= dates[0] && s <= dates[6];
  const listDone = (inbox.items ?? []).filter((t) => (t.done && inWeek(t.doneAt)) || (!t.done && t.repeat && inWeek(t.lastDone))).length;
  // where the focused time went: a block's subject, else the task, else the session's label
  const where = new Map();
  for (const date of dates) for (const s of docs[date]?.focus?.sessions ?? []) {
    const k = s.subject || s.taskText || s.label || '';
    if (k) where.set(k, (where.get(k) ?? 0) + (s.minutes || 0));
  }
  const habits = (settings.metrics ?? []).filter((m) => m.kind === 'check').map((m) => ({ name: m.name, days: dates.filter((x) => docs[x]?.metrics?.[m.id] === true).length }));
  const sum = (k) => days.reduce((n, d) => n + d[k], 0);
  return {
    week, from: dates[0], to: dates[6], days,
    totals: { planned: sum('planned'), deep: sum('deep'), focused: sum('focused'), sessions: sum('sessions'), shutdowns: sum('shutdown'), tasksDone: sum('tasksDone'), tasksAll: sum('tasksAll'), listDone, revisions: sum('revisions') },
    plan: { done: (weekDoc?.items ?? []).filter((x) => x.done && x.text?.trim()).length, total: (weekDoc?.items ?? []).filter((x) => x.text?.trim()).length },
    habits, focusOn: [...where].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5),
  };
}

/** A week with the one before it, to compare. */
export function review(db, userId, week) {
  const now = figures(db, userId, week);
  const before = figures(db, userId, weekOf(addDays(weekStart(week), -7)));
  return { ...now, prev: { focused: before.totals.focused, deep: before.totals.deep, shutdowns: before.totals.shutdowns, tasksDone: before.totals.tasksDone + before.totals.listDone } };
}

const hm = (m, tr) => { const h = Math.floor(m / 60), r = m % 60; return tr ? (h ? `${h} sa${r ? ` ${r} dk` : ''}` : `${r} dk`) : (h ? `${h} h${r ? ` ${r} m` : ''}` : `${r} m`); };
/** The review as an e-mail's subject and text. */
export function reviewMail(r, lang, name, link) {
  const tr = lang === 'tr', n = r.week.split('-W')[1].replace(/^0/, '');
  const t = r.totals;
  const lines = tr ? [
    `Merhaba ${name},`, '', `${n}. haftan (${r.from} – ${r.to}):`, '',
    `• Odak: ${hm(t.focused, tr)} (${t.sessions} oturum), planlanan derin odak ${hm(t.deep, tr)}`,
    `• Günü kapattığın gün: ${t.shutdowns}/7`,
    `• Biten görev: ${t.tasksDone + t.listDone}`,
    ...(r.plan.total ? [`• Haftalık plan: ${r.plan.done}/${r.plan.total}`] : []),
    ...(t.revisions ? [`• Yeniden planlama: ${t.revisions} kez`] : []),
    ...(r.focusOn.length ? ['', 'Odak en çok şuraya gitti:', ...r.focusOn.map((x) => `  ${x.name}: ${hm(x.minutes, tr)}`)] : []),
    ...(r.habits.length ? ['', 'Alışkanlıklar:', ...r.habits.map((h) => `  ${h.name}: ${h.days}/7`)] : []),
    '', `Ayrıntılar: ${link}`, '', 'Bu e-postayı planlayıcıdaki haftalık özet sayfasından kapatabilirsin.',
  ] : [
    `Hello ${name},`, '', `Your week ${n} (${r.from} – ${r.to}):`, '',
    `• Focused: ${hm(t.focused, tr)} (${t.sessions} sessions), deep focus planned ${hm(t.deep, tr)}`,
    `• Days closed with the shutdown: ${t.shutdowns}/7`,
    `• Tasks done: ${t.tasksDone + t.listDone}`,
    ...(r.plan.total ? [`• Weekly plan: ${r.plan.done}/${r.plan.total}`] : []),
    ...(t.revisions ? [`• Plans revised: ${t.revisions} times`] : []),
    ...(r.focusOn.length ? ['', 'Your focus went most to:', ...r.focusOn.map((x) => `  ${x.name}: ${hm(x.minutes, tr)}`)] : []),
    ...(r.habits.length ? ['', 'Habits:', ...r.habits.map((h) => `  ${h.name}: ${h.days}/7`)] : []),
    '', `The details: ${link}`, '', 'You can turn this e-mail off on the week in review page of the planner.',
  ];
  return { subject: tr ? `${n}. haftanın özeti` : `Your week ${n} in review`, text: lines.join('\n') };
}

/** Every Sunday from WEEKLY_HOUR (default 18, the server's time): the week's review to those who asked for it, once. */
export function weeklyMails({ db, send, baseUrl, hour = Number(process.env.WEEKLY_HOUR ?? 18), log = console.log }) {
  const run = async () => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() < hour) return;
    const week = weekOf(iso(now));
    for (const u of db.users.list()) {
      const s = db.docs.get(u.id, 'settings')?.value;
      if (!s?.weeklyMail || db.meta.get(`weekly:${u.id}`) === week) continue;
      const user = db.users.byId(u.id);
      const m = reviewMail(review(db, u.id, week), user.lang, user.name, `${baseUrl()}/review/${week}`);
      if (await send(user.email, m.subject, m.text)) { db.meta.set(`weekly:${u.id}`, week); log(`Weekly review sent to ${user.email}`); }
    }
  };
  setInterval(() => run().catch((e) => log(`Weekly review: ${e.message}`)), 30 * 60_000).unref();
  return run;
}
