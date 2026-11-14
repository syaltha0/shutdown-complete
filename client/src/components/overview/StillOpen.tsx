import { emptyInbox, featureOn, type InboxDoc } from "../../lib/model";
import { onLinkClick } from "../../lib/router";
import { useDoc } from "../../lib/useDoc";
import { cardDone } from "../../lib/links";
import type { OverviewData } from "./data";
export function StillOpen({
  T,
  settings,
  t,
  day,
  update,
  tasks,
  B,
}: OverviewData) {
  const link = (href: string, text: string) => (
    <a href={href} onClick={onLinkClick}>
      {text}
    </a>
  );
  const { value: inbox } = useDoc<InboxDoc>("inbox", emptyInbox);
  const metrics = settings.metrics.filter(
    (m) =>
      m.kind === "number" &&
      featureOn(settings, "metrics") &&
      day?.metrics[m.id] == null,
  );
  const inboxCount = featureOn(settings, "inbox")
    ? (inbox?.items.length ?? 0)
    : 0;
  const allDone =
    !tasks.length && !metrics.length && day?.shutdown.done && !inboxCount;
  return (
    <section className="panel b-open">
      <h2>{T.overviewOpen}</h2>
      {allDone ? (
        <div className="b-done">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path
              d="m14 32 12 12 25-27"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
          </svg>
          {B.allDone}
        </div>
      ) : (
        <>
          <ul>
            {tasks.slice(0, 4).map((x) => (
              <li key={x.id}>
                <input
                  type="checkbox"
                  className="check"
                  aria-label={T.doneLabel(x.text)}
                  onChange={() => {
                    if (x.card) cardDone(x.card).catch(() => {});
                    update((d) => ({
                      ...d,
                      tasks: d.tasks.map((y) =>
                        y.id === x.id ? { ...y, done: true } : y,
                      ),
                    }));
                  }}
                />
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
          {tasks.length > 4 && link(`/day/${t}`, T.andMore(tasks.length - 4))}
          {metrics.length > 0 &&
            link(
              `/day/${t}`,
              metrics.map((m) => T.overviewMetric(m.name)).join(" · "),
            )}
          {!day?.shutdown.done && (
            <a
              className="btn ghost b-shutdown"
              href={`/shutdown/${t}`}
              onClick={onLinkClick}
            >
              {T.runShutdown} ›
            </a>
          )}
          {inboxCount > 0 && link("/inbox", T.overviewInbox(inboxCount) + " ›")}
        </>
      )}
      <input
        id="home-task"
        className="input b-capture"
        aria-label={T.captureTask}
        placeholder={T.captureTask}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          const text = e.currentTarget.value.trim();
          if (!text) return;
          update((d) => ({
            ...d,
            tasks: [...d.tasks, { id: crypto.randomUUID(), text, done: false }],
          }));
          e.currentTarget.value = "";
        }}
      />
    </section>
  );
}
