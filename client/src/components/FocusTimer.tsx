import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { today } from '../lib/dates';
import { chime, finishPhase, mmss, notify, pauseFocus, resumeFocus, secondsLeft, settingsFocus } from '../lib/focus';
import { useT } from '../lib/i18n';
import { emptyDay, type DayDoc, type FocusActive, featureOn } from '../lib/model';
import { onLinkClick, usePath } from '../lib/router';
import { useDoc } from '../lib/useDoc';
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
  const { value: day } = useDoc<DayDoc>(`day:${today()}`, emptyDay);
  const a = day?.focus?.active ?? null;
  useTick(!!a && a.pausedLeft == null);
  const ending = useRef<string | null>(null);
  const left = a ? secondsLeft(a) : 0;

  useEffect(() => {
    if (!a || a.pausedLeft != null || left > 0 || ending.current === a.startedAt) return;
    ending.current = a.startedAt;
    const f = settingsFocus(settings);
    finishPhase(settings).then((r) => {
      if (r === 'none') return;
      if (f.sound) chime();
      if (r === 'logged') { notify(T.focusDone, T.takeBreak(f.shortMin)); stopAmbient(); }
      else notify(T.breakOver, T.backToPlan);
    });
  }, [a, left, settings, T]);

  // friends see whether this timer runs (the server keeps it to friends, and only if this person shares it)
  const presenceKey = a ? `${a.phase}:${a.startedAt}:${a.pausedLeft == null}:${a.label}:${a.roomId ?? ''}` : 'none';
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
  return (
    <div className={`mini-timer phase-${a.phase}`} role="status" aria-label={T.focusRunning}>
      <Ring a={a} size={36} stroke={4} />
      <a href="/focus" onClick={onLinkClick} className="mt-text">
        <b className="num">{mmss(left)}</b>
        <span>{a.phase === 'focus' ? a.label || T.freeFocus : T.phase[a.phase]}</span>
      </a>
      {a.pausedLeft == null
        ? <button type="button" className="btn ghost" onClick={() => pauseFocus()}>{T.pause}</button>
        : <button type="button" className="btn ghost" onClick={() => resumeFocus()}>{T.resume}</button>}
    </div>
  );
}
