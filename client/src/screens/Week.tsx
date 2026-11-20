import { CalendarView } from '../components/CalendarView';
import { useState } from 'react';
import { Segmented } from '../components/Segmented';
import { useSettings } from '../App';
import { Checklist } from '../components/Checklist';
import { DocNotice, SaveStamp } from '../components/Common';
import { IconLeft, IconRight } from '../components/Icons';
import {
  addWeeks, clock, duration, monthName, monthOf, quarterOf, rangeLabel, shortDate, today, weekDays, weekNumber, weekOf, weekdayShort,
} from '../lib/dates';
import { dayFocus } from '../lib/focus';
import { activeColumn, emptyWeek, minutesOfKind, type DayDoc, type QuarterDoc, type WeekDoc } from '../lib/model';
import { useT } from '../lib/i18n';
import { onLinkClick } from '../lib/router';
import { useSwipeNav } from '../lib/swipe';
import { useDoc, useRange } from '../lib/useDoc';
import { BrokenDown, PartOf, whereOf } from '../components/Links';
import { CapacityNote } from '../components/CapacityNote';
import { aboveKeys, choicesOf, servingOf } from '../lib/links';
import { emptyMonth, type MonthDoc } from '../lib/model';

export function Week({ id }: { id: string }) {
  const T = useT();
  const { settings } = useSettings();
  const { value: week, update, status, error, retry } = useDoc<WeekDoc>(`week:${id}`, emptyWeek);
  const updateExperiment = update;
  const [editingExperiment, setEditingExperiment] = useState(false);
  const { value: prev, update: updatePrev } = useDoc<WeekDoc>(`week:${addWeeks(id, -1)}`, emptyWeek);
  const days = weekDays(id);
  const { docs: dayDocs, error: daysError, retry: retryDays } = useRange<DayDoc>(`day:${days[0]}`, `day:${days[6]}`);
  const q = quarterOf(days[3]);
  const { value: quarter } = useDoc<QuarterDoc>(`quarter:${q}`, () => ({ goals: [], notes: '' }));
  // the months it lies in (one or two): their goals are what its items can serve
  const wkey = `week:${id}`;
  const [mA, mB = mA] = aboveKeys(wkey);
  const { value: monthA } = useDoc<MonthDoc>(mA, emptyMonth);
  const { value: monthB } = useDoc<MonthDoc>(mB, emptyMonth);
  const monthChoices = [...choicesOf(mA, monthA?.goals, whereOf(mA, T)), ...(mB !== mA ? choicesOf(mB, monthB?.goals, whereOf(mB, T)) : [])];
  const servingFor = (it: { id: string }) => days.flatMap((d) => servingOf(dayDocs?.get(`day:${d}`)?.tasks ?? [], wkey, it.id).map((item) => ({ key: `day:${d}`, item })));
  const t = today();
  const thisWeek = weekOf(t);

  const items = week?.items ?? [];
  const done = items.filter((i) => i.done).length;
  const shutdowns = days.filter((d) => dayDocs?.get(`day:${d}`)?.shutdown.done).length;

  const swipe = useSwipeNav(`/week/${addWeeks(id, -1)}`, `/week/${addWeeks(id, 1)}`);
  return (
    <div className="swipe-area" ref={swipe}>
      <div className="title-row">
        <div>
          <h1>{T.weeklyPlanTitle(weekNumber(id))}</h1>
          <p className="sub num">
            {rangeLabel(days[0], days[6])}
            {' · '}<a className="card-link" style={{ fontWeight: 400 }} href={`/month/${monthOf(days[3])}`} onClick={onLinkClick}>{monthName(monthOf(days[3]))}</a>
            {week && items.length > 0 && <> · <strong>{T.of(done, items.length)}</strong>{T.plannedItemsDone}</>}
            {dayDocs && id <= thisWeek && T.shutdownOnDays(shutdowns, 7)}
          </p>
        </div>
        <div className="title-actions"><CalendarView view="week" date={days[0]} />
          <SaveStamp status={status} />
          {id <= thisWeek && <a className="btn" href={`/review/${id}`} onClick={onLinkClick}>{T.review.open}</a>}
          {id >= thisWeek && (
            <a className={`btn${week && !week.plannedAt ? ' primary' : ''}`} href={`/plan/${id}`} onClick={onLinkClick}>
              {week?.plannedAt ? T.weekPlan.replan : T.weekPlan.start}
            </a>
          )}
          <div className="stepper">
            <a className="btn icon" href={`/week/${addWeeks(id, -1)}`} onClick={onLinkClick} aria-label={T.prevWeek}><IconLeft /></a>
            <a className="btn" href={`/week/${thisWeek}`} onClick={onLinkClick}>{T.thisWeek}</a>
            <a className="btn icon" href={`/week/${addWeeks(id, 1)}`} onClick={onLinkClick} aria-label={T.nextWeek}><IconRight /></a>
          </div>
        </div>
      </div>
      {prev?.experiment?.trim() && <div className="week-experiment" data-testid="previous-experiment">
                <span className="muted">{T.experiment.previous}: {prev.experiment}</span>
                <Segmented role="group" aria-label={T.experiment.previous}>
                  {(['worked', 'change', 'drop'] as const).map((result) => <button type="button" key={result}
                    aria-pressed={prev.experimentResult === result} onClick={() => {
                      updatePrev((w) => ({ ...w, experimentResult: result }));
                      if (result === 'change') {
                        updateExperiment((w) => ({ ...w, experiment: prev.experiment }));
                        setEditingExperiment(true);
                      } else setEditingExperiment(false);
                    }}>{T.experiment[result]}</button>)}
                </Segmented>
              </div>}
              {editingExperiment && <div className="field">
                <label htmlFor="current-experiment">{T.experiment.current}</label>
                <input autoFocus id="current-experiment" className="input" value={week?.experiment ?? ''}
                  onChange={(e) => updateExperiment((w) => ({ ...w, experiment: e.target.value }))} />
              </div>}
      <DocNotice status={status} error={error} retry={retry} />
      {id >= thisWeek && dayDocs && <CapacityNote scope="week" id={id} from={days[0]} thisOne={id === thisWeek}
        planned={days.reduce((n, d) => { const doc = dayDocs.get(`day:${d}`); return n + (doc ? minutesOfKind(doc, 'deep') : 0); }, 0)} />}

      <div className="grid week-layout">
        <section className="panel span-7 fill" aria-labelledby="wp-h">
          <header>
            <h2 id="wp-h">{T.mustDeliver}</h2>
            <span className="meta hide-phone">{T.planMeta}</span>
          </header>
          {week ? (
            <Checklist label={T.weeklyPlan} items={items} placeholder={T.addToWeek} steps
              onChange={(items) => update((w) => ({ ...w, items }))}
              line={(it, change) => <>
                <PartOf up={it.up} choices={monthChoices} onChange={(up) => change({ up })} level={T.levels.month} place="line" />
                <BrokenDown parent={{ key: wkey, item: it }} serving={servingFor(it)} place="line" />
              </>}
              tools={(it, change) => <>
                <PartOf up={it.up} choices={monthChoices} onChange={(up) => change({ up })} level={T.levels.month} place="tool" />
                <BrokenDown parent={{ key: wkey, item: it }} serving={servingFor(it)} place="tool" />
              </>} />
          ) : <div className="skeleton" style={{ height: 176 }} />}
          {week && (
            <div className="field grow" style={{ marginTop: 20 }}>
              <label htmlFor="wk-notes">{T.weekNotes}</label>
              <textarea id="wk-notes" className="input" rows={3} value={week.notes}
                placeholder={T.weekNotesPh}
                onChange={(e) => update((w) => ({ ...w, notes: e.target.value }))} />
            </div>
          )}
        </section>

        <div className="stack span-5 week-summary">
          <section className="panel flush" aria-labelledby="days-h">
            <header><h2 id="days-h">{T.theDays}</h2><a className="card-link" style={{ fontWeight: 400 }} href="/metrics" onClick={onLinkClick}>{T.nav.metrics}</a></header>
            <div className="daylist" style={{ marginTop: 8 }}>
              <div className="dayrow head" aria-hidden="true">
                <span>{T.dayCol}</span><span className="first">{T.firstBlock}</span><span className="n">{T.focusMetric}</span><span className="n">{T.tasks}</span><span className="n">{T.shutdownCol}</span>
              </div>
              {daysError && <div className="notice error" style={{ margin: '0 20px 16px' }}>{T.couldntLoadDays} <button className="btn ghost" onClick={retryDays}>{T.retry}</button></div>}
              {days.map((d) => {
                const doc = dayDocs?.get(`day:${d}`);
                const col = doc ? activeColumn(doc) : null;
                const firstBlock = col?.blocks[0];
                const deep = dayFocus(doc, settings).minutes;
                const at = doc?.shutdown.at ? new Date(doc.shutdown.at) : null;
                return (
                  <a key={d} href={`/day/${d}`} onClick={onLinkClick} className={`dayrow${d === t ? ' is-today' : ''}`}>
                    <span className="d"><b>{weekdayShort(d)}</b><small>{shortDate(d)}</small></span>
                    <span className="first">{firstBlock ? <><b>{clock(firstBlock.start)}</b> {firstBlock.label || T.untitled}</> : <span className="dash">{dayDocs ? '—' : ''}</span>}</span>
                    <span className="n">
                      {!dayDocs ? <span className="skeleton" style={{ display: 'inline-block', width: 40, height: 14 }} />
                        : duration(deep)}
                    </span>
                    <span className="n">{doc?.tasks.length ? `${doc.tasks.filter((x) => x.done).length}/${doc.tasks.length}` : <span className="dash">—</span>}</span>
                    <span className="n">{doc?.shutdown.done ? (at ? clock(at.getHours() * 60 + at.getMinutes()) : T.doneShort) : <span className="dash">—</span>}</span>
                  </a>
                );
              })}
            </div>
          </section>

          <section className="panel" aria-labelledby="qg-h">
            <header>
              <h2 id="qg-h">{T.seasonGoals}</h2>
              <a className="card-link" href={`/quarter/${q}`} onClick={onLinkClick}>{T.quarterShort(q)}</a>
            </header>
            {quarter && quarter.goals.length > 0 ? (
              <ul className="checklist" aria-label={T.quarterGoals}>
                {quarter.goals.map((g) => (
                  <li key={g.id} className={`check-row${g.done ? ' done' : ''}`} style={{ minHeight: 40 }}>
                    <input type="checkbox" className="check" checked={g.done} disabled aria-label={g.text} />
                    <span className="text" style={{ height: 'auto' }}>{g.text}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="empty">{T.noGoalsFor(T.quarterShort(q))}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
