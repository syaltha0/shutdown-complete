import { addDays, addMonths, fmtDay, monthOf } from "../../lib/dates";
import { emptyMonth, featureOn, type MonthDoc } from "../../lib/model";
import { onLinkClick } from "../../lib/router";
import { useDoc } from "../../lib/useDoc";
import { nextDate } from "../../screens/Countdown";
import type { OverviewData } from "./data";
export function Ahead({ settings, t, B, monday }: OverviewData) {
  const link = (href: string, text: string) => (
    <a href={href} onClick={onLinkClick}>
      {text}
    </a>
  );
  const { value: m0 } = useDoc<MonthDoc>(`month:${monthOf(t)}`, emptyMonth);
  const { value: m1 } = useDoc<MonthDoc>(
    `month:${addMonths(monthOf(t), 1)}`,
    emptyMonth,
  );
  const ahead = [
    ...(settings.exams ?? []).map((x) => ({
      id: `e${x.id}`,
      date: x.date,
      text: x.name,
      href: `/month/${monthOf(x.date)}`,
    })),
    ...[...(m0?.dates ?? []), ...(m1?.dates ?? [])].map((x) => ({
      ...x,
      href: `/month/${monthOf(x.date)}`,
    })),
    ...(featureOn(settings, "countdown")
      ? (settings.countdowns ?? [])
      : []
    ).map((x) => ({
      id: `c${x.id}`,
      date: nextDate(x, t),
      text: x.name,
      href: "/countdown",
    })),
  ]
    .filter(
      (x, i, all) =>
        all.findIndex((y) => y.date === x.date && y.text === x.text) === i,
    )
    .filter((x) => x.date >= t && x.date <= addDays(t, 14))
    .sort((a, b) => a.date.localeCompare(b.date));
  const calendar = Array.from({ length: 14 }, (_, i) => addDays(monday, i));
  return (
    <section className="panel b-ahead">
      <h2>{B.ahead}</h2>
      <div className="b-calendar">
        {calendar.slice(0, 7).map((d) => (
          <small key={`h${d}`}>{fmtDay(d, { weekday: "narrow" })}</small>
        ))}
        {calendar.map((d) => (
          <a
            key={d}
            href={`/day/${d}`}
            onClick={onLinkClick}
            className={d === t ? "today" : d < t ? "past" : ""}
          >
            <span>{Number(d.slice(-2))}</span>
            <i className={ahead.some((x) => x.date === d) ? "on" : ""} />
          </a>
        ))}
      </div>
      <div className="b-events">
        {ahead.slice(0, 3).map((x) => (
          <a key={x.id} href={x.href} onClick={onLinkClick}>
            <span>{x.text}</span>
            <small>
              {fmtDay(x.date, { month: "short", day: "numeric" })}{" · "}
              {B.inDays(
                Math.round((Date.parse(x.date) - Date.parse(t)) / 86400000),
              )}
            </small>
          </a>
        ))}
        {!ahead.length && link(`/month/${monthOf(t)}`, B.nothing)}
      </div>
    </section>
  );
}
