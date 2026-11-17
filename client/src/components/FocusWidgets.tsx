import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { useT } from '../lib/i18n';
import { activeColumn, emptyInbox, featureOn, uid, type DayDoc, type InboxDoc } from '../lib/model';
import { clock, duration, nowMinutes, today } from '../lib/dates';
import { dayFocus } from '../lib/focus';
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
  const { minutes: minutes, manual } = dayFocus(day, settings);
  const target = metric?.target != null && metric.target > 0 ? metric.target * 60 : null;
  const ratio = target ? Math.min(1, minutes / target) : 0;
  const blocks = day ? [...activeColumn(day).blocks].sort((a, b) => a.start - b.start) : [];
  const current = blocks.find((b) => b.start <= now && b.end > now);
  const next = blocks.find((b) => b.start >= (current?.end ?? now) && b.id !== current?.id);
  const nextText = next ? T.fwNext(next.label || T.untitledBlock, clock(next.start), clock(next.end)) : T.fwNoBlocks;
  // the day at a glance: the planned hours as a strip with the blocks and where now is, and three small figures
  const from = settings.wholeDay ? 0 : Math.min(settings.startHour * 60, blocks[0]?.start ?? Infinity);
  const to = settings.wholeDay ? 1440 : Math.max(settings.endHour * 60, blocks.at(-1)?.end ?? 0);
  const span = Math.max(60, to - from);
  const at = (m: number) => `${(Math.min(Math.max(m, from), to) - from) / span * 100}%`;
  const deepPlanned = blocks.filter((b) => b.kind === 'deep').reduce((s, b) => s + b.end - b.start, 0);
  const blocksLeft = blocks.filter((b) => b.end > now).length;
  const dayLeft = Math.max(0, to - now);
  return <section className="panel focus-widgets" aria-labelledby="fw-heading">
    <header><h2 id="fw-heading">{T.nav.today}</h2></header>
    <div className="fw-goal">{manual && <small>{T.focusManual}</small>}
      {target && <svg width="56" height="56" viewBox="0 0 36 36" role="progressbar" aria-label={T.fwGoal} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(minutes, target)} aria-valuetext={`${duration(minutes)} / ${duration(target)}`}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle className={ratio >= 1 ? 'complete' : ''} cx="18" cy="18" r="15" fill="none" strokeWidth="3" pathLength="1" strokeDasharray={`${ratio} 1`} transform="rotate(-90 18 18)" />
      </svg>}
      <div className="fw-goal-copy"><span className="fw-caption">{T.fwGoal}</span><span className="fw-value num">{duration(minutes)}{target && <span className="fw-target"> / {duration(target)}</span>}</span>{target && <span className="fw-caption fw-left">{minutes >= target ? T.fwGoalMet : T.fwGoalLeft(duration(target - minutes))}</span>}</div>
    </div>
    <div className="fw-day">
      <div className="fw-strip" role="img" aria-label={T.fwStrip(clock(from), clock(to), blocks.length)}>
        {blocks.map((b) => <span key={b.id} className={`fw-seg${b.kind === 'deep' ? ' deep' : ''}${b.end <= now ? ' past' : ''}`} style={{ left: at(b.start), width: `calc(${at(b.end)} - ${at(b.start)})` }} />)}
        {now >= from && now <= to && <span className="fw-now" style={{ left: at(now) }} />}
      </div>
      <div className="fw-strip-scale num" aria-hidden="true"><span>{clock(from)}</span><span>{clock(to)}</span></div>
      <dl className="fw-stats">
        <div><dt>{T.fwDeepPlanned}</dt><dd className="num">{duration(deepPlanned)}</dd></div>
        <div><dt>{T.fwBlocksLeft}</dt><dd className="num">{blocksLeft}</dd></div>
        <div><dt>{T.fwDayLeft}</dt><dd className="num">{duration(dayLeft)}</dd></div>
      </dl>
    </div>
    <a className="fw-next" href={`/day/${today()}`} onClick={onLinkClick}>
      <span className="fw-next-copy">{current && <span className="fw-caption">{T.fwEnds(clock(current.end))}</span>}<span>{nextText}</span>{!next && !current && <span className="fw-caption">{T.fwPlanDay}</span>}</span>
      <svg className="fw-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </a>
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
      <div className="fw-capture-field"><input ref={input} id="fw-capture" className="input" placeholder={T.fwPlaceholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><button className="fw-submit" type="submit" disabled={!text.trim() || saving} aria-label={T.fwSubmit}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button></div>
    </form>}
  </section>;
}
