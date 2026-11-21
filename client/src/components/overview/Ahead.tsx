import { CardHead } from "./CardHead";
import { addDays, addMonths, fmtDay, monthOf } from "../../lib/dates";
import { activeColumn, emptyMonth, featureOn, type MonthDoc } from "../../lib/model";
import { onLinkClick } from "../../lib/router";
import { useDoc } from "../../lib/useDoc";
import { nextDate } from "../../screens/Countdown";
import { RoundAction } from "./RoundAction";
import type { OverviewData } from "./data";
export function Ahead({ settings, t, B, monday, docs }: OverviewData) {
  const link = (href: string, text: string) => (
    <a className="b-act" href={href} onClick={onLinkClick}><span>{text}</span><b aria-hidden="true">›</b></a>
  );
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
    ...(featureOn(settings, "exams") ? settings.exams ?? [] : []).map((x) => ({
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
  const outside = ahead.filter((x) => x.date > calendar[13]);
  return (
    <section className={`panel b-ahead${ahead.length ? "" : " is-empty"}`}>
      <CardHead title={<>{B.ahead}</>} aside={outside.length > 2 ? link(`/month/${monthOf(t)}`, B.aheadMore(outside.length - 2)) : undefined} />
      <div className="b-ahead-range">{fmtDay(monday, { month: "short", day: "numeric" })} – {fmtDay(addDays(monday, 13), { month: "short", day: "numeric" })}</div>
      <div className="b-ahead-cal">
      <div className="b-calendar">
        {calendar.slice(0, 7).map((d) => (
          <small key={`h${d}`}>{fmtDay(d, { weekday: "narrow" })}</small>
        ))}
        {calendar.map((d) => {
          const events = ahead.filter((x) => x.date === d);
          const planned = blocks(d);
          const hint = [B.aheadBlocks(planned.length), ...events.map((x) => x.text)].join(" · ");
          return (
            <a
              key={d}
              href={`/day/${d}`}
              onClick={onLinkClick}
              aria-label={`${fmtDay(d, { weekday: "long", month: "long", day: "numeric" })} · ${hint}`}
              title={hint}
              className={[d === t ? "today" : d < t ? "past" : "", [0, 6].includes(new Date(`${d}T12:00:00`).getDay()) ? "weekend" : ""].filter(Boolean).join(" ")}
            >
              <span className="b-ahead-day">{Number(d.slice(-2))}</span>
              {events.length > 0 && <>
                <i className="on" aria-hidden="true" />
                <div className="b-ahead-event" aria-hidden="true"><span>{events[0].text}</span>{events.length > 1 && <small>{B.aheadExtra(events.length - 1)}</small>}</div>
              </>}
              {planned.length > 0 && <em aria-hidden="true" style={{ width: `${Math.min(planned.length / 8, 1) * 70}%` }} />}
            </a>
          );
        })}
      </div>
      {/* nothing coming up: the calendar stays readable behind one round action */}
      {!ahead.length && <div className="b-ahead-over"><RoundAction href={`/month/${monthOf(t)}`} layout="stack" title={B.aheadAddShort} hint={B.aheadHint} /></div>}
      </div>
      {tomorrow.length > 0 && <a className="b-ahead-tomorrow b-act" href={`/day/${addDays(t, 1)}`} onClick={onLinkClick}><span>{B.aheadTomorrow(time(tomorrow[0].start), tomorrow.length)}</span><b aria-hidden="true">›</b></a>}
      {outside.length > 0 && <div className="b-events">
        {outside.slice(0, 2).map((x) => (
          <a key={x.id} href={x.href} onClick={onLinkClick} title={x.text}>
            <time dateTime={x.date}>{fmtDay(x.date, { weekday: "short", day: "numeric" })}</time>
            <span>{x.text}</span>
            <small>{B.aheadWhen(Math.round((Date.parse(x.date) - Date.parse(t)) / 86400000))}</small>
          </a>
        ))}
      </div>}
    </section>
  );
}
