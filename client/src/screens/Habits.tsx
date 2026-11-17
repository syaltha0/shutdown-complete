import { cycleHabit, habitState, habitStats, planned } from '../lib/habits';
import { useState } from 'react';
import { useSettings } from '../App';
import { IconLeft, IconPlus, IconRight } from '../components/Icons';
import { Chart, themeColor } from '../components/Chart';
import {
  addDays, addMonths, addWeeks, fmtDay, longDate, monthDays, monthOf, monthRange, monthTitle, today, weekDays, weekOf,
} from '../lib/dates';
import { useT } from '../lib/i18n';
import { emptyDay, uid, type DayDoc, type MetricDef } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { updateKey, useRange } from '../lib/useDoc';

/** Habits are the yes-or-no daily metrics, drawn as a month grid with streaks. */
export function Habits({ id }: { id: string }) {
  const T = useT();
  const { settings, update } = useSettings();
  const habits = settings.metrics.filter((m) => m.kind === 'check' && !m.archived);
  const t = today();
  const [from, to] = monthRange(id);
  // load two months back too, so a streak that began last month is counted whole
  const { docs, error, retry } = useRange<DayDoc>(`day:${addDays(from, -62)}`, `day:${to}`);
  const days = monthDays(id);
  const [weekId, setWeekId] = useState(() => (monthOf(t) === id ? weekOf(t) : weekOf(from)));
  const [name, setName] = useState('');

  const toggle = (h: MetricDef, d: string) => {
    if (d > t) return;
    updateKey<DayDoc>(`day:${d}`, emptyDay, x => cycleHabit(h, x));
  };
  const stats = (h: MetricDef, dates: string[]) => habitStats(h, dates, d => docs?.get(`day:${d}`), t);
  const streak = (h: MetricDef) => stats(h, Array.from({length: 94}, (_, i) => addDays(t, i - 93))).streak;
  const elapsed = days.filter((d) => d <= t);
  const doneDays = (h: MetricDef) => stats(h, elapsed).done;
  const totalDone = habits.reduce((s, h) => s + doneDays(h), 0);
  const best = habits.map((h) => ({ h, n: streak(h) })).sort((a, b) => b.n - a.n)[0];

  function addHabit() {
    const n = name.trim();
    if (!n) return;
    update((s) => ({ ...s, metrics: [...s.metrics, { id: uid(), name: n, kind: 'check', unit: '', target: null }] }));
    setName('');
  }

  const cell = (h: MetricDef, d: string) => {
    const done = habitState(h, docs?.get(`day:${d}`)) === "done";
    return (
      <button key={d} type="button" className={`hcell${done ? ' on' : ''}${d === t ? ' is-today' : ''}`}
        disabled={d > t || !docs || !planned(h, d)} aria-pressed={done} aria-label={`${T.toggleAria(h.name, longDate(d), done)} / ${habitState(h, docs?.get(`day:${d}`)) === "skipped" ? T.habitSkipped : ""}`}
        onClick={() => toggle(h, d)}>{habitState(h, docs?.get(`day:${d}`)) === "skipped" ? "/" : ""}</button>
    );
  };

  const patch = (h: MetricDef, value: Partial<MetricDef>) => update(s => ({...s, metrics: s.metrics.map(m => m.id === h.id ? {...m, ...value} : m)}));
  const move = (h: MetricDef, offset: number) => update(s => {
    const metrics = [...s.metrics], at = metrics.findIndex(m => m.id === h.id);
    const other = habits[habits.findIndex(m => m.id === h.id) + offset];
    if (other) { const to = metrics.findIndex(m => m.id === other.id); [metrics[at], metrics[to]] = [metrics[to], metrics[at]]; }
    return {...s, metrics};
  });
  const wdays = weekDays(weekId);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.habitsTitle} · {monthTitle(id)}</h1>
          <p className="sub num">
            {docs && habits.length ? <>{T.habitsFinding(totalDone, habits.reduce((n,h) => n + stats(h, elapsed).total, 0))}{best && best.n > 0 ? T.bestStreak(best.h.name, best.n) : ''}</> : ' '}
          </p>
        </div>
        <div className="title-actions">
          <div className="stepper">
            <a className="btn icon" href={`/habits/${addMonths(id, -1)}`} onClick={onLinkClick} aria-label={T.prevMonth}><IconLeft /></a>
            <a className="btn" href={`/habits/${monthOf(t)}`} onClick={onLinkClick}>{T.thisMonth}</a>
            <a className="btn icon" href={`/habits/${addMonths(id, 1)}`} onClick={onLinkClick} aria-label={T.nextMonth}><IconRight /></a>
          </div>
        </div>
      </div>
      {error && <div className="notice error">{T.couldntLoadDays} <button className="btn ghost" onClick={retry}>{T.retry}</button></div>}

      <section className="panel flush habits" aria-labelledby="hb-h" data-anim>
        <header>
          <h2 id="hb-h">{monthTitle(id)}</h2>
          <span className="meta hide-phone">{T.habitsHint}</span>
        </header>

        {habits.length === 0 ? <div className="empty" style={{ margin: '12px 20px' }}>{T.noHabits}</div> : (
          <>
            {/* desktop: the whole month */}
            <div className="hgrid hide-phone" style={{ ['--days' as string]: days.length }}>
              <div className="hrow head">
                <span className="hname">{T.habitCol}</span>
                {days.map((d) => <span key={d} className={`hd num${d === t ? ' is-today' : ''}`}>{Number(d.slice(8))}</span>)}
                <span className="n">{T.streakCol}</span>
                <span className="n">{T.monthCol}</span>
              </div>
              {habits.map((h) => (
                <div className="hrow" key={h.id}>
                  <span className="hname">{h.name}</span>
                  {days.map((d) => cell(h, d))}
                  <span className="n num streak" key={streak(h)}>{(h.frequency?.mode === "weekly" ? T.habitWeeks(streak(h)) : T.daysN(streak(h)))}</span>
                  <span className="n num">{T.of(doneDays(h), stats(h, elapsed).total)}</span>
                </div>
              ))}
            </div>

            {/* phone: one week at a time */}
            <div className="hweek phone-only">
              <div className="hweek-nav">
                <button type="button" className="btn icon" aria-label={T.prevWeek} onClick={() => setWeekId(addWeeks(weekId, -1))}><IconLeft /></button>
                <span className="num">{fmtDay(wdays[0], { day: 'numeric', month: 'short' })} – {fmtDay(wdays[6], { day: 'numeric', month: 'short' })}</span>
                <button type="button" className="btn icon" aria-label={T.nextWeek} onClick={() => setWeekId(addWeeks(weekId, 1))}><IconRight /></button>
              </div>
              <div className="hrow head">
                {wdays.map((d) => <span key={d} className={`hd${d === t ? ' is-today' : ''}`}>{fmtDay(d, { weekday: 'short' })}</span>)}
              </div>
              {habits.map((h) => (
                <div key={h.id} className="hweek-habit">
                  <div className="hweek-name"><span>{h.name}</span><span className="muted num">{(h.frequency?.mode === "weekly" ? T.habitWeeks(streak(h)) : T.daysN(streak(h)))}</span></div>
                  <div className="hrow">{wdays.map((d) => cell(h, d))}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <form className="habit-add" onSubmit={(e) => { e.preventDefault(); addHabit(); }}>
          <input className="input" aria-label={T.addHabit} placeholder={T.habitPh} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" type="submit" disabled={!name.trim()}><IconPlus />{T.addHabit}</button>
        </form>
      </section>

      <section className="panel" aria-label={T.habitFrequency}>
        {habits.map((h, index) => <div key={h.id} className="habit-add" style={{flexWrap: "wrap"}}>
          <span>{h.name}</span>
          <select className="input" aria-label={`${h.name} / ${T.habitFrequency}`} value={h.frequency?.mode ?? 'daily'} onChange={e => patch(h, {frequency: {mode: e.target.value as 'daily' | 'days' | 'weekly', days: [0,1,2,3,4], count: 3}})}>
            <option value="daily">{T.habitDaily}</option><option value="days">{T.habitSelected}</option><option value="weekly">{T.habitWeekly}</option>
          </select>
          {h.frequency?.mode === 'weekly' && <input className="input" type="number" min={1} max={7} aria-label={`${h.name} / ${T.habitWeekly}`} value={h.frequency.count ?? 3} onChange={e => patch(h, {frequency: {...h.frequency!, count: Math.max(1, Math.min(7, Number(e.target.value)))}})} />}
          {h.frequency?.mode === 'days' && weekDays(weekOf(t)).map((d, i) => <label key={d}><input type="checkbox" checked={h.frequency?.days?.includes(i) ?? false} onChange={e => patch(h, {frequency: {...h.frequency!, days: e.target.checked ? [...h.frequency!.days ?? [], i] : h.frequency!.days?.filter(n => n !== i)}})} />{fmtDay(d, {weekday: 'short'})}</label>)}
          <button className="btn" aria-label={`${h.name} / ${T.habitUp}`} disabled={index === 0} onClick={() => move(h, -1)}>{T.habitUp}</button>
          <button className="btn" aria-label={`${h.name} / ${T.habitDown}`} disabled={index === habits.length - 1} onClick={() => move(h, 1)}>{T.habitDown}</button>
          <button className="btn" aria-label={`${h.name} / ${T.habitArchive}`} onClick={() => patch(h, {archived: true})}>{T.habitArchive}</button>
        </div>)}
      </section>
      <details className="panel"><summary>{T.habitArchived} ({settings.metrics.filter(m => m.kind === 'check' && m.archived).length})</summary>
        {settings.metrics.filter(m => m.kind === 'check' && m.archived).map(h => <div key={h.id}>{h.name} <button className="btn" aria-label={`${h.name} / ${T.habitRestore}`} onClick={() => patch(h, {archived: false})}>{T.habitRestore}</button></div>)}
      </details>
      {habits.length > 0 && docs && (
        <div className="grid" style={{ marginTop: 'var(--gap)' }}>
          <section className="panel span-5" aria-labelledby="hr-h" data-anim>
            <header><h2 id="hr-h">{T.habitRates}</h2><span className="meta">{monthTitle(id)}</span></header>
            <div className="rates">
              {habits.map((h) => {
                const n = doneDays(h), p = stats(h, elapsed).rate;
                return (
                  <div className="rate" key={h.id}>
                    <div className="bb-top"><span className="l">{h.name}</span><span className="num">{Math.round(p * 100)}%</span></div>
                    <div className="bb-track"><i style={{ transform: `scaleX(${p})` }} /></div>
                    <div className="rate-sub muted num">{T.currentRun((h.frequency?.mode === "weekly" ? T.habitWeeks(streak(h)) : T.daysN(streak(h))))} · {T.of(n, stats(h, elapsed).total)}</div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="panel span-7" aria-labelledby="hw-h" data-anim>
            <div className="chart-head">
              <h2 id="hw-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.allDoneDays}</h2>
              <span className="meta">{T.thisWeekInBlue}</span>
            </div>
            <Chart label={T.allDoneDays} deps={[docs, settings.metrics, T.locale]} draw={(el, C) => {
              const ws = Array.from({ length: 8 }, (_, i) => addWeeks(weekOf(t), i - 7));
              C.bars(el, {
                labels: ws.map((w) => fmtDay(weekDays(w)[0], { day: 'numeric', month: 'short' })),
                values: ws.map((w) => weekDays(w).filter((d) => d <= t && habits.some(h => planned(h, d) && habitState(h, docs.get(`day:${d}`)) !== "skipped") && habits.every(h => !planned(h, d) || habitState(h, docs.get(`day:${d}`)) !== "empty")).length),
                highlight: 7, colour: themeColor('--hue'), mutedColour: themeColor('--chart-1'), height: 180,
                format: (v: number) => T.daysN(v), tickFormat: (v: number) => (Number.isInteger(v) ? String(v) : ''),
              });
            }} />
          </section>
        </div>
      )}
    </>
  );
}
