import { useEffect, useRef } from 'react';
import '../vendor/charts.js';

// taste-skill's charts.js (vendored from .claude/skills/design-taste-frontend/assets) draws into a plain element.
declare global {
  interface Window { Charts: any }
}

/** A colour token of the current theme, for chart code that needs a literal colour. */
export const themeColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function Chart({ draw, deps, label }: { draw: (el: HTMLElement, Charts: any) => void; deps: unknown[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    // fonts change label widths: draw once they are in
    let live = true;
    const render = () => {
      if (!live || !ref.current) return;
      ref.current.innerHTML = '';
      draw(ref.current, window.Charts);
      ref.current.querySelectorAll<SVGRectElement>('rect[shape-rendering="crispEdges"]').forEach((r, i) => {
        r.classList.add('grow');
        r.style.animationDelay = `${Math.min(i * 14, 700)}ms`;
      });
    };
    document.fonts.ready.then(render);
    window.addEventListener('themechange', render);
    return () => { live = false; window.removeEventListener('themechange', render); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div className="chart" ref={ref} aria-label={label} />;
}
