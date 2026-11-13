import { useEffect, useState } from 'react';

// The floating timer's per-device choices (which corner it sits in, whether it is shrunk to a ring).
// They live in localStorage, which can be missing or refuse writes, so every access is guarded.

/** Bottom/top, then left/right: 'br' is the bottom right corner. */
export type Corner = 'br' | 'bl' | 'tl' | 'tr';
export const CORNERS: Corner[] = ['br', 'bl', 'tl', 'tr'];
const CORNER_KEY = 'sc-mini-corner';

export function readCorner(): Corner {
  try { const v = localStorage.getItem(CORNER_KEY); if (CORNERS.includes(v as Corner)) return v as Corner; } catch { /* storage unavailable */ }
  return 'br';
}
export function saveCorner(c: Corner) { try { localStorage.setItem(CORNER_KEY, c); } catch { /* storage unavailable */ } }

/** The corner a dropped timer settles in: the one nearest its centre. Phones only choose top or bottom. */
export function nearestCorner(cx: number, cy: number, w: number, h: number, phone: boolean, side: 'l' | 'r'): Corner {
  const v = cy < h / 2 ? 't' : 'b';
  return `${v}${phone ? side : cx < w / 2 ? 'l' : 'r'}` as Corner;
}

/** The next corner in the order bottom right, bottom left, top left, top right (phones: bottom, top). */
export function nextCorner(c: Corner, phone: boolean): Corner {
  if (phone) return `${c[0] === 'b' ? 't' : 'b'}${c[1]}` as Corner;
  return CORNERS[(CORNERS.indexOf(c) + 1) % CORNERS.length];
}

/** True while the viewport is phone-sized (the tab bar layout); the corner is then only top or bottom. */
export function usePhone(): boolean {
  const query = '(max-width: 860px)';
  const [phone, set] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query), on = () => set(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
