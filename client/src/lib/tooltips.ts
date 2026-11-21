/**
 * One look for every hover note in the app (user, 2026-11-21). Any element with a `title` keeps it in the markup, but
 * while a mouse rests on it (or the keyboard focuses it) the native grey box is held back and this one shows instead:
 * the first part of a "a · b · c" note as a line of its own, the rest quieter beneath. It sits in the top layer
 * (a manual popover), so it shows over open dialogs too, and keeps inside the window.
 */
const DELAY = 350, WARM = 400, GAP = 8, EDGE = 8;

let tip: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let text = '';
let timer = 0;
let hiddenAt = 0;
let watch: MutationObserver | null = null;

function box() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'app-tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = 'app-tip';
  if ('popover' in tip) tip.popover = 'manual';
  document.body.append(tip);
  return tip;
}

/** Takes the title off the element (so the browser shows nothing of its own) and remembers it. */
function hold(el: HTMLElement) {
  const t = el.getAttribute('title');
  if (t != null) { el.dataset.tipTitle = t; el.removeAttribute('title'); }
  return el.dataset.tipTitle ?? '';
}

function release() {
  window.clearTimeout(timer);
  watch?.disconnect(); watch = null;
  if (target) {
    // React may have written a new title meanwhile; that one wins
    if (!target.hasAttribute('title') && target.dataset.tipTitle != null) target.setAttribute('title', target.dataset.tipTitle);
    delete target.dataset.tipTitle;
    if (target.getAttribute('aria-describedby') === 'app-tip') target.removeAttribute('aria-describedby');
  }
  target = null;
  if (tip?.classList.contains('on')) {
    tip.classList.remove('on');
    hiddenAt = performance.now();
    try { tip.hidePopover?.(); } catch { /* already hidden */ }
  }
}

function fill(el: HTMLDivElement, note: string) {
  const [head, ...rest] = note.split(' · ');
  el.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = head;
  el.append(strong);
  if (rest.length) { const sub = document.createElement('span'); sub.textContent = rest.join(' · '); el.append(sub); }
}

function place() {
  if (!target || !tip) return;
  const r = target.getBoundingClientRect();
  if (!r.width && !r.height) { release(); return; }
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), window.innerWidth - w - EDGE);
  const above = r.top - GAP - h;
  const top = above >= EDGE ? above : Math.min(r.bottom + GAP, window.innerHeight - h - EDGE);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.dataset.side = above >= EDGE ? 'top' : 'bottom';
}

function show() {
  if (!target || !text) return;
  const el = box();
  fill(el, text);
  try { el.showPopover?.(); } catch { /* not supported or already open */ }
  el.classList.add('on');
  if (!target.hasAttribute('aria-describedby') && !target.getAttribute('aria-label')) target.setAttribute('aria-describedby', 'app-tip');
  place();
}

function start(el: HTMLElement, now: boolean) {
  if (el === target) return;
  release();
  target = el;
  text = hold(el).trim();
  if (!text) { release(); return; }
  // a title React writes again while the note is up moves into the note instead of the native box
  watch = new MutationObserver(() => {
    if (!target || !target.hasAttribute('title')) return;
    text = hold(target).trim();
    if (tip?.classList.contains('on')) { if (text) { fill(tip, text); place(); } else release(); }
  });
  watch.observe(el, { attributes: true, attributeFilter: ['title'] });
  const warm = performance.now() - hiddenAt < WARM;
  if (now || warm) show(); else timer = window.setTimeout(show, DELAY);
}

const owner = (node: EventTarget | null) =>
  node instanceof Element ? node.closest<HTMLElement>('[title]:not(svg *), [data-tip-title]') : null;

export function installTooltips() {
  if (typeof document === 'undefined' || (window as unknown as { __tips?: boolean }).__tips) return;
  (window as unknown as { __tips?: boolean }).__tips = true;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = owner(e.target);
    if (el) start(el, false);
    else if (target) release();
  });
  document.addEventListener('pointerout', (e) => {
    if (!target || e.pointerType !== 'mouse') return;
    const to = e.relatedTarget;
    if (!(to instanceof Node) || !target.contains(to)) release();
  });
  document.addEventListener('focusin', (e) => {
    const el = owner(e.target);
    if (el && el === e.target && el.matches(':focus-visible')) start(el, false);
  });
  document.addEventListener('focusout', (e) => { if (e.target === target) release(); });
  document.addEventListener('pointerdown', release, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tip?.classList.contains('on')) release(); });
  window.addEventListener('scroll', release, true);
  window.addEventListener('blur', release);
}
