import type { Kind } from './model';

// What the command palette (Ctrl+K) understands beyond its fixed commands: "12 Nov" or "week 47" (go there),
// "block 3pm 1h deep Chapter draft" (a block for the plan) and "task Report tomorrow 10am" (a task for the inbox).
// A pure parser, Turkish and English at once whatever the interface language is: a line it does not fully
// understand gives nothing, so the palette never guesses. It takes today's date as a plain argument and keeps its
// own few calendar helpers (dates.ts needs the browser) so the unit tests can run it as it is.

export type Level = 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface GoTarget { level: Level; id: string; path: string }
export interface BlockDraft { date: string; dateGiven: boolean; start: number; end: number; kind: Kind; label: string }
export type PaletteIntent =
  | { type: 'go'; target: GoTarget }
  | { type: 'block'; draft: BlockDraft }
  | { type: 'task'; body: string };

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const iso = (d: Date) => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = dateOf(s); d.setDate(d.getDate() + n); return iso(d); };

function isoWeek(s: string): string {
  const d = dateOf(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3); // the Thursday decides the year
  const jan4 = new Date(d.getFullYear(), 0, 4);
  jan4.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3);
  return `${d.getFullYear()}-W${pad(1 + Math.round((d.getTime() - jan4.getTime()) / (7 * 864e5)))}`;
}
function weekMonday(id: string): string {
  const [y, w] = id.split('-W').map(Number);
  const d = new Date(y, 0, 4);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + (w - 1) * 7);
  return iso(d);
}

const own = (o: object, k: string) => Object.hasOwn(o, k);
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '');
interface Tok { raw: string; f: string; end: number }
function tokens(input: string): Tok[] {
  return [...input.matchAll(/\S+/gu)].map((m) => ({ raw: m[0], f: fold(m[0]), end: (m.index ?? 0) + m[0].length }));
}

const WEEKDAYS = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];
const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  ['ocak', 'oca', 'january', 'jan'], ['subat', 'sub', 'february', 'feb'], ['mart', 'mar', 'march'], ['nisan', 'nis', 'april', 'apr'],
  ['mayis', 'may'], ['haziran', 'haz', 'june', 'jun'], ['temmuz', 'tem', 'july', 'jul'], ['agustos', 'agu', 'august', 'aug'],
  ['eylul', 'eyl', 'september', 'sept', 'sep'], ['ekim', 'eki', 'october', 'oct'], ['kasim', 'kas', 'november', 'nov'], ['aralik', 'ara', 'december', 'dec'],
];
// Short Turkish forms are ordinary words ("ara" = pause, "sub"…): they name a month only beside a day number.
const STANDALONE_MONTH = new Set(['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik',
  'january', 'jan', 'february', 'feb', 'march', 'mar', 'april', 'apr', 'may', 'june', 'jun', 'july', 'jul', 'august', 'aug', 'september', 'sept', 'sep', 'october', 'oct', 'november', 'nov', 'december', 'dec']);
const monthIndex = (w: string) => MONTHS.findIndex((names) => names.includes(w.replace(/\.$/, '')));
const validYear = (n: number) => n >= 1900 && n <= 2199;

function validDay(y: number, m: number, d: number): string | null {
  if (!validYear(y) || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? iso(date) : null;
}

/** A day written at tokens[i]: today, tomorrow, a weekday (the next one), "12 Nov", "12.11", an ISO date. */
function dayAt(t: Tok[], i: number, base: string): { date: string; n: number } | null {
  const w = t[i]?.f;
  if (!w) return null;
  const by = Number(base.slice(0, 4));
  if (['bugun', 'today'].includes(w)) return { date: base, n: 1 };
  if (['yarin', 'tomorrow'].includes(w)) return { date: addDays(base, 1), n: 1 };
  if (['dun', 'yesterday'].includes(w)) return { date: addDays(base, -1), n: 1 };
  const skip = ['next', 'gelecek'].includes(w) ? 1 : 0, name = t[i + skip]?.f ?? '';
  let wd = WEEKDAYS.indexOf(name); if (wd < 0) wd = WEEKDAYS_EN.indexOf(name);
  if (wd >= 0) return { date: addDays(base, (wd - dateOf(base).getDay() + 7) % 7 || 7), n: skip + 1 };
  const full = w.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) { const date = validDay(+full[1], +full[2], +full[3]); return date ? { date, n: 1 } : null; }
  const dm = w.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (dm) { const date = validDay(dm[3] ? +dm[3] : by, +dm[2], +dm[1]); return date ? { date, n: 1 } : null; }
  const dayFirst = w.match(/^(\d{1,2})\.?$/);
  if (dayFirst && t[i + 1]) {
    const m = monthIndex(t[i + 1].f);
    if (m < 0) return null;
    const year = t[i + 2]?.f.match(/^\d{4}$/) ? +t[i + 2].f : null;
    const date = validDay(year ?? by, m + 1, +dayFirst[1]);
    return date ? { date, n: year ? 3 : 2 } : null;
  }
  const m = monthIndex(w);
  if (m >= 0 && t[i + 1]?.f.match(/^\d{1,2}\.?$/)) {
    const year = t[i + 2]?.f.match(/^\d{4}$/) ? +t[i + 2].f : null;
    const date = validDay(year ?? by, m + 1, parseInt(t[i + 1].f, 10));
    return date ? { date, n: year ? 3 : 2 } : null;
  }
  return null;
}

