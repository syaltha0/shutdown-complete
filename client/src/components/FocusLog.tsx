import { duration } from '../lib/dates';
import { useT } from '../lib/i18n';
import type { Block, FocusSession } from '../lib/model';
import { onLinkClick } from '../lib/router';

/** Read the original sessions, including label matches after a plan revision. */
export function FocusLog({ sessions = [], block }: { sessions?: FocusSession[]; block?: Block }) {
  const T = useT();
  const entries = block ? sessions.filter((s) => s.blockId === block.id || (!!block.label && s.label === block.label)) : sessions;
  if (!entries.length) return null;
  return <details className="focus-log">
    <summary>{T.focusJournal} · {duration(entries.reduce((n, s) => n + s.minutes, 0))}</summary>
    <ul>{entries.map((s) => <li key={s.id}>
      <div><a href="/focus" onClick={onLinkClick}>{s.label || T.freeFocus}</a> · <span className="num">{duration(s.minutes)}</span></div>
      {s.taskText && <div><a href="/tasks" onClick={onLinkClick}>{T.tkTitle}: {s.taskText}</a></div>}
      {s.intent && <p>{T.intentLabel}: {s.intent}</p>}
      {s.note && <p>{s.note}</p>}
    </li>)}</ul>
  </details>;
}
