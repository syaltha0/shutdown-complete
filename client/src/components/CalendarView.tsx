import { useState } from 'react';
import { monthOf, weekOf } from '../lib/dates';
import { useT } from '../lib/i18n';
import { navigate } from '../lib/router';
export function CalendarView({ view, date }: { view: 'day' | 'week' | 'month' | 'agenda'; date: string }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const href = (v: typeof view, d: string) => `/${v}/${v === 'week' ? weekOf(d) : v === 'month' ? monthOf(d) : d}`;
  return <div className="calendar-view" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>{T.calendarViews[view]}</button>
    {open && <div className="calendar-menu">
      {(['month', 'week', 'day', 'agenda'] as const).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => {setOpen(false); navigate(href(v, date));}}>{T.calendarViews[v]}</button>)}
      <label>{T.calendarViews.jump}<input aria-label={T.calendarViews.jump} type="date" value={date} onChange={e => { if (e.target.validity.valid && e.target.value) {setOpen(false); navigate(href(view, e.target.value));} }} /></label>
    </div>}
  </div>;
}
