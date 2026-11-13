// Tasks as iCalendar VTODOs (RFC 5545), for the CalDAV server (caldav.mjs) and the Nextcloud link (davsync.mjs).
// A task of the planner is one VTODO; each of its subtasks is a VTODO of its own pointing at it with RELATED-TO, as
// the calendar servers' task apps keep them. What iCalendar has no word for (an estimate, "count from the day it is
// done") rides along in X- properties.
import { createHash } from 'node:crypto';
import { rollOn } from './recur.mjs';

export const DEFAULT_LIST = 'inbox';
export const listOf = (t) => t.list ?? DEFAULT_LIST;
const hash = (s) => createHash('sha256').update(s).digest('base64url').slice(0, 22);

// ---------- reading ----------
const unescape = (v) => v.replace(/\\(.)/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
/** The lines of a calendar object, unfolded, as {name, params, value}. */
function lines(ics) {
  return String(ics).replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter(Boolean).map((l) => {
    // the name and its parameters end at the first colon outside quotes
    let i = 0, q = false;
    for (; i < l.length; i++) { if (l[i] === '"') q = !q; else if (l[i] === ':' && !q) break; }
    const [name, ...ps] = l.slice(0, i).split(';');
    const params = Object.fromEntries(ps.map((p) => { const [k, ...v] = p.split('='); return [k.toUpperCase(), v.join('=').replace(/^"|"$/g, '')]; }));
    return { name: name.toUpperCase(), params, value: l.slice(i + 1), raw: l };
  });
}
/** A DATE or DATE-TIME as the planner's day; a time in UTC is read in this server's time. */
const local = (v) => (/^\d{8}T\d{6}Z$/.test(v) ? new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13))) : null);
const pad2 = (n) => String(n).padStart(2, '0');
const day = (v) => {
  const z = local(v);
  if (z) return `${z.getFullYear()}-${pad2(z.getMonth() + 1)}-${pad2(z.getDate())}`;
  return /^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : undefined;
};
/** The hour of a DATE-TIME (none for a DATE). */
const time = (v, params) => {
  if (params.VALUE === 'DATE' || !/^\d{8}T\d{4}/.test(v)) return undefined;
  const z = local(v);
  return z ? `${pad2(z.getHours())}:${pad2(z.getMinutes())}` : `${v.slice(9, 11)}:${v.slice(11, 13)}`;
};
// Resolve an IANA TZID without depending on the process's local timezone.
function zonedValue(v, params) {
  if (!params.TZID || !/^\d{8}T\d{6}$/.test(v)) return v;
  const target = Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13), +v.slice(13, 15));
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: params.TZID, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    let instant = target;
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(fmt.formatToParts(instant).map(x => [x.type, x.value]));
      instant += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    }
    return new Date(instant).toISOString().replace(/[-:]/g, '').replace('.000', '');
  } catch { return v; } // Preserve unknown/custom zones verbatim on export.
}
/** An alarm's trigger as minutes before (-PT15M -> 15, -P1D -> 1440, PT0S -> 0); null when it is not before. */
function beforeMinutes(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const mins = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.round((+(m[6] || 0)) / 60);
  return m[1] === '-' || mins === 0 ? mins : null;
}
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const UNITS = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };

