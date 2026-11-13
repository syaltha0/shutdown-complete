// The weekly schedule: blocks that come back every week (classes, training, a standing appointment). Each is placed
// on a day once, the first time that day is opened from the day it was made on, and the day remembers it (`repeats`),
// so a repeating block moved or deleted on one day stays that way. Past days are never touched.
import { parseISODate, today, weekOf, weekStart } from './dates';
import { uid, type Block, type DayDoc, type Repeat, type ScheduleException } from './model';

/** Monday = 0 … Sunday = 6 */
export const weekdayOf = (date: string) => (parseISODate(date).getDay() + 6) % 7;

/** The day with the repeating blocks it does not have yet, or null when nothing is due. */
export function placeRepeats(day: DayDoc, date: string, schedule: Repeat[] | undefined, exceptions: ScheduleException[] = []): DayDoc | null {
  if (!schedule?.length || date < today()) return null;
  let changed = false;
  if (date > today()) {
    const blocked = new Set(schedule.filter(r => isExcepted(exceptions, date, r.id)).map(r => r.id));
    const removed = new Set(day.columns.flatMap(c => c.blocks.filter(b => b.repeatId && blocked.has(b.repeatId)).map(b => b.repeatId!)));
    const columns = day.columns.map(c => ({ ...c, blocks: c.blocks.filter(b => !b.repeatId || !blocked.has(b.repeatId)) }));
    changed = columns.some((c, i) => c.blocks.length !== day.columns[i].blocks.length);
    if (changed) day = { ...day, columns, repeats: day.repeats?.filter(id => !removed.has(id)) };
  }
  const wd = weekdayOf(date);
  const seen = new Set(day.repeats ?? []);
  const due = schedule.filter((r) => r.days.includes(wd) && date >= r.since && !seen.has(r.id) && !isExcepted(exceptions, date, r.id) && onItsWeek(r, date));
  if (!due.length) return changed ? day : null;
  const last = day.columns.length - 1;
  const floor = day.columns[last].from ?? 0;
  // a day already redrawn from some hour takes only what still lies ahead of that hour
  const add: Block[] = due.filter((r) => r.start >= floor).map((r) => ({
    id: uid(), start: r.start, end: r.end, label: r.label, note: r.note, kind: r.kind, subject: r.subject, repeatId: r.id,
  }));
  return {
    ...day,
    repeats: [...(day.repeats ?? []), ...due.map((r) => r.id)],
    columns: day.columns.map((c, i) => (i === last ? { ...c, blocks: [...c.blocks, ...add].sort((a, z) => a.start - z.start) } : c)),
  };
}

/** Whether a repeat that comes every few weeks falls in the week of `date`. */
export function onItsWeek(r: Repeat, date: string) {
  const every = r.every ?? 1;
  if (every <= 1) return true;
  const weeks = Math.round((parseISODate(weekStart(weekOf(date))).getTime() - parseISODate(weekStart(weekOf(r.since))).getTime()) / (7 * 86400000));
  return weeks % every === 0;
}

/** A repeat made from a block, on the given weekdays, from `date` on. */
export const repeatFromBlock = (b: Block, days: number[], date: string): Repeat => ({
  id: uid(), label: b.label, note: b.note, kind: b.kind, subject: b.subject, start: b.start, end: b.end, days, since: date,
});

export const isExcepted = (exceptions: ScheduleException[] | undefined, date: string, id: string) =>
  (exceptions ?? []).some(e => e.from <= date && date <= e.to && (e.applies === 'all' || e.applies.includes(id)));
