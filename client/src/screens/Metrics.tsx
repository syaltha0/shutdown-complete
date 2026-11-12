import { useState } from 'react';
import { useSettings } from '../App';
import { Chart, themeColor } from '../components/Chart';
import {
  addDays, addWeeks, quarterOf, quarterWeeks, rangeLabel, shortDate, today, weekDays, weekNumber, weekOf,
} from '../lib/dates';
import { useT } from '../lib/i18n';
import { effectivePlan, type DayDoc, type MetricDef } from '../lib/model';
import { clock, duration } from '../lib/dates';
import { insights } from '../lib/insights';
import { focusMinutes } from '../lib/focus';
import { onLinkClick } from '../lib/router';
import { useRange } from '../lib/useDoc';
import { Segmented } from '../components/Segmented';

type Span = '8w' | 'quarter';
const FOCUS_ID = '__focus';

export function Metrics() {
  const T = useT();
  const { settings } = useSettings();
  // completed focus sessions are a metric of their own, counted from the day's sessions
  const focusDef: MetricDef = { id: FOCUS_ID, name: T.focusMetric, kind: 'number', unit: T.mUnit, target: null };
  const defs = [...settings.metrics, focusDef];
  const [metricId, setMetricId] = useState(defs[0]?.id ?? '');
  const [span, setSpan] = useState<Span>('8w');
  const nf1 = new Intl.NumberFormat(T.locale, { maximumFractionDigits: 1 });
  const fmtVal = (v: number, m: MetricDef) => `${nf1.format(v)}${m.unit ? ` ${m.unit}` : ''}`;
  const t = today();
  const cur = weekOf(t);
  const weeks = span === '8w'
    ? Array.from({ length: 8 }, (_, i) => addWeeks(cur, i - 7))
    : quarterWeeks(quarterOf(t)).filter((w) => w <= cur);
  const from = weekDays(weeks[0])[0], to = weekDays(weeks[weeks.length - 1])[6];
  const { docs, error, retry } = useRange<DayDoc>(`day:${from}`, `day:${to}`);
  const m = defs.find((d) => d.id === metricId) ?? defs[0];

  const val = (d: string): number | null => {
    const doc = docs?.get(`day:${d}`);
    if (m.id === FOCUS_ID) { const f = doc ? focusMinutes(doc) : 0; return f || null; }
    const v = doc?.metrics[m.id];
    if (m.kind === 'check') return v === true ? 1 : v === false ? 0 : null;
    return typeof v === 'number' ? v : null;
  };

  const head = (
    <div className="title-row">
      <div>
        <h1>{T.metricsTitle}</h1>
        <p className="sub">{docs ? <Finding m={m} val={val} cur={cur} fmtVal={fmtVal} /> : ' '}</p>
      </div>
      <div className="title-actions">
        <Segmented className="sm" role="group" aria-label={T.metric}>
          {defs.map((d) => <button key={d.id} type="button" aria-pressed={d.id === m?.id} onClick={() => setMetricId(d.id)}>{d.name}</button>)}
        </Segmented>
        <Segmented className="sm" role="group" aria-label={T.period}>
          <button type="button" aria-pressed={span === '8w'} onClick={() => setSpan('8w')}>{T.eightWeeks}</button>
          <button type="button" aria-pressed={span === 'quarter'} onClick={() => setSpan('quarter')}>{T.thisQuarter}</button>
        </Segmented>
      </div>
    </div>
  );

  if (error) return <>{head}<div className="notice error">{T.couldntLoadDays} <button className="btn ghost" onClick={retry}>{T.retry}</button></div></>;

  const workdays = weeks.flatMap((w) => weekDays(w));
  const thisWeekDays = weekDays(cur).filter((d) => d <= t);
  const logged = thisWeekDays.map(val).filter((v): v is number => v != null);
  const total = logged.reduce((s, v) => s + v, 0);
  const onTarget = m.target != null ? logged.filter((v) => v >= m.target!).length : null;
  const streak = shutdownStreak(docs, t);

  const rows = weeks.map((w) => {
    const ds = weekDays(w).filter((d) => d <= t);
    const vs = ds.map(val).filter((v): v is number => v != null);
    const sum = vs.reduce((s, v) => s + v, 0);
    const sd = ds.filter((d) => docs?.get(`day:${d}`)?.shutdown.done).length;
    const wd = ds.length;
    return { w, n: vs.length, sum, avg: vs.length ? sum / vs.length : null, hit: m.target != null ? vs.filter((v) => v >= m.target!).length : null, sd, wd };
  }).reverse();

  return (
    <>
      {head}
      <div className="stack">
        <div className="kpis" aria-label={`${m.name}, ${T.thisWeekKpi}`}>
          <div className="kpi lead">
            <div className="kpi-label">{m.kind === 'check' ? T.daysThisWeek : T.thisWeekKpi}</div>
            <div className="kpi-value num">{docs ? (m.kind === 'check' ? <span data-count={total}>{total}<small>/ {thisWeekDays.length}</small></span> : <span data-count={total}>{nf1.format(total)}<small>{m.unit}</small></span>) : <span className="skeleton" style={{ display: 'inline-block', width: 80, height: 30 }} />}</div>
            <div className="delta">{m.kind === 'number' && m.target != null ? T.againstFive(fmtVal(m.target * 7, m)) : rangeLabel(weekDays(cur)[0], weekDays(cur)[6])}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{m.kind === 'check' ? T.daysLogged : T.dailyAverage}</div>
            <div className="kpi-value num">{logged.length ? (m.kind === 'check' ? logged.length : <>{nf1.format(total / logged.length)}<small>{m.unit}</small></>) : <span className="muted">—</span>}</div>
            <div className="delta">{logged.length ? T.overLogged(logged.length) : T.nothingLogged}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{T.daysOnTarget}</div>
            <div className="kpi-value num">{onTarget != null ? <>{onTarget}<small>/ {logged.length}</small></> : <span className="muted">—</span>}</div>
            <div className="delta">{m.target != null ? T.targetADay(fmtVal(m.target, m)) : T.noTarget}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{T.streak}</div>
            <div className="kpi-value num">{docs ? <>{streak}<small>{T.workdays(streak)}</small></> : '—'}</div>
            <div className="delta">{T.inARow}</div>
          </div>
        </div>

        <section className="panel" aria-labelledby="chart-h">
          <div className="chart-head">
            <h2 id="chart-h" style={{ fontSize: 16, fontWeight: 500 }}>{m.kind === 'check' ? T.daysPerWeek(m.name) : T.perWorkday(m.name)}</h2>
            <span className="meta">{rangeLabel(from, to)} · {T.thisWeekInBlue}</span>
          </div>
          {docs ? (
            m.kind === 'check' ? (
              <Chart label={T.daysPerWeek(m.name)} deps={[docs, m.id, span, T.locale]} draw={(el, C) => C.bars(el, {
                labels: weeks.map((w) => T.wk(weekNumber(w))),
                values: weeks.map((w) => weekDays(w).map(val).filter((v) => v === 1).length),
                highlight: weeks.length - 1, colour: themeColor('--hue'), mutedColour: themeColor('--chart-1'), height: 220,
              })} />
            ) : (
              <Chart label={T.perWorkday(m.name)} deps={[docs, m.id, span, T.locale]} draw={(el, C) => C.bars(el, {
                labels: workdays.map((d) => shortDate(d)),
                values: workdays.map((d) => val(d) ?? 0),
                highlight: workdays.map((d, i) => (weekOf(d) === cur ? i : -1)).filter((i) => i >= 0),
                colour: themeColor('--hue'), mutedColour: themeColor('--chart-1'), height: 240,
                format: (v: number) => fmtVal(v, m),
                tickFormat: (v: number) => nf1.format(v),
                xAt: workdays.map((_, i) => (i % (el.clientWidth < 640 ? 10 : 5) === 0 ? i : -1)).filter((i) => i >= 0),
                reference: m.target != null ? { value: m.target, label: T.target(fmtVal(m.target, m)) } : undefined,
              })} />
            )
          ) : <div className="skeleton" style={{ height: 240 }} />}
        </section>

        <Subjects docs={docs} from={from} to={to} />
        <PlanReality docs={docs} />

        <section className="panel flush" aria-labelledby="byweek-h">
          <header><h2 id="byweek-h">{T.byWeek}</h2><span className="meta">{T.newestFirst}</span></header>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{T.weekCol}</th>
                <th className="n">{m.kind === 'check' ? T.daysCol : T.totalCol}</th>
                {m.kind === 'number' && <th className="n hide-phone">{T.averageCol}</th>}
                {m.target != null && <th className="n">{T.onTargetCol}</th>}
                <th className="n">{T.shutdownsCol}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.w} className={r.w === cur ? 'is-current' : undefined}>
                  <td><a href={`/week/${r.w}`} onClick={onLinkClick}><b style={{ fontWeight: 500 }}>{T.weekN(weekNumber(r.w))}</b></a> <span className="muted hide-phone">· {rangeLabel(weekDays(r.w)[0], weekDays(r.w)[6])}</span></td>
                  <td className="n">{r.n ? (m.kind === 'check' ? T.of(r.sum, r.n) : fmtVal(r.sum, m)) : <span className="muted">—</span>}</td>
                  {m.kind === 'number' && <td className="n hide-phone">{r.avg != null ? fmtVal(r.avg, m) : <span className="muted">—</span>}</td>}
                  {m.target != null && <td className="n">{r.n ? T.of(r.hit ?? 0, r.n) : <span className="muted">—</span>}</td>}
                  <td className="n">{r.wd ? T.of(r.sd, r.wd) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Finding({ m, val, cur, fmtVal }: { m: MetricDef; val: (d: string) => number | null; cur: string; fmtVal: (v: number, m: MetricDef) => string }) {
  const T = useT();
  const t = today();
  const ds = weekDays(cur).filter((d) => d <= t);
  const vs = ds.map(val);
  if (m.kind === 'check') return <>{T.checkFinding(m.name, vs.filter((v) => v === 1).length, ds.length)}</>;
  const sum = vs.filter((v): v is number => v != null).reduce((s, v) => s + v, 0);
  if (m.target == null) return <>{T.sumFinding(fmtVal(sum, m), m.name)}</>;
  const workdaysSoFar = ds.length;
  const due = m.target * workdaysSoFar;
  const gap = sum - due;
  return <>{T.gapFinding(fmtVal(sum, m), m.name, gap, fmtVal(Math.abs(gap), m), fmtVal(due, m))}</>;
}

/** Days in a row with the shutdown done, counting back from today (today counts only once it is done). */
function shutdownStreak(docs: Map<string, DayDoc> | null, t: string): number {
  if (!docs) return 0;
  let d = t, n = 0;
  if (!docs.get(`day:${d}`)?.shutdown.done) d = addDays(d, -1);
  for (let i = 0; i < 120; i++, d = addDays(d, -1)) {
    if (docs.get(`day:${d}`)?.shutdown.done) n++; else break;
  }
  return n;
}

/**
 * Where the time went, by subject: the hours planned in blocks with that subject (the plan as it stood at the end of
 * each day) and the part of them spent in focus sessions. One row per subject, longest first; the bar's light part is
 * planned, the dark part focused, both on one scale.
 */
function Subjects({ docs, from, to }: { docs: Map<string, DayDoc> | null; from: string; to: string }) {
  const T = useT();
  if (!docs) return null;
  const rows = new Map<string, { planned: number; focused: number }>();
  const row = (k: string) => rows.get(k) ?? rows.set(k, { planned: 0, focused: 0 }).get(k)!;
  for (const d of docs.values()) {
    for (const b of effectivePlan(d)) if (b.subject?.trim()) row(b.subject.trim()).planned += b.end - b.start;
    const all = d.columns.flatMap((c) => c.blocks);
    for (const x of d.focus?.sessions ?? []) {
      const subj = (x.subject ?? all.find((b) => b.id === x.blockId)?.subject)?.trim();
      if (subj) row(subj).focused += x.minutes;
    }
  }
  const list = [...rows.entries()].sort((a, b) => b[1].planned - a[1].planned || b[1].focused - a[1].focused);
  const max = Math.max(1, ...list.map(([, v]) => Math.max(v.planned, v.focused)));
  return (
    <section className="panel" aria-labelledby="subj-h">
      <div className="chart-head">
        <h2 id="subj-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.bySubject}</h2>
        {list.length > 0 && (
          <span className="subj-legend meta">
            <span><i className="planned" aria-hidden="true" />{T.plannedLbl}</span>
            <span><i className="focused" aria-hidden="true" />{T.focusedLbl}</span>
            <span>{rangeLabel(from, to)}</span>
          </span>
        )}
      </div>
      {list.length === 0 ? <p className="muted" style={{ margin: 0 }}>{T.noSubjects}</p> : (
        <table className="subj-table">
          <thead className="sr-only"><tr><th>{T.subject}</th><th>{T.plannedLbl}</th><th>{T.focusedLbl}</th></tr></thead>
          <tbody>
            {list.map(([name, v]) => (
              <tr key={name} title={`${name}: ${T.plannedLbl} ${duration(v.planned)} · ${T.focusedLbl} ${duration(v.focused)}`}>
                <th scope="row">{name}</th>
                <td className="bar-cell" aria-hidden="true">
                  <div className="bars">
                    <span className="bar planned" style={{ width: `${(v.planned / max) * 100}%` }} />
                    {v.focused > 0 && <span className="bar focused" style={{ width: `${(v.focused / max) * 100}%` }} />}
                  </div>
                </td>
                <td className="n num">{duration(v.planned)}<span className="muted"> · {duration(v.focused)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** How the plans held up over the period: a few plain findings from the revision columns (lib/insights.ts). */
function PlanReality({ docs }: { docs: Map<string, DayDoc> | null }) {
  const T = useT();
  if (!docs) return null;
  const ins = insights(docs.values());
  const pct = (a: number, b: number) => Math.round((a / Math.max(1, b)) * 100);
  const lines: React.ReactNode[] = [];
  if (ins.days >= 3) {
    lines.push(ins.revised === 0 ? <>{T.neverRevised(ins.days)}</> : <>{T.revisedDays(ins.revised, ins.days)}{ins.breakWindow ? T.breakWindow(clock(ins.breakWindow[0]), clock(ins.breakWindow[1])) : ''}.</>);
    for (const o of ins.overruns.slice(0, 3)) lines.push(<>{T.overrun(o.name, Math.round((o.ratio - 1) * 100), o.n)}</>);
    // the two halves of the day, only when they differ enough to mean something
    if (ins.morning.total >= 3 && ins.afternoon.total >= 3 && Math.abs(pct(ins.morning.kept, ins.morning.total) - pct(ins.afternoon.kept, ins.afternoon.total)) >= 10) lines.push(<>{T.halves(pct(ins.morning.kept, ins.morning.total), pct(ins.afternoon.kept, ins.afternoon.total))}</>);
    if (ins.deep.planned >= 60) lines.push(<>{T.deepDone(pct(ins.deep.done, ins.deep.planned), duration(ins.deep.done), duration(ins.deep.planned))}</>);
  }
  return (
    <section className="panel" aria-labelledby="pr-h">
      <div className="chart-head"><h2 id="pr-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.planReal}</h2></div>
      {lines.length === 0 ? <p className="muted" style={{ margin: 0 }}>{T.planRealEmpty}</p> : (
        <ul className="findings">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      )}
    </section>
  );
}
