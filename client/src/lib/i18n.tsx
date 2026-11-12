// The planner's words in English and Turkish. Every visible string comes from here.
// The language lives in the settings document (so every device shows the same one) and in localStorage
// (so the sign-in screen knows it before the settings load).
import { en, type Words } from './words/en';
import { tr } from './words/tr';

export type Lang = 'en' | 'tr';

const dicts: Record<Lang, Words> = { en, tr };
const KEY = 'sc-lang';

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'tr') return v;
  } catch { /* private mode */ }
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let current: Lang = initial();
document.documentElement.lang = dicts[current].locale;

export const getLang = () => current;
export const dict = (l: Lang) => dicts[l];

/** Switches the language for everything rendered after this call. */
export function setLang(l: Lang) {
  if (l !== 'en' && l !== 'tr') return;
  current = l;
  document.documentElement.lang = dicts[l].locale;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
}

/** The words of the current language. The app re-renders from the top when the language changes. */
export const useT = () => dicts[current];
export const T = () => dicts[current];
