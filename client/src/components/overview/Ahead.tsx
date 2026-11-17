import { addDays, addMonths, fmtDay, monthOf } from "../../lib/dates";
import { activeColumn, emptyMonth, featureOn, type DayDoc, type MonthDoc } from "../../lib/model";
import { onLinkClick } from "../../lib/router";
import { useDoc, useRange } from "../../lib/useDoc";
import { nextDate } from "../../screens/Countdown";
import type { OverviewData } from "./data";
export function Ahead({ settings, t, B, monday }: OverviewData) {
  const link = (href: string, text: string) => (
    <a className="b-act" href={href} onClick={onLinkClick}><span>{text}</span><b aria-hidden="true">›</b></a>
  );
  const { docs } = useRange<DayDoc>(`day:${monday}`, `day:${addDays(t, 14)}`);
  const blocks = (d: string) => {
    const doc = docs?.get(`day:${d}`);
    return doc?.columns.length ? [...activeColumn(doc).blocks].sort((a, b) => a.start - b.start) : [];
  };
  const tomorrow = blocks(addDays(t, 1));
  const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
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
    <section className={`panel b-ahead${!ahead.length && !tomorrow.length ? " is-empty" : ""}`}>
      <h2>{B.ahead}</h2>
      <div className="b-ahead-range">{fmtDay(monday, { month: "short", day: "numeric" })} – {fmtDay(addDays(monday, 13), { month: "short", day: "numeric" })}</div>
      <div className="b-calendar">
        {calendar.slice(0, 7).map((d) => (
          <small key={`h${d}`}>{fmtDay(d, { weekday: "narrow" })}</small>
        ))}
        {calendar.map((d) => (
          <a
            key={d}
            href={`/day/${d}`}
            onClick={onLinkClick}
            aria-label={`${fmtDay(d, { weekday: "long", month: "long", day: "numeric" })} · ${B.aheadBlocks(blocks(d).length)}${ahead.filter(x => x.date === d).map(x => ` · ${x.text}`).join("")}`}
            title={`${B.aheadBlocks(blocks(d).length)}${ahead.filter(x => x.date === d).map(x => ` · ${x.text}`).join("")}`}
            className={d === t ? "today" : d < t ? "past" : ""}
          >
            <span>{Number(d.slice(-2))}</span>
            <i className={ahead.some((x) => x.date === d) ? "on" : ""} />
            <em aria-hidden="true" style={{ width: `${Math.min(blocks(d).length / 8, 1) * 70}%` }} />
          </a>
        ))}
      </div>
      {tomorrow.length > 0 && <a className="b-ahead-tomorrow b-act" href={`/day/${addDays(t, 1)}`} onClick={onLinkClick}><span>{B.aheadTomorrow(time(tomorrow[0].start), tomorrow.length)}</span><b aria-hidden="true">›</b></a>}
      <div className="b-events">
        {ahead.slice(0, 4).map((x) => (
          <a key={x.id} href={x.href} onClick={onLinkClick} title={x.text}>
            <time dateTime={x.date}>{fmtDay(x.date, { weekday: "short", day: "numeric" })}</time>
            <span>{x.text}</span>
            <small>{B.aheadWhen(Math.round((Date.parse(x.date) - Date.parse(t)) / 86400000))}</small>
          </a>
        ))}
        {!ahead.length && <div className="b-ahead-empty"><p>{B.aheadEmpty}</p>{link(`/month/${monthOf(t)}`, B.aheadAdd)}</div>}
      </div>
      {ahead.length > 4 && link(`/month/${monthOf(t)}`, B.aheadMore(ahead.length - 4))}
    </section>
  );
}