const dayTarget = (id: string): GoTarget => ({ level: 'day', id, path: `/day/${id}` });
function weekTarget(year: number, n: number): GoTarget | null {
  if (!validYear(year) || n < 1 || n > 53) return null;
  const id = `${year}-W${pad(n)}`;
  return isoWeek(weekMonday(id)) === id ? { level: 'week', id, path: `/week/${id}` } : null;
}
const monthTarget = (y: number, m: number): GoTarget | null => validYear(y) && m >= 1 && m <= 12 ? { level: 'month', id: `${y}-${pad(m)}`, path: `/month/${y}-${pad(m)}` } : null;
const quarterTarget = (y: number, q: number): GoTarget | null => validYear(y) && q >= 1 && q <= 4 ? { level: 'quarter', id: `${y}-Q${q}`, path: `/quarter/${y}-Q${q}` } : null;
const yearTarget = (y: number): GoTarget | null => validYear(y) ? { level: 'year', id: String(y), path: `/year/${y}` } : null;

const UNITS: Record<string, Level> = { hafta: 'week', week: 'week', ay: 'month', month: 'month', ceyrek: 'quarter', quarter: 'quarter', yil: 'year', year: 'year' };
const RELATIVE: Record<string, number> = { bu: 0, this: 0, gelecek: 1, next: 1, haftaya: 1, gecen: -1, last: -1, onceki: -1, previous: -1 };

/** "12 Nov", "yarın", "pazartesi", "gelecek hafta", "hafta 47", "Aralık", "2026", "Q1" … → the screen it names, or null. */
export function parseGo(input: string, base: string): GoTarget | null {
  let t = tokens(input);
  const lead = t[0]?.f === 'tarihe' && t[1]?.f === 'git' ? 2 : t[0]?.f === 'go' && t[1]?.f === 'to' ? 2 : ['go', 'goto', 'git'].includes(t[0]?.f ?? '') ? 1 : 0;
  t = t.slice(lead);
  if (!t.length) return null;
  const f = t.map((x) => x.f), by = Number(base.slice(0, 4));
  const year = (s?: string) => (s && /^\d{4}$/.test(s) ? +s : null);

  const day = dayAt(t, 0, base);
  if (day && day.n === t.length) return dayTarget(day.date);

  // this / next / last week, month, quarter, year
  const unit = own(UNITS, f[1] ?? '') ? UNITS[f[1]] : null;
  if (t.length === 2 && own(RELATIVE, f[0]) && unit) {
    const k = RELATIVE[f[0]], d = dateOf(base);
    if (unit === 'week') { const id = isoWeek(addDays(base, 7 * k)); return { level: 'week', id, path: `/week/${id}` }; }
    if (unit === 'month') { d.setDate(1); d.setMonth(d.getMonth() + k); return monthTarget(d.getFullYear(), d.getMonth() + 1); }
    if (unit === 'quarter') { const q = by * 4 + Math.floor(d.getMonth() / 3) + k; return quarterTarget(Math.floor(q / 4), (q % 4) + 1); }
    return yearTarget(by + k);
  }

  // week 47, hafta 47, 47. hafta, w47, 2026-W47
  let m = f.join(' ').match(/^(?:(?:hafta|week|w)\s*(\d{1,2})|(\d{1,2})\.?\s*(?:hafta|week)|(\d{4})-w(\d{1,2}))(?:\s+(\d{4}))?$/);
  if (m) return weekTarget(+(m[3] ?? m[5] ?? by), +(m[1] ?? m[2] ?? m[4]));

  // Q1, çeyrek 1, 1. çeyrek, 2026-Q4 (a year may come before or after)
  m = f.join(' ').match(/^(?:(\d{4})\s+)?(?:(?:q|ceyrek|quarter)\s*([1-4])|([1-4])\.?\s*(?:ceyrek|quarter))(?:\s+(\d{4}))?$/) ?? f.join(' ').match(/^(\d{4})-q([1-4])$/);
  if (m) return quarterTarget(+(m[1] ?? m[4] ?? by), +(m[2] ?? m[3]));

  // a month (name or 2026-11), with an optional year
  if (/^\d{4}-\d{2}$/.test(f[0]) && t.length === 1) return monthTarget(+f[0].slice(0, 4), +f[0].slice(5));
  if (f.length <= 2 && STANDALONE_MONTH.has(f[0].replace(/\.$/, '')) && (f.length === 1 || year(f[1]))) return monthTarget(year(f[1]) ?? by, monthIndex(f[0]) + 1);

  if (t.length === 1 && /^\d{4}$/.test(f[0])) return yearTarget(+f[0]);
  return null;
}

