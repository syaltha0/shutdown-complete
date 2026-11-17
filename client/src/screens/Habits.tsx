import { cycleHabit, habitState, habitStats, habitHeatmap, habitLongest, planned, shift } from '../lib/habits';
import { useState } from 'react';
import { useSettings } from '../App';
import { IconLeft, IconPlus, IconRight } from '../components/Icons';
import { addMonths, fmtDay, longDate, monthDays, monthOf, monthRange, monthTitle, today, weekDays, weekOf } from '../lib/dates';
import { useT } from '../lib/i18n';
import { emptyDay, uid, type DayDoc, type MetricDef } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { updateKey, useRange } from '../lib/useDoc';

export function Habits({ id }: { id: string }) {
  const T = useT(), { settings, update } = useSettings();
  const habits = settings.metrics.filter(m => m.kind === 'check' && !m.archived);
  const t = today(), [, to] = monthRange(id), end = to < t ? to : t;
  const history = Array.from({length: 364}, (_, i) => shift(end, i - 363));
  const { docs, error, retry } = useRange<DayDoc>(`day:${shift(history[0], -7)}`, `day:${to > t ? to : t}`);
  const [name, setName] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  const get = (d: string) => docs?.get(`day:${d}`);
  const stats = (h: MetricDef, dates: string[]) => habitStats(h, dates, get, end);
  const recent = Array.from({length: 14}, (_, i) => shift(end, i - 13));
  const elapsed = monthDays(id).filter(d => d <= t);
  const totalDone = habits.reduce((n, h) => n + stats(h, elapsed).done, 0);
  function addHabit(value = name) {
    const n = value.trim(); if (!n) return;
    update(s => ({...s, metrics: [...s.metrics, {id: uid(), name: n, kind: 'check', unit: '', target: null}]})); setName('');
  }
  const patch = (h: MetricDef, value: Partial<MetricDef>) => update(s => ({...s, metrics: s.metrics.map(m => m.id === h.id ? {...m, ...value} : m)}));
  const move = (h: MetricDef, offset: number) => update(s => {
    const metrics = [...s.metrics], at = metrics.findIndex(m => m.id === h.id);
    const other = habits[habits.findIndex(m => m.id === h.id) + offset];
    if (other) {const to = metrics.findIndex(m => m.id === other.id); [metrics[at], metrics[to]] = [metrics[to], metrics[at]];}
    return {...s, metrics};
  });
  const frequency = (h: MetricDef) => h.frequency?.mode === 'weekly' ? T.habitWeeklySummary(h.frequency.count ?? 1) : h.frequency?.mode === 'days' ? weekDays(weekOf(t)).filter((_, i) => h.frequency?.days?.includes(i)).map(d => fmtDay(d, {weekday: 'short'})).join(' · ') || T.habitSelected : T.habitDaily;
  const units = (h: MetricDef, n: number) => h.frequency?.mode === 'weekly' ? T.habitWeeks(n) : T.daysN(n);
  const cell = (h: MetricDef, d: string, i: number) => {
    const state = habitState(h, get(d)), done = state === 'done';
    return <button key={d} className={`hcell${done ? ' on' : ''}${d === t ? ' is-today' : ''}${i < 7 ? ' hv-older' : ''}`} disabled={d > t || !docs || !planned(h, d)} aria-pressed={done} aria-label={`${T.toggleAria(h.name, longDate(d), done)} / ${state === 'skipped' ? T.habitSkipped : ''}`} title={longDate(d)} onClick={() => updateKey<DayDoc>(`day:${d}`, emptyDay, x => cycleHabit(h, x))}>{state === 'skipped' ? '/' : ''}</button>;
  };
  return <div className="habits-v2">
    <div className="title-row"><div><h1>{T.habitsTitle}</h1><p className="sub">{docs ? T.habitsFinding(totalDone, habits.reduce((n,h) => n + stats(h, elapsed).total, 0)) : T.habitLoading}</p></div>
      <div className="stepper"><a className="btn icon" href={`/habits/${addMonths(id,-1)}`} onClick={onLinkClick} aria-label={T.prevMonth}><IconLeft /></a><a className="btn" href={`/habits/${monthOf(t)}`} onClick={onLinkClick}>{monthTitle(id)}</a><a className="btn icon" href={`/habits/${addMonths(id,1)}`} onClick={onLinkClick} aria-label={T.nextMonth}><IconRight /></a></div>
    </div>
    {error && <div className="notice error">{T.couldntLoadDays} <button className="btn" onClick={retry}>{T.retry}</button></div>}
    <section className="hv-ledger" aria-label={T.habitsTitle} aria-busy={!docs}>
    {!habits.length && <div className="hv-empty"><h2>{T.habitBegin}</h2><p>{T.habitIntro}</p><button className="btn hv-start" onClick={() => document.getElementById('habit-name')?.focus()}><IconPlus />{T.addHabit}</button><div className="hv-suggestions">{T.habitSuggestions.map(n => <button key={n} className="btn" onClick={() => addHabit(n)}>{n}</button>)}</div></div>}
    <div className="hgrid">
      {habits.length > 0 && <div className="hrow head"><span>{T.habitCol}</span><div className="hv-days">{recent.map((d,i) => <span key={d} className={i < 7 ? 'hv-older' : ''}>{fmtDay(d,{day:'numeric'})}</span>)}</div><span>{T.streakCol}</span></div>}
      {habits.map((h,index) => {
        const current = stats(h, history).streak, open = opened === h.id;
        const heatmap = open && docs ? habitHeatmap(h, get, end) : [];
        return <article className="hv-habit" key={h.id}>
          <div className="hrow"><button className="hv-name" aria-expanded={open} aria-controls={`detail-${h.id}`} onClick={() => setOpened(open ? null : h.id)}><span className="hname">{h.name}</span><small>{frequency(h)}</small><IconRight /></button><div className="hv-phone-dates">{recent.slice(-7).map(d => <span key={d}>{fmtDay(d,{weekday:'narrow'})} {Number(d.slice(8))}</span>)}</div><div className="hv-days">{recent.map((d,i) => cell(h,d,i))}</div><span className="hv-streak num">{docs ? units(h,current) : '—'}</span></div>
          {open && <div id={`detail-${h.id}`} className="hv-detail">
            <div className="hv-detail-head"><h2>{T.habitYear}</h2><span className="meta">{fmtDay(heatmap[0]?.date ?? history[0],{month:'short',year:'numeric'})} – {fmtDay(end,{month:'short',year:'numeric'})}</span></div>
            {!docs ? <p>{T.habitLoading}</p> : <>
            <div className="hv-heatmap" aria-label={T.habitYear}>{Array.from({length:4},(_,part) => <div className="hv-quarter" key={part}><span className="meta hv-quarter-label">{fmtDay(heatmap[part*91].date,{month:'short'})} – {fmtDay(heatmap[part*91+90].date,{month:'short'})}</span><div className="hv-map-grid">{heatmap.slice(part*91,part*91+91).map(c => <span key={c.date} className="hv-map-cell" data-level={c.level} data-state={c.state} data-future={c.date > end} title={`${longDate(c.date)}: ${c.state === 'skipped' ? T.habitSkipped : T.toggleAria(h.name,longDate(c.date),c.state === 'done')}`} aria-label={`${longDate(c.date)}, ${c.state === 'skipped' ? T.habitSkipped : T.toggleAria(h.name,longDate(c.date),c.state === 'done')}`}>{c.state === 'skipped' ? '/' : ''}</span>)}</div></div>)}</div>
            <p className="hv-legend meta"><span><i className="hv-map-cell" data-level="4" />{T.habitCompleted}</span><span><i className="hv-map-cell">/</i>{T.habitSkipped}</span><span>{T.habitMapHint}</span></p>
            <dl className="hv-stats"><div><dt>{T.streakCol}</dt><dd>{units(h,current)}</dd></div><div><dt>{T.habitLongest}</dt><dd>{units(h,habitLongest(h,history,get,end))}</dd></div>{[30,90].map(n => {const s=stats(h,history.slice(-n)); return <div key={n}><dt>{T.habitWindow(n)}</dt><dd>{s.total ? Math.round(s.rate*100)+'%' : '—'}</dd><small>{T.of(s.done,s.total)}</small></div>;})}</dl>
            <div className="hv-monthly"><h3>{T.habitMonthly}</h3><div className="hv-month-bars">{Array.from({length:6},(_,i) => addMonths(monthOf(end),i-5)).map(m => {const s=stats(h,monthDays(m));return <div className="hv-month" key={m}><span className="num">{s.total ? Math.round(s.rate*100)+'%' : '—'}</span><div className="hv-bar-track"><i style={{height: s.rate*100+'%'}} /></div><span>{fmtDay(m+'-01',{month:'short'})}</span></div>;})}</div></div>
            </>}
            <section className="hv-controls" aria-label={T.habitFrequency}>
          <select className="input" aria-label={`${h.name} / ${T.habitFrequency}`} value={h.frequency?.mode ?? 'daily'} onChange={e => patch(h, {frequency: {mode: e.target.value as 'daily' | 'days' | 'weekly', days: [0,1,2,3,4], count: 3}})}>
            <option value="daily">{T.habitDaily}</option><option value="days">{T.habitSelected}</option><option value="weekly">{T.habitWeekly}</option>
          </select>
          {h.frequency?.mode === 'weekly' && <input className="input" type="number" min={1} max={7} aria-label={`${h.name} / ${T.habitWeekly}`} value={h.frequency.count ?? 3} onChange={e => patch(h, {frequency: {...h.frequency!, count: Math.max(1, Math.min(7, Number(e.target.value)))}})} />}
          {h.frequency?.mode === 'days' && weekDays(weekOf(t)).map((d, i) => <label key={d}><input type="checkbox" checked={h.frequency?.days?.includes(i) ?? false} onChange={e => patch(h, {frequency: {...h.frequency!, days: e.target.checked ? [...h.frequency!.days ?? [], i] : h.frequency!.days?.filter(n => n !== i)}})} />{fmtDay(d, {weekday: 'short'})}</label>)}
          <button className="btn" aria-label={`${h.name} / ${T.habitUp}`} disabled={index === 0} onClick={() => move(h, -1)}>{T.habitUp}</button>
          <button className="btn" aria-label={`${h.name} / ${T.habitDown}`} disabled={index === habits.length - 1} onClick={() => move(h, 1)}>{T.habitDown}</button>
          <button className="btn" aria-label={`${h.name} / ${T.habitArchive}`} onClick={() => patch(h, {archived: true})}>{T.habitArchive}</button>
            </section>
          </div>}
        </article>;
      })}
    </div>
    <form className="habit-add" onSubmit={e => {e.preventDefault();addHabit();}}><input id="habit-name" className="input" aria-label={T.addHabit} placeholder={T.habitPh} value={name} onChange={e => setName(e.target.value)} /><button className="btn" type="submit" disabled={!name.trim()}><IconPlus />{T.addHabit}</button></form>
    </section>
      <details className="panel"><summary>{T.habitArchived} ({settings.metrics.filter(m => m.kind === 'check' && m.archived).length})</summary>
        {settings.metrics.filter(m => m.kind === 'check' && m.archived).map(h => <div key={h.id}>{h.name} <button className="btn" aria-label={`${h.name} / ${T.habitRestore}`} onClick={() => patch(h, {archived: false})}>{T.habitRestore}</button></div>)}
      </details>
  </div>;
}
