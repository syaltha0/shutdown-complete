import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { useT } from '../lib/i18n';
import { finishPhase, mmss, pauseFocus, resumeFocus, secondsLeft, settingsFocus, useFocusDay } from '../lib/focus';
import { useTick } from './FocusTimer';

// The mini timer is the timer drawn into a canvas and played as a video in the browser's picture-in-picture window:
// it floats over other apps and, unlike a Document Picture-in-Picture window, carries no address bar (the user found
// that one ugly). Pause/play and skip are the window's own media buttons (Media Session).
const W = 640, H = 360;

export function FocusMini() {
  const T = useT();
  const { settings } = useSettings();
  const { active: a, key } = useFocusDay();
  useTick(!!a && a.pausedLeft == null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const resources = useRef<{ video: HTMLVideoElement; stream: MediaStream; canvas: HTMLCanvasElement } | null>(null);
  const busy = useRef(false);
  const supported = !!document.pictureInPictureEnabled && !!HTMLCanvasElement.prototype.captureStream;
  const locked = !!settingsFocus(settings).strict && a?.phase === 'focus';
  const last = useRef(a);
  if (a) last.current = a;
  const shown = a ?? last.current;
  const keepOpen = !!settingsFocus(settings).miniKeepOpen;
  const left = a ? secondsLeft(a) : 0;
  const togglePause = () => { if (!a || locked) return; void (a.pausedLeft == null ? pauseFocus(key) : resumeFocus(key)); };
  const skip = () => { if (a && !locked) void finishPhase(settings, true, { key, startedAt: a.startedAt }); };

  function close() {
    const r = resources.current;
    if (r) {
      resources.current = null;
      if (document.pictureInPictureElement === r.video) void document.exitPictureInPicture().catch(() => {});
      r.stream.getTracks().forEach((track) => track.stop()); r.video.pause(); r.video.srcObject = null; r.video.remove();
    }
    setOpen(false);
  }
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => { if (!a && !keepOpen) closeRef.current(); }, [!!a, keepOpen]);
  useEffect(() => {
    const stop = () => closeRef.current();
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); };
  }, []);
  useEffect(() => { if (!error) return; const id = window.setTimeout(() => setError(false), 4000); return () => clearTimeout(id); }, [error]);

  // draw: the theme's surface, a thin progress track in the phase colour, the time large, the phase under it
  useEffect(() => {
    if (!open || !resources.current || !shown) return;
    const ctx = resources.current.canvas.getContext('2d'); if (!ctx) return;
    const css = getComputedStyle(document.documentElement), v = (n: string) => css.getPropertyValue(n).trim();
    const color = v(shown.phase === 'focus' ? '--hue' : shown.phase === 'short' ? '--positive' : '--focus-long');
    const frac = Math.max(0, Math.min(1, left / (shown.plannedMin * 60)));
    ctx.fillStyle = v('--surface'); ctx.fillRect(0, 0, W, H);
    const bar = (w: number, fill: string) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(64, 72, Math.max(6, w), 6, 3); ctx.fill(); };
    bar(W - 128, v('--border')); if (frac > 0) bar((W - 128) * frac, color);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = v('--text'); ctx.font = '500 132px Jost'; ctx.fillText(mmss(left), W / 2, 230);
    ctx.fillStyle = color; ctx.font = '400 30px Jost';
    ctx.fillText(shown.pausedLeft != null ? `${T.phase[shown.phase]} · ${T.pause}` : T.phase[shown.phase], W / 2, 290);
  });

  // the window's media buttons: play/pause follows the timer, "next" skips the phase (off in strict mode)
  useEffect(() => {
    if (!open || !('mediaSession' in navigator)) return;
    const media = navigator.mediaSession;
    const set = (k: MediaSessionAction, f: (() => void) | null) => { try { media.setActionHandler(k, f); } catch { /* not offered here */ } };
    set('pause', locked ? null : () => { if (a?.pausedLeft == null) togglePause(); });
    set('play', locked ? null : () => { if (a?.pausedLeft != null) togglePause(); });
    set('nexttrack', locked ? null : skip);
    media.playbackState = a && a.pausedLeft == null ? 'playing' : 'paused';
    return () => { set('pause', null); set('play', null); set('nexttrack', null); };
  }, [open, a, locked, key]);

  async function toggle() {
    if (open) { close(); return; }
    if (!a || busy.current || !supported) return;
    busy.current = true; setError(false);
    try {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const stream = canvas.captureStream(2), video = document.createElement('video');
      video.hidden = true; video.muted = true; video.playsInline = true; video.srcObject = stream; document.body.appendChild(video);
      resources.current = { canvas, stream, video }; setOpen(true);
      await video.play(); await video.requestPictureInPicture();
      video.addEventListener('leavepictureinpicture', () => closeRef.current(), { once: true });
    } catch { close(); setError(true); }
    finally { busy.current = false; }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'm' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable], dialog, [role="dialog"]') || document.querySelector('dialog[open], .focus-room')) return;
      e.preventDefault(); void toggle();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  if (!supported) return null;
  return <>
    <button type="button" className="btn icon focus-mini-trigger" aria-label={T.miniTimer} title={T.miniTimer} aria-pressed={open} disabled={!a} onClick={() => void toggle()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><rect x="11" y="11" width="7" height="6" rx="1"/></svg></button>
    {error && <span className="muted" role="status">{T.miniTimerError}</span>}
  </>;
}
