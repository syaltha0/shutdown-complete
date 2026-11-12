import { T } from './i18n';

// Dates are local calendar days written as YYYY-MM-DD. Weeks are ISO weeks (Monday first), quarters are calendar quarters.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => toISODate(new Date());

export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** ISO week id, e.g. 2026-W43 */
export function weekOf(s: string): string {
  const d = parseISODate(s);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day + 3); // Thursday of this week decides the year
  const year = d.getFullYear();
  const firstThursday = new Date(year, 0, 4);
  const fday = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fday + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return `${year}-W${pad(week)}`;
}

/** The Monday of an ISO week id */
export function weekStart(id: string): string {
  const [y, w] = id.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const day = (jan4.getDay() + 6) % 7;
  jan4.setDate(jan4.getDate() - day + (w - 1) * 7);
  return toISODate(jan4);
}

export const weekDays = (id: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(id), i));
export const weekNumber = (id: string) => Number(id.split('-W')[1]);

export function addWeeks(id: string, n: number): string {
  return weekOf(addDays(weekStart(id), n * 7));
}

/** Quarter id, e.g. 2026-Q4 */
export function quarterOf(s: string): string {
  const d = parseISODate(s);
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export function quarterRange(id: string): [string, string] {
  const [y, q] = id.split('-Q').map(Number);
  const start = new Date(y, (q - 1) * 3, 1);
  const end = new Date(y, q * 3, 0);
  return [toISODate(start), toISODate(end)];
}

export function addQuarters(id: string, n: number): string {
  const [y, q] = id.split('-Q').map(Number);
  const idx = y * 4 + (q - 1) + n;
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
}

/** The ISO weeks whose Thursday falls inside the quarter (a week belongs to one quarter). */
export function quarterWeeks(id: string): string[] {
  const [from, to] = quarterRange(id);
  const out: string[] = [];
  let w = weekOf(from);
  if (addDays(weekStart(w), 3) < from) w = addWeeks(w, 1);
  while (addDays(weekStart(w), 3) <= to) {
    out.push(w);
    w = addWeeks(w, 1);
  }
  return out;
}

export const fmtDay = (s: string, o: Intl.DateTimeFormatOptions) => parseISODate(s).toLocaleDateString(T().locale, o);
export const longDate = (s: string) => fmtDay(s, { weekday: 'long', day: 'numeric', month: 'long' });
export const shortDate = (s: string) => fmtDay(s, { day: 'numeric', month: 'short' });
export const weekdayShort = (s: string) => fmtDay(s, { weekday: 'short' });
export const weekdayLong = (s: string) => fmtDay(s, { weekday: 'long' });

export function rangeLabel(from: string, to: string): string {
  const a = parseISODate(from), b = parseISODate(to);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString(T().locale, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
  const right = b.toLocaleDateString(T().locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return `${left}–${right}`;
}

/** Minutes since midnight -> 09:30 */
export const clock = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** A duration in minutes -> "3 h 30 m", "45 m", "0 m" (or "3 sa 30 dk" in Turkish) */
export function duration(m: number): string {
  const { hUnit, mUnit } = T();
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  if (!h) return `${r} ${mUnit}`;
  return r ? `${h} ${hUnit} ${r} ${mUnit}` : `${h} ${hUnit}`;
}

export const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/** Month id, e.g. 2026-10 */
export const monthOf = (s: string) => s.slice(0, 7);

export function addMonths(id: string, n: number): string {
  const [y, m] = id.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthRange(id: string): [string, string] {
  const [y, m] = id.split('-').map(Number);
  return [toISODate(new Date(y, m - 1, 1)), toISODate(new Date(y, m, 0))];
}

/** Every day of the month, in order */
export function monthDays(id: string): string[] {
  const [from, to] = monthRange(id);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The ISO weeks that touch the month, Monday first, for a calendar grid */
export function monthWeeks(id: string): string[] {
  const [from, to] = monthRange(id);
  const out: string[] = [];
  for (let w = weekOf(from); weekStart(w) <= to; w = addWeeks(w, 1)) out.push(w);
  return out;
}

export const monthTitle = (id: string) => fmtDay(`${id}-01`, { month: 'long', year: 'numeric' });
export const monthName = (id: string) => fmtDay(`${id}-01`, { month: 'long' });
export const quarterMonths = (q: string) => {
  const [y, n] = q.split('-Q').map(Number);
  return [0, 1, 2].map((i) => `${y}-${pad((n - 1) * 3 + i + 1)}`);
};
