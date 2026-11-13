// The focus timer (pomodoro), kept inside the day's document so it survives a reload and shows on every device.
// A finished focus session is logged on the day; if it ran in a deep-work block, its time is added to the
// focus metric (Deep work, in hours) so the daily metrics fill themselves in.
import { addDays, today } from './dates';
import {
  defaultFocus, emptyDay, emptyInbox, uid, type DayDoc, type InboxDoc, type FocusActive, type FocusSession, type FocusPhase, type FocusSettings, type Kind, type Settings,
} from './model';
import { refreshKey, updateKey, useDoc } from './useDoc';
import { showNotification } from './pwa';

export const focusMinutes = (d: DayDoc) => (d.focus?.sessions ?? []).reduce((s, x) => s + x.minutes, 0);
export const focusCount = (d: DayDoc) => (d.focus?.sessions ?? []).length;

/** The longest a phase can run, +5 min included (a stuck tab or a stray script cannot make it endless). */
export const MAX_PLANNED = 240;

export function secondsLeft(a: FocusActive, now = Date.now()): number {
  const total = a.plannedMin * 60;
  if (a.pausedLeft != null) return Math.max(0, Math.min(total, a.pausedLeft));
  const ran = (now - Date.parse(a.startedAt)) / 1000;
  if (!Number.isFinite(ran)) return 0;
  // a clock set back (or a start written by a device whose clock runs ahead) never shows more than the phase holds
  return Math.max(0, Math.min(total, Math.round(total - ran)));
}

export const settingsFocus = (s: Settings): FocusSettings => ({ ...defaultFocus(), ...(s.focus || {}) });

const dayKey = (d = today()) => `day:${d}`;

/**
 * The day document that holds the running timer: today's, or yesterday's while a session begun before midnight is
 * still on (its time is logged on the day it began). Screens pass `key` to the actions below.
 */
export function useFocusDay() {
  const d = today();
  const own = useDoc<DayDoc>(dayKey(d), emptyDay);
  const prev = useDoc<DayDoc>(dayKey(addDays(d, -1)), emptyDay);
  const carried = !own.value?.focus?.active && prev.value?.focus?.active ? prev.value.focus.active : null;
  return { ...own, active: carried ?? own.value?.focus?.active ?? null, key: carried ? dayKey(addDays(d, -1)) : dayKey(d), holder: carried ? prev.value : own.value };
}

/** Fetch the day again (another device may have paused, extended or ended the timer); unsaved edits stay. */
export const refreshFocus = (key = dayKey()) => refreshKey(key);
const withFocus = (d: DayDoc) => ({ ...d, focus: d.focus ?? { active: null, sessions: [] } });

export function startFocus(opts: { blockId: string | null; label: string; phase?: FocusPhase; minutes: number; startedAt?: string; roomId?: string; task?: FocusActive['task']; intent?: string; breakMin?: number }) {
  askToNotify();
  return updateKey<DayDoc>(dayKey(), emptyDay, (d) => {
    const x = withFocus(d);
    return { ...x, focus: { ...x.focus, active: {
      phase: opts.phase ?? 'focus', startedAt: opts.startedAt ?? new Date().toISOString(), plannedMin: Math.min(MAX_PLANNED, Math.max(1, Math.round(opts.minutes) || 1)),
      pausedLeft: null, blockId: opts.blockId, label: opts.label.slice(0, 200), ...(opts.roomId ? { roomId: opts.roomId } : {}), ...(opts.task ? { task: opts.task } : {}),
      ...(opts.intent?.trim() ? { intent: opts.intent.trim().slice(0, INTENT_MAX) } : {}), ...(opts.breakMin ? { breakMin: opts.breakMin } : {}),
    } } };
  });
}

export function pauseFocus(key = dayKey()) {
  return updateKey<DayDoc>(key, emptyDay, (d) => {
    const a = d.focus?.active;
    if (!a || a.pausedLeft != null) return d;
    return { ...d, focus: { ...d.focus!, active: { ...a, pausedLeft: secondsLeft(a) } } };
  });
}