const KINDS: Record<string, Kind> = { derin: 'deep', deep: 'deep', sig: 'shallow', shallow: 'shallow', toplanti: 'meeting', meeting: 'meeting', kisisel: 'personal', personal: 'personal' };
const MERIDIEM = /^(am|pm)$/;
const hour12 = (h: number, ap: string) => (h < 1 || h > 12 ? -1 : (h % 12) + (ap === 'pm' ? 12 : 0));
const clockMin = (h: number, m: number) => (h >= 0 && h <= 23 && m >= 0 && m <= 59 ? h * 60 + m : -1);

/** One clock time at tokens[i] ("15:00", "3pm", "3:30 pm", "at 3pm", "saat 15"); n tokens used. */
function timeAt(t: Tok[], i: number): { min: number; n: number } | null {
  const w = t[i].f;
  const prefixed = ['saat', 'at', '@'].includes(w);
  if (prefixed) { const r = i + 1 < t.length ? timeAt(t, i + 1) : null; if (r) return { min: r.min, n: r.n + 1 }; const bare = t[i + 1]?.f.match(/^(\d{1,2})$/); const v = bare ? clockMin(+bare[1], 0) : -1; return v >= 0 ? { min: v, n: 2 } : null; }
  const colon = w.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (colon) {
    const h = colon[3] ? hour12(+colon[1], colon[3]) : +colon[1], v = clockMin(h, +colon[2]);
    const sp = t[i + 1]?.f;
    if (!colon[3] && sp && MERIDIEM.test(sp)) { const v2 = clockMin(hour12(+colon[1], sp), +colon[2]); return v2 >= 0 ? { min: v2, n: 2 } : null; }
    return v >= 0 ? { min: v, n: 1 } : null;
  }
  const ap = w.match(/^(\d{1,2})(am|pm)$/);
  if (ap) { const v = clockMin(hour12(+ap[1], ap[2]), 0); return v >= 0 ? { min: v, n: 1 } : null; }
  const spaced = w.match(/^(\d{1,2})$/);
  if (spaced && t[i + 1] && MERIDIEM.test(t[i + 1].f)) { const v = clockMin(hour12(+spaced[1], t[i + 1].f), 0); return v >= 0 ? { min: v, n: 2 } : null; }
  return null;
}

/** A bare clock word inside a range: "15", "15:30", "3pm". */
const clockWord = (s: string) => {
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  return m ? clockMin(m[3] ? hour12(+m[1], m[3]) : +m[1], m[2] ? +m[2] : 0) : -1;
};

const UNIT_MIN:Record<string, number> = { dk: 1, dak: 1, dakika: 1, min: 1, mins: 1, minute: 1, minutes: 1, m: 1, s: 60, sa: 60, saat: 60, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60 };
const MIN_UNITS = new Set(['dk', 'dak', 'dakika', 'min', 'mins', 'minute', 'minutes', 'm']);

