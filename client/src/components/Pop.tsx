// A small panel that opens beside or under its button: menus, pickers (boards, links between plans).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { IconX } from './Icons';

/**
 * A small panel that opens under its button (a menu, a label picker), Planka's pop-overs. It sits in the page's flow
 * (absolute to its wrapper), so it also works inside a modal dialog; a click outside or Esc closes it.
 */
export function Pop({ open, onClose, title, children, align = 'left', className = '', beside = false }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; align?: 'left' | 'right'; className?: string;
  /** set beside the element it belongs to (a tile), as wide as it and kept inside the window, instead of under its button */
  beside?: boolean;
}) {
  const T = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const w = ref.current?.parentElement; if (w && !w.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [open, onClose]);
  useLayoutEffect(() => {
    if (!open || !beside) { setPos(null); return; }
    const el = ref.current, a = el?.parentElement;
    if (!el || !a) return;
    // to the right of the tile if there is room, else to its left, else over its lower part (a phone); never past the
    // window's edges, so nothing has to be scrolled to reach it
    const place = () => {
      const r = a.getBoundingClientRect(), vw = document.documentElement.clientWidth, m = 12, gap = 10;
      // the phone's tab bar covers the foot of the window
      const bar = document.querySelector<HTMLElement>('.tabbar');
      const vh = window.innerHeight - (bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0);
      const h = Math.min(el.scrollHeight, vh - 2 * m);
      let left = r.right + gap;
      if (left + r.width > vw - m) left = r.left - gap - r.width;
      const side = left >= m;
      if (!side) left = r.left;
      const top = Math.max(m, Math.min(side ? r.top : r.top + 48, vh - m - h));
      setPos({ position: 'fixed', left, top, width: r.width, maxHeight: vh - 2 * m, overflowY: 'auto' });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, beside]);
  if (!open) return null;
  return (
    <div ref={ref} className={`kb-pop ${align} ${className}`} role="dialog" aria-label={title} style={beside ? (pos ?? { visibility: 'hidden' }) : undefined}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="kb-pop-head"><b>{title}</b><button type="button" className="btn ghost icon" aria-label={T.close} onClick={onClose}><IconX /></button></div>
      {children}
    </div>
  );
}
