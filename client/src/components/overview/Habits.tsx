import { featureOn } from "../../lib/model";
import type { OverviewData } from "./data";
export function Habits({ T, settings, day, update, B }: OverviewData) {
  const habits = settings.metrics.filter(
    (m) => m.kind === "check" && featureOn(settings, "habits"),
  );
  return (
    <section className="panel b-habits">
      <h2>{T.nav.habits}</h2>
      <div className="b-chips">
        {habits.map((m) => (
          <button
            key={m.id}
            className={`b-chip${day?.metrics[m.id] === true ? " on" : ""}`}
            aria-pressed={day?.metrics[m.id] === true}
            onClick={() =>
              update((d) => ({
                ...d,
                metrics: { ...d.metrics, [m.id]: d.metrics[m.id] !== true },
              }))
            }
          >
            <i />
            {m.name}
          </button>
        ))}
      </div>
      {!habits.length && <p>{B.noHabits}</p>}
    </section>
  );
}
