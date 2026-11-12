// Tasks that come back (every day, every 2 days, on chosen weekdays, every month...): the dates they come back on.
// Shared by the planner (client/src/lib/tasks.ts) and the CalDAV side of the server, which rolls a repeating task on
// when a phone app marks it done. Dates are plain YYYY-MM-DD strings, counted in whole days.

const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());
export const addDaysIso = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
/** Monday = 0. */
export const weekdayOf = (s) => (parse(s).getDay() + 6) % 7;
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

/** A month further on the same day, or on `keep` (the 31st becomes a shorter month's last day). */
function addMonthsKeep(s, n, keep) {
  const x = parse(s), day = keep ?? x.getDate();
  const y = new Date(x.getFullYear(), x.getMonth() + n, 1, 12);
  y.setDate(Math.min(day, new Date(y.getFullYear(), y.getMonth() + 1, 0).getDate()));
  return iso(y);
}

/** The next date of a rule after `from`. */
export function nextDate(r, from) {
  const every = Math.max(1, r.every || 1);
  switch (r.unit) {
    case 'month': return addMonthsKeep(from, every, r.monthDay);
    case 'year': return addMonthsKeep(from, 12 * every, r.monthDay);
    case 'week': {
      const days = [...new Set(r.days ?? [])].sort();
      if (!days.length) return addDaysIso(from, 7 * every);
      // a later chosen day in the same week, else the first chosen day `every` weeks on
      const w = weekdayOf(from), later = days.find((x) => x > w);
      if (later != null) return addDaysIso(from, later - w);
      return addDaysIso(addDaysIso(from, -w), 7 * every + days[0]);
    }
    default: return addDaysIso(from, every);
  }
}

/** A date moved to the first of a weekly rule's days on or after it (unchanged when it already is one). */
export function onRuleDay(r, s) {
  if (r.unit !== 'week' || !r.days?.length) return s;
  for (let i = 0; i < 7; i++) if (r.days.includes(weekdayOf(addDaysIso(s, i)))) return addDaysIso(s, i);
  return s;
}

/**
 * A repeating task done: it comes back on its next date (counted from its due date, or from today for "after it is
 * done"); dates already past are skipped, its progress and steps start again. The start keeps its distance to the due.
 * A rule that ends (after `count` times, or `until` a day) is done for good once that is reached.
 */
export function rollOn(t, now = todayIso()) {
  const base = t.repeat.after ? now : t.due ?? t.start ?? now;
  // a monthly or yearly rule keeps the day it began on
  const r = (t.repeat.unit === 'month' || t.repeat.unit === 'year') && !t.repeat.after && t.repeat.monthDay == null
    ? { ...t.repeat, monthDay: parse(base).getDate() } : t.repeat;
  let next = nextDate(r, base);
  for (let i = 0; next <= now && i < 1000; i++) next = nextDate(r, next);
  const count = (t.doneCount ?? 0) + 1;
  if ((r.count && count >= r.count) || (r.until && next > r.until)) return { repeat: r, done: true, doneAt: now, doneCount: count, lastDone: now };
  const gap = t.start && t.due ? daysBetween(t.start, t.due) : null;
  const patch = { repeat: r, percent: undefined, steps: t.steps?.map((s) => ({ ...s, done: false })), doneCount: (t.doneCount ?? 0) + 1, lastDone: now };
  if (t.due || !t.start) patch.due = next;
  if (t.start) patch.start = gap != null ? addDaysIso(next, -gap) : next;
  return patch;
}
