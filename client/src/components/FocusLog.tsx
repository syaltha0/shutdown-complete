import { duration } from '../lib/dates';
import { useT } from '../lib/i18n';
import type { Block, FocusSession } from '../lib/model';
import { onLinkClick } from '../lib/router';

/** Read the original sessions, including label matches after a plan revision. */
/** `bare`: just the list, for a place that already folds it (the week review's "Focus notes") */
export function FocusLog({ sessions = [], block, bare }: { sessions?: FocusSession[]; block?: Block; bare?: boolean }) {
  const T = useT();
  const entries = block ? sessions.filter((s) => s.blockId === block.id || (!!block.task && s.taskId === block.task.id) || (!!block.label && s.label === block.label)) : sessions;
  if (!entries.length) return null;
  const list = <ul>{entries.map((s) => <li key={s.id}>
      <div><a href="/focus" onClick={onLinkClick}>{s.label || T.freeFocus}</a> · <span className="num">{duration(s.minutes)}</span></div>
      {s.taskText && <div><a href={"/tasks/all?task=" + encodeURIComponent(s.taskId ?? "")} onClick={onLinkClick}>{T.tkTitle}: {s.taskText}</a></div>}
      {s.intent && <p>{T.intentLabel}: {s.intent}</p>}
      {s.note && <p>{s.note}</p>}
    </li>)}</ul>;
  if (bare) return <div className="focus-log bare">{list}</div>;
  return <details className="focus-log">
    <summary>{T.focusJournal} · {duration(entries.reduce((n, s) => n + s.minutes, 0))}</summary>
    {list}
  </details>;
}
