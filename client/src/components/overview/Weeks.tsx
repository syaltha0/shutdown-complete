import { CardHead } from "./CardHead";
﻿import { addDays, duration, fmtDay, monthOf } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import { heatLevel } from "../../lib/year";
import type { OverviewData } from "./data";
export function Weeks({ t, docOf, deep, B, T, monday }: OverviewData) {
  const days = Array.from({ length: 84 }, (_, i) => addDays(monday, i - 77));
  const minutes = days.map(d => d > t ? 0 : deep(docOf(d)));
  const totals = Array.from({ length: 12 }, (_, w) => minutes.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0));
  const total = totals.reduce((a, b) => a + b, 0);
  return <section className="panel b-heat">
    <CardHead title={B.weeks} aside={<a className="b-act" href={`/year/${t.slice(0, 4)}`} onClick={onLinkClick}>{B.weeksYear} ›</a>} />
    {total ? <>
    <div className="b-heat-months">{totals.map((_, w) => <span key={w}>{w === 0 || monthOf(days[w * 7]) !== monthOf(days[(w - 1) * 7]) ? fmtDay(days[w * 7], { month: "short" }) : ""}</span>)}</div>
    <div className="b-heat-body">
      <div className="b-heat-days" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map(i => <small key={i} style={{ gridRow: i + 1 }}>{fmtDay(addDays(monday, i), { weekday: "narrow" })}</small>)}</div>
      <div className="b-heatmap">{days.map((d, i) => {
        const label = `${fmtDay(d, { weekday: "short", day: "numeric", month: "short" })} · ${d > t ? T.year.future : duration(minutes[i])}`;
        return <a key={d} href={`/day/${d}`} onClick={onLinkClick} className={`heat-${heatLevel(minutes[i])}${d === t ? " b-heat-today" : ""}${d > t ? " b-heat-future" : ""}`} title={label} aria-label={label} aria-current={d === t ? "date" : undefined} data-date={d} data-minutes={minutes[i]}/>;
      })}</div>
    </div>
    <footer className="b-heat-foot b-number-sm"><p>{total ? B.weeksSummary(duration(total), duration(Math.round(total / 12)), duration(Math.max(...totals))) : B.noHistory}</p><div className="b-heat-legend" aria-label={T.year.heat}>{T.year.legend.map((label, i) => <span key={label} title={label}><i className={`heat-${i}`} aria-hidden="true"/><span>{label}</span></span>)}</div></footer>
    </> : <p className="b-heat-empty">{B.noHistory}</p>}
  </section>;
}
