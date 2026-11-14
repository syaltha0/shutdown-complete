import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { reducedMotion } from './theme';

// A small history router: /day/2026-10-21, /week/2026-W43, /quarter/2026-Q4, /metrics, /shutdown/2026-10-21, /settings

export function navigate(to: string, replace = false) {
  if (to === location.pathname) return;
  const go = (inTransition: boolean) => {
    history[replace ? 'replaceState' : 'pushState'](null, '', to);
    const fire = () => window.dispatchEvent(new PopStateEvent('popstate'));
    // inside a view transition the new screen must render now, so the browser can cross-fade old and new;
    // a redirect (often from an effect, where React cannot render synchronously) just announces the change
    if (inTransition) flushSync(fire); else fire();
    window.scrollTo(0, 0);
  };
  const reduce = reducedMotion();
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reduce && !replace) doc.startViewTransition(() => go(true));
  else go(false);
}

export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

/** Plain left-clicks on internal links go through the router. */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = e.currentTarget.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('/api/')) return;
  e.preventDefault();
  navigate(href);
}

/** Wait for a destination section to mount, including during view transitions. */
export function navigateSection(id: string) {
  const reveal = () => {
    const el = document.getElementById(id);
    if (!el || location.pathname !== '/settings') return false;
    el.scrollIntoView({block:'start'}); el.focus({preventScroll:true}); return true;
  };
  const observer = new MutationObserver(()=>{if(reveal()) observer.disconnect();});
  observer.observe(document.body,{childList:true,subtree:true});
  navigate('/settings#'+id);
  requestAnimationFrame(()=>{if(reveal()) observer.disconnect();});
  setTimeout(()=>observer.disconnect(),5000);
}
