import { clock } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import { OverviewTimelineLabel } from "./TimelineLabel";
import type { OverviewData } from "./data";
export function Timeline({ T, settings, t, now, day, plan, B }: OverviewData) {
  const from = Math.min(settings.startHour * 60, plan[0]?.start ?? 1440);
  const to = Math.max(from + 60, settings.endHour * 60, plan.at(-1)?.end ?? 0);
  const at = (n: number) =>
    Math.max(0, Math.min(100, ((n - from) / (to - from)) * 100));
  const tick =
    [60, 120, 180, 240, 360].find((m) => (to - from) / m <= 6) ?? 360;
  return (
    <section className="panel b-timeline">
      <h2>{B.timeline}</h2>
      <a
        className="b-track"
        href={`/day/${t}`}
        onClick={onLinkClick}
        aria-label={B.timeline}
      >
        {plan.map((b) => (
          <i
            key={b.id}
            title={`${clock(b.start)}–${clock(b.end)} · ${b.label || T.untitledBlock}`}
            aria-label={`${clock(b.start)}–${clock(b.end)} · ${b.label || T.untitledBlock}`}
            className={b.kind === "deep" ? "deep" : ""}
            style={{
              left: `${at(b.start)}%`,
              width: `${at(b.end) - at(b.start)}%`,
            }}
          >
            {at(b.end) - at(b.start) >= 8 && (
              <OverviewTimelineLabel text={b.label || T.untitledBlock} />
            )}
          </i>
        ))}
        <b style={{ left: `${at(now)}%` }} />
        {(day?.focus?.sessions ?? []).map((s, i) => {
          const b = plan.find((b) => b.id === s.blockId);
          return b ? (
            <em
              key={i}
              style={{
                left: `${at(b.start)}%`,
                width: `${Math.min(at(b.end) - at(b.start), (s.minutes / (to - from)) * 100)}%`,
              }}
            />
          ) : null;
        })}
      </a>
      <div className="b-ticks">
        {Array.from(
          { length: Math.floor(to / tick) - Math.ceil(from / tick) + 1 },
          (_, i) => (Math.ceil(from / tick) + i) * tick,
        ).map((n) => (
          <span key={n} style={{ left: `${at(n)}%` }}>
            {clock(Math.round(n))}
          </span>
        ))}
      </div>
    </section>
  );
}
