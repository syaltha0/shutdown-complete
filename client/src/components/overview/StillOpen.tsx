import { emptyInbox, featureOn, type InboxDoc } from "../../lib/model";
import { onLinkClick } from "../../lib/router";
import { useDoc } from "../../lib/useDoc";
import { cardDone } from "../../lib/links";
import { offerUndo } from "../../lib/undo";
import { useState } from "react";
import { AddTodayDialog, RoundAction } from "./RoundAction";
import type { OverviewData } from "./data";
import { IconInbox, IconMetrics, IconShutdown } from "../Icons";

export function StillOpen({ T, settings, t, day, update, tasks, B, now, plan }: OverviewData) {
  const { value: inbox } = useDoc<InboxDoc>("inbox", emptyInbox);
  const [adding, setAdding] = useState(false);
  const metrics = settings.metrics.filter(m => m.kind === "number" && featureOn(settings, "metrics") && day?.metrics[m.id] == null);
  const inboxCount = featureOn(settings, "inbox") ? (inbox?.items.length ?? 0) : 0;
  const shutdown = !day?.shutdown.done;
  const ended = now >= 1080 || (plan.length > 0 && plan.every(b => b.end <= now));
  const doneToday = day?.tasks.filter(x => x.done && x.text.trim()) ?? [];
  const remaining = tasks.length + metrics.length + Number(shutdown) + Number(inboxCount > 0);
  const row = (icon: React.ReactNode, text: string, href: string, action: string, due = false) => <li className={`b-open-row${due ? " due" : ""}`}>
    <span className="b-open-icon" aria-hidden="true">{icon}</span><span className="b-open-text">{text}</span>
    <a className="b-open-go" href={href} onClick={onLinkClick}>{action}<span aria-hidden="true"> ›</span></a>
  </li>;
  // one flat list of what is still open today: tasks to tick, then the measurements, the shutdown and the inbox as rows
  // of the same kind, each with its short action; what is done sits quietly under it (user, 2026-11-21)
  return <section className="panel b-open">
    <header className="b-open-head"><h2>{T.overviewOpen}</h2>{remaining > 0 && <span className="b-open-count num" aria-label={B.openLeft(remaining)}>{remaining}</span>}</header>
    {!remaining ? <div className="b-done"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="1" /><path d="m19 32 9 9 18-19" fill="none" stroke="currentColor" strokeWidth="2" /></svg><span>{B.allDone}</span></div> : <ul className="b-open-list" aria-label={T.overviewOpen}>
      {tasks.slice(0, 5).map(x => <li key={x.id} className="b-open-row task"><label><input type="checkbox" className="check" aria-label={T.doneLabel(x.text)} checked={false} onChange={() => {
        if (x.card) cardDone(x.card).catch(() => {});
        update(d => ({ ...d, tasks: d.tasks.map(y => y.id === x.id ? { ...y, done: true } : y) }));
        offerUndo(B.openCompleted(x.text), () => update(d => ({ ...d, tasks: d.tasks.map(y => y.id === x.id ? { ...y, done: false } : y) })));
      }} /><span className="b-open-text" title={x.text}>{x.text}</span></label></li>)}
      {tasks.length > 5 && row(null, B.openMore(tasks.length - 5), `/day/${t}`, T.nav.today)}
      {metrics.length > 0 && row(<IconMetrics />, B.openMetrics(metrics.length), `/day/${t}`, B.openLog)}
      {shutdown && row(<IconShutdown />, ended ? B.openClose : T.runShutdown, `/shutdown/${t}`, B.openClosingGroup, ended)}
      {inboxCount > 0 && row(<IconInbox />, B.openInbox(inboxCount), "/inbox", B.openSort)}
    </ul>}
    {doneToday.length > 0 && <p className="b-open-done"><span className="num">{B.openDoneLine(doneToday.length)}</span> · <s title={doneToday.map(x => x.text).join(" · ")}>{doneToday[0].text}</s></p>}
    <RoundAction layout="row" onClick={() => setAdding(true)} title={T.overviewTasksAdd} hint={B.roundOpen} />
    {adding && <AddTodayDialog onAdd={text => update(d => ({ ...d, tasks: [...d.tasks, { id: crypto.randomUUID(), text, done: false }] }))} onClose={() => setAdding(false)} />}
  </section>;
}
