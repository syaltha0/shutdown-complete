// The task lists (screens/Tasks.tsx): lists of one's own and the collections drawn from all of them, the order they
// are shown in, and tasks that come back (every day, every 2 days, every week on chosen days, every month...).
import { fmtDay, parseISODate, shortDate, today, weekDays, weekOf } from './dates';
import type { InboxDoc, Item, Recur, TaskList } from './model';
import type { Words } from './words/en';

/** The list every task without one belongs to (the old inbox), always there. */
export const DEFAULT_LIST = 'inbox';
/** Collections: tasks gathered from every list by what they are. */
export const COLLECTIONS = ['all', 'today', 'week', 'important', 'current', 'completed'] as const;
export type Collection = (typeof COLLECTIONS)[number];
export type Sort = 'due' | 'priority' | 'start' | 'created' | 'title' | 'manual';
export const SORTS: Sort[] = ['due', 'priority', 'start', 'created', 'title', 'manual'];
/** A tag's view: `tag:<name>`. */
export const TAG = 'tag:';

export const listOf = (t: Item) => t.list ?? DEFAULT_LIST;
export const listsOf = (doc: InboxDoc, words: Words): TaskList[] => [{ id: DEFAULT_LIST, name: words.tkInbox }, ...(doc.lists ?? [])];

const isOpen = (t: Item) => !t.done;
const daysTo = (d: string) => Math.round((parseISODate(d).getTime() - parseISODate(today()).getTime()) / 86400000);

/** Whether a task belongs in a collection (or a list, by its id). */
export function inView(t: Item, view: string): boolean {
  const now = today();
  switch (view) {
    case 'all': return isOpen(t);
    // due or started by today, late ones too
    case 'today': return isOpen(t) && ((!!t.due && t.due <= now) || (!!t.start && t.start <= now));
    case 'week': return isOpen(t) && !!t.due && daysTo(t.due) <= 7;
    case 'important': return isOpen(t) && t.priority === 1;
    // begun: started, partly done, or some of its steps ticked
    case 'current': return isOpen(t) && ((!!t.start && t.start <= now) || (t.percent ?? 0) > 0 || !!t.steps?.some((s) => s.done));
    case 'completed': return !!t.done;
    default: return isOpen(t) && (view.startsWith(TAG) ? !!t.tags?.includes(view.slice(TAG.length)) : listOf(t) === view);
  }
}

/** The order of a view; tasks without the field sorted by come last, then by when they were written down. */
export function sortTasks(items: Item[], by: Sort): Item[] {
  // one's own order is the order they are kept in, changed by dragging
  if (by === 'manual') return [...items];
  const key = (t: Item): string => {
    switch (by) {
      case 'due': return `${t.due ?? '9999'} ${t.dueTime ?? '99:99'}`;
      case 'start': return t.start ?? '9999';
      case 'priority': return String(t.priority ?? 9);
      case 'created': return t.created ? String(9e12 - Date.parse(t.created)).padStart(14, '0') : '9';
      case 'title': return t.text.toLocaleLowerCase();
    }
  };
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || (a.created ?? '').localeCompare(b.created ?? ''));
}

// the dates rules come back on live with the server, which rolls a task on when a phone app marks it done
export { nextDate, onRuleDay } from '../../../server/src/recur.mjs';
import { rollOn as roll } from '../../../server/src/recur.mjs';
/** A repeating task done: the changes that bring it back on its next date (see server/src/recur.mjs). */
export const rollOn = (t: Item): Partial<Item> => roll(t) as Partial<Item>;

/** The ready-made rules offered first; anything else is "custom". */
export const PRESETS: { id: string; rule: Recur }[] = [
  { id: 'daily', rule: { every: 1, unit: 'day' } },
  { id: 'every2', rule: { every: 2, unit: 'day' } },
  { id: 'weekdays', rule: { every: 1, unit: 'week', days: [0, 1, 2, 3, 4] } },
  { id: 'weekly', rule: { every: 1, unit: 'week' } },
  { id: 'biweekly', rule: { every: 2, unit: 'week' } },
  { id: 'monthly', rule: { every: 1, unit: 'month' } },
  { id: 'yearly', rule: { every: 1, unit: 'year' } },
];
export const presetOf = (r?: Recur) =>
  !r ? 'none' : PRESETS.find((p) => p.rule.every === r.every && p.rule.unit === r.unit && (p.rule.days ?? []).join() === (r.days ?? []).join())?.id ?? 'custom';

/** A rule in words: "every 2 days", "every week on Mon, Thu", "every month, after it is done". */
export function recurWords(W: Words, r: Recur): string {
  const names = weekDays(weekOf(today())).map((d) => fmtDay(d, { weekday: 'short' }));
  const days = r.unit === 'week' && r.days?.length ? r.days.slice().sort().map((d) => names[d]) : [];
  return W.tkEvery(r.every, r.unit, days) + (r.after ? W.tkAfterDone : '') + (r.count ? W.tkTimes(r.count) : r.until ? W.tkUntil(shortDate(r.until)) : '');
}

/** When it is due, short: a date (late ones flagged by the caller). */
export const dueShort = (d: string) => shortDate(d);
export { daysTo };

export function matchesFilter(t: Item, f: import('./model').SavedTaskFilter): boolean {
  const now = today();
  return (!f.list || listOf(t) === f.list) && (!f.tag || !!t.tags?.includes(f.tag)) && (!f.priority || String(t.priority ?? '') === f.priority)
    && (!!t.done === (f.status === 'completed')) && (!f.date || (f.date === 'none' ? !t.due : !!t.due && (f.date === 'today' ? t.due === now : f.date === 'week' ? weekOf(t.due) === weekOf(now) : f.date === 'late' ? t.due < now : (!f.from || t.due >= f.from) && (!f.to || t.due <= f.to))));
}
