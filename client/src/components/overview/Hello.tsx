import { useAccount } from "../../App";
import { clock, duration, longDate } from "../../lib/dates";
import { settingsFocus, startFocus } from "../../lib/focus";
import { navigate, onLinkClick } from "../../lib/router";
import type { OverviewData } from "./data";
export function Hello({ T, settings, t, now, plan, B }: OverviewData) {
  const link = (href: string, text: string) => (
    <a href={href} onClick={onLinkClick}>
      {text}
    </a>
  );
  const cur = plan.find((b) => b.start <= now && b.end > now);
  const { user } = useAccount();
  const ended = plan.length > 0 && now >= plan[plan.length - 1].end;
  const greet = B.greeting(new Date().getHours(), user.name);
  return (
    <section className="panel b-hello">
      <h2>{greet}</h2>
      <div className="b-now">
        {cur
          ? cur.label || T.untitledBlock
          : ended
            ? B.ended
            : T.overviewNoPlan}
      </div>
      <p className="muted">
        {cur
          ? `${clock(cur.start)}–${clock(cur.end)} · ${B.left(duration(cur.end - now))}`
          : longDate(t)}
      </p>
      <div className="b-actions">
        {cur ? (
          <button
            className="btn"
            onClick={() =>
              startFocus({
                blockId: cur.id,
                label: cur.label || T.untitledBlock,
                minutes: settingsFocus(settings).focusMin,
              }).then(() => navigate("/focus"))
            }
          >
            {T.focusOn(cur.label || T.untitledBlock)}
          </button>
        ) : ended ? (
          link(`/shutdown/${t}`, T.runShutdown)
        ) : (
          link("/focus", T.startFocus)
        )}
        {link(`/day/${t}`, T.openToday)}
      </div>
    </section>
  );
}
