import { useState } from 'react';
import { useSettings } from '../App';
import { CalendarView } from '../components/CalendarView';
import { DocNotice } from '../components/Common';
import { useCalendar } from '../lib/calendar';
import { addDays, clock, longDate, monthOf, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import { activeColumn, emptyInbox, featureOn, type DayDoc, type MonthDoc, type InboxDoc } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { useDoc, useRange } from '../lib/useDoc';
export function Agenda({ date }: {date: string}) {
  const T = useT(); const {settings} = useSettings(); const [count, setCount] = useState(14);
  const end = addDays(date, count - 1);
  const days = useRange<DayDoc>(`day:${date}`, `day:${end}`);
  const months = useRange<MonthDoc>(`month:${monthOf(date)}`, `month:${monthOf(end)}`);
  const {value: inbox} = useDoc<InboxDoc>('inbox', emptyInbox);
  const calendar = useCalendar(date, end);
  return <><div className="title-row"><h1>{T.calendarViews.agenda}</h1><CalendarView view="agenda" date={date} /></div>
    <DocNotice status={days.error ? 'error' : days.docs ? 'saved' : 'loading'} error={days.error} retry={days.retry} />
    <div className="agenda-days">{Array.from({length: count}, (_, i) => addDays(date, i)).map(d => {
      const day = days.docs?.get(`day:${d}`);
      const entries: {text: string; time?: number; done?: boolean}[] = [
        ...(day ? activeColumn(day).blocks.map(b => ({text: b.label || T.untitledBlock, time: b.start})) : []),
        ...(calendar?.days[d] ?? []).map(e => ({text: e.title, time: e.allDay ? undefined : e.start})),
        ...(day?.tasks ?? []).filter(t => !t.due || t.due === d).map(t => ({text: t.text, done: t.done})),
        ...(featureOn(settings, 'inbox') ? inbox?.items ?? [] : []).filter(t => t.due === d).map(t => ({text: t.text, done: t.done})),
        ...(months.docs?.get(`month:${monthOf(d)}`)?.dates ?? []).filter(t => t.date === d).map(t => ({text: t.text})),
        ...(featureOn(settings, 'exams') ? settings.exams ?? [] : []).filter(e => e.date === d).map(e => ({text: e.name})),
        ...(featureOn(settings, 'countdown') ? settings.countdowns ?? [] : []).filter(e => e.date === d || (e.yearly && e.date.slice(5) === d.slice(5))).map(e => ({text: e.name, time: e.time ?? undefined})),
      ];
      entries.sort((a,b) => (a.time ?? -1) - (b.time ?? -1));
      return <section className={`panel agenda-day${d === today() ? ' today' : ''}`} key={d}><h2><a href={`/day/${d}`} onClick={onLinkClick}>{longDate(d)}</a></h2>
        {!entries.length ? <p className="muted">{T.calendarViews.empty}</p> : <ul>{entries.map((e,i) => <li key={i} className={e.done ? 'done' : ''}><span className="num">{e.time == null ? '' : clock(e.time)}</span><span>{e.text}</span></li>)}</ul>}
      </section>;
    })}</div><button className="btn" onClick={() => setCount(n => n + 14)}>{T.calendarViews.more}</button></>;
}
