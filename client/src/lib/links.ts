// How the plans hang together. The scales serve each other: a month goal serves a season (quarter) goal, a week's
// item a month goal, a day's task an item of its week (Item.up). Each item can hold smaller steps (Item.steps). A task
// put on a day from a board card stays tied to it (Item.card / Card.planned): ticking the task moves the card to its
// board's last list, and a card moved there ticks the task.
import { api } from './api';
import { monthDays, monthOf, monthWeeks, quarterMonths, quarterOf, today, weekDays, weekOf } from './dates';
import {
  emptyBoards, emptyDay, emptyTeam, type Board, type BoardsDoc, type CardLink, type DayDoc, type Item, type ItemLink, type ProjectData, type TeamDoc,
} from './model';
import { updateKey } from './useDoc';

/** The items of `items` that serve the item `id` of the document `key`. */
export const servingOf = (items: Item[], key: string, id: string) => items.filter((x) => x.up?.key === key && x.up.id === id);

/** Done of all, for a list of items (steps or the items serving one). */
export const tally = (items: Item[]) => ({ done: items.filter((x) => x.done).length, total: items.length });

/** One of the plans an item can serve, as offered in the "serves" picker. */
export interface Choice { key: string; id: string; text: string; done: boolean; where: string }
export const choicesOf = (key: string, items: Item[] | undefined, where: string): Choice[] =>
  (items ?? []).filter((x) => x.text.trim()).map((x) => ({ key, id: x.id, text: x.text, done: x.done, where }));
export const linkOf = (c: Choice): ItemLink => ({ key: c.key, id: c.id });
export const sameLink = (a: ItemLink | undefined, b: ItemLink | undefined) => !!a && !!b && a.key === b.key && a.id === b.id;

/** Where an item that breaks a plan down goes: the scale below, at its current part if that lies inside, else its first. */
export function belowKey(key: string): string | null {
  const t = today();
  const [kind, id] = key.split(':');
  if (kind === 'quarter') { const ms = quarterMonths(id); return `month:${ms.includes(monthOf(t)) ? monthOf(t) : ms[0]}`; }
  if (kind === 'month') { const ws = monthWeeks(id); return `week:${ws.includes(weekOf(t)) ? weekOf(t) : ws.find((w) => weekDays(w).some((d) => monthDays(id).includes(d))) ?? ws[0]}`; }
  if (kind === 'week') { const ds = weekDays(id); return `day:${ds.includes(t) ? t : ds[0]}`; }
  return null;
}
/** The list a document keeps its items in. */
export const itemsField = (key: string) => (key.startsWith('day:') ? 'tasks' : key.startsWith('week:') ? 'items' : 'goals');

/** Adds an item to the scale below that serves `parent` (the same words, to be made smaller there). */
export async function addBelow(parent: { key: string; item: Item }) {
  const key = belowKey(parent.key);
  if (!key) return null;
  const field = itemsField(key);
  const empty = key.startsWith('day:') ? emptyDay() : key.startsWith('week:') ? { items: [], notes: '' } : { goals: [], notes: '', dates: [] };
  const item: Item = { id: Math.random().toString(36).slice(2, 10), text: parent.item.text, done: false, up: { key: parent.key, id: parent.item.id } };
  await updateKey<Record<string, unknown>>(key, () => empty as unknown as Record<string, unknown>, (d) => ({ ...d, [field]: [...((d[field] as Item[]) ?? []), item] }));
  return key;
}

/** The month documents a quarter's goals are served from, the week documents a month's, the day documents a week's. */
export function belowRange(key: string): [string, string] | null {
  const [kind, id] = key.split(':');
  if (kind === 'quarter') { const ms = quarterMonths(id); return [`month:${ms[0]}`, `month:${ms[ms.length - 1]}`]; }
  if (kind === 'month') { const ws = monthWeeks(id); return [`week:${ws[0]}`, `week:${ws[ws.length - 1]}`]; }
  if (kind === 'week') { const ds = weekDays(id); return [`day:${ds[0]}`, `day:${ds[6]}`]; }
  return null;
}
/** The documents one scale up whose items this scale's items can serve. */
export function aboveKeys(key: string): string[] {
  const [kind, id] = key.split(':');
  if (kind === 'month') return [`quarter:${quarterOf(`${id}-01`)}`];
  if (kind === 'week') { const ds = weekDays(id); return [...new Set([`month:${monthOf(ds[0])}`, `month:${monthOf(ds[6])}`])]; }
  if (kind === 'day') return [`week:${weekOf(id)}`];
  return [];
}
export const itemsOf = (key: string, doc: unknown): Item[] => ((doc as Record<string, Item[]> | null)?.[itemsField(key)] ?? []);

// ---------------- board cards and the tasks made from them ----------------

const boardDocKey = (project: string) => (project.startsWith('t:') ? `team:${project.slice(2)}` : 'boards');

/** Changes the board a card lives on, in its personal project or its team project. */
async function onBoard(link: Pick<CardLink, 'project' | 'board'>, fn: (b: Board) => Board) {
  const key = boardDocKey(link.project);
  const setBoards = (p: ProjectData): ProjectData => ({ ...p, boards: p.boards.map((b) => (b.id === link.board ? fn(b) : b)) });
  if (key === 'boards') {
    const pid = link.project.slice(2);
    await updateKey<BoardsDoc>('boards', emptyBoards, (d) => ({ ...d, projects: (d.projects ?? []).map((p) => (p.id === pid ? { ...p, ...setBoards(p) } : p)) }));
  } else {
    await updateKey<TeamDoc>(key, emptyTeam, setBoards);
  }
}

/** A task tied to a card was ticked: the card goes to its board's last list (if it is not there already). */
export async function cardDone(link: CardLink) {
  await onBoard(link, (b) => {
    const last = b.lists[b.lists.length - 1];
    const card = b.lists.flatMap((l) => l.cards).find((c) => c.id === link.card);
    if (!last || !card || last.cards.some((c) => c.id === card.id)) return b;
    return { ...b, lists: b.lists.map((l) => (l.id === last.id ? { ...l, cards: [...l.cards, card] } : { ...l, cards: l.cards.filter((c) => c.id !== card.id) })) };
  });
}

/** After a list of tasks changed: cards whose tasks were just ticked move to their boards' last lists. */
export function syncCards(before: Item[], after: Item[]) {
  const was = new Map(before.map((x) => [x.id, x.done]));
  for (const x of after) if (x.card && x.done && was.get(x.id) === false) cardDone(x.card).catch(() => {});
}

/** A card moved into (or out of) its board's last list: the day's task made from it is ticked (or unticked). */
export async function taskOfCard(planned: { day: string; task: string }, done: boolean) {
  const set = (d: DayDoc) => (d.tasks.some((x) => x.id === planned.task) ? { ...d, tasks: d.tasks.map((x) => (x.id === planned.task ? { ...x, done } : x)) } : d);
  // the task may have been carried to a later day: look from the day it was put on up to today
  const end = today() > planned.day ? today() : planned.day;
  const docs = await api.range<DayDoc>(`day:${planned.day}`, `day:${end}`).catch(() => []);
  const hit = docs.find((x) => x.value?.tasks.some((t) => t.id === planned.task));
  await updateKey<DayDoc>(hit ? hit.key : `day:${planned.day}`, emptyDay, set);
}

