import { useLayoutEffect, useRef } from 'react';

// Keep short blocks accessible through their title without clipping their name.
export function OverviewTimelineLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const label = ref.current;
    if (!label) return;
    const fit = () => { label.style.visibility = label.scrollWidth > label.clientWidth ? 'hidden' : 'visible'; };
    const observer = new ResizeObserver(fit);
    observer.observe(label);
    fit();
    return () => observer.disconnect();
  }, [text]);
  return <span ref={ref}>{text}</span>;
}