/** The first VTODO of a calendar object, read into the planner's terms (null when there is none). */
export function parseTodo(ics) {
  const ls = lines(ics);
  const from = ls.findIndex((l) => l.name === 'BEGIN' && l.value.toUpperCase() === 'VTODO');
  if (from < 0) return null;
  const t = { categories: [] };
  let depth = 0;
  for (const l of ls.slice(from + 1)) {
    if (l.name === 'BEGIN') { depth++; continue; }
    if (l.name === 'END') { if (depth-- === 0) break; continue; }
    // of an alarm inside, only when it rings (the first one, before the due time)
    if (depth === 1 && l.name === 'TRIGGER' && t.remind == null) { const m = beforeMinutes(l.value); if (m != null) t.remind = m; continue; }
    if (depth > 0) continue;
    const v = ['DUE', 'DTSTART'].includes(l.name) ? zonedValue(l.value, l.params) : l.value;
    switch (l.name) {
      case 'UID': t.uid = v; break;
      case 'SUMMARY': t.text = unescape(v); break;
      case 'DESCRIPTION': t.notes = unescape(v); break;
      case 'DUE': t.due = day(v); t.dueTime = time(v, l.params); break;
      case 'DTSTART': t.start = day(v); t.startTime = time(v, l.params); break;
      case 'PRIORITY': { const p = Number(v); t.priority = p >= 1 && p <= 4 ? 1 : p === 5 ? 5 : p >= 6 && p <= 9 ? 9 : undefined; break; }
      case 'PERCENT-COMPLETE': t.percent = Math.max(0, Math.min(100, Number(v) || 0)) || undefined; break;
      case 'STATUS': t.status = v.toUpperCase(); break;
      case 'COMPLETED': t.completed = day(v); break;
      case 'CATEGORIES': t.categories.push(...v.split(/(?<!\\),/).map((x) => unescape(x).trim()).filter(Boolean)); break;
      case 'CREATED': t.created = /^\d{8}T\d{6}/.test(v) ? `${day(v)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}Z` : undefined; break;
      case 'RELATED-TO': if (!l.params.RELTYPE || l.params.RELTYPE.toUpperCase() === 'PARENT') t.parent = v; break;
      case 'RRULE': {
        const r = Object.fromEntries(v.split(';').map((p) => p.split('=')).map(([k, x]) => [k.toUpperCase(), x]));
        const unit = UNITS[r.FREQ?.toUpperCase()];
        if (!unit) break;
        t.repeat = { every: Math.max(1, Number(r.INTERVAL) || 1), unit };
        if (unit === 'week' && r.BYDAY) {
          const days = r.BYDAY.split(',').map((d) => BYDAY.indexOf(d.replace(/^[+-]?\d+/, '').toUpperCase())).filter((d) => d >= 0);
          if (days.length) t.repeat.days = [...new Set(days)].sort();
        }
        if ((unit === 'month' || unit === 'year') && /^\d+$/.test(r.BYMONTHDAY || '')) t.repeat.monthDay = Number(r.BYMONTHDAY);
        if (Number(r.COUNT) > 0) t.repeat.count = Number(r.COUNT);
        if (/^\d{8}/.test(r.UNTIL || '')) t.repeat.until = day(r.UNTIL);
        break;
      }
      case 'X-SC-WAITING': t.waiting = v === '1'; break;
      case 'X-SC-WAITING-NOTE': t.waitingNote = unescape(v); break;
      case 'X-SC-REVIEW': t.review = day(v); break;
      case 'X-SC-ESTIMATE': t.estimate = Number(v) || undefined; break;
      case 'X-SC-SPENT': t.spent = Number(v) || undefined; break;
      case 'X-SC-AFTER': t.after = v === '1'; break;
      case 'X-SC-DONE-COUNT': t.doneCount = Number(v) || undefined; break;
      case 'X-SC-LAST-DONE': t.lastDone = day(v); break;
    }
  }
  if (t.repeat && t.after) t.repeat.after = true;
  t.done = t.status === 'COMPLETED' || (!!t.completed && t.status !== 'NEEDS-ACTION' && t.status !== 'IN-PROCESS');
  return t.uid ? t : null;
}

