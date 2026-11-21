import { CardHead } from "./CardHead";
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
    [60, 120, 180, 240, 360].find((m) => (to - from) / m <= 4) ?? 360;
  return (
    <section className="panel b-timeline">
      <CardHead title={B.timeline} aside={(day?.columns.length ?? 0) > 1 ? B.timelineRevision(day!.columns.length - 1) : undefined} />
      <div className={`b-track${plan.length ? "" : " is-empty"}`} role="group" aria-label={B.timeline}>
        {Array.from({ length: Math.floor(to / tick) - Math.ceil(from / tick) + 1 }, (_, i) => (Math.ceil(from / tick) + i) * tick).map(n => <span key={n} className="b-time-grid" aria-hidden="true" style={{ left: `${at(n)}%` }} />)}
        {/* the empty message sits in the wider stretch beside the now line, so the two never meet */}
        {!plan.length && <a className="b-empty-plan" href={`/day/${t}`} onClick={onLinkClick} style={now >= from && now <= to ? { left: `${at(now) < 50 ? (at(now) + 100) / 2 : at(now) / 2}%` } : undefined}>{B.timelineEmpty}</a>}
        {plan.map((b) => {
          const minutes = (day?.focus?.sessions ?? []).filter(s => s.blockId === b.id).reduce((sum, s) => sum + s.minutes, 0);
          const description = B.timelineBlock(b.label || T.untitledBlock, clock(b.start), clock(b.end), minutes);
          return <a key={b.id} href={`/day/${t}`} onClick={onLinkClick}
            title={description} aria-label={description} className={`b-timeline-block ${b.kind} ${b.end <= now ? "past" : b.start <= now ? "current" : ""}`}
            style={{left: `${at(b.start)}%`, width: `${at(b.end) - at(b.start)}%`}}>
            <i>{at(b.end) - at(b.start) >= 8 && <OverviewTimelineLabel text={b.label || T.untitledBlock} />}</i>
            <span className="b-timeline-tip" aria-hidden="true">{description}</span>
          </a>;
        })}
        {now >= from && now <= to && <b aria-hidden="true" style={{ left: `${at(now)}%` }}><span>{clock(now)}</span></b>}
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
      </div>
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
