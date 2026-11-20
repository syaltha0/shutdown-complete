import { useEffect, useState } from 'react';
import { useSettings } from '../App';
import { Chart, themeColor } from '../components/Chart';
import {
  addDays, addWeeks, quarterOf, quarterWeeks, rangeLabel, today, weekDays, weekNumber, weekOf, weekdayLong, weekdayShort, shortDate,
} from '../lib/dates';
import { useT } from '../lib/i18n';
import { effectivePlan, emptyDay, type DayDoc, type MetricDef } from '../lib/model';
import { clock, duration } from '../lib/dates';
import { insights } from '../lib/insights';
import { focusMinutes } from '../lib/focus';
import { onLinkClick } from '../lib/router';
import { updateKey, useRange } from '../lib/useDoc';
import { Segmented } from '../components/Segmented';

type Span = '8w' | 'quarter';
const FOCUS_ID = '__focus';
const MINUS = '−';

export function Metrics() {
  const T = useT();
  const { settings } = useSettings();
  // completed focus sessions are a metric of their own, counted from the day's sessions
  const focusDef: MetricDef = { id: FOCUS_ID, name: T.focusMetric, kind: 'number', unit: T.mUnit, target: null };
  const defs = [...settings.metrics.filter(m => !m.archived), focusDef];
  const [metricId, setMetricId] = useState(defs[0]?.id ?? '');
  const [span, setSpan] = useState<Span>('8w');
  const nf1 = new Intl.NumberFormat(T.locale, { maximumFractionDigits: 1 });
  const fmtVal = (v: number, m: MetricDef) => `${nf1.format(v)}${m.unit ? ` ${m.unit}` : ''}`;
  const t = today();
  const cur = weekOf(t);
  const allWeeks = span === '8w'
    ? Array.from({ length: 8 }, (_, i) => addWeeks(cur, i - 7))
    : quarterWeeks(quarterOf(t)).filter((w) => w <= cur);
  // one week more than shown, for the comparison with the week before the first one
  const fetchFrom = weekDays(addWeeks(allWeeks[0], -1))[0], to = weekDays(allWeeks[allWeeks.length - 1])[6];
  const { docs, error, retry } = useRange<DayDoc>(`day:${fetchFrom}`, `day:${to}`);
  const m = defs.find((d) => d.id === metricId) ?? defs[0];

  const val = (d: string): number | null => {
    const doc = docs?.get(`day:${d}`);
    if (m.id === FOCUS_ID) { const f = doc ? focusMinutes(doc) : 0; return f || null; }
    const v = doc?.metrics[m.id];
    if (m.kind === 'check') return v === true ? 1 : v === false ? 0 : null;
    return typeof v === 'number' ? v : null;
  };

  // weeks before the first logged value are only empty space: drop them (but keep a few for a sense of time)
  const firstLogged = docs ? allWeeks.findIndex((w) => weekDays(w).some((d) => val(d) != null)) : -1;
  const weeks = firstLogged > 0 ? allWeeks.slice(Math.min(firstLogged, Math.max(0, allWeeks.length - 3))) : allWeeks;
  const from = weekDays(weeks[0])[0];

  const head = (
    <div className="title-row metric-title">
      <div>
        <h1>{T.metricsTitle}</h1>
        <p className="sub">{docs ? <Finding m={m} val={val} cur={cur} fmtVal={fmtVal} /> : ' '}</p>
        {docs && m && m.id !== FOCUS_ID && <TodayEntry m={m} doc={docs.get(`day:${t}`)} day={t} nf1={nf1} />}
      </div>
      <div className="title-actions metric-controls">
        <Segmented className={`sm metric-seg${defs.length > 6 ? ' many' : ''}`} role="group" aria-label={T.metric}>
          {defs.map((d) => <button key={d.id} type="button" aria-pressed={d.id === m?.id} onClick={() => setMetricId(d.id)}>{d.name}</button>)}
        </Segmented>
        <select className="input metric-select" aria-label={T.metric} value={m?.id} onChange={(e) => setMetricId(e.target.value)}>
          {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <Segmented className="sm" role="group" aria-label={T.period}>
          <button type="button" aria-pressed={span === '8w'} onClick={() => setSpan('8w')}>{T.eightWeeks}</button>
          <button type="button" aria-pressed={span === 'quarter'} onClick={() => setSpan('quarter')}>{T.thisQuarter}</button>
        </Segmented>
      </div>
    </div>
  );

  if (error) return <>{head}<div className="notice error">{T.couldntLoadDays} <button className="btn ghost" onClick={retry}>{T.retry}</button></div></>;

  const isCheck = m.kind === 'check';
  const workdays = weeks.flatMap((w) => weekDays(w));
  const thisWeekDays = weekDays(cur).filter((d) => d <= t);
  const prevWeekDays = weekDays(addWeeks(cur, -1)).slice(0, thisWeekDays.length);
  const stats = (ds: string[]) => {
    const vs = ds.map(val).filter((v): v is number => v != null);
    const sum = vs.reduce((s, v) => s + v, 0);
    return { n: vs.length, sum, avg: vs.length ? sum / vs.length : null, hit: m.target != null ? vs.filter((v) => v >= m.target!).length : null };
  };
  const now = stats(thisWeekDays), before = stats(prevWeekDays);
  const total = now.sum;
  const streak = shutdownStreak(docs, t);

  // this week against the same days of last week; a fall is the only thing that gets a colour
  const versus = (a: number | null, b: number | null, fmt: (v: number) => string) => {
    if (a == null || b == null || !before.n) return null;
    const d = Math.round((a - b) * 100) / 100;
    if (d === 0) return <span className="vs">{T.sameAsLastWeek}</span>;
    return <span className={`vs${d < 0 ? ' down' : ''}`}>{T.vsLastWeek(`${d > 0 ? '+' : MINUS}${fmt(Math.abs(d))}`)}</span>;
  };
  const fmtDays = (n: number) => `${nf1.format(n)} ${T.workdays(n)}`;
  const fmtSum = (v: number) => (isCheck ? fmtDays(v) : fmtVal(v, m));

  const rows = weeks.map((w) => {
    const ds = weekDays(w).filter((d) => d <= t);
    const s = stats(ds);
    const sd = ds.filter((d) => docs?.get(`day:${d}`)?.shutdown.done).length;
    return { w, n: s.n, sum: s.sum, avg: s.avg, hit: s.hit, sd, wd: ds.length };
  }).reverse();

  // docs inside the shown weeks only (the comparison week stays out of the other panels)
  const shown = docs ? new Map([...docs].filter(([k]) => k >= `day:${from}` && k <= `day:${to}`)) : null;

  return (
    <>
      {head}
      <div className="stack metrics">
        <div className="kpis metric-kpis" aria-label={`${m.name}, ${T.thisWeekKpi}`}>
          <div className="kpi lead">
            <div className="kpi-label">{isCheck ? T.daysThisWeek : T.thisWeekKpi}</div>
            <div className="kpi-value num">{docs ? (isCheck ? <span data-count={total}>{total}<small>/{thisWeekDays.length}</small></span> : <span data-count={total}>{nf1.format(total)}<small>{m.unit}</small></span>) : <span className="skeleton" style={{ display: 'inline-block', width: 80, height: 28 }} />}</div>
            <div className="delta">{docs && (versus(total, before.sum, fmtSum) ?? (m.kind === 'number' && m.target != null ? T.againstFive(fmtVal(m.target * 7, m)) : rangeLabel(weekDays(cur)[0], weekDays(cur)[6])))}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{isCheck ? T.daysLogged : T.dailyAverage}</div>
            <div className="kpi-value num">{now.n ? (isCheck ? now.n : <>{nf1.format(total / now.n)}<small>{m.unit}</small></>) : <span className="muted">—</span>}</div>
            <div className="delta">{now.n ? (!isCheck && versus(now.avg, before.avg, (v) => fmtVal(v, m))) || T.overLogged(now.n) : T.nothingLogged}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{T.daysOnTarget}</div>
            <div className="kpi-value num">{now.hit != null ? <>{now.hit}<small>/{now.n}</small></> : <span className="muted">—</span>}</div>
            <div className="delta">{m.target != null ? (versus(now.hit, before.hit, fmtDays) ?? T.targetADay(fmtVal(m.target, m))) : T.noTarget}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{T.streak}</div>
            <div className="kpi-value num">{docs ? <>{streak}<small>{T.workdays(streak)}</small></> : '—'}</div>
            <div className="delta">{T.inARow}</div>
          </div>
        </div>



        <section className="panel" aria-labelledby="chart-h">
          <div className="chart-head">
            <h2 id="chart-h" style={{ fontSize: 16, fontWeight: 500 }}>{isCheck ? T.checkGridHead(m.name) : T.perWorkday(m.name)}</h2>
            <span className="meta">{rangeLabel(from, to)}{!isCheck && ` · ${T.thisWeekInBlue}`}</span>
          </div>
          {docs ? (
            isCheck ? <CheckGrid weeks={weeks} val={val} today={t} cur={cur} /> : (
              <Chart label={T.perWorkday(m.name)} deps={[docs, m.id, span, T.locale, weeks.length]} draw={(el, C) => {
                const step = Math.max(1, Math.ceil((weeks.length * 66) / Math.max(1, el.clientWidth)));
                return C.bars(el, {
                  labels: workdays.map((d) => shortDate(d)),
                  values: workdays.map((d) => val(d)),
                  highlight: workdays.map((d, i) => (weekOf(d) === cur ? i : -1)).filter((i) => i >= 0),
                  colour: themeColor('--hue'), mutedColour: themeColor('--chart-1'), height: el.clientWidth < 520 ? 200 : 240,
                  format: (v: number) => fmtVal(v, m),
                  tickFormat: (v: number) => nf1.format(v),
                  // a label on each Monday, every few weeks as the width allows, counted back from this week
                  xAt: workdays.map((_, i) => (i % 7 === 0 && (weeks.length - 1 - i / 7) % step === 0 ? i : -1)).filter((i) => i >= 0),
                  reference: m.target != null ? { value: m.target, label: T.target(fmtVal(m.target, m)) } : undefined,
                });
              }} />
            )
          ) : <div className="skeleton" style={{ height: 240 }} />}
        </section>

        {shown && <Weekdays weeks={weeks} val={val} today={t} cur={cur} isCheck={isCheck} fmt={(v) => fmtVal(v, m)} nf1={nf1} />}
        <Subjects docs={shown} from={from} to={to} />
        <PlanReality docs={shown} />

        <section className="panel flush" aria-labelledby="byweek-h">
          <header><h2 id="byweek-h">{T.byWeek}</h2><span className="meta">{T.newestFirst}</span></header>
          <table className="byweek" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{T.weekCol}</th>
                <th className="n">{isCheck ? T.daysCol : T.totalCol}</th>
                {m.kind === 'number' && <th className="n hide-phone">{T.averageCol}</th>}
                {m.target != null && <th className="n">{T.onTargetCol}</th>}
                <th className="n">{T.shutdownsCol}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.w} className={r.w === cur ? 'is-current' : undefined}>
                  <td><a href={`/week/${r.w}`} onClick={onLinkClick}><b style={{ fontWeight: 500 }}>{T.weekN(weekNumber(r.w))}</b></a> <span className="muted hide-phone">· {rangeLabel(weekDays(r.w)[0], weekDays(r.w)[6])}</span></td>
                  <td className="n">{r.n ? (isCheck ? T.of(r.sum, r.n) : fmtVal(r.sum, m)) : <span className="muted">—</span>}</td>
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

/**
 * Today's value of the chosen metric, entered here: a box for a number, a toggle for a check. It writes the day
 * document like every other screen does (the Day, the habit grid), so the figures above follow at once.
 */
function TodayEntry({ m, doc, day, nf1 }: { m: MetricDef; doc: DayDoc | undefined; day: string; nf1: Intl.NumberFormat }) {
  const T = useT();
  const stored = doc?.metrics[m.id];
  const shownValue = typeof stored === 'number' ? nf1.format(stored).replace(/ /g, '') : '';
  const [draft, setDraft] = useState(shownValue);
  // follow the stored value when it changes elsewhere (or after our own write)
  useEffect(() => { setDraft(shownValue); }, [shownValue, m.id]);
  const write = (v: number | boolean | null) => updateKey<DayDoc>(`day:${day}`, emptyDay, (d) => {
    const next = { ...d.metrics };
    if (v == null) delete next[m.id]; else next[m.id] = v;
    return { ...d, metrics: next };
  });
  const commit = () => {
    const txt = draft.trim().replace(',', '.');
    if (txt === '') { if (typeof stored === 'number') write(null); return; }
    const n = Number(txt);
    if (!Number.isFinite(n) || n < 0) { setDraft(shownValue); return; }
    if (n !== stored) write(Math.round(n * 100) / 100);
    else setDraft(shownValue);
  };
  return (
    <div className="today-entry" role="group" aria-label={T.logToday}>
      <span className="te-label">{T.logToday}</span>
      {m.kind === 'check' ? (
        <button type="button" className={`btn te-check${stored === true ? ' on' : ''}`} aria-pressed={stored === true} onClick={() => write(stored !== true)}>
          {stored === true ? T.doneToday : T.markDoneToday}
        </button>
      ) : (
        <>
          <label className="te-field">
            <span className="sr-only">{T.logTodayHint(m.name)}</span>
            <input className="input num" inputMode="decimal" autoComplete="off" value={draft} placeholder="0"
              onChange={(e) => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} />
            {m.unit && <span className="muted">{m.unit}</span>}
          </label>
          {typeof stored === 'number' && <button type="button" className="btn ghost" onClick={() => write(null)}>{T.clearToday}</button>}
        </>
      )}
    </div>
  );
}

/** A check metric, week by week: seven squares for each week, filled where it was done. */
function CheckGrid({ weeks, val, today: t, cur }: { weeks: string[]; val: (d: string) => number | null; today: string; cur: string }) {
  const T = useT();
  const heads = weekDays(cur).map((d) => weekdayShort(d).slice(0, 2));
  return (
    <div className="daygrid">
      <div className="dg-row dg-head" aria-hidden="true">
        <span />
        <span className="dg-cells">{heads.map((h, i) => <span key={i}>{h}</span>)}</span>
        <span />
      </div>
      {weeks.map((w) => {
        const ds = weekDays(w);
        const past = ds.filter((d) => d <= t);
        const n = past.filter((d) => val(d) === 1).length;
        return (
          <div key={w} className={`dg-row${w === cur ? ' cur' : ''}`} role="img" aria-label={T.gridRow(T.wk(weekNumber(w)), n, past.length)}>
            <span className="dg-wk">{T.wk(weekNumber(w))}</span>
            <span className="dg-cells">
              {ds.map((d) => {
                const v = d > t ? undefined : val(d);
                return <i key={d} className={v === 1 ? 'on' : v === 0 ? 'off' : v === null ? 'none' : 'future'} title={`${weekdayShort(d)} ${shortDate(d)}`} />;
              })}
            </span>
            <span className="dg-n num">{n}/{past.length}</span>
          </div>
        );
      })}
      <p className="meta dg-legend">{T.gridLegend}</p>
    </div>
  );
}

/** Which day of the week is the strongest: the average over the weeks shown, a bar for each weekday. */
function Weekdays({ weeks, val, today: t, cur, isCheck, fmt, nf1 }: {
  weeks: string[]; val: (d: string) => number | null; today: string; cur: string; isCheck: boolean; fmt: (v: number) => string; nf1: Intl.NumberFormat;
}) {
  const T = useT();
  const names = weekDays(cur);
  const avg = names.map((_, i) => {
    const vs = weeks.map((w) => weekDays(w)[i]).filter((d) => d <= t).map(val).filter((v): v is number => v != null);
    return { n: vs.length, v: vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length : null };
  });
  const total = avg.reduce((s, a) => s + a.n, 0);
  if (total < 7) return null;
  const max = Math.max(...avg.map((a) => a.v ?? 0));
  if (max <= 0) return null;
  const best = avg.findIndex((a) => a.v === max);
  const show = (v: number) => (isCheck ? T.shareOfDays(Math.round(v * 100)) : fmt(v));
  return (
    <section className="panel" aria-labelledby="wd-h">
      <div className="chart-head">
        <h2 id="wd-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.byWeekday}</h2>
        <span className="meta">{T.weekdayAvgNote}</span>
      </div>
      <p className="wd-best">{T.weekdayBest(weekdayLong(names[best]), show(max))}</p>
      <ol className="wd-strip">
        {avg.map((a, i) => (
          <li key={i} className={i === best ? 'best' : undefined} title={`${weekdayLong(names[i])}: ${a.v != null ? show(a.v) : '—'}`}>
            <span className="wd-track" aria-hidden="true"><i style={{ height: `${a.v != null ? Math.max(3, (a.v / max) * 100) : 0}%` }} /></span>
            <span className="wd-caption"><span className="wd-val num">{a.v != null ? (isCheck ? `${Math.round(a.v * 100)}%` : nf1.format(a.v)) : '—'}</span>
            <span className="wd-day">{weekdayShort(names[i])}</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
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
 * planned, the dark part focused, both on one scale. With nothing to show it is one quiet line, not a card.
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
  if (list.length === 0) return <p className="empty-line"><b>{T.bySubject}</b>{T.noSubjects}</p>;
  const max = Math.max(1, ...list.map(([, v]) => Math.max(v.planned, v.focused)));
  return (
    <section className="panel" aria-labelledby="subj-h">
      <div className="chart-head">
        <h2 id="subj-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.bySubject}</h2>
        <span className="subj-legend meta">
          <span><i className="planned" aria-hidden="true" />{T.plannedLbl}</span>
          <span><i className="focused" aria-hidden="true" />{T.focusedLbl}</span>
          <span>{rangeLabel(from, to)}</span>
        </span>
      </div>
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
  if (lines.length === 0) return <p className="empty-line"><b>{T.planReal}</b>{T.planRealEmpty}</p>;
  return (
    <section className="panel" aria-labelledby="pr-h">
      <div className="chart-head"><h2 id="pr-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.planReal}</h2></div>
      <ul className="findings">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </section>
  );
}
