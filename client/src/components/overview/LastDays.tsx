import { duration, fmtDay, longDate } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function LastDays({ T, t, docOf, recent, deep, B }: OverviewData) {
  const max = Math.max(60, ...recent.map((d) => deep(docOf(d))));
  return (
    <section className="panel b-recent">
      <h2>{B.recent}</h2>
      <div className="b-bars">
        {[...recent].reverse().map((d) => (
          <a
            href={`/day/${d}`}
            key={d}
            onClick={onLinkClick}
            title={`${longDate(d)} · ${duration(deep(docOf(d)))}`}
          >
            <div>
              <i
                className={d === t ? "today" : d < t ? "past" : ""}
                style={{ height: `${(deep(docOf(d)) / max) * 100}%` }}
              />
            </div>
            <small>{fmtDay(d, { weekday: "short" })}</small>
          </a>
        ))}
      </div>
      <p>
        {recent.some((d) => deep(docOf(d)))
          ? B.week(duration(recent.reduce((n, d) => n + deep(docOf(d)), 0)))
          : T.overviewNoHistory}
      </p>
    </section>
  );
}
