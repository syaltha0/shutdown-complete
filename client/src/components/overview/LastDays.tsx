import { addDays, duration, fmtDay, longDate } from "../../lib/dates";
import { settingsFocus } from "../../lib/focus";
import { onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function LastDays({ settings, t, docOf, recent, deep, B }: OverviewData) {
  const days = [...recent].reverse().map(date => {
    const doc = docOf(date);
    return { date, minutes: deep(doc), closed: !!doc?.shutdown.done, tasks: doc?.tasks.filter(x => x.done).length ?? 0 };
  });
  const target = settings.metrics.find(m => m.id === settingsFocus(settings).metricId)?.target;
  const goal = target && target > 0 ? Math.round(target * 60) : 0;
  const max = Math.max(60, goal * 1.25, ...days.map(d => d.minutes));
  const total = days.reduce((n, d) => n + d.minutes, 0);
  const previous = recent.reduce((n, d) => n + deep(docOf(addDays(d, -7))), 0);
  const delta = total - previous;
  const hasData = days.some(d => d.minutes || d.tasks || d.closed);
  return <section className="panel b-recent">
    <header><h2>{B.recent}</h2><a className="b-act" href="/focus" onClick={onLinkClick}><span>{B.recentFocus}</span><span aria-hidden="true">›</span></a></header>
    <div className="b-recent-chart">
      {goal > 0 && <div className="b-recent-goal" style={{ bottom: `${goal / max * 100}%` }}><span>{B.recentGoal(duration(goal))}</span></div>}
      <div className="b-bars">{days.map(d => <a key={d.date} href={`/day/${d.date}`} onClick={onLinkClick} aria-label={`${longDate(d.date)} · ${duration(d.minutes)} · ${B.recentTasks(d.tasks)} · ${d.closed ? B.streakClosed : B.streakPending}`} title={`${longDate(d.date)} · ${duration(d.minutes)} · ${B.recentTasks(d.tasks)} · ${d.closed ? B.streakClosed : B.streakPending}`}>
        <div className="b-recent-track"><i className={d.date === t ? 'today' : ''} style={{height: `${d.minutes / max * 100}%`}} /></div>
        <span className="b-recent-day">{fmtDay(d.date, {weekday:'short'})}{d.closed && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 6 3 3 5-6" /></svg>}</span>
        <small>{B.recentTasks(d.tasks)}</small>
      </a>)}</div>
    </div>
    {hasData ? <div className="b-recent-summary"><p>{B.recentTotal(duration(total), duration(Math.round(total / 7)), days.filter(d => d.closed).length)}</p><p>{B.recentDelta(`${delta < 0 ? '−' : '+'}${duration(Math.abs(delta))}`)}</p></div> : <p>{B.recentEmpty}</p>}
  </section>;
}
