import type { Item, TaskList } from './model';

const weekdays = [
  ['pazartesi', 'monday'], ['salı', 'tuesday'], ['çarşamba', 'wednesday'],
  ['perşembe', 'thursday'], ['cuma', 'friday'], ['cumartesi', 'saturday'], ['pazar', 'sunday'],
];
const fold = (s: string) => s.toLocaleLowerCase('tr-TR');
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Deliberately bounded grammar; unsupported text stays in the title. Never creates lists. */
export function parseTaskDraft(input: string, lists: TaskList[], base: string): Partial<Item> & { text: string } {
  const result: Partial<Item> & { text: string } = { text: input.trim() };
  let text = result.text;
  const take = (pattern: RegExp, apply: (match: RegExpMatchArray) => boolean | void) => {
    text = text.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as RegExpMatchArray;
      return apply(match) === false ? match[0] : ' ';
    });
  };
  take(/(?:^|\s)#([^\s#@]+)/gu, (m) => {
    const list = lists.find((l) => fold(l.name) === fold(m[1]));
    if (!list) return false;
    result.list = list.id;
  });
  take(/(?:^|\s)@([^\s#@]+)/gu, (m) => { result.tags = [...new Set([...(result.tags ?? []), m[1]])]; });
  take(/(?:^|\s)!([159])(?=\s|$)/g, (m) => { result.priority = Number(m[1]) as 1 | 5 | 9; });
  take(/(?:^|\s)(her|every)\s+([\p{L}]+)(?=\s|$)/giu, (m) => {
    const word = fold(m[2]);
    const day = weekdays.findIndex((names) => names.includes(word));
    const unit = ['gün', 'day'].includes(word) ? 'day' : ['hafta', 'week'].includes(word) ? 'week' : ['ay', 'month'].includes(word) ? 'month' : null;
    if (day < 0 && !unit) return false;
    result.repeat = day >= 0 ? { every: 1, unit: 'week', days: [day] } : { every: 1, unit: unit! };
    const d = new Date(`${base}T12:00:00`);
    if (day >= 0) d.setDate(d.getDate() + (day - (d.getDay() + 6) % 7 + 7) % 7);
    result.due = dateKey(d);
  });
  take(/(?:^|\s)(bugün|yarın|today|tomorrow|\d{4}-\d{2}-\d{2})(?:\s+(?:at\s+|saat\s+)?(\d{1,2})(?::([0-5]\d))?)?(?=\s|$)/giu, (m) => {
    const word = fold(m[1]);
    let due = base;
    if (['yarın', 'tomorrow'].includes(word)) { const d = new Date(`${base}T12:00:00`); d.setDate(d.getDate() + 1); due = dateKey(d); }
    else if (/^\d/.test(word)) {
      const d = new Date(`${word}T12:00:00`);
      if (!Number.isFinite(d.getTime()) || dateKey(d) !== word) return false;
      due = word;
    }
    if (m[2] && Number(m[2]) > 23) return false;
    result.due = due;
    if (m[2]) result.dueTime = `${m[2].padStart(2, '0')}:${m[3] ?? '00'}`;
  });
  // a weekly rule counts from one of its own weekdays: a date beside it moves on to the next such day
  if (result.due && result.repeat?.days?.length) {
    const d = new Date(`${result.due}T12:00:00`);
    for (let i = 0; i < 7 && !result.repeat.days.includes((d.getDay() + 6) % 7); i++) d.setDate(d.getDate() + 1);
    result.due = dateKey(d);
  }
  const title = text.replace(/\s+/g, ' ').trim();
  // A title is mandatory: never turn a metadata-only entry into an unnamed task.
  return title ? { ...result, text: title } : { text: input.trim() };
}
