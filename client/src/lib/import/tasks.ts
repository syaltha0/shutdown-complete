import type { InboxDoc, Item } from '../model';
export type Source = 'todoist' | 'ticktick';
export interface Parsed { tasks: (Item & { listName: string })[]; skipped: { row: number; reason: 'completed' | 'empty' | 'unsupported' }[] }
export function csv(text: string): string[][] {
  // one line ending everywhere: a file saved on Windows keeps \r\n inside quoted multi-line fields too
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = text.split(/\r?\n/).find(l => /TYPE|Title/.test(l)) ?? text.split(/\r?\n/)[0];
  const delimiter = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === delimiter || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== delimiter) { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else cell += c;
  }
  if (quoted) throw new Error('CSV');
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
function date(value: string): { due?: string; dueTime?: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return {};
  const due = `${m[1]}-${m[2]}-${m[3]}`;
  const timestamp = new Date(due + 'T00:00:00Z');
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 10) !== due) return {};
  return { due, ...(m[4] && Number(m[4]) < 24 && Number(m[5]) < 60 ? { dueTime: `${m[4]}:${m[5]}` } : {}) };
}
export function parseImport(text: string, source: Source, name: string, completed = false): Parsed {
  const rows = csv(text), header = rows.findIndex(r => source === 'todoist' ? r.includes('TYPE') && r.includes('CONTENT') : r.includes('Title') && r.includes('Status'));
  if (header < 0) throw new Error('CSV');
  const tasks: Parsed['tasks'] = [], skipped: Parsed['skipped'] = []; let section = '', parent: Item | undefined;
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i]; if (r.every(v => !v.trim())) continue;
    const get = (key: string) => (r[rows[header].indexOf(key)] ?? '').trim();
    const title = get(source === 'todoist' ? 'CONTENT' : 'Title');
    if (source === 'todoist' && get('TYPE') === 'section') { section = title; parent = undefined; continue; }
    if (source === 'todoist' && get('TYPE') === 'note') { if (parent) parent.notes = [parent.notes, title].filter(Boolean).join('\n'); continue; }
    if (source === 'todoist' && get('TYPE') !== 'task') { skipped.push({ row: i + 1, reason: 'unsupported' }); continue; }
    if (source === 'todoist' && Number(get('INDENT') || 1) <= 1) parent = undefined;
    const done = source === 'ticktick' ? get('Status') === '2' : /^(1|true|2)$/i.test(get('COMPLETED'));
    if (!completed && done) { skipped.push({ row: i + 1, reason: 'completed' }); continue; }
    if (!title) { skipped.push({ row: i + 1, reason: 'empty' }); continue; }
    const rawDate = get(source === 'todoist' ? 'DATE' : 'Due Date');
    const parsedDate = date(rawDate);
    const p = get(source === 'todoist' ? 'PRIORITY' : 'Priority');
    const priority = source === 'todoist' ? p === '1' || p === '' ? 1 : p === '2' ? 5 : 9 : p === '5' ? 1 : p === '3' ? 5 : 9;
    const notes = [get(source === 'todoist' ? 'DESCRIPTION' : 'Content'), get('Repeat'), !parsedDate.due ? rawDate : '', get('DEADLINE')].filter(Boolean).join('\n');
    const item: Parsed['tasks'][number] = { id: String(i), text: title, done, ...parsedDate, priority, notes, tags: [section, ...get('Tags').split(',')].filter(Boolean), listName: get(source === 'todoist' ? 'PROJECT' : 'List Name') || name.replace(/\.csv$/i, '') };
    if (source === 'todoist' && Number(get('INDENT')) > 1 && parent) { (parent.steps ??= []).push(item); }
    else { tasks.push(item); parent = item; }
  }
  return { tasks, skipped };
}
export async function fileIdentity(text: string, source: Source) {
  return source + ':' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))))).map(n => n.toString(16).padStart(2, '0')).join('');
}
export function mergeImport(doc: InboxDoc, parsed: Parsed, identity: string): InboxDoc {
  const lists = [...(doc.lists ?? [])], items = [...doc.items];
  const assign = (item: Item, id: string): Item => ({ ...item, id, steps: item.steps?.map((s, i) => assign(s, `${id}:${i}`)) });
  parsed.tasks.forEach((task) => {
    const id = `${identity}:${task.id}`;
    if (items.some(t => t.id === id)) return;
    let list = lists.find(l => l.name === task.listName);
    if (!list) { list = { id: `${identity}:list:${lists.length}`, name: task.listName }; lists.push(list); }
    const { listName: _name, ...item } = task;
    items.push({ ...assign(item, id), list: list.id });
  });
  return { ...doc, items, lists };
}
