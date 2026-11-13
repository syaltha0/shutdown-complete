import type { Item } from './model';

const fold = (s: string) => s.toLocaleLowerCase();

/** Every word of the query must appear somewhere in the task: title, notes, tags or a subtask's title. */
export function taskMatches(t: Item, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([t.text, t.notes, ...(t.tags ?? []), ...(t.steps ?? []).map((s) => s.text)].filter(Boolean).join('\n'));
  return words.every((w) => hay.includes(w));
}
