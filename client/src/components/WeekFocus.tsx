import { duration, shortDate, weekDays, weekdayShort } from '../lib/dates';
import { focusMinutes } from '../lib/focus';
import { useT } from '../lib/i18n';
import type { DayDoc, FocusSession } from '../lib/model';
import { useRange } from '../lib/useDoc';
import { FocusLog } from './FocusLog';

/** Session history stays useful even when the original plan has been revised. */
export function WeekFocus({ id }: { id: string }) {
  const T = useT(), W = T.review, dates = weekDays(id);
  const { docs, error, retry } = useRange<DayDoc>(`day:${dates[0]}`, `day:${dates[6]}`);
  if (error) return <section className="panel span-12"><button className="btn" onClick={retry}>{T.retry}</button></section>;
  if (!docs) return <div className="skeleton span-12" style={{ height: 100 }} />;
  const days = dates.map((date) => ({ date, doc: docs.get(`day:${date}`) }));
  const sessions = days.flatMap(({ doc }) => doc?.focus?.sessions ?? []);
  const groups: { sessions: FocusSession[]; minutes: number; label: string }[] = [];
  for (const session of sessions) {
    // Same block id OR same nonempty label, as in the focus page. Merge connected groups once.
    const matches = groups.filter((g) => g.sessions.some((s) => (!!s.blockId && s.blockId === session.blockId) || (!!session.label && s.label === session.label)));
    const group = { sessions: [session, ...matches.flatMap((g) => g.sessions)], minutes: session.minutes + matches.reduce((n, g) => n + g.minutes, 0), label: session.label || session.subject || T.freeFocus };
    for (const match of matches) groups.splice(groups.indexOf(match), 1);
    groups.push(group);
  }
  groups.sort((a, b) => b.minutes - a.minutes);
  const total = days.reduce((n, d) => n + (d.doc ? focusMinutes(d.doc) : 0), 0);
  return <section className="panel span-12 week-focus" aria-labelledby="week-focus-title">
    <header><h2 id="week-focus-title">{W.focusBlocks}</h2><b className="num">{duration(total)}</b></header>
    {!sessions.length ? <p className="empty">{W.noFocus}</p> : <>
      <div className="week-focus-days">{days.map(({ date, doc }) => <div key={date}><span>{weekdayShort(date)}</span><b className="num">{duration(doc ? focusMinutes(doc) : 0)}</b></div>)}</div>
      <ul className="week-focus-blocks">{groups.map((g, i) => <li key={i}><div><span>{g.label}</span><b className="num">{duration(g.minutes)}</b></div><i style={{ width: `${g.minutes / total * 100}%` }} /></li>)}</ul>
      <details className="week-focus-notes"><summary>{W.focusNotes}</summary>{days.filter(({ doc }) => doc?.focus?.sessions.length).map(({ date, doc }) => <div key={date}><h3>{weekdayShort(date)} <span className="num">{shortDate(date)}</span> <span className="muted num">· {duration(focusMinutes(doc!))}</span></h3><FocusLog sessions={doc!.focus!.sessions} bare /></div>)}</details>
    </>}
  </section>;
}
