import { useState } from 'react';
import { useT } from '../lib/i18n';
import { addDays, today, fmtDay } from '../lib/dates';
import { uid, type Settings, type ScheduleException } from '../lib/model';
import { weekdayOf, onItsWeek } from '../lib/repeat';

export function ScheduleExceptions({ settings, update }: { settings: Settings; update: (f: (s: Settings) => Settings) => void }) {
  const T = useT().scheduleExceptions;
  const [from, setFrom] = useState(today()), [to, setTo] = useState(today()), [label, setLabel] = useState('');
  const [applies, setApplies] = useState<'all' | string[]>('all');
  const choices = [...(settings.schedule ?? []).map(r => ({ id: r.id, name: r.label })), ...(settings.templates ?? []).map(t => ({ id: t.id, name: t.name }))];
  function preview(e: ScheduleException) {
    const days: string[] = []; let count = 0;
    for (let d = e.from, n = 0; d <= e.to && n < 3660; d = addDays(d, 1), n++) {
      const includes = (id: string) => e.applies === 'all' || e.applies.includes(id);
      const blocks = (settings.schedule ?? []).filter(r => includes(r.id) && r.since <= d && r.days.includes(weekdayOf(d)) && onItsWeek(r, d)).length
        + (settings.templates ?? []).filter(t => includes(t.id) && t.days.includes(weekdayOf(d))).reduce((n, t) => n + t.blocks.length, 0);
      if (blocks) { days.push(fmtDay(d, { day: 'numeric', month: 'short' })); count += blocks; }
    }
    return `${T.affected}: ${days.join(', ') || '—'} · ${count} ${T.lessons}`;
  }
  const draft = { id: '', from, to, label, applies };
  return <section className="set-row" aria-labelledby="s-exceptions">
    <div className="about"><h2 id="s-exceptions">{T.title}</h2></div>
    <div className="set-panel">
      <div className="field"><label htmlFor="ex-from">{T.from}</label><input className="input" id="ex-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div className="field"><label htmlFor="ex-to">{T.to}</label><input className="input" id="ex-to" type="date" min={from} value={to} onChange={e => setTo(e.target.value)} /></div>
      <div className="field"><label htmlFor="ex-label">{T.label}</label><input className="input" id="ex-label" value={label} onChange={e => setLabel(e.target.value)} /></div>
      <label><input type="checkbox" style={{ accentColor: 'currentColor' }} checked={applies === 'all'} onChange={e => setApplies(e.target.checked ? 'all' : [])} />{T.all}</label>
      {applies !== 'all' && <fieldset><legend>{T.selected}</legend>{choices.map(c => <label key={c.id} style={{ display: 'block' }}><input type="checkbox" style={{ accentColor: 'currentColor' }} checked={applies.includes(c.id)} onChange={e => setApplies(e.target.checked ? [...applies, c.id] : applies.filter(id => id !== c.id))} />{c.name}</label>)}</fieldset>}
      <p className="muted" data-testid="exception-preview">{from && to && from <= to ? preview(draft) : '—'}</p>
      <button className="btn" type="button" disabled={!from || !to || from > to || !label.trim() || (applies !== 'all' && !applies.length)} onClick={() => { update(s => ({ ...s, exceptions: [...(s.exceptions ?? []), { ...draft, id: uid(), label: label.trim() }] })); setLabel(''); }}>{T.add}</button>
      {(settings.exceptions ?? []).map(e => <div key={e.id} className="tpl-row"><span><b>{e.label}</b><small>{e.from} – {e.to}</small><p className="muted">{preview(e)}</p></span><button type="button" className="btn" aria-label={`${T.remove}: ${e.label}`} onClick={() => update(s => ({ ...s, exceptions: (s.exceptions ?? []).filter(x => x.id !== e.id) }))}>{T.remove}</button></div>)}
    </div>
  </section>;
}
