import { CardHead } from "./CardHead";
import { useEffect, useState } from "react";
import { clock, duration } from "../../lib/dates";
import { dayFocus, secondsLeft, useFocusDay } from "../../lib/focus";
import { onLinkClick } from "../../lib/router";
import { OverviewRing } from "./Ring";
import { RoundAction } from "./RoundAction";
import type { OverviewData } from "./data";

export function FocusToday({ T, settings, day, B, plan, now: minute }: OverviewData) {
  const { active } = useFocusDay();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!active || active.pausedLeft != null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [active]);
  const metricId = settings.focus?.metricId ?? "deep";
  const goal = Math.max(0, (settings.metrics.find(m => m.id === metricId)?.target ?? 0) * 60);
  const { minutes: focused, manual } = dayFocus(day, settings);
  const sessions = day?.focus?.sessions ?? [];
  const complete = goal > 0 && focused >= goal;
  const next = plan.find(b => b.kind === "deep" && b.start > minute);
  const nextLine = !active && next && <p className="b-focus-next" title={`${B.focusNext} ${clock(next.start)} ${next.label}`}><span>{B.focusNext}</span> <span className="num">{clock(next.start)}</span> {next.label}</p>;
  if (!active && !sessions.length && !focused) return <section className="panel b-focus is-empty" aria-labelledby="overview-focus-title" data-complete={false}>
    <CardHead id="overview-focus-title" title={B.focus} />
    <RoundAction href="/focus" icon="play" title={T.startFocus} hint={B.roundFocus} />
    {nextLine}
  </section>;
  return <section className="panel b-focus" aria-labelledby="overview-focus-title" data-complete={complete}>
    <CardHead id="overview-focus-title" title={B.focus} />
    <div className="b-rt-body">
      <div className="b-focus-main">
        <OverviewRing value={focused} total={goal} label={`${B.focus}: ${duration(focused)} / ${duration(goal)}`} text={goal ? `${Math.min(100, Math.round(focused / goal * 100))}%` : duration(focused)} complete={complete} />
        <div className="b-focus-values">
          {active ? <>
            <span className="b-focus-phase">{T.phase[active.phase]}{active.pausedLeft != null ? ` · ${B.focusPaused}` : ""}</span>
            <strong className="num b-number-lg b-rt-summary">{B.focusMinutes(Math.ceil(secondsLeft(active, now) / 60))}</strong>
          </> : <>
            <div className="b-focus-total"><strong className="num b-number-lg">{duration(focused)}</strong>{manual && <span className="b-focus-manual">{T.focusManual}</span>}</div>
            {goal > 0 && <span className="b-focus-goal">{complete ? B.focusReached : `${B.focusRemaining} ${duration(goal - focused)}`}</span>}
          </>}
      {active && <p className="b-focus-detail b-number-sm">{B.focusTodayTotal} <span className="num">{duration(focused)}</span>{manual && <span className="b-focus-manual">{T.focusManual}</span>}</p>}
      {!active && sessions.length > 0 && <p className="b-focus-detail b-number-sm">{B.focusSessions(sessions.length)} · {B.focusLongest} <span className="num">{duration(Math.max(...sessions.map(s => s.minutes)))}</span></p>}
        </div>
      </div>
      {nextLine}
      <a className="b-act main" href="/focus" onClick={onLinkClick}><span>{active ? B.focusOpen : T.startFocus}</span><span aria-hidden="true">›</span></a>
    </div>
  </section>;
}
