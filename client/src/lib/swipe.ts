// Phone gestures: a sideways swipe moves to the previous or next day (week, month), and the page that opens slides
// in from the side the finger went. A block being moved with a long press locks the swipe.
import { useEffect, useRef } from 'react';
import { navigate } from './router';
import { reducedMotion } from './theme';

let lastDir: 'left' | 'right' | null = null;
let locked = false;
/** Set while a block is moved by a long press, so letting go does not also turn the page. */
export const lockSwipe = (on: boolean) => { locked = on; };

// a swipe that starts on a control means that control, not the page
const ownGesture = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('input, textarea, select, dialog, .segmented, .day-chips, .tabbar, [data-noswipe]');

/** Attach to the page's wrapper: a sideways swipe goes to `prev` (finger to the right) or `next` (to the left). */
export function useSwipeNav(prev: string, next: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s: { x: number; y: number; t: number } | null = null;
    const start = (e: TouchEvent) => {
      s = e.touches.length === 1 && !ownGesture(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    };
    const end = (e: TouchEvent) => {
      const from = s;
      s = null;
      if (!from || locked) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - from.x, dy = t.clientY - from.y;
      // clearly sideways, far enough and quick: a swipe, not a scroll or a slow drag
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - from.t > 700) return;
      lastDir = dx < 0 ? 'left' : 'right';
      navigate(dx < 0 ? next : prev);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchend', end); };
  }, [prev, next]);

  // the page arriving after a swipe slides in from that side (a fade under reduced motion)
  useEffect(() => {
    const dir = lastDir;
    lastDir = null;
    const canvas = document.querySelector<HTMLElement>('.canvas');
    if (!dir || !canvas?.animate) return;
    const x = dir === 'left' ? 28 : -28;
    canvas.animate(
      reducedMotion() ? [{ opacity: 0.4 }, { opacity: 1 }] : [{ transform: `translateX(${x}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, []);
  return ref;
}
