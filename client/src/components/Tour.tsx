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
  const [cardHeight, setCardHeight] = useState(260);
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
  useLayoutEffect(() => {
    if (!open || !card.current) return;
    const observer = new ResizeObserver(([entry]) => setCardHeight(entry.target.getBoundingClientRect().height));
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [open, i]);

  if (!open) return null;

  // Use the visible target and measured card, including translated/wrapped text.
  const phone = vw <= 860;
  const W = 360;
  const width = phone ? vw - 24 : W;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(12, Math.min(vw - width - 12, x));
  const clampY = (y: number) => Math.max(12, Math.min(vh - cardHeight - 12, y));
  let left = (vw - width) / 2, top = clampY((vh - cardHeight) / 2);
  let spot = rect && { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
    width: Math.max(0, Math.min(vw, rect.left + rect.width) - Math.max(0, rect.left)),
    height: Math.max(0, Math.min(vh, rect.top + rect.height) - Math.max(0, rect.top)) };
  if (spot) {
    const candidates = [
      { left: clampX(spot.left), top: spot.top + spot.height + 16 },
      { left: clampX(spot.left), top: spot.top - cardHeight - 16 },
      { left: spot.left + spot.width + 16, top: clampY(spot.top) },
      { left: spot.left - width - 16, top: clampY(spot.top) },
    ];
    const free = candidates.find((p) => p.left >= 12 && p.left + width <= vw - 12 && p.top >= 12 && p.top + cardHeight <= vh - 12);
    if (free) ({ left, top } = free);
    else {
      // A full-height grid has no outside space. Dock the card and expose only
      // the target above it, keeping the highlighted part clear of the card.
      left = clampX(spot.left); top = clampY(vh - cardHeight - 12);
      spot = { ...spot, height: Math.max(0, Math.min(spot.height, top - spot.top - 16)) };
    }
  }
  const style: React.CSSProperties = { left, top, bottom: 'auto', right: 'auto', width, translate: 'none', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto' };

  return (
    <div className={`tour${phone ? ' phone' : ''}`} role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour-spot${rect ? '' : ' none'}`}
        style={spot ? { transform: `translate(${spot.left}px, ${spot.top}px)`, width: spot.width, height: spot.height } : undefined} />
      <div className="tour-card" style={style} ref={card} tabIndex={-1} key={i}>
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
