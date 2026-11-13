import { FocusRoom } from './FocusRoom';
import { showNotification } from '../lib/pwa';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { clock, nowMinutes, today } from '../lib/dates';
import { chime, cycleDone, extendFocus, resetCycle, MAX_PLANNED, finishPhase, mmss, notify, pauseFocus, refreshFocus, resumeFocus, secondsLeft, settingsFocus, startFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';
import { type Block, type FocusActive, activeColumn, featureOn } from '../lib/model';
import { onLinkClick, usePath } from '../lib/router';
import { ambientPlaying, stopAmbient } from '../lib/ambient';
import { api } from '../lib/api';
import { SkipChoice, useSkip } from './SkipChoice';
import { type Corner, nearestCorner, readCompact, readCorner, reducedMotion, saveCompact, saveCorner, usePhone } from './MiniTimerPrefs';

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

/** The time-left ring: full when idle and at the start of a phase, draining to empty as the phase runs. */
export function Ring({ a, size, stroke }: { a: FocusActive; size: number; stroke: number }) {
  const total = a.plannedMin * 60;
  const left = secondsLeft(a);
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const remaining = total ? Math.min(1, Math.max(0, left / total)) : 1;
  return (
    // keyed by the phase's start, so a new phase draws full at once instead of sweeping back up
    <svg key={`${a.phase}:${a.startedAt}`} className={`ring phase-${a.phase}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--raised)" strokeWidth={stroke} />
      <circle className="ring-fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - remaining)} opacity={remaining > 0 ? 1 : 0} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
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
  const { active: a, key, holder, value: day } = useFocusDay();
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
  // Alt+P pauses or resumes the timer from any screen, except while typing or with a dialog open (the Focus screen keeps Space as well)
  const hotkey = useRef({ a, key, locked: !!f.strict && a?.phase === 'focus' });
  hotkey.current = { a, key, locked: !!f.strict && a?.phase === 'focus' };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyP' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.isContentEditable || el?.closest('input, textarea, select')) return;
      if (document.querySelector('dialog[open], [role="dialog"], .more-sheet, .tour')) return;
      const { a: now, key: docKey, locked } = hotkey.current;
      if (!now) return;
      e.preventDefault();
      if (locked) return;
      void (now.pausedLeft == null ? pauseFocus(docKey) : resumeFocus(docKey));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
    <FocusMiniPanel a={a} docKey={key} count={cycleDone(holder?.focus)} blocks={day ? activeColumn(day).blocks : []} />
  </>;
}

function FocusMiniPanel({ a, docKey, count, blocks }: { a: FocusActive; docKey: string; count: number; blocks: Block[] }) {
  const T = useT();
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  const [open, setOpen] = useState(false);
  const [corner, setCorner] = useState<Corner>(readCorner);
  const [dragging, setDragging] = useState(false);
  const [compact, setCompact] = useState(readCompact);
  const phone = usePhone();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const suppressed = useRef(false);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const settleFrom = useRef<{ x: number; y: number } | null>(null);
  const justDragged = useRef(false);
  // a phase change (focus to break, break to focus) draws the card's edge in the new phase's colour once
  const lastPhase = useRef(a.phase);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (lastPhase.current === a.phase) return;
    lastPhase.current = a.phase;
    if (reducedMotion()) return;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1300);
    return () => window.clearTimeout(t);
  }, [a.phase]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) { suppressed.current = true; setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  // after a drop the card is already at its new corner: slide it in from where it was let go
  useLayoutEffect(() => {
    const from = settleFrom.current, el = root.current;
    settleFrom.current = null;
    if (!from || !el || reducedMotion()) return;
    const to = el.getBoundingClientRect();
    el.animate([{ translate: `${from.x - to.left}px ${from.y - to.top}px` }, { translate: '0 0' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }, [corner]);
  const left = secondsLeft(a);
  const skip = useSkip(a, docKey);
  const cycle = Math.max(1, f.longEvery);
  const session = (count % cycle + (a.phase === 'focus' ? 1 : 0)) || cycle;
  const next = a.phase !== 'focus' ? 'focus' : (count + 1) % cycle === 0 ? 'long' : 'short';
  const nextMin = next === 'focus' ? f.focusMin : next === 'long' ? f.longMin : a.breakMin ?? f.shortMin;
  const end = new Date(Date.now() + left * 1000).toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' });
  // the block the next focus belongs to (same pick as the Focus screen): the one running now, else the next deep, else the next that is not personal
  const nowMin = nowMinutes();
  const running = blocks.find((b) => nowMin >= b.start && nowMin < b.end && b.kind !== 'personal');
  const upNext = a.phase === 'focus' ? null : running ?? blocks.find((b) => b.start > nowMin && b.kind === 'deep') ?? blocks.find((b) => b.start > nowMin && b.kind !== 'personal') ?? null;
  const startNext = async () => {
    // a break that sits in yesterday's document is closed first; otherwise the new focus replaces it in one write, so the card never flickers
    if (docKey !== `day:${today()}`) await finishPhase(settings, true, { key: docKey, startedAt: a.startedAt });
    await startFocus({ phase: 'focus', blockId: upNext?.id ?? null, label: upNext?.label || T.freeFocus, minutes: f.focusMin, breakMin: f.shortMin });
  };
  const togglePause = () => a.pausedLeft == null ? pauseFocus(docKey) : resumeFocus(docKey);
  const shrink = (on: boolean) => {
    setCompact(on); saveCompact(on);
    if (on) { suppressed.current = true; trigger.current?.focus(); setOpen(false); }
  };
  const place = (c: Corner) => { setCorner(c); saveCorner(c); };

  // drag the pill row to another corner: a press that moves 6 px is a drag, anything less stays a click
  const onRowDown = (e: React.PointerEvent) => {
    const el = root.current, row = e.currentTarget;
    if (e.button !== 0 || !el || press.current || (e.target as Element).closest('.mt-pause')) return;
    const start = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    press.current = start;
    const move = (m: PointerEvent) => {
      if (m.pointerId !== start.id) return;
      const dx = m.clientX - start.x, dy = m.clientY - start.y;
      if (!start.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        start.moved = true;
        row.setPointerCapture(start.id);
        setDragging(true); suppressed.current = true; setOpen(false);
      }
      // while carried it is a small ring chip held under the pointer
      el.style.left = `${m.clientX - 26}px`; el.style.top = `${m.clientY - 26}px`; el.style.right = 'auto'; el.style.bottom = 'auto';
    };
    const finish = (u: PointerEvent) => {
      if (u.pointerId !== start.id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
      press.current = null;
      if (!start.moved) return;
      const r = el.getBoundingClientRect();
      el.style.left = el.style.top = el.style.right = el.style.bottom = '';
      setDragging(false);
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 0);
      const to = u.type === 'pointercancel' ? corner : nearestCorner(r.left + r.width / 2, r.top + r.height / 2, window.innerWidth, window.innerHeight, phone, corner[1] as 'l' | 'r');
      if (to === corner) {
        // dropped near where it started: it eases back
        const back = el.getBoundingClientRect();
        if (!reducedMotion()) el.animate([{ translate: `${r.left - back.left}px ${r.top - back.top}px` }, { translate: '0 0' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      } else { settleFrom.current = { x: r.left, y: r.top }; place(to); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  };

  const panel = (
    <section id="mini-focus-details" className="mt-panel" aria-label={T.focusRunning} inert={!open} aria-hidden={!open}>
      <div className="mt-panel-clip"><div className="mt-body">
        <div className="mt-head"><span className="mt-phase">{T.phase[a.phase]}</span><a className="card-link mt-link" href="/focus" onClick={onLinkClick}>{T.miniGoFocus}</a></div>
        <strong className="mt-label">{a.label || T.freeFocus}</strong>
        <div className="mt-meta"><span>{T.sessionN(session, cycle)}</span><span>{a.pausedLeft == null ? T.miniEnds(end) : T.miniPaused}</span></div>
        <p className="mt-next">{T.miniNext(T.phase[next], nextMin)}</p>
        {upNext && <p className="mt-next mt-block">{running ? T.miniBlockNow(upNext.label || T.freeFocus, clock(upNext.end)) : T.miniBlockNext(upNext.label || T.freeFocus, clock(upNext.start))}</p>}
        <div className="mt-actions">
          <button type="button" className="btn sm ghost focus-act num" disabled={a.plannedMin >= MAX_PLANNED} onClick={() => extendFocus(5, docKey)}>{T.plusFive}</button>
          <button type="button" className="btn sm ghost focus-act" disabled={skip.locked} onClick={skip.request}>{T.skip}</button>
          <span className="mt-tools">
            {count % cycle >= 1 && <button type="button" className="btn sm ghost icon mt-cycle" aria-label={T.cycleReset} title={T.cycleReset} onClick={() => void resetCycle(docKey)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg></button>}
            <button type="button" className="btn sm ghost icon mt-compact" aria-label={compact ? T.miniExpand : T.miniShrink} title={compact ? T.miniExpand : T.miniShrink} onClick={() => shrink(!compact)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">{compact ? <path d="M5 12h14M12 5v14" /> : <path d="M5 12h14" />}</svg></button>
          </span>
        </div>
        {skip.asking && <SkipChoice a={a} skip={skip} className="mt-skip" />}
        {a.phase !== 'focus' && <button type="button" className="btn sm primary mt-start-next" onClick={() => void startNext()}>{T.miniStartNext}</button>}
      </div></div>
    </section>
  );
  const atTop = corner[0] === 't';
  return <div ref={root} className={`mini-timer phase-${a.phase}${flash ? ' mt-flash' : ''}`} data-open={open} data-v={atTop ? 'top' : 'bottom'} data-h={corner[1] === 'l' ? 'left' : 'right'} data-dragging={dragging} data-compact={compact}
    onPointerEnter={e => { if (e.pointerType === 'mouse' && !press.current?.moved) { suppressed.current = false; setOpen(true); } }}
    onPointerLeave={e => { if (e.pointerType === 'mouse' && !root.current?.contains(document.activeElement)) setOpen(false); }}
    onFocus={() => { if (!suppressed.current) setOpen(true); }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { suppressed.current = false; setOpen(false); } }}
    onKeyDown={e => {
      // no corner button: Alt + an arrow key moves the card (the keyboard way to do what dragging does)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.startsWith('Arrow')) {
        const v = e.key === 'ArrowUp' ? 't' : e.key === 'ArrowDown' ? 'b' : corner[0];
        const h = phone ? corner[1] : e.key === 'ArrowLeft' ? 'l' : e.key === 'ArrowRight' ? 'r' : corner[1];
        e.preventDefault(); place(`${v}${h}` as Corner); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); suppressed.current = true; trigger.current?.focus(); setOpen(false); } }}>
    {/* one body: the details unfold above the pill row (below it when the card sits at the top), inside the same card */}
    {!atTop && panel}
    <div className="mt-row" onPointerDown={onRowDown}
      onClickCapture={e => { if (justDragged.current) { e.preventDefault(); e.stopPropagation(); } }}>
      <Ring a={a} size={36} stroke={4} />
      {/* shrunk to a ring, the name carries the time left to the minute, so a screen reader is not read the clock every second */}
      <button ref={trigger} type="button" className="mt-text mt-trigger" aria-expanded={open} aria-controls="mini-focus-details"
        aria-label={compact && !open ? T.miniAria(a.phase === 'focus' ? a.label || T.freeFocus : T.phase[a.phase], Math.ceil(left / 60), a.pausedLeft != null) : undefined}
        onClick={() => { suppressed.current = false; setOpen(true); }}>
        <b className="num">{mmss(left)}</b><span>{a.label || T.freeFocus}</span>
      </button>
      <button type="button" className="btn ghost mt-pause focus-act" disabled={skip.locked} onClick={togglePause}>{a.pausedLeft == null ? T.pause : T.resume}</button>
    </div>
    {atTop && panel}
  </div>;
}