// ---------- writing ----------
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
const dateVal = (d) => d.replace(/-/g, '');
const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z');
/** Lines longer than 75 octets folded, as RFC 5545 asks. */
function fold(line) {
  const b = Buffer.from(line, 'utf8');
  if (b.length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
function rrule(r) {
  const parts = [`FREQ=${{ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[r.unit]}`];
  if (r.every > 1) parts.push(`INTERVAL=${r.every}`);
  if (r.unit === 'week' && r.days?.length) parts.push(`BYDAY=${r.days.map((d) => BYDAY[d]).join(',')}`);
  if ((r.unit === 'month' || r.unit === 'year') && r.monthDay) parts.push(`BYMONTHDAY=${r.monthDay}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${dateVal(r.until)}`);
  return parts.join(';');
}
const wrap = (body) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shutdown Complete//Tasks//EN', ...body, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';

/** A task as a calendar object. */
export function taskIcs(t) {
  const L = ['BEGIN:VTODO', `UID:${t.id}`, `DTSTAMP:${stamp(t.created ?? '2026-01-01T00:00:00Z')}`];
  if (t.created) L.push(`CREATED:${stamp(t.created)}`);
  L.push(`SUMMARY:${esc(t.text)}`);
  if (t.notes) L.push(`DESCRIPTION:${esc(t.notes)}`);
  if (t.start) L.push(t.startTime ? `DTSTART:${stamp(new Date(`${t.start}T${t.startTime}:00`).toISOString())}` : `DTSTART;VALUE=DATE:${dateVal(t.start)}`);
  if (t.due) L.push(t.dueTime ? `DUE:${stamp(new Date(`${t.due}T${t.dueTime}:00`).toISOString())}` : `DUE;VALUE=DATE:${dateVal(t.due)}`);
  if (t.priority) L.push(`PRIORITY:${t.priority}`);
  if (t.percent && !t.done) L.push(`PERCENT-COMPLETE:${t.percent}`);
  if (t.done) L.push('STATUS:COMPLETED', 'PERCENT-COMPLETE:100', `COMPLETED:${dateVal(t.doneAt ?? '2026-01-01')}T120000Z`);
  else L.push(`STATUS:${t.percent ? 'IN-PROCESS' : 'NEEDS-ACTION'}`);
  if (t.tags?.length) L.push(`CATEGORIES:${t.tags.map(esc).join(',')}`);
  if (t.repeat) L.push(`RRULE:${rrule(t.repeat)}`);
  if (t.waiting) L.push('X-SC-WAITING:1');
  if (t.waitingNote) L.push(`X-SC-WAITING-NOTE:${esc(t.waitingNote)}`);
  if (t.review) L.push(`X-SC-REVIEW;VALUE=DATE:${dateVal(t.review)}`);
  if (t.estimate) L.push(`X-SC-ESTIMATE:${t.estimate}`);
  if (t.spent) L.push(`X-SC-SPENT:${t.spent}`);
  if (t.repeat?.after) L.push('X-SC-AFTER:1');
  if (t.doneCount) L.push(`X-SC-DONE-COUNT:${t.doneCount}`);
  if (t.lastDone) L.push(`X-SC-LAST-DONE;VALUE=DATE:${dateVal(t.lastDone)}`);
  if (t.remind != null && t.dueTime && !t.done) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.text)}`, `TRIGGER;RELATED=END:${t.remind ? `-PT${t.remind}M` : 'PT0S'}`, 'END:VALARM');
  L.push('END:VTODO');
  return preserved(t, L);
}
/** A subtask as a calendar object of its own, pointing at its task. */
export function stepIcs(step, parent) {
  return preserved(step, ['BEGIN:VTODO', `UID:${step.id}`, `DTSTAMP:${stamp(parent.created ?? '2026-01-01T00:00:00Z')}`, `SUMMARY:${esc(step.text)}`,
    `STATUS:${step.done ? 'COMPLETED' : 'NEEDS-ACTION'}`, ...(step.done ? ['PERCENT-COMPLETE:100'] : []), `RELATED-TO;RELTYPE=PARENT:${parent.id}`, 'END:VTODO']);
}

// Keep opaque properties, parameters and nested components. Only fields actually changed by
// the planner replace their original lines; a title edit must not rewrite recurrence or alarms.
function preserved(t, generated) {
  if (!t.davRaw) return wrap(generated);
  let original = lines(t.davRaw);
  const parsed = parseTodo(t.davRaw);
  if (!parsed) return wrap(generated);
  if (t.remind !== t.davBase?.remind) {
    let replaced = false;
    for (let i = 0; i < original.length; i++) {
      if (original[i].name !== 'BEGIN' || original[i].value !== 'VALARM') continue;
      const end = original.findIndex((l, j) => j > i && l.name === 'END' && l.value === 'VALARM');
      if (end < 0) break;
      const alarm = original.slice(i, end + 1);
      const trigger = alarm.find(l => l.name === 'TRIGGER');
      if (replaced || !alarm.some(l => l.name === 'ACTION' && l.value === 'DISPLAY') || !trigger || beforeMinutes(trigger.value) == null || (trigger.params.RELATED && trigger.params.RELATED !== 'END') || trigger.params.VALUE === 'DATE-TIME') { i = end; continue; }
      if (t.remind == null) original.splice(i, end - i + 1);
      else trigger.raw = `TRIGGER;RELATED=END:${t.remind ? `-PT${t.remind}M` : 'PT0S'}`;
      replaced = true;
      break;
    }
    if (!replaced && t.remind != null) {
      const begin = generated.indexOf('BEGIN:VALARM');
      if (begin >= 0) original.splice(original.findIndex(l => l.name === 'END' && l.value === 'VTODO'), 0, ...lines(generated.slice(begin, generated.indexOf('END:VALARM') + 1).join('\n')));
    }
  }
  const fields = { 'X-SC-WAITING': ['waiting'], 'X-SC-WAITING-NOTE': ['waitingNote'], 'X-SC-REVIEW': ['review'], UID: ['id'], SUMMARY: ['text'], DESCRIPTION: ['notes'], DUE: ['due', 'dueTime'], DTSTART: ['start', 'startTime'], PRIORITY: ['priority'], 'PERCENT-COMPLETE': ['percent', 'done'], STATUS: ['done'], COMPLETED: ['done', 'doneAt'], CATEGORIES: ['tags'], RRULE: ['repeat'], 'RELATED-TO': ['parent'], 'X-SC-ESTIMATE': ['estimate'], 'X-SC-SPENT': ['spent'], 'X-SC-AFTER': ['repeat'], 'X-SC-DONE-COUNT': ['doneCount'], 'X-SC-LAST-DONE': ['lastDone'] };
  const changed = new Set(Object.entries(fields).filter(([, keys]) => keys.some(k => JSON.stringify(t[k]) !== JSON.stringify(t.davBase?.[k]))).map(([k]) => k));
  const out = []; let todo = false, depth = 0;
  for (const l of original) {
    if (l.name === 'BEGIN' && l.value === 'VTODO') { todo = true; out.push(l.raw); continue; }
    if (todo && l.name === 'END' && l.value === 'VTODO' && depth === 0) {
      let nested = 0;
      for (const g of generated.slice(1, -1)) {
        const n = g.split(/[;:]/)[0];
        if (n === 'BEGIN') nested++;
        if (!nested && changed.has(n)) {
          if (n === 'RRULE') {
            const oldParts = original.find(l => l.name === 'RRULE')?.value.split(';') ?? [];
            const keys = { FREQ: 'unit', INTERVAL: 'every', BYDAY: 'days', BYMONTHDAY: 'monthDay', COUNT: 'count', UNTIL: 'until' };
            const keep = oldParts.filter(p => {
              const field = keys[p.split('=')[0].toUpperCase()];
              return !field || JSON.stringify(t.repeat?.[field]) === JSON.stringify((t.davBase?.repeat ?? parsed.repeat)?.[field]);
            });
            const keptKeys = new Set(keep.map(p => p.split('=')[0].toUpperCase()));
            out.push([...g.slice(6).split(';').filter(p => !keptKeys.has(p.split('=')[0])), ...keep].join(';').replace(/^/, 'RRULE:'));
          } else out.push(g);
        }
        if (n === 'END') nested--;
      }
      todo = false;
    }
    if (todo && l.name === 'BEGIN') depth++;
    if (!todo || depth || !changed.has(l.name)) out.push(l.raw);
    if (todo && l.name === 'END') depth--;
  }
  return out.map(fold).join('\r\n') + '\r\n';
}

// ---------- a list as resources ----------
/** A list's tasks and subtasks as calendar objects: name (the last part of its address) -> {uid, ics, etag}. */
export function resources(doc, list) {
  const out = new Map();
  for (const t of doc?.items ?? []) {
    if (listOf(t) !== list) continue;
    const ics = taskIcs(t);
    out.set(t.href ?? `${t.id}.ics`, { uid: t.id, ics, etag: `"${hash(ics)}"` });
    for (const s of t.steps ?? []) {
      const sics = stepIcs(s, t);
      out.set(s.href ?? `${s.id}.ics`, { uid: s.id, ics: sics, etag: `"${hash(sics)}"`, parent: t.id });
    }
  }
  return out;
}
/** Where a uid lives in the document: a task, or a subtask of one. */
export function findUid(doc, uid) {
  for (const t of doc?.items ?? []) {
    if (t.id === uid) return { task: t };
    const s = t.steps?.find((x) => x.id === uid);
    if (s) return { task: t, step: s };
  }
  return null;
}

/**
 * A calendar object written into a list: a new task or subtask, or a change to one. A repeating task sent back as
 * completed by an app that does not roll it on itself comes back on its next date instead. Returns the new document
 * (unchanged when the object holds no task).
 */
export function upsert(doc, list, name, ics, today) {
  const v = parseTodo(ics);
  if (!v) return { doc, error: 'no-vtodo' };
  const items = [...(doc.items ?? [])];
  const at = findUid(doc, v.uid);
  const href = name === `${v.uid}.ics` ? undefined : name;
  // a subtask: its own object, pointing at a task of this list
  const parent = v.parent && items.find((x) => x.id === v.parent && listOf(x) === list);
  if (parent || at?.step) {
    const owner = at?.step ? at.task : parent;
    const step = { id: v.uid, text: v.text ?? '', done: v.done, ...(href ? { href } : {}) };
    step.davRaw = ics;
    step.davBase = { ...step, parent: v.parent };
    delete step.davBase.davRaw;
    const steps = owner.steps?.some((s) => s.id === v.uid) ? owner.steps.map((s) => (s.id === v.uid ? step : s)) : [...(owner.steps ?? []), step];
    return { doc: { ...doc, items: items.map((x) => (x.id === owner.id ? { ...x, steps } : x)) } };
  }
  const old = at?.task;
  let t = {
    ...(old ?? {}),
    id: v.uid, text: v.text ?? '', done: v.done, list: list === DEFAULT_LIST ? undefined : list,
    due: v.due, dueTime: v.due ? v.dueTime : undefined, remind: v.due && v.dueTime ? v.remind : undefined, start: v.start, startTime: v.startTime, priority: v.priority, percent: v.done ? undefined : v.percent,
    tags: v.categories.length ? v.categories : undefined, notes: v.notes || undefined, repeat: v.repeat,
    waiting: v.waiting, waitingNote: v.waitingNote, review: v.review,
    estimate: v.estimate ?? old?.estimate, spent: v.spent ?? old?.spent, doneCount: v.doneCount ?? old?.doneCount, lastDone: v.lastDone ?? old?.lastDone,
    created: old?.created ?? v.created ?? new Date().toISOString(), doneAt: v.done ? (old?.doneAt ?? v.completed ?? today) : undefined,
    ...(href ? { href } : {}),
  };
  // The planner cannot calculate arbitrary RFC recurrence sets. Keep their completion and
  // full recurrence untouched rather than moving them to an incorrect date.
  const complex = /^(?:EXDATE|EXRULE|RDATE|RECURRENCE-ID)[;:]/m.test(ics) || /(?:BYSETPOS|BYMONTH|BYYEARDAY|BYWEEKNO|BYHOUR|BYMINUTE|BYSECOND|WKST)=/.test(ics) || /BYDAY=[^;\r\n]*\d/.test(ics) || (t.repeat?.unit !== 'week' && /BYDAY=/.test(ics));
  // Do not expose a lossy approximation to the UI's recurrence calculator either.
  if (complex) t.repeat = undefined;
  if (t.done && t.repeat && !complex) { const p = rollOn(t, today); t = { ...t, ...p, done: !!p.done, doneAt: p.done ? today : undefined }; }
  t.davRaw = ics;
  t.davBase = { ...t, due: v.due, dueTime: v.dueTime, start: v.start, done: v.done, doneAt: v.done ? v.completed ?? today : undefined, repeat: complex ? undefined : v.repeat };
  delete t.davBase.davRaw;
  delete t.davBase.davBase;
  for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
  return { doc: { ...doc, items: old ? items.map((x) => (x.id === old.id ? t : x)) : [...items, t] } };
}

/** A calendar object taken out of a list (a subtask from its task). */
export function removeUid(doc, uid) {
  const at = findUid(doc, uid);
  if (!at) return doc;
  if (at.step) return { ...doc, items: doc.items.map((x) => (x.id === at.task.id ? { ...x, steps: x.steps.filter((s) => s.id !== uid) } : x)) };
  return { ...doc, items: doc.items.filter((x) => x.id !== uid) };
}

/** A tag of the list's whole state, for clients that ask whether anything changed. */
export const ctagOf = (res) => `"${hash([...res.values()].map((r) => r.etag).sort().join(','))}"`;
export { hash };

export { esc as icsEscape, fold as icsFold };
