// The focus timer (pomodoro), kept inside the day's document so it survives a reload and shows on every device.
// A finished focus session is logged on the day; if it ran in a deep-work block, its time is added to the
// focus metric (Deep work, in hours) so the daily metrics fill themselves in.
import { today } from './dates';
import {
  defaultFocus, emptyDay, emptyInbox, uid, type DayDoc, type InboxDoc, type FocusActive, type FocusPhase, type FocusSettings, type Kind, type Settings,
} from './model';
import { updateKey } from './useDoc';
import { showNotification } from './pwa';

export const focusMinutes = (d: DayDoc) => (d.focus?.sessions ?? []).reduce((s, x) => s + x.minutes, 0);
export const focusCount = (d: DayDoc) => (d.focus?.sessions ?? []).length;

export function secondsLeft(a: FocusActive, now = Date.now()): number {
  if (a.pausedLeft != null) return a.pausedLeft;
  return Math.max(0, Math.round(a.plannedMin * 60 - (now - Date.parse(a.startedAt)) / 1000));
}

export const settingsFocus = (s: Settings): FocusSettings => ({ ...defaultFocus(), ...(s.focus || {}) });

const dayKey = (d = today()) => `day:${d}`;
const withFocus = (d: DayDoc) => ({ ...d, focus: d.focus ?? { active: null, sessions: [] } });

export function startFocus(opts: { blockId: string | null; label: string; phase?: FocusPhase; minutes: number; startedAt?: string; roomId?: string; task?: FocusActive['task']; intent?: string; breakMin?: number }) {
  askToNotify();
  return updateKey<DayDoc>(dayKey(), emptyDay, (d) => {
    const x = withFocus(d);
    return { ...x, focus: { ...x.focus, active: {
      phase: opts.phase ?? 'focus', startedAt: opts.startedAt ?? new Date().toISOString(), plannedMin: opts.minutes,
      pausedLeft: null, blockId: opts.blockId, label: opts.label, ...(opts.roomId ? { roomId: opts.roomId } : {}), ...(opts.task ? { task: opts.task } : {}),
      ...(opts.intent?.trim() ? { intent: opts.intent.trim() } : {}), ...(opts.breakMin ? { breakMin: opts.breakMin } : {}),
    } } };
  });
}

export function pauseFocus() {
  return updateKey<DayDoc>(dayKey(), emptyDay, (d) => {
    const a = d.focus?.active;
    if (!a || a.pausedLeft != null) return d;
    return { ...d, focus: { ...d.focus!, active: { ...a, pausedLeft: secondsLeft(a) } } };
  });
}

export function resumeFocus() {
  return updateKey<DayDoc>(dayKey(), emptyDay, (d) => {
    const a = d.focus?.active;
    if (!a || a.pausedLeft == null) return d;
    // restart the clock so that exactly pausedLeft seconds remain
    const startedAt = new Date(Date.now() - (a.plannedMin * 60 - a.pausedLeft) * 1000).toISOString();
    return { ...d, focus: { ...d.focus!, active: { ...a, startedAt, pausedLeft: null } } };
  });
}

/** Adds minutes to the running phase (a running one gets later end, a paused one more time left). */
export function extendFocus(min = 5) {
  return updateKey<DayDoc>(dayKey(), emptyDay, (d) => {
    const a = d.focus?.active;
    if (!a) return d;
    return { ...d, focus: { ...d.focus!, active: { ...a, plannedMin: a.plannedMin + min, ...(a.pausedLeft != null ? { pausedLeft: a.pausedLeft + min * 60 } : {}) } } };
  });
}

/** Writes (or clears) the short note on a logged session. */
export function noteSession(id: string, note: string) {
  const text = note.trim();
  return updateKey<DayDoc>(dayKey(), emptyDay, (d) => {
    if (!d.focus) return d;
    return { ...d, focus: { ...d.focus, sessions: d.focus.sessions.map((x) => {
      if (x.id !== id) return x;
      const { note: _old, ...rest } = x;
      return text ? { ...rest, note: text } : rest;
    }) } };
  });
}

export function cancelFocus() {
  return updateKey<DayDoc>(dayKey(), emptyDay, (d) => (d.focus ? { ...d, focus: { ...d.focus, active: null } } : d));
}

/**
 * Ends the running phase. A focus phase that ran at least a minute is logged (early or on time) and the right break
 * starts; a break simply ends. Returns what happened so the caller can chime.
 */
export async function finishPhase(settings: Settings, early = false): Promise<'logged' | 'break-over' | 'none'> {
  const f = settingsFocus(settings);
  let result: 'logged' | 'break-over' | 'none' = 'none';
  let toList: { id: string; minutes: number } | null = null;
  await updateKey<DayDoc>(dayKey(), emptyDay, (d) => {
    const x = withFocus(d);
    const a = x.focus.active;
    if (!a) return d;
    if (a.phase !== 'focus') { result = 'break-over'; return { ...x, focus: { ...x.focus, active: null } }; }
    const left = secondsLeft(a);
    if (!early && left > 0) return d; // not finished yet (another device may have resumed it)
    const minutes = Math.round((a.plannedMin * 60 - left) / 60);
    if (minutes < 1) return { ...x, focus: { ...x.focus, active: null } };
    const block = x.columns.flatMap((c) => c.blocks).find((b) => b.id === a.blockId);
    const kind: Kind | null = block?.kind ?? null;
    const end = new Date();
    const session = { id: uid(), blockId: a.blockId, label: a.label, kind, subject: block?.subject, start: new Date(end.getTime() - minutes * 60000).toISOString(), end: end.toISOString(), minutes, ...(a.task ? { taskId: a.task.id, taskText: a.task.text } : {}), ...(a.intent ? { intent: a.intent } : {}) };
    // the minutes add up on the task worked on: a day's task here, a listed one in the lists below
    const tasks = a.task?.day ? x.tasks.map((t) => (t.id === a.task!.id ? { ...t, spent: (t.spent ?? 0) + minutes } : t)) : x.tasks;
    if (a.task && !a.task.day) toList = { id: a.task.id, minutes };
    const sessions = [...x.focus.sessions, session];
    let metrics = x.metrics;
    const def = settings.metrics.find((m) => m.id === f.metricId && m.kind === 'number');
    if (def && kind === 'deep') {
      const prev = typeof metrics[def.id] === 'number' ? (metrics[def.id] as number) : 0;
      metrics = { ...metrics, [def.id]: Math.round((prev + minutes / 60) * 100) / 100 };
    }
    const long = sessions.length % Math.max(1, f.longEvery) === 0;
    result = 'logged';
    return {
      ...x, metrics, tasks,
      focus: { sessions, active: {
        phase: long ? 'long' : 'short', startedAt: end.toISOString(), plannedMin: long ? f.longMin : (a.breakMin ?? f.shortMin),
        pausedLeft: null, blockId: a.blockId, label: a.label, sessionId: session.id, ...(a.task ? { task: a.task } : {}),
      } },
    };
  });
  const add = toList as { id: string; minutes: number } | null;
  if (add) await updateKey<InboxDoc>('inbox', emptyInbox, (b) => ({ ...b, items: b.items.map((t) => (t.id === add.id ? { ...t, spent: (t.spent ?? 0) + add.minutes } : t)) }));
  return result;
}

// ---- sound and notifications ----
let ctx: AudioContext | null = null;
export function chime() {
  try {
    ctx = ctx || new AudioContext();
    const t0 = ctx.currentTime;
    [660, 880, 1320].forEach((freq, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + i * 0.16);
      g.gain.linearRampToValueAtTime(0.18, t0 + i * 0.16 + 0.02);
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
