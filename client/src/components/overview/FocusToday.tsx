import { useEffect, useState } from "react";
import { duration } from "../../lib/dates";
import { focusMinutes, secondsLeft, useFocusDay } from "../../lib/focus";
import { onLinkClick } from "../../lib/router";
import { OverviewRing } from "./Ring";
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
  return <section className="panel b-focus" aria-labelledby="overview-focus-title" data-complete={complete}>
    <h2 id="overview-focus-title">{B.focus}</h2>
    <OverviewRing value={focused} total={goal} label={B.focus} text={B.focusMinutes(focused)} complete={complete} />
    <p className="b-focus-summary">{[goal > 0 ? B.of(duration(goal)) : null, B.focusSessions(count)].filter(Boolean).join(" ? ")}</p>
    <div className="b-focus-dots" aria-hidden="true">{Array.from({ length: Math.min(count, 8) }, (_, i) => <i key={i} />)}</div>
    <p className="b-focus-status" role={active ? "timer" : undefined} aria-live="off">{active ? `${T.phase[active.phase]} ? ${B.left(B.focusMinutes(Math.ceil(secondsLeft(active, now) / 60)))}${active.pausedLeft != null ? ` ? ${B.focusPaused}` : ""}` : focused ? complete ? B.focusComplete : B.focusLogged : B.noFocus}</p>
    <a className="btn" href="/focus" onClick={onLinkClick}>{active ? B.focusOpen : T.startFocus}</a>
  </section>;
}
