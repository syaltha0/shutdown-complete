// A realistic-capacity check: the deep work a day or week plans against what the last four weeks of focus sessions show.
import { addDays } from './dates';
import { focusMinutes } from './focus';
import type { DayDoc } from './model';
import { useRange } from './useDoc';

/** The plan counts as too much when it is over the usual by this share and by at least this many minutes. */
export const CAPACITY_OVER = 1.4;
export const CAPACITY_GAP = 60;
/** Fewer days with a focus session than this in the four weeks: too little to say what is usual. */
export const CAPACITY_MIN_DAYS = 5;
export const CAPACITY_WEEKS = 4;

export interface Baseline { perDay: number; perWeek: number }

/** What the last four weeks (the 28 days before `anchor`) usually held: minutes per day that had focus, and per week. */
export function baselineOf(docs: Map<string, DayDoc> | null, anchor: string): Baseline | null {
  if (!docs) return null;
  const from = `day:${addDays(anchor, -7 * CAPACITY_WEEKS)}`, to = `day:${addDays(anchor, -1)}`;
  let total = 0, days = 0;
  for (const [k, d] of docs) {
    if (k < from || k > to) continue;
    const m = focusMinutes(d);
    if (m > 0) { total += m; days++; }
  }
  if (days < CAPACITY_MIN_DAYS) return null;
  return { perDay: total / days, perWeek: total / CAPACITY_WEEKS };
}

export const overCapacity = (planned: number, usual: number) => planned > usual * CAPACITY_OVER && planned - usual >= CAPACITY_GAP;

/** The baseline before `anchor` (today, or the day a plan starts on when that lies in the past). */
export function useBaseline(anchor: string): Baseline | null {
  const { docs } = useRange<DayDoc>(`day:${addDays(anchor, -7 * CAPACITY_WEEKS)}`, `day:${addDays(anchor, -1)}`);
  return baselineOf(docs, anchor);
}
