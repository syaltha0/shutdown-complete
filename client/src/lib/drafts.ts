import type { DayDoc, Item, Settings } from './model';

/**
 * Local versions that lost a save to another device (a 409). The server's version replaces the screen, so the text
 * that was refused is kept here instead: the last 3 per document, for 7 days. localStorage can be unavailable
 * (private windows, blocked storage), so everything also lives in memory for the session.
 */
export interface Draft { key: string; at: number; value: unknown; serverVersion: number }

export const MAX_DRAFTS = 3;
export const DRAFT_DAYS = 7;

let owner = '';
let rev = 0;
const memory = new Map<string, Draft[]>();
const live = new Set<string>(); // documents that lost a save during this session
const listeners = new Set<() => void>();
const prefix = () => `sc-drafts:${owner}:`;
const emit = () => { rev++; listeners.forEach((l) => l()); };

export function setDraftOwner(user: string) { if (owner !== user) { owner = user; memory.clear(); live.clear(); emit(); } }
export const subscribeDrafts = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const draftRevision = () => rev;

const fresh = (list: Draft[]) => list.filter((d) => d && typeof d.at === 'number' && typeof d.key === 'string' && 'value' in d && Date.now() - d.at < DRAFT_DAYS * 864e5).sort((a, b) => b.at - a.at).slice(0, MAX_DRAFTS);

/** The drafts of one document, newest first (expired ones are gone). */
export function readDrafts(key: string): Draft[] {
  let list = memory.get(key) ?? [];
  try {
    const raw = localStorage.getItem(prefix() + key);
    if (raw && !memory.has(key)) list = JSON.parse(raw) as Draft[];
  } catch { /* storage unavailable: the session's own copy */ }
  const kept = fresh(Array.isArray(list) ? list : []);
  if (!Array.isArray(list) || kept.length !== list.length) write(key, kept);
  return kept;
}

function write(key: string, list: Draft[]) {
  if (list.length) memory.set(key, list); else memory.delete(key);
  try { if (list.length) localStorage.setItem(prefix() + key, JSON.stringify(list)); else localStorage.removeItem(prefix() + key); } catch { /* kept in memory */ }
}

/** Compare two documents regardless of key order. */
export function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

export function saveDraft(key: string, value: unknown, serverVersion: number): Draft {
  const d: Draft = { key, at: Date.now(), value: JSON.parse(JSON.stringify(value)), serverVersion };
  const old = readDrafts(key).filter((x) => !same(x.value, value));
  write(key, fresh([d, ...old]));
  live.add(key);
  emit();
  return d;
}

export function clearDrafts(key: string) { write(key, []); live.delete(key); emit(); }

/** Every document with a kept draft (this session's and the ones stored before). */
export function draftKeys(): string[] {
  const keys = new Set<string>(memory.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith(prefix())) keys.add(k.slice(prefix().length)); }
  } catch { /* storage unavailable */ }
  return [...keys].filter((k) => readDrafts(k).length);
}
export const liveKeys = () => [...live];

// ---- reading a document the way a person would -------------------------------------------------------------------

export interface DraftWords {
  blocks: string; tasks: string; notes: string; goals: string; dates: string; items: string; lists: string;
  workday: string; metrics: string; ritual: string; schedule: string; templates: string; other: string;
}
export interface Section { title: string; lines: string[]; prose?: boolean }

const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const span = (a: number, b: number) => `${hm(a)}–${hm(b)}`;
const text = (s: unknown) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim();
const item = (i: Item) => `${i.done ? '[x]' : '[ ]'} ${text(i.text)}`;
const items = (list: unknown) => (Array.isArray(list) ? (list as Item[]).filter((i) => i && typeof i === 'object').map(item) : []);
const notes = (title: string, v: unknown): Section => ({ title, lines: typeof v === 'string' && v.trim() ? v.replace(/\s+$/, '').split('\n') : [], prose: true });

/** A document's fields in plain words: the names and times of blocks, notes, task texts. An unknown kind shows as text. */
export function describe(key: string, value: unknown, w: DraftWords): Section[] {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const kind = key.split(':')[0];
  if (kind === 'day') {
    const d = v as Partial<DayDoc>;
    const cols = Array.isArray(d.columns) ? d.columns : [];
    const blocks = cols.flatMap((c, n) => (c.blocks ?? []).map((b) => `${cols.length > 1 ? `${n + 1} · ` : ''}${span(b.start, b.end)}  ${text(b.label)}`));
    return [{ title: w.blocks, lines: blocks }, { title: w.tasks, lines: items(d.tasks) }, notes(w.notes, d.notes)];
  }
  if (kind === 'week') return [{ title: w.items, lines: items(v.items) }, notes(w.notes, v.notes)];
  if (kind === 'quarter') return [{ title: w.goals, lines: items(v.goals) }, notes(w.notes, v.notes)];
  if (kind === 'month') {
    const dates = Array.isArray(v.dates) ? (v.dates as { date: string; text: string }[]).map((x) => `${x.date}  ${text(x.text)}`) : [];
    return [{ title: w.goals, lines: items(v.goals) }, { title: w.dates, lines: dates }, notes(w.notes, v.notes)];
  }
  if (key === 'inbox') {
    const lists = Array.isArray(v.lists) ? (v.lists as { name: string }[]).map((l) => text(l.name)) : [];
    return [{ title: w.tasks, lines: items(v.items) }, { title: w.lists, lines: lists }];
  }
  if (key === 'settings') {
    const s = v as Partial<Settings>;
    return [
      { title: w.workday, lines: typeof s.startHour === 'number' && typeof s.endHour === 'number' ? [s.wholeDay ? '00:00–24:00' : `${hm(s.startHour * 60)}–${hm(s.endHour * 60)}`] : [] },
      { title: w.metrics, lines: (s.metrics ?? []).map((m) => `${text(m.name)}${m.unit ? ` (${text(m.unit)})` : ''}${m.target != null ? ` · ${m.target}` : ''}`) },
      { title: w.ritual, lines: (s.ritual ?? []).map((r) => text(r.text)) },
      { title: w.schedule, lines: (s.schedule ?? []).map((r) => `${span(r.start, r.end)}  ${text(r.label)}`) },
      { title: w.templates, lines: (s.templates ?? []).map((t) => text(t.name)) },
    ];
  }
  let plain = '';
  try { plain = JSON.stringify(value, null, 2) ?? ''; } catch { /* not serializable */ }
  return [{ title: w.other, lines: plain.split('\n'), prose: true }];
}

/** The same fields as plain text, for the clipboard. */
export const toText = (sections: Section[]) => sections.filter((s) => s.lines.length).map((s) => `${s.title}\n${s.lines.join('\n')}`).join('\n\n');

/** The documents a screen shows (its address), whose kept drafts belong on it. */
export function keysForPath(path: string, today: string): string[] {
  const [, section, arg] = path.split('/');
  switch (section) {
    case '': return [`day:${today}`];
    case 'day': case 'shutdown': return arg ? [`day:${arg}`] : [`day:${today}`];
    case 'week': case 'plan': case 'review': return arg ? [`week:${arg}`] : [];
    case 'month': return arg ? [`month:${arg}`] : [];
    case 'quarter': return arg ? [`quarter:${arg}`] : [];
    case 'tasks': case 'inbox': return ['inbox'];
    case 'settings': return ['settings'];
    default: return [];
  }
}
