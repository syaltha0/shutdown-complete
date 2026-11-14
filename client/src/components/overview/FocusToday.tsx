import { duration } from "../../lib/dates";

import { onLinkClick } from "../../lib/router";
import { OverviewRing } from "./Ring";
import type { OverviewData } from "./data";
export function FocusToday({ T, settings, day, deep, B }: OverviewData) {
  const link = (href: string, text: string) => (
    <a href={href} onClick={onLinkClick}>
      {text}
    </a>
  );
  const metricId = settings.focus?.metricId ?? "deep";
  const goal =
    (settings.metrics.find((m) => m.id === metricId)?.target ?? 0) * 60;
  const stored = day?.metrics[metricId];
  const focused =
    typeof stored === "number"
      ? Math.max(0, Math.round(stored * 60))
      : deep(day);
  return (
    <section className="panel b-focus">
      <h2>{B.focus}</h2>
      <OverviewRing
        value={focused}
        total={goal}
        label={B.focus}
        text={focused ? duration(focused) : "–"}
      />
      <p>{focused ? (goal ? B.of(duration(goal)) : B.focus) : B.noFocus}</p>
      {link("/focus", T.startFocus)}
    </section>
  );
}
