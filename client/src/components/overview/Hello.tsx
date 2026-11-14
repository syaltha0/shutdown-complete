import { useState } from "react";
import { useAccount } from "../../App";
import { clock, duration } from "../../lib/dates";
import { settingsFocus, startFocus, useFocusDay } from "../../lib/focus";
import { navigate, onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
import { activeColumn } from "../../lib/model";
import { addDays } from "../../lib/dates";
export function Hello({ T, settings, t, now, plan, B, day, docs }: OverviewData) {
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
  return <section className={`panel b-hello${side ? " has-side" : ""}`}>
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
    {failed && <span role="alert" className="b-hello-error">{T.helloFocusError}</span>}
    </div>
    {side && <aside className="b-hello-side" aria-label={side.title}>
      <h3>{side.title}</h3>
      <ul>{side.items.map(b => <li key={b.id}><span className="num">{clock(b.start)}</span><span className={b.kind === "deep" ? "deep" : undefined}>{b.label || T.untitledBlock}</span></li>)}</ul>
    </aside>}
  </section>;
}

const Chev = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
