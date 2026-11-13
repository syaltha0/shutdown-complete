import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { useT } from '../lib/i18n';
import { activeColumn, emptyInbox, featureOn, uid, type DayDoc, type InboxDoc } from '../lib/model';
import { clock, duration, nowMinutes, today } from '../lib/dates';
import { focusMinutes } from '../lib/focus';
import { updateKey } from '../lib/useDoc';
import { offerUndo } from '../lib/undo';
import { onLinkClick } from '../lib/router';

export function FocusWidgets({ day }: { day: DayDoc | null }) {
  const T = useT();
  const { settings } = useSettings();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => { const timer = window.setInterval(() => setNow(nowMinutes()), 1000); return () => window.clearInterval(timer); }, []);
  const id = settings.focus?.metricId ?? 'deep';
  const metric = settings.metrics.find((m) => m.id === id);
  const stored = day?.metrics[id];
  const minutes = typeof stored === 'number' ? Math.max(0, Math.round(stored * 60)) : day ? focusMinutes(day) : 0;
  const target = metric?.target != null && metric.target > 0 ? metric.target * 60 : null;
  const ratio = target ? Math.min(1, minutes / target) : 0;
  const blocks = day ? [...activeColumn(day).blocks].sort((a, b) => a.start - b.start) : [];
  const current = blocks.find((b) => b.start <= now && b.end > now);
  const next = blocks.find((b) => b.start >= (current?.end ?? now) && b.id !== current?.id);
  const nextText = next ? T.fwNext(next.label || T.untitledBlock, clock(next.start), clock(next.end)) : T.fwNoBlocks;
  return <section className="panel focus-widgets" aria-labelledby="fw-heading">
    <header><h2 id="fw-heading">{T.nav.today}</h2></header>
    <div className="fw-goal">
      {target && <svg width="36" height="36" viewBox="0 0 36 36" role="progressbar" aria-label={T.fwGoal} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(minutes, target)} aria-valuetext={`${duration(minutes)} / ${duration(target)}`}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle className={ratio >= 1 ? 'complete' : ''} cx="18" cy="18" r="15" fill="none" strokeWidth="3" pathLength="1" strokeDasharray={`${ratio} 1`} transform="rotate(-90 18 18)" />
      </svg>}
      <span className="num">{target ? `${duration(minutes)} / ${duration(target)}` : T.fwToday(duration(minutes))}</span>
    </div>
    <a className="fw-next" href={`/day/${today()}`} onClick={onLinkClick}>{current ? `${T.fwEnds(clock(current.end))} · ${nextText}` : nextText}</a>
    {featureOn(settings, 'inbox') && <form className="fw-capture" onSubmit={async (e) => {
      e.preventDefault(); const value = text.trim(); if (!value || saving) return;
      const item = { id: uid(), text: value, done: false, created: new Date().toISOString() };
      setSaving(true);
      try {
        await updateKey<InboxDoc>('inbox', emptyInbox, (doc) => ({ ...doc, items: [...doc.items, item] }));
        setText('');
        offerUndo(T.fwAdded, () => { void updateKey<InboxDoc>('inbox', emptyInbox, (doc) => ({ ...doc, items: doc.items.filter((x) => x.id !== item.id) })); });
      } finally { setSaving(false); input.current?.focus(); }
    }}>
      <label htmlFor="fw-capture">{T.fwCapture}</label>
      <input ref={input} id="fw-capture" className="input" placeholder={T.fwPlaceholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
    </form>}
  </section>;
}
