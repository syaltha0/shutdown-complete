import { useLayoutEffect, useRef } from 'react';

/**
 * A row of choices (buttons with aria-pressed) on a tone step, with a thumb that slides to the chosen one.
 * The thumb follows whatever button is pressed, so callers keep writing plain buttons inside it.
 */
export function Segmented({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const b = box.current, t = thumb.current;
    if (!b || !t) return;
    let raf = 0;
    const place = () => {
      const on = b.querySelector<HTMLElement>(':scope > button[aria-pressed="true"]');
      t.style.opacity = on ? '1' : '0';
      if (!on) return;
      t.style.transform = `translateX(${on.offsetLeft}px)`;
      t.style.width = `${on.offsetWidth}px`;
      // the first placement jumps; only later changes slide
      if (!b.classList.contains('ready')) raf = requestAnimationFrame(() => b.classList.add('ready'));
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(b, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed'] });
    const ro = new ResizeObserver(place);
    ro.observe(b);
    document.fonts?.ready.then(place);
    return () => { cancelAnimationFrame(raf); mo.disconnect(); ro.disconnect(); };
  }, []);
  return (
    <div ref={box} className={`segmented ${className}`.trim()} {...rest}>
      <span ref={thumb} className="seg-thumb" aria-hidden="true" />
      {children}
    </div>
  );
}
