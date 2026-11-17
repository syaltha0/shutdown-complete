import type { DayDoc, MetricDef } from './model.ts';

export function shift(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
export const monday = (date: string) => shift(date, -weekday(date));
export const planned = (h: MetricDef, date: string) => (!h.since || date >= h.since) && (h.frequency?.mode !== 'days' || (h.frequency.days ?? []).includes(weekday(date)));
export const habitState = (h: MetricDef, doc?: DayDoc | null) => doc?.metrics[h.id] === true ? 'done' : doc?.skippedHabits?.includes(h.id) ? 'skipped' : 'empty';
export function cycleHabit(h: MetricDef, doc: DayDoc): DayDoc {
  const state = habitState(h, doc);
  return { ...doc, metrics: { ...doc.metrics, [h.id]: state === 'empty' }, skippedHabits: [...(doc.skippedHabits ?? []).filter(id => id !== h.id), ...(state === 'done' ? [h.id] : [])] };
}
/** Weekly quotas use whole ISO weeks; skips reduce available opportunities, never the quota below completed work. */
export function habitStats(h: MetricDef, dates: string[], get: (date: string) => DayDoc | null | undefined, today: string) {
  const eligible = dates.filter(d => d <= today && planned(h, d));
  let done = 0, total = 0;
  const weekly = h.frequency?.mode === 'weekly';
  const units = weekly ? [...new Set(eligible.map(monday))] : eligible;
  const results = units.map(d => {
    const ds = weekly ? Array.from({ length: 7 }, (_, i) => shift(d, i)).filter(x => x <= today && planned(h, x)) : [d];
    const n = ds.filter(x => habitState(h, get(x)) === 'done').length;
    const available = ds.filter(x => habitState(h, get(x)) !== 'skipped').length;
    const opportunities = h.since ? Array.from({length: 7}, (_, i) => shift(d, i)).filter(x => planned(h, x)).length : 7;
    const target = weekly ? Math.min(Math.max(1, Math.min(7, h.frequency?.count ?? 1)), opportunities - ds.filter(x => habitState(h, get(x)) === 'skipped').length) : available;
    done += Math.min(n, target); total += target;
    return { d, neutral: target === 0, complete: n >= target, pending: weekly ? shift(d, 6) >= today : d === today };
  });
  let streak = 0;
  for (const r of results.reverse()) {
    if (r.neutral) continue;
    if (r.complete) streak++;
    else if (!r.pending) break;
  }
  return { done, total, streak, rate: total ? done / total : 0 };
}

/** Exactly 52 Monday-first weeks ending in the reference date's week.
 * Binary completions use full ink; the weekly completion fraction supplies four tones.
 * Skipped and unplanned dates never receive a completion tone. */
export function habitHeatmap(h: MetricDef, get: (date: string) => DayDoc | null | undefined, end: string) {
  const start = shift(monday(end), -51 * 7);
  return Array.from({ length: 364 }, (_, i) => {
    const date = shift(start, i), state = h.since && date < h.since ? 'unavailable' : habitState(h, get(date));
    const week = Math.floor(i / 7), day = i % 7;
    const fraction = h.frequency?.mode === 'weekly'
      ? habitStats(h, Array.from({length: 7}, (_, j) => shift(monday(date), j)), get, end).rate : 1;
    const level = date <= end && planned(h, date) && state === 'done' ? Math.max(1, Math.ceil(fraction * 4)) : 0;
    return { date, week, day, state, level };
  });
}

/** The longest run in the supplied history, using the same units and skip rules as current runs. */
export function habitLongest(h: MetricDef, dates: string[], get: (date: string) => DayDoc | null | undefined, today: string) {
  const weekly = h.frequency?.mode === 'weekly';
  const units = [...new Set(dates.filter(d => d <= today && planned(h, d)).map(d => weekly ? monday(d) : d))].sort();
  let longest = 0, run = 0;
  for (const date of units) {
    const ds = weekly ? Array.from({length: 7}, (_, i) => shift(date, i)) : [date];
    const s = habitStats(h, ds, get, today);
    if (!s.total) continue;
    if (s.done >= s.total) longest = Math.max(longest, ++run);
    else if (weekly ? shift(date, 6) < today : date < today) run = 0;
  }
  return longest;
}
