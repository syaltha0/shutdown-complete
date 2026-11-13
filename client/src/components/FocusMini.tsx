import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../App';
import { useT } from '../lib/i18n';
import { finishPhase, mmss, pauseFocus, resumeFocus, secondsLeft, settingsFocus, useFocusDay } from '../lib/focus';
import { useTick } from './FocusTimer';

type PipWindow = Window & { documentPictureInPicture?: { requestWindow(options: { width: number; height: number }): Promise<Window> } };

export function FocusMini() {
  const T = useT();
  const { settings } = useSettings();
  const { active: a, key } = useFocusDay();
  useTick(!!a && a.pausedLeft == null);
  const [pip, setPip] = useState<Window | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [error, setError] = useState(false);
  const resources = useRef<{ video: HTMLVideoElement; stream: MediaStream; canvas: HTMLCanvasElement } | null>(null);
  const busy = useRef(false);
  const supported = !!(window as PipWindow).documentPictureInPicture || (!!document.pictureInPictureEnabled && !!HTMLCanvasElement.prototype.captureStream);
  const locked = !!settingsFocus(settings).strict && a?.phase === 'focus';
  const last = useRef(a);
  if (a) last.current = a;
  const shown = a ?? last.current;
  const keepOpen = !!settingsFocus(settings).miniKeepOpen;
  const left = a ? secondsLeft(a) : 0;
  const togglePause = () => { if (!a || locked) return; void (a.pausedLeft == null ? pauseFocus(key) : resumeFocus(key)); };
  function close() {
    pip?.close(); setPip(null);
    const r = resources.current;
    if (r) {
      resources.current = null;
      if (document.pictureInPictureElement === r.video) void document.exitPictureInPicture().catch(() => {});
      r.stream.getTracks().forEach(track => track.stop()); r.video.pause(); r.video.srcObject = null; r.video.remove();
    }
    setVideoOpen(false);
  }
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => { if (!a && !keepOpen) closeRef.current(); }, [!!a, keepOpen]);
  useEffect(() => {
    const stop = () => closeRef.current();
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); };
  }, []);
  useEffect(() => { if (!error) return; const id = window.setTimeout(() => setError(false), 4000); return () => clearTimeout(id); }, [error]);
  useEffect(() => {
    if (!pip) return;
    const sync = () => { pip.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? ''; pip.document.documentElement.lang = T.locale; };
    sync();
    const observer = new MutationObserver(sync); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [pip, T.locale]);
  useEffect(() => {
    if (!videoOpen || !resources.current || !shown) return;
    const canvas = resources.current.canvas, ctx = canvas.getContext('2d'); if (!ctx) return;
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue(shown.phase === 'focus' ? '--hue' : shown.phase === 'short' ? '--positive' : '--focus-long').trim();
    ctx.fillStyle = style.getPropertyValue('--surface').trim(); ctx.fillRect(0, 0, 520, 300);
    ctx.fillStyle = color; ctx.fillRect(40, 40, 440 * Math.max(0, Math.min(1, left / (shown.plannedMin * 60))), 4);
    ctx.textAlign = 'center'; ctx.fillStyle = style.getPropertyValue('--text').trim(); ctx.font = '500 100px Jost'; ctx.fillText(mmss(left), 260, 178);
    ctx.fillStyle = color; ctx.font = '400 28px Jost'; ctx.fillText(T.phase[shown.phase], 260, 234);
  });
  useEffect(() => {
    if (!videoOpen || !('mediaSession' in navigator)) return;
    const media = navigator.mediaSession;
    try { media.setActionHandler('pause', () => { if (a?.pausedLeft == null) togglePause(); }); media.setActionHandler('play', () => { if (a?.pausedLeft != null) togglePause(); }); } catch { /* unsupported media actions */ }
    return () => { media.setActionHandler('pause', null); media.setActionHandler('play', null); };
  }, [videoOpen, a, locked, key]);
  async function toggle() {
    if (pip || videoOpen) { close(); return; }
    if (!a || busy.current || !supported) return;
    busy.current = true; setError(false);
    try {
      const api = (window as PipWindow).documentPictureInPicture;
      if (api) {
        const w = await api.requestWindow({ width: 260, height: 150 });
        document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => w.document.head.appendChild(el.cloneNode(true)));
        w.document.adoptedStyleSheets = [...document.adoptedStyleSheets];
        w.document.body.className = 'focus-mini-body'; w.document.title = T.miniTimer;
        w.addEventListener('pagehide', () => setPip(null), { once: true });
        setPip(w);
      } else {
        const canvas = document.createElement('canvas'); canvas.width = 520; canvas.height = 300;
        const stream = canvas.captureStream(1), video = document.createElement('video');
        video.hidden = true; video.muted = true; video.playsInline = true; video.srcObject = stream; document.body.appendChild(video);
        resources.current = { canvas, stream, video }; setVideoOpen(true);
        await video.play(); await video.requestPictureInPicture();
        video.addEventListener('leavepictureinpicture', () => closeRef.current(), { once: true });
      }
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
    <button type="button" className="btn icon focus-mini-trigger" aria-label={T.miniTimer} title={T.miniTimer} aria-pressed={!!pip || videoOpen} disabled={!a} onClick={() => void toggle()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><rect x="11" y="11" width="7" height="6" rx="1"/></svg></button>
    {error && <span className="muted" role="status">{T.miniTimerError}</span>}
    {pip && shown && createPortal(<main className={`focus-mini phase-${shown.phase}`}>
      <div className="focus-mini-track" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, left / (shown.plannedMin * 60) * 100))}%` }} /></div>
      <b className="focus-mini-time num" role="timer">{mmss(left)}</b>
      <span className="focus-mini-phase">{T.phase[shown.phase]}</span>
      <div className="focus-mini-controls">
        <button type="button" className="btn icon" aria-label={shown.pausedLeft == null ? T.pause : T.resume} disabled={!a || locked} onClick={togglePause}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{shown.pausedLeft == null ? <path d="M7 5h3v14H7zm7 0h3v14h-3z"/> : <path d="m8 5 11 7-11 7z"/>}</svg></button>
        <button type="button" className="btn icon" aria-label={shown.phase === 'focus' ? T.finishNow : T.skipBreak} disabled={!a || locked} onClick={() => { if (a && !locked) void finishPhase(settings, true, { key, startedAt: a.startedAt }); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m5 5 10 7-10 7zm12 0h2v14h-2z"/></svg></button>
      </div>
    </main>, pip.document.body)}
  </>;
}
