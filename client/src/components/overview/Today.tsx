import { CardHead } from "./CardHead";
import { emptyInbox, featureOn, type InboxDoc } from "../../lib/model";
import { onLinkClick } from "../../lib/router";
import { useDoc } from "../../lib/useDoc";
import { cardDone } from "../../lib/links";
import { offerUndo } from "../../lib/undo";
import { useState } from "react";
import { AddTodayDialog, RoundAction } from "./RoundAction";
import type { OverviewData } from "./data";
import { IconInbox, IconMetrics, IconShutdown } from "../Icons";

export function Today({ T, settings, t, day, update, tasks, B, now, plan }: OverviewData) {
  const { value: inbox } = useDoc<InboxDoc>("inbox", emptyInbox);
  const [adding, setAdding] = useState(false);
  const metrics = settings.metrics.filter(m => m.kind === "number" && featureOn(settings, "metrics") && day?.metrics[m.id] == null);
  const inboxCount = featureOn(settings, "inbox") ? (inbox?.items.length ?? 0) : 0;
  const shutdown = !day?.shutdown.done;
  const ended = now >= 1080 || (plan.length > 0 && plan.every(b => b.end <= now));
  const doneToday = day?.tasks.filter(x => x.done && x.text.trim()) ?? [];
  const total = day?.tasks.filter(x => x.text.trim()).length ?? 0;
  const done = doneToday.length;
  const remaining = tasks.length + metrics.length + Number(shutdown) + Number(inboxCount > 0);
  const row = (icon: React.ReactNode, text: string, href: string, action: string, due = false) => <li className={`b-open-row${due ? " due" : ""}`}>
    <span className="b-open-icon" aria-hidden="true">{icon}</span><span className="b-open-text">{text}</span>
    <a className="b-open-go" href={href} onClick={onLinkClick} aria-label={`${text} · ${action}`}>{action}<span aria-hidden="true"> ›</span></a>
  </li>;
  // one flat list of what is still open today: tasks to tick, then the measurements, the shutdown and the inbox as rows
  // of the same kind, each with its short action; what is done sits quietly under it (user, 2026-11-21)
  const empty = total === 0 && remaining === 0;
  return <section className={`panel b-open b-today${!remaining ? " is-settled" : ""}`}>
    <CardHead title={B.today} aside={total > 0 && <span className="num" aria-label={T.tasksDone(done, total)}>{done}/{total}</span>} />
    {total > 0 && <div className="b-today-hairline" role="progressbar" aria-label={B.today} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={T.tasksDone(done, total)}><i style={{ width: `${done / total * 100}%` }} /></div>}
    {!empty && <div className="b-today-content">
    {!remaining ? <div className="b-done"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="1" /><path d="m19 32 9 9 18-19" fill="none" stroke="currentColor" strokeWidth="2" /></svg><span>{B.allDone}</span></div> : <ul className="b-open-list" aria-label={B.today}>
      {[...tasks].sort((a, b) => Number(b.id === day?.keyTaskId) - Number(a.id === day?.keyTaskId)).map(x => <li key={x.id} className={`b-open-row task${x.id === day?.keyTaskId ? " key-task-selected" : ""}`}><label><input type="checkbox" className="check" aria-label={T.doneLabel(x.text)} checked={false} onChange={() => {
        if (x.card) cardDone(x.card).catch(() => {});
        update(d => ({ ...d, tasks: d.tasks.map(y => y.id === x.id ? { ...y, done: true } : y) }));
        offerUndo(B.openCompleted(x.text), () => update(d => ({ ...d, tasks: d.tasks.map(y => y.id === x.id ? { ...y, done: false } : y) })));
      }} /><span className="b-open-text" title={x.text}>{x.text}</span></label></li>)}
      {shutdown && row(<IconShutdown />, ended ? B.openClose : T.runShutdown, `/shutdown/${t}`, B.openClosingGroup, ended)}
      {metrics.length > 0 && row(<IconMetrics />, B.openMetrics(metrics.length), `/day/${t}`, B.openLog)}
      {inboxCount > 0 && row(<IconInbox />, B.openInbox(inboxCount), "/inbox", B.openSort)}
    </ul>}
    {doneToday.length > 0 && <div className="b-open-done"><span className="num">{B.openDoneLine(doneToday.length)}</span><ul>{doneToday.slice(0, 3).map(x => <li key={x.id}><s title={x.text}>{x.text}</s></li>)}</ul></div>}
    </div>}
    {empty ? <RoundAction layout="stack" onClick={() => setAdding(true)} title={T.overviewTasksAdd} hint={B.roundOpen} /> : <button type="button" className="b-round-action b-today-add" onClick={() => setAdding(true)}><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 6v12M6 12h12" /></svg></span>{T.overviewTasksAdd}</button>}
    {adding && <AddTodayDialog onAdd={text => update(d => ({ ...d, tasks: [...d.tasks, { id: crypto.randomUUID(), text, done: false }] }))} onClose={() => setAdding(false)} />}
  </section>;
}
