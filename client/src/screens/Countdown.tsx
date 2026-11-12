import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { IconPlus, IconX } from '../components/Icons';
import { addDays, clock, fmtDay, longDate, parseISODate, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import { featureOn, uid, type Countdown, type CountdownKind } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { insertAt, offerUndo } from '../lib/undo';
import { ExamPlanner } from './ExamPlanner';
import { useNow } from './TimeGrid';

const DAY = 86400000;
const KINDS: CountdownKind[] = ['exam', 'due', 'event', 'birthday', 'trip'];
const daysBetween = (a: string, b: string) => Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY);

/** The date a countdown is next at: itself, or, for one that comes every year, its next return. */
export function nextDate(c: { date: string; yearly?: boolean }, t = today()) {
  if (!c.yearly || c.date >= t) return c.date;
  const [, m, d] = c.date.split('-');
  const y = Number(t.slice(0, 4));
  const thisYear = `${y}-${m}-${d}`;
  return thisYear >= t ? thisYear : `${y + 1}-${m}-${d}`;
}

type Row = { id: string; name: string; date: string; time: number | null; created?: string; kind?: CountdownKind; yearly?: boolean; exam: boolean; next: string };

/**
 * Countdowns: the days left until the dates that matter (an exam on 24 November, a trip, a birthday). The nearest one
 * leads, large, with its remaining days drawn as dots (weekends hollow) so the time left is something to see; the rest
 * follow as cards. Exams planned in Month show by themselves; an exam can be prepared for from here (the exam planner,
 * filled in). Birthdays and other dates that come back every year roll on to their next return; one-off dates that
 * passed gather at the foot to clear away.
 */