export function resumeFocus(key = dayKey()) {
  return updateKey<DayDoc>(key, emptyDay, (d) => {
    const a = d.focus?.active;
    if (!a || a.pausedLeft == null) return d;
    // restart the clock so that exactly pausedLeft seconds remain
    const startedAt = new Date(Date.now() - (a.plannedMin * 60 - a.pausedLeft) * 1000).toISOString();
    return { ...d, focus: { ...d.focus!, active: { ...a, startedAt, pausedLeft: null } } };
  });
}

/** Adds minutes to the running phase (a running one gets later end, a paused one more time left). */
export function extendFocus(min = 5, key = dayKey()) {
  return updateKey<DayDoc>(key, emptyDay, (d) => {
    const a = d.focus?.active;
    const add = a ? Math.min(min, MAX_PLANNED - a.plannedMin) : 0;
    if (!a || add <= 0) return d;
    return { ...d, focus: { ...d.focus!, active: { ...a, plannedMin: a.plannedMin + add, ...(a.pausedLeft != null ? { pausedLeft: secondsLeft(a) + add * 60 } : {}) } } };
  });
}

/** A skipped focus phase that ran no longer than this is dropped without asking and without counting. */
export const SKIP_FREE_SEC = 30;
/** What a skipped focus phase counts for: the time run so far, the whole planned session, or nothing. */
export type SkipCount = 'elapsed' | 'full' | 'none';

/** What skipping the running phase needs: a break (or a focus phase within its first seconds) goes at once, a longer focus phase asks. */
export function skipPlan(a: FocusActive, now = Date.now()) {
  const ran = a.plannedMin * 60 - secondsLeft(a, now);
  return { ask: a.phase === 'focus' && ran > SKIP_FREE_SEC, elapsedMin: Math.max(1, Math.round(ran / 60)), fullMin: a.plannedMin, count: (a.phase === 'focus' && ran <= SKIP_FREE_SEC ? 'none' : 'elapsed') as SkipCount };
}

/** Writes (or clears) the short note on a logged session. */
export const NOTE_MAX = 280, INTENT_MAX = 140;

export function noteSession(id: string, note: string, key = dayKey()) {
  const text = note.trim().slice(0, NOTE_MAX);
  return updateKey<DayDoc>(key, emptyDay, (d) => {
    if (!d.focus) return d;
    return { ...d, focus: { ...d.focus, sessions: d.focus.sessions.map((x) => {
      if (x.id !== id) return x;
      const { note: _old, ...rest } = x;
      return text ? { ...rest, note: text } : rest;
    }) } };
  });
}

export function cancelFocus(key = dayKey()) {
  return updateKey<DayDoc>(key, emptyDay, (d) => (d.focus ? { ...d, focus: { ...d.focus, active: null } } : d));
}

/**
 * Ends the running phase. A focus phase that ran at least a minute is logged (early or on time) and the right break
 * starts; a break simply ends. Returns what happened so the caller can chime.
 * `startedAt` names the phase the caller saw: if it has changed since (a second click, another device), nothing
 * happens, so a double click on "Finish now" cannot also skip the break it started.
 */
