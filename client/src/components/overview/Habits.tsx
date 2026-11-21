import { CardHead } from "./CardHead";
import { useLayoutEffect, useRef, useState } from "react";
import { habitStats, planned, habitState } from '../../lib/habits';
import { featureOn } from "../../lib/model";
import { addDays, fmtDay, longDate } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import { RoundAction } from "./RoundAction";
import type { OverviewData } from "./data";

/**
 * Today's habits (user, 2026-11-21): a row each with the tick for today, the name, the last seven days as the small
 * blue squares of the Habits screen (today ringed, days off and skips told apart) and the habit's own run on the
 * right; the weekday letters sit once above the squares. More habits than fit scroll inside the tile.
 */
export function Habits({ T, settings, day, update, B, recent, docOf, t }: OverviewData) {
  const habits = settings.metrics.filter((m) => m.kind === "check" && !m.archived && featureOn(settings, "habits"));
  const due = habits.filter(m => planned(m, t) && habitState(m, day) !== "skipped");
  const done = due.filter(m => day?.metrics[m.id] === true).length;
  const week = [...recent].reverse();
  const history = Array.from({ length: 60 }, (_, i) => addDays(t, i - 59));
  const runs = habits.map(h => habitStats(h, history, docOf, t).streak);
  // as many whole rows as the tile holds; the rest behind one "+n more" row instead of a half-cut row
  const list = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(habits.length);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      if (window.matchMedia("(max-width: 860px)").matches) { setFit(Math.min(4, habits.length)); return; }
      const row = el.querySelector<HTMLElement>('.b-habit-row');
      if (!row) return;
      const h = row.getBoundingClientRect().height || 25, rows = Math.floor((el.clientHeight + 2) / h);
      // the more row is shorter than a habit row: room for n rows holds n - 1 habits and it
      setFit(rows >= habits.length ? habits.length : Math.max(1, Math.floor((el.clientHeight + 2 - 20) / h)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [habits.length]);
  const shown = habits.slice(0, fit), hidden = habits.length - shown.length;
  return (
    <section className={`panel b-habits${habits.length <= 2 ? " is-sparse" : ""}${habits.length ? "" : " is-empty"}`}>
      <CardHead title={T.nav.habits} aside={<>{habits.length > 0 && <a className="b-habits-count num" href="/habits" onClick={onLinkClick} aria-label={`${B.habitsToday(done, due.length)} · ${B.habitsOpen}`}><span aria-live="polite">{B.habitsToday(done, due.length)}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></a>}</>} />
      {habits.length > 0 ? <>
        {due.length > 0 && <div className="b-habits-progress" aria-hidden="true"><i style={{ width: `${(done / due.length) * 100}%` }} /></div>}
        <div className="b-habit-days" aria-hidden="true"><span />{week.map(d => <span key={d} className={d === t ? "today" : ""}>{fmtDay(d, { weekday: "narrow" })}</span>)}<span /></div>
        <div className="b-habit-list" ref={list} role="group" aria-label={T.nav.habits}>
          {shown.map((m, i) => {
            const state = habitState(m, day), checked = state === "done", due = planned(m, t);
            const weekly = m.frequency?.mode === "weekly";
            return <div className={`b-habit-row${checked ? " is-done" : ""}`} key={m.id}>
              <button type="button" className={`b-chip${checked ? " on" : ""}${state === "skipped" ? " skipped" : ""}`} disabled={!due} aria-label={m.name} aria-pressed={checked}
                title={!due ? B.habitsOff : state === "skipped" ? B.habitsSkipped : undefined}
                onClick={() => update((d) => ({ ...d, metrics: { ...d.metrics, [m.id]: d.metrics[m.id] !== true }, skippedHabits: (d.skippedHabits ?? []).filter(id => id !== m.id) }))}>
                <i aria-hidden="true">{checked ? <svg viewBox="0 0 16 16"><path d="m4 8 3 3 5-6" /></svg> : state === "skipped" ? <svg viewBox="0 0 16 16"><path d="m5 11 6-6" /></svg> : null}</i><span title={m.name}>{m.name}</span>
              </button>
              <div className="b-habit-week" aria-label={B.habitsWeek}>
                {week.map((date) => {
                  const doc = docOf(date), s = habitState(m, doc), value = s === "done";
                  const label = s === "skipped" ? `${longDate(date)} · ${B.habitsSkipped}` : B.habitsDay(longDate(date), value);
                  return <span key={date} className={[value ? "done" : "", s === "skipped" ? "skipped" : "", !planned(m, date) ? "off" : "", date === t ? "today" : ""].filter(Boolean).join(" ")} data-date={date} data-done={value} role="img" aria-label={label} title={label} />;
                })}
              </div>
              <span className="b-habit-run num" title={B.habitsRun(runs[i], weekly)}>{runs[i] ? B.habitsRunShort(runs[i], weekly) : "–"}</span>
            </div>;
          })}
          {hidden > 0 && <a className="b-habit-more" href="/habits" onClick={onLinkClick}>{B.habitsMore(hidden)}<span aria-hidden="true">›</span></a>}
        </div>
        {due.length > 0 && done === due.length && <small className="b-habits-summary b-habits-complete">{B.habitsComplete}</small>}
      </> : <RoundAction href="/habits" title={B.habitsAdd} hint={B.roundHabits} />}
    </section>
  );
}
