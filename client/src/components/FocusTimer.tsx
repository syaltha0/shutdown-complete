import { FocusRoom } from './FocusRoom';
import { showNotification } from '../lib/pwa';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { today } from '../lib/dates';
import { chime, extendFocus, MAX_PLANNED, finishPhase, mmss, notify, pauseFocus, refreshFocus, resumeFocus, secondsLeft, settingsFocus, startFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';
import { type FocusActive, featureOn } from '../lib/model';
import { onLinkClick, usePath } from '../lib/router';
import { ambientPlaying, stopAmbient } from '../lib/ambient';
import { api } from '../lib/api';

/** Ticks once a second while a timer runs. */
export function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => set((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return Date.now();
}

/** The progress ring: the one hue on the screen while a session runs. */
export function Ring({ a, size, stroke }: { a: FocusActive; size: number; stroke: number }) {
  const total = a.plannedMin * 60;
  const left = secondsLeft(a);
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const done = total ? 1 - left / total : 0;
  return (
    <svg className={`ring phase-${a.phase}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--raised)" strokeWidth={stroke} />
      <circle className="ring-fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - done)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/**
 * Lives in the shell: ends a phase when its time is up (logs the session, starts the break), chimes, notifies,
 * and keeps the tab title on the clock. Shows a small floating timer on every screen except Focus itself.
 */
export function FocusRunner() {
  const T = useT();
  const { settings } = useSettings();
  const path = usePath();
  const [closedBreak, setClosedBreak] = useState<string | null>(null);
  const f = settingsFocus(settings);
  const { active: a, key, holder } = useFocusDay();
  useTick(!!a && a.pausedLeft == null);

  useEffect(() => {
    const check = async () => {
      if (!f.scheduled || a?.roomId) return;
      const now = new Date(), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      for (const b of (f.breaks ?? []).slice(0, 5)) {
        const stamp = `sc:break:${today()}:${b.id}`;
        if (b.time !== time || localStorage.getItem(stamp)) continue;
        localStorage.setItem(stamp, '1');
        if (a) await finishPhase(settings, true, {key, startedAt: a.startedAt});
        await startFocus({phase: 'long', minutes: b.minutes, blockId: null, label: b.label || T.phase.long});
        showNotification(T.focusDone, b.label || T.phase.long);
        break;
      }
    };
    void check(); const timer = window.setInterval(() => void check(), 1000);
    return () => window.clearInterval(timer);
  }, [settings, a, key, T]);

  // another device may have paused, extended, ended or started the timer: look again while the tab is in view
  const running = !!a;
  useEffect(() => {
    const look = () => {
      if (document.visibilityState !== 'visible') return;
      refreshFocus(`day:${today()}`);
      if (key !== `day:${today()}`) refreshFocus(key);
    };
    const t = window.setInterval(look, running ? 15_000 : 60_000);
    document.addEventListener('visibilitychange', look);
    window.addEventListener('focus', look);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', look); window.removeEventListener('focus', look); };
  }, [key, running]);
  const ending = useRef<string | null>(null);
  const left = a ? secondsLeft(a) : 0;

  useEffect(() => {
    if (!a || a.pausedLeft != null || left > 0 || ending.current === a.startedAt) return;
    ending.current = a.startedAt;
    const f = settingsFocus(settings);
    finishPhase(settings, false, { key, startedAt: a.startedAt }).then((r) => {
      if (r === 'none') return;
      if (f.voice && 'speechSynthesis' in window) {
        const speech = new SpeechSynthesisUtterance(r === 'logged' ? T.focusOptions.breakVoice : T.focusOptions.focusVoice);
        speech.lang = T.locale; speech.volume = f.volume ?? 1; window.speechSynthesis.speak(speech);
      }
      if (f.sound) chime(f);
      if (r === 'logged') { notify(T.focusDone, T.takeBreak(f.shortMin)); stopAmbient(); }
      else notify(T.breakOver, T.backToPlan);
    });
  }, [a, left, settings, T, key]);

  // friends see whether this timer runs (the server keeps it to friends, and only if this person shares it)
  const presenceKey = a ? `${a.phase}:${a.startedAt}:${a.pausedLeft == null}:${a.label}:${a.roomId ?? ''}:${a.plannedMin}` : 'none';
  const sharing = featureOn(settings, 'friends');
  useEffect(() => {
    const t = window.setTimeout(() => {
      api.presence(a && sharing ? {
        state: a.pausedLeft != null ? 'paused' : a.phase, label: a.label, roomId: a.roomId ?? null,
        endsAt: a.pausedLeft != null ? null : new Date(Date.parse(a.startedAt) + a.plannedMin * 60_000).toISOString(),
      } : null).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [presenceKey, sharing]); // eslint-disable-line react-hooks/exhaustive-deps

  // a session stopped or finished early: the background sound fades out with it
  useEffect(() => { if (!a && ambientPlaying()) stopAmbient(); }, [a]);
  useEffect(() => { if (a && a.phase !== 'focus' && ambientPlaying()) stopAmbient(); }, [a?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = a ? `${mmss(left)} · ${a.phase === 'focus' ? a.label || T.freeFocus : T.phase[a.phase]}` : 'Shutdown Complete';
  }, [a, left, T]);

  if (!a || path.startsWith('/focus')) return null;
  return <>{f.fullscreenBreak && a.phase !== 'focus' && closedBreak !== a.startedAt && <FocusRoom start={{blockId: a.blockId, label: a.label, minutes: a.plannedMin}} onClose={() => setClosedBreak(a.startedAt)} />}
    <FocusMiniPanel a={a} docKey={key} count={holder?.focus?.sessions.length ?? 0} />
  </>;
}

function FocusMiniPanel({ a, docKey, count }: { a: FocusActive; docKey: string; count: number }) {
  const T = useT();
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const suppressed = useRef(false);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) { suppressed.current = true; setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const left = secondsLeft(a);
  const locked = !!f.strict && a.phase === 'focus';
  const cycle = Math.max(1, f.longEvery);
  const session = (count % cycle + (a.phase === 'focus' ? 1 : 0)) || cycle;
  const next = a.phase !== 'focus' ? 'focus' : (count + 1) % cycle === 0 ? 'long' : 'short';
  const nextMin = next === 'focus' ? f.focusMin : next === 'long' ? f.longMin : a.breakMin ?? f.shortMin;
  const end = new Date(Date.now() + left * 1000).toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' });
  const togglePause = () => a.pausedLeft == null ? pauseFocus(docKey) : resumeFocus(docKey);
  return <div ref={root} className={`mini-timer phase-${a.phase}`} data-open={open}
    onPointerEnter={e => { if (e.pointerType === 'mouse') { suppressed.current = false; setOpen(true); } }}
    onPointerLeave={e => { if (e.pointerType === 'mouse' && !root.current?.contains(document.activeElement)) setOpen(false); }}
    onFocus={() => { if (!suppressed.current) setOpen(true); }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { suppressed.current = false; setOpen(false); } }}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); suppressed.current = true; trigger.current?.focus(); setOpen(false); } }}>
    {/* one body: the details unfold above the pill row, inside the same card */}
    <section id="mini-focus-details" className="mt-panel" aria-label={T.focusRunning} inert={!open} aria-hidden={!open}>
      <div className="mt-panel-clip"><div className="mt-body">
        <span className="mt-phase">{T.phase[a.phase]}</span>
        <strong className="mt-label">{a.label || T.freeFocus}</strong>
        <div className="mt-meta"><span>{T.sessionN(session, cycle)}</span><span>{a.pausedLeft == null ? T.miniEnds(end) : T.miniPaused}</span></div>
        <p className="mt-next">{T.miniNext(T.phase[next], nextMin)}</p>
        <div className="mt-actions">
          <button type="button" className="btn sm" disabled={a.plannedMin >= MAX_PLANNED} onClick={() => extendFocus(5, docKey)}>{T.plusFive}</button>
          <button type="button" className="btn sm ghost" disabled={locked} onClick={() => finishPhase(settings, true, {key: docKey, startedAt: a.startedAt})}>{a.phase === 'focus' ? T.finishNow : T.skipBreak}</button>
          <a className="card-link mt-link" href="/focus" onClick={onLinkClick}>{T.miniGoFocus}</a>
        </div>
      </div></div>
    </section>
    <div className="mt-row">
      <Ring a={a} size={36} stroke={4} />
      <button ref={trigger} type="button" className="mt-text mt-trigger" aria-expanded={open} aria-controls="mini-focus-details"
        onPointerDown={e => { if (e.pointerType !== 'mouse') { e.preventDefault(); suppressed.current = false; setOpen(true); } }}
        onClick={() => { suppressed.current = false; setOpen(true); }}>
        <b className="num">{mmss(left)}</b><span>{a.label || T.freeFocus}</span>
      </button>
      <button type="button" className="btn ghost mt-pause" disabled={locked} onClick={togglePause}>{a.pausedLeft == null ? T.pause : T.resume}</button>
    </div>
  </div>;
}
