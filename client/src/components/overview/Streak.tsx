import { CardHead } from "./CardHead";
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
  // the streak tile (user, 2026-11-21): the run as one big figure, the last two weeks as the squares the habits use
  // (two rows of seven, today ringed), this month and the best run as two small figures, the evening's action last
  return <section className={`panel b-streak${closed ? " is-closed" : ""}`}>
    <CardHead title={<>{T.streak}</>} />
    <div className="b-streak-top">
      <div className="b-streak-summary"><strong className="b-streak-number num b-number-lg">{streak}</strong><span>{B.streakUnit(streak)}</span></div>
      <dl className="b-streak-stats b-number-sm">
        <div><dt>{B.streakMonthLabel}</dt><dd className="num">{count}<small>/{elapsed}</small></dd></div>
        <div title={B.streakWindow}><dt>{B.streakBestLabel}</dt><dd className="num">{best}</dd></div>
      </dl>
    </div>
    <div className="b-streak-days" aria-label={B.streakRecent}>
      {Array.from({ length: 14 }, (_, i) => addDays(t, i - 13)).map(d => {
        const done = !!docOf(d)?.shutdown.done;
        const weekend = [0, 6].includes(new Date(d + "T12:00:00").getDay());
        const label = `${longDate(d)} · ${done ? B.streakClosed : B.streakPending}`;
        return <a key={d} href={`/day/${d}`} onClick={onLinkClick} title={label} aria-label={label} aria-current={d === t ? "date" : undefined}
          className={[done ? "on" : "", weekend ? "weekend" : "", d === t ? "today" : ""].join(" ")} />;
      })}
    </div>
    {closed ? <span className="b-streak-status">{at && Number.isFinite(at.getTime()) ? B.streakDoneAt(at.toLocaleTimeString(T.locale, { hour: "2-digit", minute: "2-digit", hour12: false })) : B.streakClosed}</span>
      : <a className="b-act" href={`/shutdown/${t}`} onClick={onLinkClick}><span>{!streak ? B.streakStart : nearEnd ? B.streakRun : B.streakTonight}</span><span aria-hidden="true">›</span></a>}
  </section>;
}
