import { useEffect, useState } from "react";
import { clock, duration } from "../../lib/dates";
import { focusMinutes, secondsLeft, useFocusDay } from "../../lib/focus";
import { onLinkClick } from "../../lib/router";
import { OverviewRing } from "./Ring";
import { RoundAction } from "./RoundAction";
import type { OverviewData } from "./data";

export function FocusToday({ T, settings, day, B }: OverviewData) {
  const { active } = useFocusDay();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!active || active.pausedLeft != null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [active]);
  const metricId = settings.focus?.metricId ?? "deep";
  const goal = Math.max(0, (settings.metrics.find((m) => m.id === metricId)?.target ?? 0) * 60);
  const stored = day?.metrics[metricId];
  const focused = typeof stored === "number" ? Math.max(0, Math.round(stored * 60)) : day ? focusMinutes(day) : 0;
  const count = day?.focus?.sessions.length ?? 0;
  const complete = goal > 0 && focused >= goal;
  // the latest sessions, newest first, beside the ring
  const recent = [...(day?.focus?.sessions ?? [])].reverse().slice(0, 1);
  // nothing yet today: one round action instead of a ring of dashes
  if (!active && !count && !focused) return <section className="panel b-focus is-empty" aria-labelledby="overview-focus-title" data-complete={false}>
    <h2 id="overview-focus-title">{B.focus}</h2>
    <RoundAction href="/focus" icon="play" title={T.startFocus} hint={B.roundFocus} />
  </section>;
  return <section className="panel b-focus" aria-labelledby="overview-focus-title" data-complete={complete}>
    <h2 id="overview-focus-title">{B.focus}</h2>
    <OverviewRing value={focused} total={goal} label={B.focus} text={focused ? duration(focused) : "–"} complete={complete} />
    <div className="b-rt-body">
      <dl className="b-figures">
        <div><dt>{B.focusSessionsLabel}</dt><dd className="num">{count}</dd></div>
        <div><dt>{B.focusRemaining}</dt><dd className="num">{goal ? (focused >= goal ? B.focusReached : duration(goal - focused)) : "–"}</dd></div>
        <div><dt>{B.focusLongest}</dt><dd className="num">{count ? duration(Math.max(...(day?.focus?.sessions ?? []).map(s => s.minutes))) : "–"}</dd></div>
      </dl>
      {active && <p className="b-rt-summary">{active ? `${T.phase[active.phase]} · ${B.left(B.focusMinutes(Math.ceil(secondsLeft(active, now) / 60)))}${active.pausedLeft != null ? ` · ${B.focusPaused}` : ""}` : [goal > 0 ? B.of(duration(goal)) : null, count > 0 ? B.focusSessions(count) : null].filter(Boolean).join(" · ") || B.noFocus}</p>}
      {recent.length > 0 && <ul className="b-rt-list">{recent.map(s => { const at = new Date(s.start); return <li key={s.id}><span className="num">{clock(at.getHours() * 60 + at.getMinutes())}</span><span className="b-truncate" title={s.label}>{s.label || T.freeFocus}</span><span className="num">{duration(s.minutes)}</span></li>; })}</ul>}
      <a className="b-act main" href="/focus" onClick={onLinkClick}><span>{active ? B.focusOpen : T.startFocus}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></a>
    </div>
  </section>;
}
