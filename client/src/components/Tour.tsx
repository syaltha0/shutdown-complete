import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { useT } from '../lib/i18n';

interface Rect { top: number; left: number; width: number; height: number }

/** The first visible element for a tour target (the rail on a desktop, the tab bar on a phone). */
function findTarget(name: string): HTMLElement | null {
  if (!name) return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  return all.find((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden') ?? null;
}

/** A guided walk through the method, shown at first sign-in and again from Settings. */
export function Tour() {
  const T = useT();
  const { settings, update } = useSettings();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(window.innerWidth);
  const card = useRef<HTMLDivElement>(null);
  const steps = T.tour;
  const open = settings.tourDone !== true;
  const step = steps[Math.min(i, steps.length - 1)];

  const measure = useCallback(() => {
    setVw(window.innerWidth);
    const el = findTarget(step.target);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    const pad = 6;
    setRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  }, [step.target]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = findTarget(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    measure();
    const t = window.setTimeout(measure, 450); // after a smooth scroll
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, step.target, measure]);

  const close = useCallback(() => update((s) => ({ ...s, tourDone: true })), [update]);
  const next = useCallback(() => (i >= steps.length - 1 ? close() : setI(i + 1)), [i, steps.length, close]);
  const back = useCallback(() => setI(Math.max(0, i - 1)), [i]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, close]);

  useEffect(() => { if (open) card.current?.focus(); }, [open, i]);
  useEffect(() => { if (!open) setI(0); }, [open]);

  if (!open) return null;

  // the card sits beside its target when there is room, else under it; on a phone it is a bottom sheet
  const phone = vw <= 860;
  const W = 360;
  let style: React.CSSProperties = {};
  if (!phone && rect) {
    const roomRight = vw - (rect.left + rect.width);
    if (rect.width < 120 && roomRight > W + 24) {
      style = { left: rect.left + rect.width + 16, top: Math.max(16, Math.min(window.innerHeight - 260, rect.top)) };
    } else {
      const below = rect.top + rect.height + 16;
      const top = below + 240 < window.innerHeight ? below : Math.max(16, rect.top - 256);
      style = { left: Math.max(16, Math.min(vw - W - 16, rect.left)), top };
    }
  }

  return (
    <div className={`tour${phone ? ' phone' : ''}`} role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour-spot${rect ? '' : ' none'}`}
        style={rect ? { transform: `translate(${rect.left}px, ${rect.top}px)`, width: rect.width, height: rect.height } : undefined} />
      <div className={`tour-card${rect && !phone ? '' : ' centred'}`} style={style} ref={card} tabIndex={-1} key={i}>
        <span className="tour-count num">{T.tourStep(i + 1, steps.length)}</span>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-foot">
          <button type="button" className="btn ghost" onClick={close}>{T.tourSkip}</button>
          <div className="right">
            {i > 0 && <button type="button" className="btn" onClick={back}>{T.tourBack}</button>}
            <button type="button" className="btn primary" onClick={next}>{i >= steps.length - 1 ? T.tourDone : T.tourNext}</button>
          </div>
        </div>
        <div className="tour-dots" aria-hidden="true">{steps.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
      </div>
    </div>
  );
}
