import { onLinkClick } from "../../lib/router";
import { offerUndo } from "../../lib/undo";
import type { OverviewData } from "./data";
export function TasksToday({ T, t, day, tasks, B, update }: OverviewData) {
  const total = day?.tasks.filter(x => x.text.trim()).length ?? 0;
  const done = total - tasks.length;
  const complete = total > 0 && done === total;
  const next = tasks[0];
  const finish = async () => {
    if (!next) return;
    await update(d => ({ ...d, tasks: d.tasks.map(x => x.id === next.id ? { ...x, done: true } : x) }));
    offerUndo(T.overviewTaskFinished(next.text), () => {
      void update(d => ({ ...d, tasks: d.tasks.map(x => x.id === next.id ? { ...x, done: false } : x) }));
    });
  };
  return <section className={`panel b-tasks${complete ? ' is-complete' : ''}`}>
    <h2>{B.tasks}</h2>
    <div className="b-tasks-ring" role="progressbar" aria-label={B.tasks} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done} aria-valuetext={total ? T.tasksDone(done, total) : T.overviewTasksEmpty}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="43" fill="none" stroke="var(--rule)" strokeWidth="5" />
        <circle className="b-tasks-fill" cx="50" cy="50" r="43" fill="none" strokeWidth="5" pathLength="100" strokeDasharray={`${total ? done / total * 100 : 0} 100`} opacity={done ? 1 : 0} transform="rotate(-90 50 50)" strokeLinecap="round" />
      </svg>
      <strong>{total ? `${done}/${total}` : '–'}</strong>
    </div>
    {next ? <label className="b-tasks-next"><input type="checkbox" checked={false} onChange={() => void finish()} /><span className="b-truncate" title={next.text}>{next.text}</span></label>
      : <p className="b-truncate">{complete ? T.overviewTasksAllDone : T.overviewTasksEmpty}</p>}
    <a className={`b-act${!total ? ' main' : ''}`} href={`/day/${t}`} onClick={onLinkClick}><span>{!total ? T.overviewTasksAdd : tasks.length > 1 ? T.overviewTasksMore(tasks.length - 1) : T.openToday}</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" /></svg></a>
  </section>;
}
