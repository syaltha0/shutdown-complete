import { CardHead } from "./CardHead";
import { addDays, duration, fmtDay, longDate } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function LastDays({ t, docOf, recent, deep, B }: OverviewData) {
  const days = [...recent].reverse().map(date => {
    const doc = docOf(date);
    return { date, minutes: deep(doc), closed: !!doc?.shutdown.done, tasks: doc?.tasks.filter(x => x.done).length ?? 0 };
  });
  const max = Math.max(1, ...days.map(d => d.minutes));
  const total = days.reduce((n, d) => n + d.minutes, 0);
  const previous = recent.reduce((n, d) => n + deep(docOf(addDays(d, -7))), 0);
  const delta = total - previous;
  const hasData = days.some(d => d.minutes || d.tasks || d.closed);
  return <section className="panel b-recent">
    <CardHead title={B.recent} aside={<a className="b-act" href="/focus" onClick={onLinkClick}><span>{B.recentFocus}</span><span aria-hidden="true">›</span></a>} />
    {hasData ? <div className="b-recent-chart">
      <div className="b-bars">{days.map(d => {
        const label = `${longDate(d.date)} · ${duration(d.minutes)} · ${B.recentTasks(d.tasks)} · ${d.closed ? B.streakClosed : B.streakPending}`;
        const height = `${d.minutes / max * 100}%`;
        return <a key={d.date} aria-current={d.date === t ? "date" : undefined} href={`/day/${d.date}`} onClick={onLinkClick} aria-label={label} title={label}>
          <div className="b-recent-track"><i className={d.date === t ? "today" : ""} style={{height}} /><strong className="b-recent-value b-number-sm" style={{bottom:height}}>{d.minutes ? duration(d.minutes) : ""}</strong></div>
          <span className="b-recent-day">{fmtDay(d.date, {weekday:"short"})}{d.closed && <i className="b-recent-closed" aria-hidden="true" />}</span>
        </a>;
      })}</div>
    </div> : <p className="b-recent-empty">{B.recentEmpty}</p>}
    {hasData && <div className="b-recent-summary b-number-sm"><p>{B.recentTotal(duration(total), duration(Math.round(total / 7)), days.filter(d => d.closed).length)} · {B.recentDelta(`${delta < 0 ? '−' : '+'}${duration(Math.abs(delta))}`)}</p></div>}
  </section>;
}
