import type { CalEvent } from './calendar';
import type { Block } from './model';

// A block made from a calendar event remembers the event's time at that moment (`source.start/end`). Each time the day
// opens the block is compared with the event as the calendar says it is now. Nothing is ever written to the calendar.

/** How many days either side of the planned day are searched for an event that moved. */
export const DRIFT_SPAN = 14;

export interface Drift {
  block: Block;
  /** 'moved': the event has another time (or day); 'gone': it is no longer in the calendar */
  kind: 'moved' | 'gone';
  was: { date: string; start: number; end: number };
  now?: { date: string; start: number; end: number };
}

/** An event with no UID of its own is told apart by its title and time (calendar.ts eventUid): a change of time makes it look like another event, so nothing can be said about it. */
export const hasOwnUid = (uid: string) => !uid.startsWith('["');

/**
 * What the calendar has done to the event behind a block, or null when nothing can be said with confidence
 * (no recorded time, no UID of its own, a calendar that did not answer, a series with several occurrences about).
 */
export function driftOf(
  b: Block, date: string, days: Record<string, CalEvent[]>, errors: { id: string }[], linked: string[],
): Drift | null {
  const s = b.source;
  if (!s || s.start == null || s.end == null || s.date !== date || !hasOwnUid(s.uid)) return null;
  if (!linked.includes(s.calendar) || errors.some((e) => e.id === s.calendar)) return null;
  const was = { date, start: s.start, end: s.end };
  const same = (e: CalEvent) => e.cal === s.calendar && e.uid === s.uid;
  const here = (days[date] ?? []).filter(same);
  if (here.some((e) => e.allDay)) return null; // it became an all-day event: not a time to follow
  if (here.some((e) => e.start === s.start && e.end === s.end)) return null;
  if (here.length > 1) return null;
  if (here.length === 1) {
    const e = here[0];
    return { block: b, kind: 'moved', was, now: { date, start: e.start, end: e.end } };
  }
  // not on its day any more: moved to one other day within reach, or gone
  const elsewhere = Object.entries(days).filter(([d]) => d !== date).flatMap(([d, list]) => list.filter((e) => same(e) && !e.allDay).map((e) => ({ d, e })));
  if (elsewhere.length > 1) return null; // a series: which occurrence it became cannot be told
  if (elsewhere.length === 1) return { block: b, kind: 'moved', was, now: { date: elsewhere[0].d, start: elsewhere[0].e.start, end: elsewhere[0].e.end } };
  return { block: b, kind: 'gone', was };
}
