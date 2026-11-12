import { zonedToUtc } from './calendar.mjs';
import { icsEscape as esc, icsFold as fold } from './vtodo.mjs';
const date = (d) => d.replaceAll('-', '');
const shift = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const clock = (d, min, zone) => {
  const day = shift(d, Math.floor(min / 1440));
  return new Date(zonedToUtc({ y: +day.slice(0, 4), mo: +day.slice(5, 7), d: +day.slice(8), h: Math.floor(min % 1440 / 60), mi: min % 60 }, zone)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};
/** Active plans in the account's zone; stable UIDs survive edits and token rotation. */
export function plannerIcs(docs, zone, tasks = false, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (k) => parts.find((p) => p.type === k).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`, from = shift(today, -7), to = shift(today, 30);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shutdown Complete//Planner//EN', 'CALSCALE:GREGORIAN', `X-WR-TIMEZONE:${zone}`];
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const event = (uid, title, fields) => lines.push('BEGIN:VEVENT', `UID:${esc(uid)}`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(title)}`, ...fields, 'END:VEVENT');
  const seen = new Set();
  for (const { key, value: v } of docs) {
    if (!v) continue;
    const d = key.slice(4);
    if (key.startsWith('day:') && d >= from && d <= to) {
      const col = v.columns?.findLast((c) => c.closedAt == null);
      for (const b of col?.blocks ?? []) event(`${key}-${b.id}@shutdown-complete`, b.label, [
        `DTSTART:${clock(d, b.start, zone)}`, `DTEND:${clock(d, b.end, zone)}`,
        `CATEGORIES:${esc(b.kind)}`, ...(b.note ? [`DESCRIPTION:${esc(b.note)}`] : []),
      ]);
    }
    if (tasks && (key === 'inbox' || key.startsWith('day:'))) for (const t of v.tasks ?? v.items ?? []) {
      if (!t.due || t.due < from || t.due > to || seen.has(t.id)) continue;
      seen.add(t.id);
      event(`task-${t.id}@shutdown-complete`, t.text, [`DTSTART;VALUE=DATE:${date(t.due)}`, `DTEND;VALUE=DATE:${date(shift(t.due, 1))}`]);
    }
  }
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