/** A length at tokens[i] ("30dk", "1s", "1.5h", "90m", "1h30", "2 saat", "45 min"); n tokens used. */
function durationAt(t: Tok[], i: number): { min: number; n: number } | null {
  const w = t[i].f;
  const ok = (min: number, n: number) => (Number.isFinite(min) && min >= 1 && min <= 1440 ? { min: Math.round(min), n } : null);
  const num = (s: string) => Number(s.replace(',', '.'));
  const mixed = w.match(/^(\d+)(h|s|sa|saat|hr|hour)(\d{1,2})(m|dk|min)?$/);
  if (mixed) return ok(+mixed[1] * 60 + +mixed[3], 1);
  const glued = w.match(/^(\d+(?:[.,]\d+)?)([a-z]+)$/);
  if (glued && own(UNIT_MIN, glued[2])) return MIN_UNITS.has(glued[2]) && /[.,]/.test(glued[1]) ? null : ok(num(glued[1]) * UNIT_MIN[glued[2]], 1);
  const bare = w.match(/^(\d+(?:[.,]\d+)?)$/), next = t[i + 1]?.f;
  if (bare && next && own(UNIT_MIN, next)) return MIN_UNITS.has(next) && /[.,]/.test(bare[1]) ? null : ok(num(bare[1]) * UNIT_MIN[next], 2);
  return null;
}

/** "block 15:00 1h deep Chapter draft" → a block draft: the first words are the keyword, the rest in any order. */
export function parseBlock(input: string, base: string): BlockDraft | null {
  const t = tokens(input);
  let i = 0;
  if (t[i]?.f === 'add') i++;
  if (!['blok', 'block'].includes(t[i]?.f ?? '')) return null;
  i++;
  if (['ekle', 'add'].includes(t[i]?.f ?? '')) i++;
  let start = -1, end = -1, dur = 0, kind: Kind | null = null, date: string | null = null, nameStarted = false;
  const name: string[] = [];
  while (i < t.length) {
    const w = t[i].f;
    // a range: 15:00-16:30, 15:00 - 16:30, 3pm-4pm
    if (start < 0) {
      const glued = w.match(/^([^-–—]+)[-–—]([^-–—]+)$/);
      if (glued && clockWord(glued[1]) >= 0 && clockWord(glued[2]) >= 0) { start = clockWord(glued[1]); end = clockWord(glued[2]); i++; continue; }
      const sep = t[i + 1]?.f;
      if (sep && /^[-–—]$/.test(sep) && t[i + 2]) {
        const a = timeAt(t, i), b = a && a.n === 1 ? timeAt(t, i + 2) : null;
        if (a && b) { start = a.min; end = b.min; i += 2 + b.n; continue; }
      }
      const a = timeAt(t, i);
      if (a) { start = a.min; i += a.n; continue; }
    }
    if (!dur && end < 0) { const d = durationAt(t, i); if (d) { dur = d.min; i += d.n; continue; } }
    if (!kind && !nameStarted && own(KINDS, w)) { kind = KINDS[w]; i++; continue; }
    if (!date) {
      const d = dayAt(t, i, base);
      // "Friday" or "May 4" can be a word of the name once the name began; numeric and today/tomorrow dates are unmistakable
      if (d && (!nameStarted || /^(\d|bugun|yarin|today|tomorrow)/.test(w))) { date = d.date; i += d.n; continue; }
    }
    name.push(t[i].raw); nameStarted = true; i++;
  }
  if (start < 0) return null;
  if (end < 0) end = start + (dur || 60);
  end = Math.min(end, 1440);
  if (end <= start) return null;
  return { date: date ?? base, dateGiven: !!date, start, end, kind: kind ?? 'deep', label: name.join(' ').trim() };
}

/** "task Report tomorrow 10am", "görev ekle …", "add task …" → the text after the keyword (the quick-add grammar reads it). */
export function parseTaskCommand(input: string): string | null {
  const t = tokens(input);
  const lead = t[0]?.f === 'add' && t[1]?.f === 'task' ? 2 : t[0]?.f === 'gorev' && t[1]?.f === 'ekle' ? 2 : ['task', 'gorev'].includes(t[0]?.f ?? '') ? 1 : 0;
  if (!lead || t.length <= lead) return null;
  return input.slice(t[lead - 1].end).trim() || null;
}

/** The first reading of a palette line: a block, a task, or a place to go. */
export function parsePalette(input: string, base: string): PaletteIntent | null {
  const draft = parseBlock(input, base);
  if (draft) return { type: 'block', draft };
  const body = parseTaskCommand(input);
  if (body) return { type: 'task', body };
  const target = parseGo(input, base);
  return target ? { type: 'go', target } : null;
}
