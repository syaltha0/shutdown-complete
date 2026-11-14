import { useState } from "react";
import { useAccount } from "../../App";
import { clock, duration } from "../../lib/dates";
import { settingsFocus, startFocus, useFocusDay } from "../../lib/focus";
import { navigate, onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function Hello({ T, settings, t, now, plan, B, day }: OverviewData) {
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
  async function focus() {
    if (active) { navigate('/focus'); return; }
    if (!cur || starting) return;
    setStarting(true); setFailed(false);
    try {
      await startFocus({ blockId: cur.id, label, minutes: settingsFocus(settings).focusMin });
      navigate('/focus');
    } catch { setFailed(true); } finally { setStarting(false); }
  }
  return <section className="panel b-hello">
    <h2>{B.greeting(Math.floor(now / 60), user.name.trim())}</h2>
    <div className="b-now" title={closed ? T.shutdownComplete : cur ? label : undefined}>
      {closed ? T.shutdownComplete : cur ? label : ended ? B.ended : next ? T.helloReady : T.helloNoPlan}
    </div>
    <div className="b-hello-detail muted">
      {closed ? <span>{at && Number.isFinite(at.getTime()) ? `${T.helloClosedAt(at.toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit', hour12: false }))} · ` : ''}{summary}</span>
        : cur ? <><div className="b-hello-time"><span>{clock(cur.start)}–{clock(cur.end)}</span><span>{B.left(duration(Math.ceil(cur.end - now)))}</span></div><div className="b-hello-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div></>
        : <span>{next ? T.helloFirst(clock(next.start)) : ended ? T.helloClose : T.helloMakeRoom}</span>}
      {!closed && next && <span className="b-hello-next" title={next.label || T.untitledBlock}>{T.helloNext(next.label || T.untitledBlock, clock(next.start))}</span>}
    </div>
    <div className="b-actions">
      {cur ? <button className="btn primary" disabled={starting} onClick={focus}>{active ? T.helloResume : T.focusOn(label)}</button>
        : !closed && <a className="btn primary" href={ended ? `/shutdown/${t}` : `/day/${t}`} onClick={onLinkClick}>{ended ? T.runShutdown : T.helloPlan}</a>}
      <a className="btn" href={`/day/${t}`} onClick={onLinkClick}>{T.openToday}</a>
    </div>
    {failed && <span role="alert" className="b-hello-error">{T.helloFocusError}</span>}
  </section>;
}
