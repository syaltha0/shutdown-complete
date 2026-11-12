// Light, dark or the system's choice. Kept per device (a phone may be dark while the desk is light), in localStorage,
// and applied before the first paint by a small script in index.html.
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'sc-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* private mode */ }
  return 'system';
}

const resolve = (p: ThemePref) => (p === 'system' ? (media.matches ? 'dark' : 'light') : p);

function apply() {
  const t = resolve(getThemePref());
  if (document.documentElement.dataset.theme === t) return;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b0b0b' : '#f8f8f8');
  window.dispatchEvent(new Event('themechange'));
}

export function setThemePref(p: ThemePref) {
  try { localStorage.setItem(KEY, p); } catch { /* private mode */ }
  apply();
}

media.addEventListener('change', apply);
apply();

// Motion: the system's "reduce motion" setting, or always on, or always reduced. Also per device; the resolved value is
// html[data-motion="full" | "reduce"], which every animation rule and the scripts read instead of the media query.
export type MotionPref = 'system' | 'full' | 'reduce';
const MKEY = 'sc-motion';
const mmedia = window.matchMedia('(prefers-reduced-motion: reduce)');

export function getMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(MKEY);
    if (v === 'full' || v === 'reduce' || v === 'system') return v;
  } catch { /* private mode */ }
  return 'system';
}

/** True when animations should be reduced on this device. */
export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce';

function applyMotion() {
  const p = getMotionPref();
  const m = p === 'system' ? (mmedia.matches ? 'reduce' : 'full') : p;
  if (document.documentElement.dataset.motion === m) return;
  document.documentElement.dataset.motion = m;
  window.dispatchEvent(new Event('motionchange'));
}

export function setMotionPref(p: MotionPref) {
  try { localStorage.setItem(MKEY, p); } catch { /* private mode */ }
  applyMotion();
}

mmedia.addEventListener('change', applyMotion);
applyMotion();