export function Countdowns() {
  const T = useT();
  const { settings, update } = useSettings();
  useNow(true);
  const [editing, setEditing] = useState<Countdown | 'new' | null>(null);
  const [prepare, setPrepare] = useState<{ name: string; date: string } | null>(null);
  const t = today();
  const own = settings.countdowns ?? [];
  const planned = settings.exams ?? [];
  const rows: Row[] = [
    ...own.map((c) => ({ ...c, exam: false, next: nextDate(c, t) })),
    ...planned.filter((x) => !own.some((c) => c.date === x.date && c.name === x.name))
      .map((x) => ({ id: `exam-${x.id}`, name: x.name, date: x.date, time: null, kind: 'exam' as const, exam: true, next: x.date })),
  ];
  const ahead = rows.filter((c) => c.next >= t).sort((a, b) => a.next.localeCompare(b.next) || (a.time ?? 0) - (b.time ?? 0));
  const passed = rows.filter((c) => c.next < t && !c.exam).sort((a, b) => b.date.localeCompare(a.date));
  const lead = ahead[0] ?? null;

  function save(c: Countdown) {
    update((s) => {
      const list = s.countdowns ?? [];
      return { ...s, countdowns: list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c] };
    });
    setEditing(null);
  }
  function remove(id: string) {
    const c = own.find((x) => x.id === id);
    if (!c) return;
    const i = own.indexOf(c);
    update((s) => ({ ...s, countdowns: (s.countdowns ?? []).filter((x) => x.id !== id) }));
    offerUndo(T.deleted(c.name), () => update((s) => ({ ...s, countdowns: insertAt(s.countdowns ?? [], i, c) })));
    setEditing(null);
  }
  const hasPlan = (r: Row) => r.exam || planned.some((x) => x.date === r.next && x.name === r.name);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.cdTitle}</h1>
          <p className="sub num">{lead ? T.cdNext(lead.name, daysBetween(t, lead.next)) : T.cdNone}</p>
        </div>
        <div className="title-actions">
          {rows.length > 0 && <button type="button" className="btn primary" onClick={() => setEditing('new')}><IconPlus />{T.cdNew}</button>}
        </div>
      </div>

      {rows.length === 0 && (
        <section className="panel kb-start" aria-labelledby="cd-first-h" data-anim>
          <h2 id="cd-first-h">{T.cdFirst}</h2>
          <p className="muted">{T.cdFirstBody}</p>
          <CountdownForm onSave={save} />
        </section>
      )}

      {lead && (
        <section className="panel cd-lead" aria-labelledby="cd-lead-h" data-anim>
          <Card row={lead} lead onEdit={lead.exam ? undefined : () => setEditing(own.find((x) => x.id === lead.id) ?? null)}
            onPrepare={featureOn(settings, 'exams') && lead.kind === 'exam' && !hasPlan(lead) ? () => setPrepare({ name: lead.name, date: lead.next }) : undefined} />
        </section>
      )}

      {ahead.length > 1 && (
        <div className="cd-grid">
          {ahead.slice(1).map((r) => (
            <Card key={r.id} row={r} onEdit={r.exam ? undefined : () => setEditing(own.find((x) => x.id === r.id) ?? null)}
              onPrepare={featureOn(settings, 'exams') && r.kind === 'exam' && !hasPlan(r) ? () => setPrepare({ name: r.name, date: r.next }) : undefined} />
          ))}
        </div>
      )}

      {passed.length > 0 && (
        <section className="panel cd-passed" aria-labelledby="cd-past-h" data-anim>
          <header><h2 id="cd-past-h">{T.cdPassed}</h2><span className="meta">{T.cdPassedMeta}</span></header>
          <ul className="home-list dates">
            {passed.map((c) => (
              <li key={c.id}>
                <span className="when num">{fmtDay(c.date, { day: 'numeric', month: 'short' })}</span>
                <span>{c.name}</span>
                <span className="row-end">
                  <small className="muted num">{T.cdAgo(daysBetween(c.date, t))}</small>
                  <button type="button" className="btn ghost icon" aria-label={T.remove(c.name)} onClick={() => remove(c.id)}><IconX /></button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CountdownDialog value={editing} onClose={() => setEditing(null)} onSave={save} onRemove={remove} />
      <ExamPlanner open={!!prepare} exam={null} start={prepare ?? undefined} onClose={() => setPrepare(null)} />
    </>
  );
}

/** One countdown: what, the days (hours when under two days), when, how much of the wait is behind. */
function Card({ row: r, lead = false, onEdit, onPrepare }: { row: Row; lead?: boolean; onEdit?: () => void; onPrepare?: () => void }) {
  const T = useT();
  const t = today();
  const n = daysBetween(t, r.next);
  const at = parseISODate(r.next).getTime() + (r.time ?? 0) * 60000;
  const hours = Math.max(0, Math.round((at - Date.now()) / 3600000));
  const soon = r.time != null && n <= 1;
  // the wait behind: since it was added, or, for a date that comes every year, since its last return
  const prev = r.yearly ? `${Number(r.next.slice(0, 4)) - 1}${r.next.slice(4)}` : undefined;
  const since = prev && (!r.created || prev > r.created) ? prev : r.created;
  const span = since ? daysBetween(since, r.next) : 0;
  const gone = span > 0 ? Math.min(1, Math.max(0, daysBetween(since!, t) / span)) : null;
  const Tag = lead ? 'div' : 'article';
  return (
    <Tag className={`cd-card${lead ? ' lead' : ''}${n <= 7 ? ' near' : ''}`}>
      <div className="cd-main">
        <div className="cd-top">
          {r.kind && <span className={`cd-kind k-${r.kind}`}>{T.cdKinds[r.kind]}</span>}
          {lead ? <h2 id="cd-lead-h">{r.name}</h2> : <h2>{r.name}</h2>}
        </div>
        <p className="cd-num num">
          {n === 0 && !soon ? <b>{T.cdToday}</b> : soon ? <><b>{hours}</b><span>{T.cdHours(hours)}</span></> : <><b>{n}</b><span>{T.cdDays(n)}</span></>}
        </p>
        <p className="muted cd-when num">
          {longDate(r.next)}{r.time != null ? ` · ${clock(r.time)}` : ''}{n >= 14 ? ` · ${T.cdWeeks(Math.floor(n / 7), n % 7)}` : ''}{r.yearly ? ` · ${T.cdEveryYear}` : ''}
        </p>
        {gone != null && <div className="cd-line" aria-hidden="true"><i style={{ transform: `scaleX(${gone})` }} /></div>}
        {(onPrepare || onEdit || r.exam) && (
          <div className="cd-foot">
            {onPrepare && <button type="button" className="btn sm" onClick={onPrepare}>{T.cdPrepare}</button>}
            {r.exam && <a className="card-link meta" href={`/month/${r.next.slice(0, 7)}`} onClick={onLinkClick}>{T.cdPlanned}</a>}
            {onEdit && <button type="button" className="btn ghost sm" onClick={onEdit}>{T.cdEdit}</button>}
          </div>
        )}
      </div>
      {lead && n > 0 && n <= 70 && <DayDots from={t} days={n} />}
    </Tag>
  );
}

/**
 * The days left as a small calendar: a row per week (Monday first), one dot a day from today, Saturdays and Sundays
 * hollow, the day itself a ring. A wait of five weeks is something to see, not only a number.
 */
function DayDots({ from, days }: { from: string; days: number }) {
  const T = useT();
  const lead = (parseISODate(from).getDay() + 6) % 7;
  const names = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(T.locale, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));
  return (
    <div className="cd-dots" aria-hidden="true">
      {names.map((x, i) => <b key={`h${i}`}>{x}</b>)}
      {Array.from({ length: lead }, (_, i) => <span key={`p${i}`} />)}
      {Array.from({ length: days }, (_, i) => {
        const wd = parseISODate(addDays(from, i)).getDay();
        return <i key={i} className={wd === 0 || wd === 6 ? 'we' : undefined} style={{ animationDelay: `${Math.min(i * 12, 600)}ms` }} />;
      })}
      <i className="end" />
    </div>
  );
}

/** Adding or changing a countdown: what, when (a time if it matters), what kind, every year or once. */
function CountdownForm({ initial, onSave, onRemove, onCancel }: { initial?: Countdown; onSave: (c: Countdown) => void; onRemove?: (id: string) => void; onCancel?: () => void }) {
  const T = useT();
  const t = today();
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time != null ? clock(initial.time) : '');
  const [kind, setKind] = useState<CountdownKind | undefined>(initial?.kind);
  const [yearly, setYearly] = useState(!!initial?.yearly);
  const pickKind = (k: CountdownKind) => { setKind(kind === k ? undefined : k); if (k === 'birthday' && !initial) setYearly(true); };
  return (
    <form className="cd-form" onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim() || !date) return;
      const [h, m] = time ? time.split(':').map(Number) : [null, null];
      onSave({ id: initial?.id ?? uid(), name: name.trim(), date, time: h != null ? h * 60 + (m ?? 0) : null, created: initial?.created ?? t, kind, yearly: yearly || undefined });
      if (!initial) { setName(''); setDate(''); setTime(''); setKind(undefined); setYearly(false); }
    }}>
      <div className="field">
        <label htmlFor="cd-name">{T.cdName}</label>
        <input id="cd-name" className="input" value={name} placeholder={T.cdNamePh} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <span className="label" id="cd-kind">{T.cdKind}</span>
        <div className="day-chips" role="group" aria-labelledby="cd-kind">
          {KINDS.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => pickKind(k)}>{T.cdKinds[k]}</button>)}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="cd-date">{T.examDate}</label>
          <input id="cd-date" type="date" className="input num" min={yearly ? undefined : t} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cd-time">{T.cdTime}</label>
          <input id="cd-time" type="time" className="input num" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <label className="switch-row"><input type="checkbox" className="switch" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />{T.cdYearly}</label>
      <div className="foot">
        {initial && onRemove ? <button type="button" className="btn danger" onClick={() => onRemove(initial.id)}>{T.cdDelete}</button> : <span />}
        <div className="right">
          {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>{T.cancel}</button>}<button type="submit" className="btn primary" disabled={!name.trim() || !date}>{initial ? T.cdSave : T.cdAdd}</button></div>
      </div>
    </form>
  );
}

function CountdownDialog({ value, onClose, onSave, onRemove }: { value: Countdown | 'new' | null; onClose: () => void; onSave: (c: Countdown) => void; onRemove: (id: string) => void }) {
  const T = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (value && !d.open) d.showModal();
    if (!value && d.open) d.close();
  }, [value]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-labelledby="cd-dlg-h">
      {value && (
        <div className="kb-dlg">
          <h2 id="cd-dlg-h">{value === 'new' ? T.cdNew : T.cdEditTitle}</h2>
          <CountdownForm key={value === 'new' ? 'new' : value.id} initial={value === 'new' ? undefined : value} onSave={onSave} onRemove={onRemove} onCancel={onClose} />
        </div>
      )}
    </dialog>
  );
}
