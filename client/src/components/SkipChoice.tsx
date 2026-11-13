import { useEffect, useId, useRef, useState } from 'react';
import { useSettings } from '../App';
import { chime, finishPhase, settingsFocus, skipPlan, type SkipCount } from '../lib/focus';
import { useT } from '../lib/i18n';
import type { FocusActive } from '../lib/model';

/**
 * Skipping the running phase, the same on the Focus card, the mini timer and the focus room. A break goes at once; a
 * focus phase that ran 30 seconds or less goes at once too and counts for nothing; a longer one asks what to count.
 * Strict mode keeps a focus phase from being skipped.
 */
export function useSkip(a: FocusActive | null, key: string) {
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  const [asking, setAsking] = useState(false);
  // a new phase (this one ran out, or another device skipped it) closes the question
  useEffect(() => setAsking(false), [a?.startedAt]);
  const locked = !!a && !!f.strict && a.phase === 'focus';
  async function pick(count?: SkipCount) {
    if (!a || locked) return;
    setAsking(false);
    const r = await finishPhase(settings, true, { key, startedAt: a.startedAt, count });
    if (r !== 'none' && f.sound) chime(f);
  }
  function request() {
    if (!a || locked) return;
    const plan = skipPlan(a);
    if (plan.ask) setAsking(true); else void pick(plan.count);
  }
  return { locked, asking, request, pick, cancel: () => setAsking(false) };
}

/** The question a long-running focus phase asks before it is skipped: count the time so far, the whole session, or neither. */
export function SkipChoice({ a, skip, className = '' }: { a: FocusActive; skip: ReturnType<typeof useSkip>; className?: string }) {
  const T = useT();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const plan = skipPlan(a);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { if (back?.isConnected) back.focus(); };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip.cancel(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...root.current!.querySelectorAll<HTMLElement>('button')], i = all.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };
  return (
    <div ref={root} className={`skip-choice ${className}`} role="dialog" aria-modal="false" aria-labelledby={id} onKeyDown={onKeyDown}>
      <strong id={id}>{T.skipTitle}</strong>
      <p className="muted num">{T.skipRan(plan.elapsedMin, plan.fullMin)}</p>
      <div className="skip-actions">
        <button type="button" className="btn" onClick={() => skip.pick('elapsed')}>{T.skipElapsed(plan.elapsedMin)}</button>
        <button type="button" className="btn" onClick={() => skip.pick('full')}>{T.skipFull(plan.fullMin)}</button>
        <button type="button" className="btn ghost" onClick={skip.cancel}>{T.skipCancel}</button>
      </div>
    </div>
  );
}
