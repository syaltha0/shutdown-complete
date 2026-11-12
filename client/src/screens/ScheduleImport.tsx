import { useEffect, useRef, useState } from 'react';
import { Segmented } from '../components/Segmented';
import { api, ApiError } from '../lib/api';
import { viewerZone } from '../lib/calendar';
import { clock, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import { uid, type Kind, type Repeat } from '../lib/model';
import { weekdayNames } from './Templates';

/** A class of a timetable: what, on which weekdays (Monday = 0), from and to (minutes). */
export interface Slot { title: string; days: number[]; start: number; end: number }

// weekday names as people write them, English and Turkish, long and short
const DAY_WORDS: [RegExp, number][] = [
  [/^(mon(day)?|mo|pzt|pazartesi|pts)$/i, 0], [/^(tue(s(day)?)?|tu|sal[ıi]?)$/i, 1], [/^(wed(nesday)?|we|[çc]ar([şs]amba)?)$/i, 2],
  [/^(thu(r(s(day)?)?)?|th|per([şs]embe)?)$/i, 3], [/^(fri(day)?|fr|cum(a)?)$/i, 4], [/^(sat(urday)?|sa|cmt|cumartesi)$/i, 5], [/^(sun(day)?|su|paz(ar)?)$/i, 6],
];
const dayOf = (w: string) => DAY_WORDS.find(([re]) => re.test(w.trim().replace(/[.,:]$/, '')))?.[1];
const RANGE = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;
const minutes = (h: string, m: string) => Number(h) * 60 + Number(m);

/** Slots of the same class at the same hours joined into one, its days together. */
function join(slots: { title: string; day: number; start: number; end: number }[]): Slot[] {
  const out = new Map<string, Slot>();
  for (const s of slots) {
    if (!s.title.trim() || s.end <= s.start) continue;
    const k = `${s.title.trim().toLocaleLowerCase()}|${s.start}|${s.end}`;
    const cur = out.get(k);
    if (cur) { if (!cur.days.includes(s.day)) cur.days.push(s.day); } else out.set(k, { title: s.title.trim(), days: [s.day], start: s.start, end: s.end });
  }
  return [...out.values()].map((s) => ({ ...s, days: s.days.sort() })).sort((a, b) => a.days[0] - b.days[0] || a.start - b.start);
}

/**
 * A timetable pasted as text: either lines ("Mon 09:00-10:30 Maths", "Pazartesi 09.00 - 10.30 Fizik"), or a table
 * copied from a spreadsheet (a row of weekday names, then rows starting with the hours, a class in each day's column).
 */
export function parseTimetable(text: string): Slot[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const cells = (l: string) => l.split(/\t|\s{2,}|;|\|/).map((c) => c.trim());
  const head = lines.findIndex((l) => cells(l).filter((c) => dayOf(c) != null).length >= 2);
  const found: { title: string; day: number; start: number; end: number }[] = [];
  if (head >= 0) {
    const cols = cells(lines[head]).map(dayOf);
    for (const l of lines.slice(head + 1)) {
      const cs = cells(l);
      const at = cs.findIndex((c) => RANGE.test(c));
      if (at < 0) continue;
      const m = RANGE.exec(cs[at])!;
      cs.forEach((c, i) => { const d = cols[i]; if (i !== at && d != null && c && !RANGE.test(c)) found.push({ title: c, day: d, start: minutes(m[1], m[2]), end: minutes(m[3], m[4]) }); });
    }
  } else {
    for (const l of lines) {
      const m = RANGE.exec(l);
      if (!m) continue;
      const words = l.replace(RANGE, ' ').split(/[\s,]+/).filter(Boolean);
      const days = words.map(dayOf).filter((d): d is number => d != null);
      const title = words.filter((w) => dayOf(w) == null).join(' ').replace(/^[-–:·]+|[-–:·]+$/g, '').trim();
      for (const d of days) found.push({ title, day: d, start: minutes(m[1], m[2]), end: minutes(m[3], m[4]) });
    }
  }
  return join(found);
}

/** Classes brought into the weekly schedule from a calendar file or a pasted timetable, each looked over first. */
export function ScheduleImport({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (r: Repeat[]) => void }) {
  const T = useT(), W = T.schedImport;
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [text, setText] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [kind, setKind] = useState<Kind>('meeting');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = weekdayNames();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setSlots(null); setText(''); setError(null); setOff(new Set()); }
    if (!open && d.open) d.close();
  }, [open]);
  const show = (s: Slot[]) => { setSlots(s); setOff(new Set()); setError(s.length ? null : W.nothing); };
  const readFile = async (f: File) => {
    setBusy(true); setError(null);
    try { show((await api.scheduleFromIcs(await f.text(), viewerZone())).slots); } catch (e) { setError(e instanceof ApiError && e.code === 'not-a-calendar' ? W.notCalendar : W.failed); } finally { setBusy(false); }
  };
  const chosen = (slots ?? []).filter((_, i) => !off.has(i));
  return (
    <dialog ref={ref} className="sheet sched-import" onClose={onClose} aria-labelledby="si-title">
      <form method="dialog" onSubmit={(e) => {
        e.preventDefault();
        onAdd(chosen.map((s) => ({ id: uid(), label: s.title, note: '', kind, subject: s.title, start: s.start, end: s.end, days: s.days, since: today() })));
        onClose();
      }}>
        <h2 id="si-title">{W.title}</h2>
        <Segmented role="group" aria-label={W.title}>
          <button type="button" aria-pressed={mode === 'file'} onClick={() => { setMode('file'); setSlots(null); }}>{W.fromFile}</button>
          <button type="button" aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setSlots(null); }}>{W.fromText}</button>
        </Segmented>
        {mode === 'file' ? (
          <label className="field"><span>{W.fileLabel}</span>
            <input type="file" accept=".ics,text/calendar" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
            <span className="hint">{W.fileHint}</span>
          </label>
        ) : (
          <label className="field"><span>{W.textLabel}</span>
            <textarea className="input sched-text" rows={7} placeholder={W.textPh} value={text} onChange={(e) => { setText(e.target.value); show(parseTimetable(e.target.value)); if (!e.target.value.trim()) setError(null); }} />
            <span className="hint">{W.textHint}</span>
          </label>
        )}
        {error && <p className="err-line" role="alert">{error}</p>}
        {slots && slots.length > 0 && (
          <>
            <p className="muted">{W.found(slots.length)}</p>
            <ul className="inbox-list pick-list sched-slots">
              {slots.map((s, i) => (
                <li key={i}>
                  <label>
                    <input type="checkbox" className="check" checked={!off.has(i)} onChange={() => setOff((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                    <span className="text">{s.title}</span>
                    <span className="task-meta num">{s.days.map((d) => names[d]).join(', ')} · {clock(s.start)}–{clock(s.end)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="field sched-kind"><span>{W.kindLabel}</span>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {(['meeting', 'deep', 'shallow', 'personal'] as Kind[]).map((k) => <option key={k} value={k}>{T.kinds[k].name}</option>)}
              </select>
            </label>
          </>
        )}
        <div className="foot">
          <button type="button" className="btn ghost" onClick={onClose}>{T.cancel}</button>
          <div className="right"><button type="submit" className="btn primary" disabled={!chosen.length}>{W.add(chosen.length)}</button></div>
        </div>
      </form>
    </dialog>
  );
}
