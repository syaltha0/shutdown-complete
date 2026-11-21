import { addDays, longDate } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function Streak({ T, day, t, docOf, B, now, plan }: OverviewData) {
  let streak = 0;
  for (let d = day?.shutdown.done ? t : addDays(t, -1);
    streak < 60 && docOf(d)?.shutdown.done; d = addDays(d, -1)) streak++;
  let best = 0, run = 0;
  for (let i = 89; i >= 0; i--) {
    run = docOf(addDays(t, -i))?.shutdown.done ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const elapsed = Number(t.slice(8));
  const count = Array.from({ length: elapsed }, (_, i) => addDays(t, -i)).filter(d => docOf(d)?.shutdown.done).length;
  const closed = !!day?.shutdown.done;
  const at = day?.shutdown.at ? new Date(day.shutdown.at) : null;
  const nearEnd = now >= (plan.length ? Math.max(...plan.map(b => b.end)) - 30 : 17 * 60);
  return <section className="panel b-streak">
    <h2>{T.streak}</h2>
    <div className="b-streak-summary"><strong className="b-streak-number">{streak}</strong><span>{B.streakUnit(streak)}</span></div>
    <div className="b-streak-days" aria-label={B.streakRecent}>
      {Array.from({ length: 14 }, (_, i) => addDays(t, i - 13)).map(d => {
        const done = !!docOf(d)?.shutdown.done;
        const weekend = [0, 6].includes(new Date(d + "T12:00:00").getDay());
        const label = `${longDate(d)} · ${done ? B.streakClosed : B.streakPending}`;
        return <a key={d} href={`/day/${d}`} onClick={onLinkClick} title={label} aria-label={label} aria-current={d === t ? "date" : undefined}
          className={[done ? "on" : "", weekend ? "weekend" : "", d === t ? "today" : ""].join(" ")} />;
      })}
    </div>
    <small className="b-streak-month">{B.streakMonth(count, elapsed)} · <span title={B.streakWindow}>{B.streakBest(best)}</span></small>
    {closed ? <span className="b-streak-status">{at && Number.isFinite(at.getTime()) ? B.streakDoneAt(at.toLocaleTimeString(T.locale, { hour: "2-digit", minute: "2-digit", hour12: false })) : B.streakClosed}</span>
      : <a className="b-act" href={`/shutdown/${t}`} onClick={onLinkClick}><span>{!streak ? B.streakStart : nearEnd ? B.streakRun : B.streakTonight}</span><span aria-hidden="true">›</span></a>}
  </section>;
}
