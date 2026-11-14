import { addDays, longDate } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function Streak({ T, day, t, docOf, recent, B }: OverviewData) {
  let streak = 0;
  for (
    let d = day?.shutdown.done ? t : addDays(t, -1);
    streak < 60 && docOf(d)?.shutdown.done;
    d = addDays(d, -1)
  )
    streak++;
  return (
    <section className="panel b-streak">
      <h2>{T.streak}</h2>
      <strong className="b-number">{streak ? B.days(streak) : "–"}</strong>
      <div className="b-dots">
        {[...recent].reverse().map((d) => (
          <a
            key={d}
            href={`/day/${d}`}
            onClick={onLinkClick}
            title={longDate(d)}
            aria-label={longDate(d)}
            className={docOf(d)?.shutdown.done ? "on" : ""}
          />
        ))}
      </div>
    </section>
  );
}
