import { emptyInbox, featureOn, type InboxDoc } from "../../lib/model";
import { onLinkClick } from "../../lib/router";
import { useDoc } from "../../lib/useDoc";
import { cardDone } from "../../lib/links";
import { offerUndo } from "../../lib/undo";
import type { OverviewData } from "./data";

export function StillOpen({ T, settings, t, day, update, tasks, B, now, plan }: OverviewData) {
  const { value: inbox } = useDoc<InboxDoc>("inbox", emptyInbox);
  const metrics = settings.metrics.filter(m => m.kind === "number" && featureOn(settings, "metrics") && day?.metrics[m.id] == null);
  const inboxCount = featureOn(settings, "inbox") ? (inbox?.items.length ?? 0) : 0;
  const shutdown = !day?.shutdown.done;
  const ended = now >= 1080 || (plan.length > 0 && plan.every(b => b.end <= now));
  const remaining = tasks.length + metrics.length + Number(shutdown) + Number(inboxCount > 0);
  const link = (href: string, text: string, main = false) => <a className={`b-act${main ? " main" : ""}`} href={href} onClick={onLinkClick}><span>{text}</span><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></a>;
  return <section className="panel b-open">
    <h2>{T.overviewOpen}</h2>
    <p className="b-open-summary" aria-live="polite">{B.openLeft(remaining)}</p>
    {!remaining ? <div className="b-done"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="1" /><path d="m19 32 9 9 18-19" fill="none" stroke="currentColor" strokeWidth="2" /></svg><span>{B.allDone}</span></div> : <div className="b-open-body">
      {tasks.length > 0 && <ul aria-label={B.tasks}>{tasks.slice(0, 5).map(x => <li key={x.id}><label><input type="checkbox" className="check" aria-label={T.doneLabel(x.text)} checked={false} onChange={() => {
        if (x.card) cardDone(x.card).catch(() => {});
        update(d => ({ ...d, tasks: d.tasks.map(y => y.id === x.id ? { ...y, done: true } : y) }));
        offerUndo(B.openCompleted(x.text), () => update(d => ({ ...d, tasks: d.tasks.map(y => y.id === x.id ? { ...y, done: false } : y) })));
      }} /><span title={x.text}>{x.text}</span></label></li>)}</ul>}
      {tasks.length > 5 && link(`/day/${t}`, B.openMore(tasks.length - 5))}
      {metrics.length > 0 && link(`/day/${t}`, B.openMetrics(metrics.length))}
      {shutdown && <div className={ended ? "b-open-closing due" : "b-open-closing"}>{ended && <span className="b-open-hint">{B.openClose}</span>}{link(`/shutdown/${t}`, T.runShutdown, ended)}</div>}
      {inboxCount > 0 && link("/inbox", B.openInbox(inboxCount))}
    </div>}
    <div className="b-open-capture"><label htmlFor="home-task">{T.captureTask}</label><input id="home-task" className="input b-capture" aria-label={T.captureTask} placeholder={B.openCapture} onKeyDown={e => {
      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
      const text = e.currentTarget.value.trim();
      if (!text) return;
      update(d => ({ ...d, tasks: [...d.tasks, { id: crypto.randomUUID(), text, done: false }] }));
      e.currentTarget.value = "";
    }} /></div>
  </section>;
}
