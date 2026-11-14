import { addDays, duration, fmtDay, longDate, monthOf } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import { heatLevel } from "../../lib/year";
import type { OverviewData } from "./data";
export function Weeks({ t, docOf, deep, B, monday }: OverviewData) {
  const heatStart = addDays(
    t,
    -77 - ((new Date(t + "T12:00:00").getDay() + 6) % 7),
  );
  const heatDays = Array.from({ length: 84 }, (_, i) => addDays(heatStart, i));
  const weekTotals = Array.from({ length: 12 }, (_, w) =>
    heatDays.slice(w * 7, w * 7 + 7).reduce((n, d) => n + deep(docOf(d)), 0),
  );
  const heatTotal = weekTotals.reduce((a, b) => a + b, 0);
  return (
    <section className="panel b-heat">
      <h2>{B.weeks}</h2>
      <div className="b-heat-months">
        {Array.from({ length: 12 }, (_, w) => {
          const d = heatDays[w * 7];
          return (
            <span key={d}>
              {w === 0 || monthOf(d) !== monthOf(heatDays[(w - 1) * 7])
                ? fmtDay(d, { month: "short" })
                : ""}
            </span>
          );
        })}
      </div>
      <div className="b-heat-body">
        <div className="b-heat-days">
          {[0, 2, 4].map((i) => (
            <small key={i} style={{ gridRow: i + 1 }}>
              {fmtDay(addDays(monday, i), { weekday: "narrow" })}
            </small>
          ))}
        </div>
        <div className="b-heatmap">
          {heatDays.map((d) => {
            const n = d > t ? 0 : deep(docOf(d));
            return (
              <a
                key={d}
                href={`/day/${d}`}
                onClick={onLinkClick}
                className={`year-cell heat-${heatLevel(n)}`}
                title={`${longDate(d)} · ${duration(n)}`}
                aria-label={`${longDate(d)} · ${duration(n)}`}
              />
            );
          })}
        </div>
      </div>
      <p>
        {heatTotal
          ? B.history(duration(heatTotal), duration(Math.max(...weekTotals)))
          : B.noHistory}
      </p>
    </section>
  );
}
