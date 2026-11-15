import { useEffect, useMemo, useState } from 'react';
import { Segmented } from '../components/Segmented';
import { useSettings } from '../App';
import { Checklist } from '../components/Checklist';
import { TaskMeta } from '../components/TaskMeta';
import { addWeeks, clock, duration, monthOf, nowMinutes, quarterOf, rangeLabel, shortDate, today, weekDays, weekNumber, weekdayShort } from '../lib/dates';
import { useCalendar } from '../lib/calendar';
import { dayCapacity, type DayCapacity } from '../lib/dayCapacity';
import { useT } from '../lib/i18n';
import { emptyDay, emptyMonth, emptyQuarter, emptyWeek, uid, type DayDoc, type Item, type MonthDoc, type QuarterDoc, type WeekDoc } from '../lib/model';
import { navigate, onLinkClick } from '../lib/router';
import { updateKey, useDoc, useRange } from '../lib/useDoc';
import { DayChips } from './Templates';

/**
 * Weekly planning, step by step: look back at last week, look up at the month and the season (and the
 * calendar), write what this week must deliver, then put each item on the days it belongs to.
 */
export function WeekPlan({ id }: { id: string }) {
  const T = useT(), P = T.weekPlan;
  const days = weekDays(id), prevId = addWeeks(id, -1), prevDays = weekDays(prevId);
  const { value: week, update: updateExperiment } = useDoc<WeekDoc>(`week:${id}`, emptyWeek);
  const { value: prev, update: updatePrev } = useDoc<WeekDoc>(`week:${prevId}`, emptyWeek);
  const { docs: prevDocs } = useRange<DayDoc>(`day:${prevDays[0]}`, `day:${prevDays[6]}`);
  const { value: monthA } = useDoc<MonthDoc>(`month:${monthOf(days[0])}`, emptyMonth);
  const { value: monthB } = useDoc<MonthDoc>(`month:${monthOf(days[6])}`, emptyMonth);
  const { value: quarter } = useDoc<QuarterDoc>(`quarter:${quarterOf(days[3])}`, emptyQuarter);
  const cal = useCalendar(days[0], days[6]);
  const { settings } = useSettings();
  const { docs: dayDocs } = useRange<DayDoc>(`day:${days[0]}`, `day:${days[6]}`);
  const [editingExperiment, setEditingExperiment] = useState(false);
  const [step, setStep] = useState(0);
  const [carry, setCarry] = useState<Set<string> | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [assign, setAssign] = useState<Record<string, number[]>>({});
  const [saving, setSaving] = useState(false);

  const unfinished = useMemo(() => (prev?.items ?? []).filter((i) => !i.done && i.text.trim()), [prev]);
  useEffect(() => { if (prev && !carry) setCarry(new Set(unfinished.map((i) => i.id))); }, [prev, carry, unfinished]);

  // the plan starts from what the week already holds, plus what is carried over (once each)
  const startPlan = () => {
    if (items) return;
    const have = week?.items ?? [];
    const seen = new Set(have.map((i) => i.text.trim().toLowerCase()));
    const carried = unfinished.filter((i) => carry?.has(i.id) && !seen.has(i.text.trim().toLowerCase())).map((i) => ({ id: uid(), text: i.text, done: false }));
    setItems([...have, ...carried]);
  };
  const plan = items ?? week?.items ?? [];

  async function save() {
    setSaving(true);
    await updateKey<WeekDoc>(`week:${id}`, emptyWeek, (w) => ({ ...w, items: plan, plannedAt: new Date().toISOString() }));
    for (const it of plan) {
      for (const d of assign[it.id] ?? []) {
        await updateKey<DayDoc>(`day:${days[d]}`, emptyDay, (doc) => (doc.tasks.some((x) => x.text.trim().toLowerCase() === it.text.trim().toLowerCase())
          ? doc : { ...doc, tasks: [...doc.tasks, { id: uid(), text: it.text, done: false, estimate: it.estimate, up: { key: `week:${id}`, id: it.id } }] }));
      }
    }
    navigate(`/week/${id}`);
  }

  // the room each day has, with the items put on it so far (a day that has passed has none)
  const t0 = today();
  const caps: (DayCapacity | null)[] = dayDocs && step === 3 ? days.map((d, i) => (d < t0 ? null : dayCapacity({
    date: d, doc: dayDocs.get(`day:${d}`), events: cal?.days[d], settings, from: d === t0 ? nowMinutes() : undefined,
    adding: plan.filter((it) => (assign[it.id] ?? []).includes(i)),
  }))) : [];
  const capSum = (f: (c: DayCapacity) => number) => caps.reduce((n, c) => n + (c ? f(c) : 0), 0);

  // last week in numbers
  const prevDone = (prev?.items ?? []).filter((i) => i.done).length, prevAll = (prev?.items ?? []).length;
  const shutdowns = prevDays.filter((d) => prevDocs?.get(`day:${d}`)?.shutdown.done).length;
  const deepHours = prevDays.reduce((s, d) => { const v = prevDocs?.get(`day:${d}`)?.metrics.deep; return s + (typeof v === 'number' ? v : 0); }, 0);
  const datesThisWeek = [...(monthA?.dates ?? []), ...(monthB && monthOf(days[6]) !== monthOf(days[0]) ? monthB.dates : [])]
    .filter((d) => d.date >= days[0] && d.date <= days[6]).sort((a, z) => a.date.localeCompare(z.date));
  const monthGoals = monthA?.goals ?? [];

  const steps = [P.lookBack, P.lookUp, P.write, P.spread];
  const last = step === steps.length - 1;
  const next = () => { if (step === 1) startPlan(); setStep(step + 1); };

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{P.title(weekNumber(id))}</h1>
          <p className="sub num">{rangeLabel(days[0], days[6])} · <a className="card-link" style={{ fontWeight: 400 }} href={`/week/${id}`} onClick={onLinkClick}>{P.backToWeek}</a></p>
        </div>
      </div>

      <section className="panel plan-week" aria-labelledby="pw-h">
        <div className="welcome-progress plan-progress" aria-label={T.welcome.stepN(step + 1, steps.length)}>
          {steps.map((_, k) => <i key={k} className={k <= step ? 'on' : ''} />)}
          <span className="muted num">{T.welcome.stepN(step + 1, steps.length)}</span>
        </div>

        <div className="welcome-step" key={step}>
          <h2 id="pw-h" className="pw-title">{steps[step]}</h2>

          {step === 0 && (
            <>
              <p className="welcome-body">{P.lookBackBody}</p>
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
              <div className="pw-stats num">
                <div><b>{prevAll ? `${prevDone}/${prevAll}` : '—'}</b><span>{P.statPlan}</span></div>
                <div><b>{prevDocs ? shutdowns : '—'}</b><span>{P.statShutdowns}</span></div>
                <div><b>{prevDocs ? `${Math.round(deepHours * 10) / 10} ${T.defaults.metrics.deep.unit}` : '—'}</b><span>{P.statDeep}</span></div>
              </div>
              {unfinished.length === 0 ? <p className="muted">{prevAll ? P.allDone : P.nothingLastWeek}</p> : (
                <div className="pw-carry">
                  <span className="label">{P.carryLabel}</span>
                  {unfinished.map((i) => (
                    <label key={i.id} className="check-line">
                      <input type="checkbox" className="check" checked={!!carry?.has(i.id)}
                        onChange={(e) => setCarry((c) => { const n = new Set(c); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
                      <span>{i.text}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <p className="welcome-body">{P.lookUpBody}</p>
              <div className="pw-two">
                <div>
                  <span className="label">{P.monthGoals}</span>
                  {monthGoals.length ? <ul className="pw-goals">{monthGoals.map((g) => <li key={g.id} className={g.done ? 'done' : ''}>{g.text}</li>)}</ul>
                    : <p className="muted">{P.noGoals}</p>}
                </div>
                <div>
                  <span className="label">{P.seasonGoals}</span>
                  {quarter?.goals.length ? <ul className="pw-goals">{quarter.goals.map((g) => <li key={g.id} className={g.done ? 'done' : ''}>{g.text}</li>)}</ul>
                    : <p className="muted">{P.noGoals}</p>}
                </div>
              </div>
              {datesThisWeek.length > 0 && (
                <div>
                  <span className="label">{P.datesThisWeek}</span>
                  <ul className="pw-goals">{datesThisWeek.map((d) => <li key={d.id}><span className="num">{shortDate(d.date)}</span> · {d.text}</li>)}</ul>
                </div>
              )}
              <div>
                <span className="label">{P.calendarWeek}</span>
                {cal ? (
                  <div className="pw-cal num">
                    {days.map((d) => {
                      const ev = (cal.days[d] ?? []).filter((e) => !e.allDay);
                      const mins = ev.reduce((s, e) => s + e.end - e.start, 0);
                      return (
                        <div key={d}>
                          <b>{weekdayShort(d)}</b>
                          <span title={ev.map((e) => `${clock(e.start)} ${e.title}`).join(' · ')}>{ev.length ? P.meetings(ev.length) : '—'}</span>
                          <small>{ev.length ? duration(mins) : ''}</small>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="muted">{P.noCalendar} <a className="card-link" href="/settings" onClick={onLinkClick}>{T.nav.settings}</a></p>}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="welcome-body">{P.writeBody}</p>
              <Checklist label={T.weeklyPlan} items={plan} placeholder={T.addToWeek} onChange={setItems} />
            </>
          )}

          {step === 3 && (
            <>
              <p className="welcome-body">{P.spreadBody}</p>
              {plan.length > 0 && caps.length > 0 && (
                <div className="pw-cap" role="group" aria-label={P.capacityTitle} data-testid="week-capacity">
                  <p className="muted">{T.workBudget(String(settings.startHour).padStart(2, '0') + ':00', String(settings.endHour).padStart(2, '0') + ':00')}</p>
                  <p className="pw-cap-week num" data-cap="week">
                    {P.capacityWeek(duration(Math.max(0, capSum((c) => c.left))), duration(capSum((c) => c.fixed)),
                      duration(capSum((c) => c.planned)))}
                    {capSum((c) => c.unestimated) > 0 && <span data-cap="week-unestimated"> · {P.capacityNoEstimate(capSum((c) => c.unestimated))}</span>}
                  </p>
                  <div className="pw-cap-days">
                    {days.map((d, i) => {
                      const c = caps[i];
                      if (!c) return <div key={d} className="pw-cap-day past" data-date={d}><b>{weekdayShort(d)}</b><span className="muted">{P.capacityPast}</span></div>;
                      const span = Math.max(c.available, c.fixed + c.planned + c.estimated, 1);
                      const pct = (m: number) => `${(m / span) * 100}%`;
                      const over = c.left < 0;
                      return (
                        <div key={d} className={`pw-cap-day${over ? ' over' : ''}`} data-date={d}>
                          <b>{weekdayShort(d)}</b>
                          <div className="pw-bar" role="img" aria-label={P.capacityBar(duration(c.fixed), duration(c.planned), duration(c.estimated), duration(Math.max(0, c.left)))}>
                            <i className="fixed" style={{ width: pct(c.fixed) }} />
                            <i className="deep" style={{ width: pct(c.planned) }} />
                            <i className="tasks" style={{ width: pct(c.estimated) }} />
                          </div>
                          <span className="pw-cap-left num" data-cap="left" data-minutes={c.left} title={over ? P.capacityOverTip : undefined}>
                            {over ? P.capacityOver(duration(-c.left)) : P.capacityFree(duration(c.left))}
                          </span>
                          {c.unestimated > 0 && <small data-cap="unestimated">{P.capacityNoEstimate(c.unestimated)}</small>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {plan.length === 0 ? <p className="muted">{P.emptyPlan}</p> : (
                <div className="pw-spread">
                  {plan.map((it) => (
                    <div key={it.id} className="pw-spread-row">
                      <span className={it.done ? 'done' : ''}>{it.text}</span>
                      <TaskMeta item={it} onChange={(p) => setItems(plan.map((x) => (x.id === it.id ? { ...x, ...p } : x)))} />
                      <DayChips days={assign[it.id] ?? []} label={P.daysFor(it.text)} onChange={(d) => setAssign((a) => ({ ...a, [it.id]: d }))} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="welcome-foot">
          {step > 0 ? <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>{T.welcome.back}</button> : <span />}
          <button type="button" className="btn primary big" disabled={saving || !week} onClick={() => (last ? save() : next())}>{last ? P.save : T.welcome.next}</button>
        </footer>
      </section>
    </>
  );
}
