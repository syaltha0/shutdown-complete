import { useState } from 'react';
import { useSettings } from '../App';
import { CalendarView } from '../components/CalendarView';
import { DocNotice } from '../components/Common';
import { RoundAction } from '../components/overview/RoundAction';
import { useCalendar } from '../lib/calendar';
import { addDays, clock, duration, longDate, monthOf, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import { activeColumn, emptyDay, emptyInbox, featureOn, type DayDoc, type Item, type MonthDoc, type InboxDoc } from '../lib/model';
import { cardDone } from '../lib/links';
import { rollOn } from '../lib/tasks';
import { offerUndo } from '../lib/undo';
import { onLinkClick } from '../lib/router';
import { updateKey, useDoc, useRange } from '../lib/useDoc';

type Source = { src: 'day' | 'inbox'; date: string; item: Item };
/** Changes one task where it lives: on its day, or in the task lists. */
const patchTask = ({ src, date, item }: Source, p: Partial<Item>) => src === 'day'
  ? updateKey<DayDoc>(`day:${date}`, emptyDay, (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === item.id ? { ...x, ...p } : x)) }))
  : updateKey<InboxDoc>('inbox', emptyInbox, (b) => ({ ...b, items: b.items.map((x) => (x.id === item.id ? { ...x, ...p } : x)) }));

export function Agenda({ date }: {date: string}) {
  const T = useT(); const {settings} = useSettings(); const [count, setCount] = useState(14);
  const end = addDays(date, count - 1);
  const days = useRange<DayDoc>(`day:${date}`, `day:${end}`);
  const months = useRange<MonthDoc>(`month:${monthOf(date)}`, `month:${monthOf(end)}`);
  const {value: inbox} = useDoc<InboxDoc>('inbox', emptyInbox);
  const calendar = useCalendar(date, end);
  /** Ticks a task (a repeating one comes back on its next date); both can be taken back. */
  const tick = (s: Source) => {
    const t = s.item;
    if (t.done) {
      void patchTask(s, { done: false, doneAt: undefined });
      offerUndo(T.tkReopenedN(1), () => { void patchTask(s, { done: true, doneAt: t.doneAt }); });
      return;
    }
    if (t.repeat && s.src === 'inbox') {
      const p = rollOn(t);
      void patchTask(s, p);
      offerUndo(T.tkNext(t.text, p.due ?? p.start ?? ''), () => { void patchTask(s, { repeat: t.repeat, due: t.due, start: t.start, percent: t.percent, steps: t.steps, doneCount: t.doneCount, lastDone: t.lastDone, done: false, doneAt: undefined }); });
      return;
    }
    void patchTask(s, { done: true, doneAt: today() });
    if (t.card) cardDone(t.card).catch(() => {});
    offerUndo(T.doneLabel(t.text), () => { void patchTask(s, { done: false, doneAt: undefined }); });
  };
  return <><div className="title-row"><h1>{T.calendarViews.agenda}</h1><CalendarView view="agenda" date={date} /></div>
    <DocNotice status={days.error ? 'error' : days.docs ? 'saved' : 'loading'} error={days.error} retry={days.retry} />
    <div className="agenda-days">{Array.from({length: count}, (_, i) => addDays(date, i)).map(d => {
      const day = days.docs?.get(`day:${d}`);
      const entries: {text: string; time?: number; end?: number; kind?: keyof typeof T.kinds; task?: boolean; done?: boolean; source?: Source}[] = [
        ...(day ? activeColumn(day).blocks.map(b => ({text: b.label || T.untitledBlock, time: b.start, end: b.end, kind: b.kind})) : []),
        ...(calendar?.days[d] ?? []).map(e => ({text: e.title, time: e.allDay ? undefined : e.start})),
        ...(day?.tasks ?? []).filter(t => !t.due || t.due === d).map(t => ({text: t.text, done: t.done, task: true, source: {src: 'day' as const, date: d, item: t}})),
        ...(featureOn(settings, 'inbox') ? inbox?.items ?? [] : []).filter(t => t.due === d).map(t => ({text: t.text, done: t.done, task: true, source: {src: 'inbox' as const, date: d, item: t}})),
        ...(months.docs?.get(`month:${monthOf(d)}`)?.dates ?? []).filter(t => t.date === d).map(t => ({text: t.text})),
        ...(featureOn(settings, 'exams') ? settings.exams ?? [] : []).filter(e => e.date === d).map(e => ({text: e.name})),
        ...(featureOn(settings, 'countdown') ? settings.countdowns ?? [] : []).filter(e => e.date === d || (e.yearly && e.date.slice(5) === d.slice(5))).map(e => ({text: e.name, time: e.time ?? undefined})),
      ];
      entries.sort((a,b) => (a.time ?? -1) - (b.time ?? -1));
      const tasks = entries.filter(e => e.task), schedule = entries.filter(e => !e.task);
      const now = new Date(), minute = now.getHours() * 60 + now.getMinutes();
      return <section className={`panel agenda-day${d === today() ? ' today' : ''}${entries.length ? '' : ' is-empty'}`} key={d}><h2><a href={`/day/${d}`} onClick={onLinkClick}>{longDate(d)}</a></h2>
        {!entries.length ? <><span className="muted" aria-hidden="true">—</span><RoundAction href={`/day/${d}`} title={T.calendarViews.planDay} hint={T.calendarViews.empty} /></> : <>
          {!!tasks.length && <div className="agenda-task-group"><h3>{T.tasks}</h3><ul>{tasks.map((e,i) => <li key={i} className={`agenda-task${e.done ? ' done' : ''}`}>{e.source ? <label className="agenda-tick"><input type="checkbox" className="check" checked={!!e.done} aria-label={T.doneLabel(e.text)} onChange={() => tick(e.source!)} /><span>{e.text}</span></label> : e.text}</li>)}</ul></div>}
          {!!schedule.length && <ul>{schedule.map((e,i) => <li key={i} className={`agenda-entry${e.time == null ? ' untimed' : ''}${e.end != null && (d < today() || (d === today() && e.end <= minute)) ? ' is-past' : ''}`}>
            {e.time != null && <span className="num">{clock(e.time)}</span>}<span>{e.text}</span>
            {e.end != null && e.time != null && <span className="agenda-block-meta"><span className="num">{duration(e.end-e.time)}</span>{e.kind && <span className="agenda-kind"><i aria-hidden="true" />{T.kinds[e.kind].name}</span>}</span>}
          </li>)}</ul>}
        </>}
      </section>;
    })}</div><button className="btn" onClick={() => setCount(n => n + 14)}>{T.calendarViews.more}</button></>;
}