export async function finishPhase(settings: Settings, early = false, opts: { key?: string; startedAt?: string; count?: SkipCount } = {}): Promise<'logged' | 'skipped' | 'break-over' | 'none'> {
  const f = settingsFocus(settings);
  let result: 'logged' | 'skipped' | 'break-over' | 'none' = 'none';
  let toList: { id: string; minutes: number } | null = null;
  await updateKey<DayDoc>(opts.key ?? dayKey(), emptyDay, (d) => {
    const x = withFocus(d);
    const a = x.focus.active;
    if (!a) return d;
    if (opts.startedAt && a.startedAt !== opts.startedAt) return d;
    const left = secondsLeft(a);
    if (!early && left > 0) return d; // not finished yet (another device may have resumed or extended it)
    if (a.phase !== 'focus') { result = 'break-over'; return { ...x, focus: { ...x.focus, active: !early && f.autoFocus ? { phase: 'focus', startedAt: new Date().toISOString(), plannedMin: f.focusMin, pausedLeft: null, blockId: a.blockId, label: a.label, ...(a.task ? { task: a.task } : {}) } : null } }; }
    // what counts: the time run so far (default), the whole planned session, or nothing (a skip within the first seconds)
    const count = opts.count ?? 'elapsed';
    const minutes = count === 'none' ? 0 : count === 'full' ? a.plannedMin : Math.round((a.plannedMin * 60 - left) / 60);
    if (minutes < 1 && count !== 'none') return { ...x, focus: { ...x.focus, active: null } };
    const block = x.columns.flatMap((c) => c.blocks).find((b) => b.id === a.blockId);
    const kind: Kind | null = block?.kind ?? null;
    let sessions = x.focus.sessions, tasks = x.tasks, metrics = x.metrics, session: FocusSession | null = null;
    if (minutes >= 1) {
      // a phase that ran out while the tab slept (or the laptop was shut) ended at its planned time, not now
      const plannedEnd = Date.parse(a.startedAt) + a.plannedMin * 60_000;
      const stop = new Date(a.pausedLeft == null && left === 0 && plannedEnd < Date.now() ? plannedEnd : Date.now());
      session = { id: uid(), blockId: a.blockId, label: a.label, kind, subject: block?.subject, start: new Date(stop.getTime() - minutes * 60000).toISOString(), end: stop.toISOString(), minutes, ...(a.task ? { taskId: a.task.id, taskText: a.task.text } : {}), ...(a.intent ? { intent: a.intent } : {}) };
      // the minutes add up on the task worked on: a day's task here, a listed one in the lists below
      tasks = a.task?.day ? x.tasks.map((t) => (t.id === a.task!.id ? { ...t, spent: (t.spent ?? 0) + minutes } : t)) : x.tasks;
      if (a.task && !a.task.day) toList = { id: a.task.id, minutes };
      sessions = [...sessions, session];
      const def = settings.metrics.find((m) => m.id === f.metricId && m.kind === 'number');
      if (def && kind === 'deep') {
        const prev = typeof metrics[def.id] === 'number' ? (metrics[def.id] as number) : 0;
        metrics = { ...metrics, [def.id]: Math.round((prev + minutes / 60) * 100) / 100 };
      }
    }
    const end = session ? new Date(session.end) : new Date();
    // a session that was not counted adds nothing to the cycle, so the break after it is a short one
    const long = !!session && sessions.length % Math.max(1, f.longEvery) === 0;
    result = session ? 'logged' : 'skipped';
    return {
      ...x, metrics, tasks,
      focus: { ...x.focus, sessions, active: {
        phase: long ? 'long' : 'short', startedAt: end.toISOString(), plannedMin: long ? f.longMin : (a.breakMin ?? f.shortMin),
        pausedLeft: f.autoBreak === false ? (long ? f.longMin : (a.breakMin ?? f.shortMin)) * 60 : null, blockId: a.blockId, label: a.label, ...(session ? { sessionId: session.id } : {}), ...(a.task ? { task: a.task } : {}),
      } },
    };
  });
  const add = toList as { id: string; minutes: number } | null;
  if (add) await updateKey<InboxDoc>('inbox', emptyInbox, (b) => ({ ...b, items: b.items.map((t) => (t.id === add.id ? { ...t, spent: (t.spent ?? 0) + add.minutes } : t)) }));
  return result;
}

// ---- sound and notifications ----
let ctx: AudioContext | null = null;
export function chime(f?: FocusSettings) {
  try {
    ctx = ctx || new AudioContext();
    const t0 = ctx.currentTime;
    (f?.bell === 'soft' ? [440, 660] : f?.bell === 'single' ? [880] : [660, 880, 1320]).forEach((freq, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + i * 0.16);
      g.gain.linearRampToValueAtTime(0.18 * Math.max(0, Math.min(1, f?.volume ?? 1)), t0 + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.16 + 0.6);
      o.connect(g).connect(ctx!.destination);
      o.start(t0 + i * 0.16);
      o.stop(t0 + i * 0.16 + 0.65);
    });
  } catch { /* no audio */ }
}

function askToNotify() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
}

export function notify(title: string, body: string) {
  if (document.visibilityState !== 'visible') showNotification(title, body);
}

export const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** Reset a solo phase; a shared room must retain its common start and end. */
export function resetFocus(key = dayKey()) {
  return updateKey<DayDoc>(key, emptyDay, (d) => {
    if (!d.focus?.active || d.focus.active.roomId) return d;
    return { ...d, focus: { ...d.focus, active: { ...d.focus.active, startedAt: new Date().toISOString(), pausedLeft: null } } };
  });
}
