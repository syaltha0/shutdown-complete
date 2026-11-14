import { useState } from "react";
import { useAccount } from "../../App";
import { clock, duration } from "../../lib/dates";
import { settingsFocus, startFocus, useFocusDay } from "../../lib/focus";
import { navigate, onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
import { activeColumn } from "../../lib/model";
import { weekdayOf, onItsWeek, isExcepted } from "../../lib/repeat";
import { useDoc } from "../../lib/useDoc";
import { emptyWeek, type WeekDoc } from "../../lib/model";
import { weekOf } from "../../lib/dates";
import { addDays } from "../../lib/dates";
export function Hello({ T, settings, t, now, plan, B, day, docs, docOf, monday }: OverviewData) {
  const { value: week } = useDoc<WeekDoc>(`week:${weekOf(t)}`, emptyWeek);
  const weekItems = week?.items.filter(x => !x.done && x.text.trim()).slice(0, 3) ?? [];
  const template = settings.templates?.find(x => x.days.includes(weekdayOf(t)));
  const scheduled = settings.schedule?.filter(x => x.days.includes(weekdayOf(t)) && x.since <= t && onItsWeek(x, t) && !isExcepted(settings.exceptions ?? [], t, x.id)).length ?? 0;
  const { user } = useAccount();
  const { active } = useFocusDay();
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const closed = !!day?.shutdown.done;
  const cur = closed ? undefined : plan.find(b => b.start <= now && b.end > now);
  const next = plan.find(b => b.start > now);
  const ended = plan.length > 0 && !cur && !next;
  const label = cur?.label || T.untitledBlock;
  const progress = cur ? Math.min(100, Math.max(0, (now - cur.start) / (cur.end - cur.start) * 100)) : 0;
  const at = day?.shutdown.at ? new Date(day.shutdown.at) : null;
  // the day in a line: the time it closed, the tasks done and, when there was any, the focus
  const focusedMin = (day?.focus?.sessions ?? []).reduce((sum, s) => sum + s.minutes, 0);
  const tasksDone = day?.tasks.filter(x => x.done).length ?? 0;
  const summary = focusedMin > 0 ? T.helloSummary(tasksDone, duration(focusedMin)) : T.helloTasksDone(tasksDone);
  // beside the greeting: the blocks still to come today, or the first ones of tomorrow once today is through
  const later = plan.filter(b => b.start > now).slice(cur ? 0 : 1, (cur ? 0 : 1) + 3);
  const tomorrowDoc = docs?.get(`day:${addDays(t, 1)}`);
  const tomorrow = later.length || !tomorrowDoc ? [] : [...activeColumn(tomorrowDoc).blocks].sort((a, b) => a.start - b.start).slice(0, 3);
  const side = later.length ? { title: B.helloUpNext, items: later } : tomorrow.length ? { title: B.helloTomorrow, items: tomorrow } : null;
  async function focus() {
    if (active) { navigate('/focus'); return; }
    if (!cur || starting) return;
    setStarting(true); setFailed(false);
    try {
      await startFocus({ blockId: cur.id, label, minutes: settingsFocus(settings).focusMin });
      navigate('/focus');
    } catch { setFailed(true); } finally { setStarting(false); }
  }
  // this week so far, Monday to today: days with a plan, minutes focused, days closed
  const weekDays = Array.from({ length: Math.round((Date.parse(t + "T12:00:00") - Date.parse(monday + "T12:00:00")) / 864e5) + 1 }, (_, i) => addDays(monday, i));
  const sofar = weekDays.reduce((w, d) => { const doc = docOf(d); return { days: w.days, planned: w.planned + (doc && doc.columns.some(c => c.blocks.length) ? 1 : 0), focus: w.focus + (doc?.focus?.sessions ?? []).reduce((n, x) => n + x.minutes, 0), closed: w.closed + (doc?.shutdown?.done ? 1 : 0) }; }, { days: weekDays.length, planned: 0, focus: 0, closed: 0 });
  return <section className={`panel b-hello has-side`}>
    <div className="b-hello-main">
    <h2>{B.greeting(Math.floor(now / 60), user.name.trim())}</h2>
    <div className="b-now" title={closed ? T.shutdownComplete : cur ? label : undefined}>
      {closed ? T.shutdownComplete : cur ? label : ended ? B.ended : next ? T.helloReady : T.helloNoPlan}
    </div>
    <div className="b-hello-detail muted">
      {closed ? <span>{at && Number.isFinite(at.getTime()) ? `${T.helloClosedAt(at.toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit', hour12: false }))} · ` : ''}{summary}</span>
        : cur ? <><div className="b-hello-time"><span>{clock(cur.start)}–{clock(cur.end)}</span><span>{B.left(duration(Math.ceil(cur.end - now)))}</span></div><div className="b-hello-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div></>
        : <span>{next ? T.helloFirst(clock(next.start)) : ended ? T.helloClose : T.helloMakeRoom}</span>}
      {!closed && next && !side && <span className="b-hello-next" title={next.label || T.untitledBlock}>{T.helloNext(next.label || T.untitledBlock, clock(next.start))}</span>}
    </div>
    <div className="b-actions">
      {cur ? <button type="button" className="b-act main" disabled={starting} onClick={focus}><span>{active ? T.helloResume : T.focusOn(label)}</span><Chev /></button>
        : !closed && <a className="b-act main" href={ended ? `/shutdown/${t}` : `/day/${t}`} onClick={onLinkClick}><span>{ended ? T.runShutdown : T.helloPlan}</span><Chev /></a>}
    </div>
    {!plan.length && (template || scheduled > 0) && <div className="b-hello-starts">
      {template && <a className="b-act" href={`/day/${t}`} onClick={onLinkClick}><span>{B.helloTemplate(template.name)}</span><Chev /></a>}
      {scheduled > 0 && <a className="b-act" href={`/day/${t}`} onClick={onLinkClick}><span>{B.helloSchedule(scheduled)}</span><Chev /></a>}
    </div>}
    <small className="b-hello-summary">{plan.length ? B.helloDaySummary(plan.length, duration(plan.filter(b => b.kind === "deep").reduce((n, b) => n + b.end - b.start, 0)), clock(plan[0].start), clock(Math.max(...plan.map(b => b.end)))) : B.helloStartHint}</small>
    {failed && <span role="alert" className="b-hello-error">{T.helloFocusError}</span>}
    </div>
    <aside className="b-hello-side" aria-label={side?.title ?? B.helloThisWeek}>
      {side ? <><h3>{side.title}</h3>
        <ul>{side.items.map(b => <li key={b.id}><span className="num">{clock(b.start)}</span><span className={b.kind === "deep" ? "deep" : undefined}>{b.label || T.untitledBlock}</span></li>)}</ul></>
        : !plan.length && weekItems.length > 0 && <><h3>{B.helloWeek}</h3><ul>{weekItems.map(x => <li className="b-hello-week-item" key={x.id}><a href={`/week/${weekOf(t)}`} onClick={onLinkClick}>{x.text}</a></li>)}</ul></>}
      {/* always there: the week so far in three figures, meaningful even on a brand-new account */}
      <h3 className="b-hello-week-title">{B.helloThisWeek}</h3>
      <dl className="b-hello-week">
        <div><dt>{B.helloWeekPlanned}</dt><dd className="num">{sofar.planned}/{sofar.days}</dd></div>
        <div><dt>{B.helloWeekFocus}</dt><dd className="num">{sofar.focus ? duration(sofar.focus) : "–"}</dd></div>
        <div><dt>{B.helloWeekClosed}</dt><dd className="num">{sofar.closed}</dd></div>
      </dl>
    </aside>
  </section>;
}

const Chev = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
