import { useState } from 'react';
import { useSettings } from '../App';
import { Checklist } from '../components/Checklist';
import { DocNotice, SaveStamp } from '../components/Common';
import { IconLeft, IconPlus, IconRight, IconX } from '../components/Icons';
import {
  addMonths, duration, fmtDay, monthDays, monthOf, monthTitle, monthWeeks, quarterOf, shortDate, today, weekDays, weekNumber, weekOf,
} from '../lib/dates';
import { useT } from '../lib/i18n';
import { emptyMonth, featureOn, minutesOfKind, uid, type DayDoc, type MonthDoc } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { useSwipeNav } from '../lib/swipe';
import { useDoc, useRange } from '../lib/useDoc';
import { BrokenDown, PartOf, whereOf } from '../components/Links';
import { aboveKeys, belowRange, choicesOf, servingOf } from '../lib/links';
import { emptyQuarter, type QuarterDoc, type WeekDoc } from '../lib/model';
import { insertAt, offerUndo } from '../lib/undo';
import { ExamPlanner } from './ExamPlanner';
import type { Exam } from '../lib/exam';
import { parseISODate } from '../lib/dates';

export function Month({ id }: { id: string }) {
  const T = useT();
  const { settings } = useSettings();
  const { value: month, update, status, error, retry } = useDoc<MonthDoc>(`month:${id}`, emptyMonth);
  const weeks = monthWeeks(id);
  const first = weekDays(weeks[0])[0], last = weekDays(weeks[weeks.length - 1])[6];
  const { docs } = useRange<DayDoc>(`day:${first}`, `day:${last}`);
  const [newDate, setNewDate] = useState(`${id}-01`);
  const [newText, setNewText] = useState('');
  const [examOpen, setExamOpen] = useState<{ exam: Exam | null } | null>(null);
  const { update: updateSettings } = useSettings();
  const exams = [...(settings.exams ?? [])].filter((x) => x.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
  const t = today();
  const days = monthDays(id);
  const habits = settings.metrics.filter((m) => m.kind === 'check');
  const goals = month?.goals ?? [];
  // the season goals its goals can serve, and the weeks' items that serve its goals
  const mkey = `month:${id}`;
  const [qk] = aboveKeys(mkey);
  const { value: quarterDoc } = useDoc<QuarterDoc>(qk, emptyQuarter);
  const seasonChoices = choicesOf(qk, quarterDoc?.goals, whereOf(qk, T));
  const [wFrom, wTo] = belowRange(mkey)!;
  const { docs: weekDocs } = useRange<WeekDoc>(wFrom, wTo);
  const servingFor = (g: { id: string }) => [...(weekDocs?.entries() ?? [])].flatMap(([k, d]) => servingOf(d.items ?? [], mkey, g.id).map((item) => ({ key: k, item })));
  const dates = [...(month?.dates ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  // the month in numbers, from the days themselves
  const dayDocs = days.map((d) => docs?.get(`day:${d}`)).filter((x): x is DayDoc => !!x);
  const shutdowns = dayDocs.filter((d) => d.shutdown.done).length;
  const deepMin = dayDocs.reduce((s, d) => s + (typeof d.metrics.deep === 'number' ? d.metrics.deep * 60 : minutesOfKind(d, 'deep')), 0);
  const weekdayNames = weekDays(weeks[0]).map((d) => fmtDay(d, { weekday: 'short' }));

  function addDate() {
    const text = newText.trim();
    if (!text || !newDate) return;
    update((m) => ({ ...m, dates: [...(m.dates ?? []), { id: uid(), date: newDate, text }] }));
    setNewText('');
  }

  const swipe = useSwipeNav(`/month/${addMonths(id, -1)}`, `/month/${addMonths(id, 1)}`);
  return (
    <div className="swipe-area" ref={swipe}>
      <div className="title-row">
        <div>
          <h1>{monthTitle(id)}</h1>
          <p className="sub num">
            {docs ? T.monthFinding(goals.filter((g) => g.done).length, goals.length, shutdowns, duration(Math.round(deepMin))) : ' '}
            {' · '}<a className="card-link" style={{ fontWeight: 400 }} href={`/quarter/${quarterOf(`${id}-01`)}`} onClick={onLinkClick}>{T.quarterShort(quarterOf(`${id}-01`))}</a>
          </p>
        </div>
        <div className="title-actions">
          <SaveStamp status={status} />
          {featureOn(settings, 'exams') && <button type="button" className="btn" onClick={() => setExamOpen({ exam: null })}>{T.examPlan}</button>}
          <div className="stepper">
            <a className="btn icon" href={`/month/${addMonths(id, -1)}`} onClick={onLinkClick} aria-label={T.prevMonth}><IconLeft /></a>
            <a className="btn" href={`/month/${monthOf(t)}`} onClick={onLinkClick}>{T.thisMonth}</a>
            <a className="btn icon" href={`/month/${addMonths(id, 1)}`} onClick={onLinkClick} aria-label={T.nextMonth}><IconRight /></a>
          </div>
        </div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />

      <div className="grid">
        <div className="stack span-5 fill-col">
          <section className="panel" aria-labelledby="mg-h" data-anim>
            <header><h2 id="mg-h">{T.mustDeliverMonth}</h2></header>
            {month ? <Checklist label={T.monthGoals} items={goals} placeholder={T.addMonthGoal} onChange={(goals) => update((m) => ({ ...m, goals }))} steps
              line={(g, change) => <>
                <PartOf up={g.up} choices={seasonChoices} onChange={(up) => change({ up })} level={T.levels.quarter} place="line" />
                <BrokenDown parent={{ key: mkey, item: g }} serving={servingFor(g)} place="line" />
              </>}
              tools={(g, change) => <>
                <PartOf up={g.up} choices={seasonChoices} onChange={(up) => change({ up })} level={T.levels.quarter} place="tool" />
                <BrokenDown parent={{ key: mkey, item: g }} serving={servingFor(g)} place="tool" />
              </>} />
              : <div className="skeleton" style={{ height: 132 }} />}
          </section>

          <section className="panel" aria-labelledby="md-h" data-anim>
            <header><h2 id="md-h">{T.datesToRemember}</h2></header>
            <div className="date-list">
              {month && dates.length === 0 && <div className="empty">{T.noDates}</div>}
              {dates.map((d) => (
                <div className="date-row" key={d.id}>
                  <a className="num" href={`/day/${d.date}`} onClick={onLinkClick}>{shortDate(d.date)}</a>
                  <span>{d.text}</span>
                  <button type="button" className="btn ghost icon" aria-label={T.remove(d.text)}
                    onClick={() => {
                      const at = (month?.dates ?? []).findIndex((x) => x.id === d.id);
                      update((m) => ({ ...m, dates: m.dates.filter((x) => x.id !== d.id) }));
                      offerUndo(T.deleted(d.text || shortDate(d.date)), () => update((m) => ({ ...m, dates: insertAt(m.dates, at, d) })));
                    }}><IconX /></button>
                </div>
              ))}
            </div>
            <form className="date-add" onSubmit={(e) => { e.preventDefault(); addDate(); }}>
              <input className="input num" type="date" aria-label={T.dateLabel} value={newDate} min={days[0]} max={days[days.length - 1]} onChange={(e) => setNewDate(e.target.value)} />
              <input className="input" aria-label={T.whatLabel} placeholder={T.datePh} value={newText} onChange={(e) => setNewText(e.target.value)} />
              <button className="btn" type="submit" disabled={!newText.trim()}><IconPlus />{T.addDate}</button>
            </form>
          </section>

          {featureOn(settings, 'exams') && exams.length > 0 && (
            <section className="panel" aria-labelledby="ex-h" data-anim>
              <header><h2 id="ex-h">{T.exams}</h2></header>
              <div className="date-list">
                {exams.map((x) => {
                  const left = Math.round((parseISODate(x.date).getTime() - parseISODate(t).getTime()) / 86400000);
                  return (
                    <div className="date-row exam-row" key={x.id}>
                      <span className="num">{shortDate(x.date)}</span>
                      <span><b style={{ fontWeight: 500 }}>{x.name}</b> <small className="muted num">· {T.examLeft(left)}</small></span>
                      <span className="row-actions">
                        <button type="button" className="card-link" onClick={() => setExamOpen({ exam: x })}>{T.examReplan}</button>
                        <button type="button" className="btn ghost icon" aria-label={T.examRemove(x.name)}
                          onClick={() => {
                            updateSettings((s) => ({ ...s, exams: (s.exams ?? []).filter((y) => y.id !== x.id) }));
                            offerUndo(T.deleted(x.name), () => updateSettings((s) => ({ ...s, exams: [...(s.exams ?? []), x] })));
                          }}><IconX /></button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="panel fill" aria-labelledby="mn-h" data-anim>
            <div className="field grow">
              <label id="mn-h" htmlFor="m-notes" style={{ fontSize: 16 }}>{T.monthNotes}</label>
              {month ? <textarea id="m-notes" className="input" rows={3} value={month.notes} placeholder={T.monthNotesPh}
                onChange={(e) => update((m) => ({ ...m, notes: e.target.value }))} /> : <div className="skeleton" style={{ height: 80 }} />}
            </div>
          </section>
        </div>

        <section className="panel flush span-7 month-cal" aria-labelledby="cal-h" data-anim>
          <header>
            <h2 id="cal-h">{T.monthCalendar}</h2>
            <div className="legend">
              <span><i className="lg-shut" />{T.legendShutdown}</span>
              {habits.length > 0 && <span><i className="lg-habit" />{T.legendHabits}</span>}
              <span><i className="lg-date" />{T.legendDate}</span>
            </div>
          </header>
          <div className="cal" aria-label={monthTitle(id)}>
            <div className="cal-row head" aria-hidden="true">
              <span className="wk" />
              {weekdayNames.map((n) => <span key={n}>{n}</span>)}
            </div>
            {weeks.map((w) => (
              <div className={`cal-row${w === weekOf(t) ? ' cur' : ''}`} key={w}>
                <a className="wk num" href={`/week/${w}`} onClick={onLinkClick} aria-label={T.weekN(weekNumber(w))}>{weekNumber(w)}</a>
                {weekDays(w).map((d) => {
                  const inMonth = d.slice(0, 7) === id;
                  const doc = docs?.get(`day:${d}`);
                  const deep = doc?.metrics.deep;
                  const done = doc ? habits.filter((h) => doc.metrics[h.id] === true).length : 0;
                  const remember = dates.filter((x) => x.date === d);
                  return (
                    <a key={d} href={`/day/${d}`} onClick={onLinkClick}
                      className={`cal-day${inMonth ? '' : ' out'}${d === t ? ' is-today' : ''}`}>
                      <span className="dn num">{Number(d.slice(8))}</span>
                      {doc?.shutdown.done && <span className="shut" title={T.legendShutdown} />}
                      {typeof deep === 'number' && <span className="dv num">{deep} {settings.metrics.find((m) => m.id === 'deep')?.unit ?? ''}</span>}
                      {remember.slice(0, 2).map((r) => <span key={r.id} className="rem">{r.text}</span>)}
                      {habits.length > 0 && doc && (
                        <span className="hb" aria-label={`${T.legendHabits}: ${done}/${habits.length}`}>
                          <i style={{ transform: `scaleX(${done / habits.length})` }} />
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>
      <ExamPlanner open={!!examOpen} exam={examOpen?.exam ?? null} onClose={() => setExamOpen(null)} />
    </div>
  );
}
