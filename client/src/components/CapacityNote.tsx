import { useSettings } from '../App';
import { useState } from 'react';
import { overCapacity, useBaseline } from '../lib/capacity';
import { duration, today } from '../lib/dates';
import { useT } from '../lib/i18n';

const read = (key: string) => { try { return localStorage.getItem(key) === 'off'; } catch { return false; } };

/**
 * A quiet note when the deep work planned for a day or a week is well above what the last four weeks of focus show.
 * It can be dismissed; that is remembered for this day or week only (this browser).
 */
export function CapacityNote({ scope, id, from, planned, thisOne }: { scope: 'day' | 'week'; id: string; /** the first date of the day or week */ from: string; planned: number; thisOne: boolean }) {
  const T = useT();
  const { settings } = useSettings();
  const key = `sc-capacity-${scope}-${id}`;
  const [off, setOff] = useState(() => read(key));
  const [seen, setSeen] = useState(key);
  if (seen !== key) { setSeen(key); setOff(read(key)); }
  // the four weeks before today, or before the day a past plan starts on
  const t = today();
  const base = useBaseline(from < t ? from : t);
  if (off || !base) return null;
  const usual = scope === 'day' ? base.perDay : base.perWeek;
  if (!overCapacity(planned, usual)) return null;
  const text = scope === 'day' ? T.capacity.day(duration(planned), duration(usual), thisOne) : T.capacity.week(duration(planned), duration(usual), thisOne);
  return (
    <p className="capacity-note" role="note" data-capacity={scope}>
      <span>{text} · {T.workBudget(String(settings.startHour).padStart(2, '0') + ':00', String(settings.endHour).padStart(2, '0') + ':00')}</span>
      <button type="button" className="card-link quiet" onClick={() => { try { localStorage.setItem(key, 'off'); } catch { /* private mode */ } setOff(true); }}>{T.capacity.dismiss}</button>
    </p>
  );
}

