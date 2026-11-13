import { useDoc, useRange } from '../lib/useDoc';
import { activeColumn, emptyDay, emptyInbox, type Block, type DayDoc, type Item } from '../lib/model';
import { useT } from '../lib/i18n';
import { clock, shortDate } from '../lib/dates';
import { onLinkClick } from '../lib/router';

export function useBlockTask(block: Block | null, day?: DayDoc) {
  const { value: inbox, status: inboxStatus } = useDoc('inbox', emptyInbox);
  const { value: origin, status: dayStatus } = useDoc<DayDoc>(block?.task?.day ? 'day:' + block.task.day : 'day:0000-00-00', emptyDay);
  const ref = block?.task;
  const item = ref ? (ref.list === 'inbox' ? inbox?.items.find(t => t.id === ref.id) : (origin?.tasks.find(t => t.id === ref.id) ?? day?.tasks.find(t => t.id === ref.id))) : day?.tasks.find(t => t.text === block?.label);
  return { item, loading: ref?.list === 'inbox' ? inboxStatus === 'loading' : dayStatus === 'loading' };
}
export function BlockTaskLink({ block, day, date }: { block: Block; day?: DayDoc; date?: string }) {
  const T = useT();
  const { item, loading } = useBlockTask(block, day);
  if (!block.task && !item) return null;
  return <p className="muted">{item ? <>{item.text}{item.done && <> / {T.taskBlock.done}</>}{' '}<a className="card-link" href={'/tasks/all?task=' + encodeURIComponent(item.id) + (block.task?.day || date ? '&day=' + (block.task?.day ?? date) : '')} onClick={onLinkClick}>{T.taskBlock.open}</a></> : !loading && T.taskBlock.deleted}</p>;
}
export function PlannedBlocks({ task }: { task: Item }) {
  const T = useT();
  const { docs } = useRange<DayDoc>('day:0000', 'day:9999');
  const blocks = [...(docs ?? [])].flatMap(([key, day]) => activeColumn(day).blocks.filter(b => b.task ? b.task.id === task.id : b.label === task.text).map(b => ({ b, date: key.slice(4) })));
  return <>{blocks.map(({b, date}) => <p key={date + b.id}>{T.taskBlock.planned} {shortDate(date)} {clock(b.start)}{String.fromCharCode(8211)}{clock(b.end)} <a className="card-link" href={'/day/' + date + '?block=' + encodeURIComponent(b.id)} onClick={onLinkClick}>{T.taskBlock.go}</a></p>)}</>;
}
