import { featureOn } from "../../lib/model";
import { longDate } from "../../lib/dates";
import { onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function Habits({ T, settings, day, update, B, recent, docOf, t }: OverviewData) {
  const habits = settings.metrics.filter((m) => m.kind === "check" && featureOn(settings, "habits"));
  const done = habits.filter((m) => day?.metrics[m.id] === true).length;
  return (
    <section className="panel b-habits">
      <header><h2>{T.nav.habits}</h2>{habits.length > 0 && <a className="b-habits-count num" href="/habits" onClick={onLinkClick} aria-label={`${B.habitsToday(done, habits.length)} · ${B.habitsOpen}`}><span aria-live="polite">{B.habitsToday(done, habits.length)}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></a>}</header>
      {habits.length > 0 ? <>
        <div className="b-habit-list" role="group" aria-label={T.nav.habits} tabIndex={0}>
          {habits.map((m) => {
            const checked = day?.metrics[m.id] === true;
            return <div className="b-habit-row" key={m.id}>
              <button type="button" className={`b-chip${checked ? " on" : ""}`} aria-label={m.name} aria-pressed={checked}
                onClick={() => update((d) => ({ ...d, metrics: { ...d.metrics, [m.id]: d.metrics[m.id] !== true } }))}>
                <i aria-hidden="true">{checked && <svg viewBox="0 0 16 16"><path d="m4 8 3 3 5-6" /></svg>}</i><span title={m.name}>{m.name}</span>
              </button>
              <div className="b-habit-week" aria-label={B.habitsWeek}>
                {[...recent].reverse().map((date) => {
                  const value = docOf(date)?.metrics[m.id] === true;
                  const label = B.habitsDay(longDate(date), value);
                  return <span key={date} className={`${value ? "done" : ""}${date === t ? " today" : ""}`} data-date={date} data-done={value} role="img" aria-label={label} title={label} />;
                })}
              </div>
            </div>;
          })}
        </div>
        {done === habits.length && <small className="b-habits-complete">{B.habitsComplete}</small>}
      </> : <p>{B.noHabits}</p>}
      {habits.length === 0 && <a className="b-act" href="/habits" onClick={onLinkClick}><span>{B.habitsAdd}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></a>}
    </section>
  );
}
