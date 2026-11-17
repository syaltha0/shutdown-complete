import { emptyInbox, featureOn, type InboxDoc } from "../../lib/model";
import { useDoc } from "../../lib/useDoc";
import { onLinkClick } from "../../lib/router";
import { offerUndo } from "../../lib/undo";
import { useState } from "react";
import { AddTodayDialog, RoundAction } from "./RoundAction";
import type { OverviewData } from "./data";
export function TasksToday({ T, t, day, tasks, B, update, settings }: OverviewData) {
  const { value: inbox } = useDoc<InboxDoc>("inbox", emptyInbox);
  const [adding, setAdding] = useState(false);
  const total = day?.tasks.filter(x => x.text.trim()).length ?? 0;
  const done = total - tasks.length;
  const complete = total > 0 && done === total;
  const shown = [...tasks].sort((a, b) => Number(b.id === day?.keyTaskId) - Number(a.id === day?.keyTaskId)).slice(0, 3);
  const finish = async (id: string, text: string) => {
    await update(d => ({ ...d, tasks: d.tasks.map(x => x.id === id ? { ...x, done: true } : x) }));
    offerUndo(T.overviewTaskFinished(text), () => {
      void update(d => ({ ...d, tasks: d.tasks.map(x => x.id === id ? { ...x, done: false } : x) }));
    });
  };
  const add = (text: string) => update(d => ({ ...d, tasks: [...d.tasks, { id: crypto.randomUUID(), text, done: false }] }));
  if (!total) return <section className="panel b-tasks is-empty">
    <h2>{B.tasks}</h2>
    <RoundAction onClick={() => setAdding(true)} title={T.overviewTasksAdd} hint={B.roundTasks} />
    {adding && <AddTodayDialog onAdd={add} onClose={() => setAdding(false)} />}
  </section>;
  return <section className={`panel b-tasks${complete ? ' is-complete' : ''}`}>
    <h2>{B.tasks}</h2>
    <div className="b-tasks-ring" role="progressbar" aria-label={B.tasks} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done} aria-valuetext={total ? T.tasksDone(done, total) : T.overviewTasksEmpty}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="43" fill="none" stroke="var(--rule)" strokeWidth="5" />
        <circle className="b-tasks-fill" cx="50" cy="50" r="43" fill="none" strokeWidth="5" pathLength="100" strokeDasharray={`${total ? done / total * 100 : 0} 100`} opacity={done ? 1 : 0} transform="rotate(-90 50 50)" strokeLinecap="round" />
      </svg>
      <strong>{total ? `${done}/${total}` : '–'}</strong>
    </div>
    <div className="b-rt-body">
      <dl className="b-figures">
        <div><dt>{B.tasksOpenLabel}</dt><dd className="num">{tasks.length}</dd></div>
        <div><dt>{B.tasksDoneLabel}</dt><dd className="num">{done}</dd></div>
        <div><dt>{B.tasksInboxLabel}</dt><dd className="num">{featureOn(settings, "inbox") ? inbox?.items.length ?? 0 : "–"}</dd></div>
      </dl>
      {(!tasks.length) && <p className="b-rt-summary">{!total ? T.overviewTasksEmpty : T.overviewTasksAllDone}</p>}
      {shown.length > 0 && <ul className="b-rt-list">{shown.map(x => <li key={x.id} className={x.id === day?.keyTaskId ? "key-task-selected" : undefined} title={x.id === day?.keyTaskId ? T.keyTask : undefined}><label className="b-tasks-next"><input type="checkbox" checked={false} onChange={() => void finish(x.id, x.text)} /><span className="b-truncate" title={x.text}>{x.text}</span></label></li>)}</ul>}
      {(!total || tasks.length > shown.length) && <a className={`b-act${!total ? ' main' : ''}`} href={`/day/${t}`} onClick={onLinkClick}><span>{!total ? T.overviewTasksAdd : T.overviewTasksMore(tasks.length - shown.length)}</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg></a>}
    </div>
  </section>;
}
