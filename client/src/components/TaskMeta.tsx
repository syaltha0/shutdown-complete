import { duration, parseISODate, shortDate, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import type { Item } from '../lib/model';

export const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240];

const daysTo = (d: string) => Math.round((parseISODate(d).getTime() - parseISODate(today()).getTime()) / 86400000);

/** When a task is due, in words: "due today", "due tomorrow", "due 28 Oct", "3 days late". */
export function dueWords(T: ReturnType<typeof useT>, due: string) {
  const n = daysTo(due);
  return n < 0 ? T.dueLate(-n) : n === 0 ? T.dueToday : n === 1 ? T.dueTomorrow : T.dueOn(shortDate(due));
}

/** After a task: when it is due (red once late, the hue when today) and how long it will take (pick to set). */
export function TaskMeta({ item, onChange, editDue = false }: { item: Item; onChange: (p: Partial<Item>) => void; editDue?: boolean }) {
  const T = useT();
  const n = item.due ? daysTo(item.due) : null;
  return (
    <span className="task-meta">
      {item.waiting && <span>{T.tkWaiting}{item.waitingNote ? ` · ${item.waitingNote}` : ''}{item.review ? ` · ${T.tkReview}: ${shortDate(item.review)}` : ''}</span>}
      {item.due && !editDue && <span className={`due${n! < 0 && !item.done ? ' late' : n === 0 ? ' today' : ''}`}>{dueWords(T, item.due)}</span>}
      {editDue && (
        <input type="date" required className="due-input num" title={T.dueLabel(item.text)} aria-label={T.dueLabel(item.text)} value={item.due ?? ''} onChange={(e) => onChange({ due: e.target.value || undefined })} />
      )}
      <select className="est-select num" aria-label={T.estimateLabel(item.text)} value={item.estimate ?? ''}
        onChange={(e) => onChange({ estimate: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">{T.estimateNone}</option>
        {ESTIMATES.map((m) => <option key={m} value={m}>{duration(m)}</option>)}
      </select>
    </span>
  );
}
