import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { AMBIENTS, ambientPlaying, ambientPref, onAmbient, playAmbient, setAmbientVolume, type Ambient } from '../lib/ambient';
import { today } from '../lib/dates';
import { cancelFocus, extendFocus, finishPhase, MAX_PLANNED, mmss, pauseFocus, resumeFocus, resetFocus, secondsLeft, settingsFocus, startFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';
import { emptyDay, uid, type DayDoc } from '../lib/model';
import { useDoc } from '../lib/useDoc';
import { RingLive, TimeLeft } from './FocusTimer';
import { SkipChoice, useSkip } from './SkipChoice';
import { IconX } from './Icons';
import { fill } from './FocusConfig';
import { useSocial } from '../lib/social';

/**
 * The focus room: the whole screen for one session, nothing else on it. The ring, the time and the block; a
 * background sound if wanted. The controls remain visible for pointer, touch and keyboard use.
 * Space pauses or resumes, Esc leaves (the session goes on outside the room).
 */
export function FocusRoom({ start, onClose }: { start: { blockId: string | null; label: string; minutes: number; task?: { id: string; text: string; day?: boolean }; intent?: string; breakMin?: number }; onClose: () => void }) {
  const T = useT();
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  const { value: day, update } = useDoc<DayDoc>(`day:${today()}`, emptyDay);
  const { active: a, key } = useFocusDay();
  const [sound, setSound] = useState<Ambient | null>(ambientPlaying() ?? ambientPref().sound);
  const [volume, setVolume] = useState(ambientPref().volume);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pickedTask, setPickedTask] = useState(start.task);
  const skip = useSkip(a, key);
  const social = useSocial(true);
  const together = a?.roomId && social?.room?.id === a.roomId ? social.room.people : [];
  // a modal: keyboard focus moves into the room and goes back to where it was on leaving
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    (rootRef.current?.querySelector<HTMLElement>('.room-controls .btn') ?? rootRef.current)?.focus();
    return () => { if (back?.isConnected) back.focus(); };
  }, []);
  useEffect(() => onAmbient(() => setSound(ambientPlaying() ?? ambientPref().sound)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !target?.isContentEditable && !target?.closest('input, textarea, select, button') && a) {
        const k = e.key.toLowerCase();
        if (k === '+' || k === '=') { e.preventDefault(); void extendFocus(5, key); }
        if (!(f.strict && a.phase === 'focus')) {
          if (k === 's') { e.preventDefault(); skip.request(); }
          if (k === 'r' && !a.roomId) { e.preventDefault(); void resetFocus(key); }
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); leave(); }
      if (e.key === 'Tab' && rootRef.current) { // Tab stays inside the room
        const all = [...rootRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, a[href]')];
        const first = all[0], last = all[all.length - 1];
        if (!first) return;
        const inside = rootRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
      }
      if (e.key === ' ' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement) && a) {
        e.preventDefault();
        if (!f.strict || a.phase !== 'focus') { if (a.pausedLeft == null) pauseFocus(key); else resumeFocus(key); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function leave() {
    try { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); } catch { /* not in full screen */ }
    onClose();
  }
  function begin() {
    startFocus({...start, label: pickedTask?.text ?? start.label, task: pickedTask});
    if (sound && !ambientPlaying()) playAmbient(sound, volume);
  }
  function pick(s: Ambient | null) {
    setSound(s);
    playAmbient(s, volume);
  }
  async function focusTask(task: { id: string; text: string }) {
    const ref = {...task, day: true};
    setPickedTask(ref);
    if (a && !(f.strict && a.phase === 'focus') && a.task?.id !== task.id) {
      await finishPhase(settings, true, { key, startedAt: a.startedAt });
      await startFocus({blockId: a.blockId, label: task.text, minutes: Math.max(1, Math.ceil(secondsLeft(a) / 60)), task: ref});
    }
  }
  const linked = day?.columns.flatMap(c => c.blocks).find(b => b.id === (a?.blockId ?? start.blockId));
  const tasks = (day?.tasks ?? []).filter(t => !t.done).sort((x,y) => Number(y.id === a?.task?.id || (linked?.task ? y.id === linked.task.id : y.text === linked?.label)) - Number(x.id === a?.task?.id || (linked?.task ? x.id === linked.task.id : x.text === linked?.label)));
  return (
    <div ref={rootRef} tabIndex={-1} className={`focus-room${a ? ` phase-${a.phase}` : ' phase-focus'}`} role="dialog" aria-modal="true" aria-label={T.roomTitle}>
      <button type="button" className="btn ghost room-leave" onClick={leave}><IconX />{T.roomLeave}</button>
      <section className={`room-tasks${tasksOpen ? ' open' : ''}`} onPointerEnter={e => {if (e.pointerType === 'mouse') setTasksOpen(true);}} onPointerLeave={e => {if (e.pointerType === 'mouse' && !e.currentTarget.contains(document.activeElement)) setTasksOpen(false);}} onBlur={e => {if (!e.currentTarget.contains(e.relatedTarget)) setTasksOpen(false);}}>
        <button className="room-task-tab btn ghost" aria-expanded={tasksOpen} onClick={() => setTasksOpen(!tasksOpen)}>{T.tasks} ({tasks.length})</button>
        {tasksOpen && <div className="room-task-body">
          {tasks.map(t => <div className="room-task-row" key={t.id}><label><input className="check" type="checkbox" checked={false} onChange={() => update(d => ({...d, tasks: d.tasks.map(x => x.id === t.id ? {...x, done: true} : x)}))} />{t.text}</label><button className="btn ghost" aria-pressed={(a?.task ?? pickedTask)?.id === t.id} onClick={() => focusTask(t)}>{T.roomTaskFocus}</button></div>)}
          <form onSubmit={e => {e.preventDefault(); if (draft.trim()) {update(d => ({...d, tasks: [...d.tasks, {id: uid(), text: draft.trim(), done: false}]})); setDraft('');}}}><input className="input" aria-label={T.captureTask} placeholder={T.captureTask} value={draft} onChange={e => setDraft(e.target.value)} /><button className="btn" type="submit">{T.roomTaskAdd}</button></form>
        </div>}
      </section>
      <div className="room-stage">
        <div className="focus-ring room-ring">
          {a ? <RingLive a={a} size={340} stroke={8} /> : <svg width={340} height={340} viewBox="0 0 340 340" aria-hidden="true"><circle cx={170} cy={170} r={166} fill="none" stroke="var(--raised)" strokeWidth={8} /></svg>}
          <div className="focus-read">
            <span className="phase-name" role="status">{a ? T.phase[a.phase] : T.phase.focus}{a?.pausedLeft != null && <span className="room-paused"> &middot; {T.focusPaused}</span>}</span>
            <b className="num" aria-live="off">{a ? <TimeLeft a={a} /> : mmss(start.minutes * 60)}</b>
            <span className="muted focus-label">{a ? a.label || T.freeFocus : start.label}</span>
          </div>
        </div>
        <div className="room-controls">
          {!a ? <button type="button" className="btn primary big" onClick={begin}>{T.startFocus}</button> : (
            <>
              {a.pausedLeft == null
                ? <button type="button" className="btn primary focus-act" disabled={!!f.strict && a.phase === 'focus'} onClick={() => pauseFocus(key)}>{T.pause}</button>
                : <button type="button" className="btn primary focus-act" disabled={!!f.strict && a.phase === 'focus'} onClick={() => resumeFocus(key)}>{T.resume}</button>}
              <button type="button" className="btn focus-act num" disabled={a.plannedMin >= MAX_PLANNED} onClick={() => extendFocus(5, key)}>{T.plusFive}</button>
              <button type="button" className={`btn focus-act${a.phase === 'focus' ? '' : ' primary'}`} disabled={skip.locked} onClick={skip.request}>{T.skip}</button>
              <button type="button" className="btn focus-act" disabled={!!f.strict && a.phase === 'focus'} onClick={() => cancelFocus(key)}>{T.stop}</button>
            </>
          )}
        </div>
        {skip.asking && a && <SkipChoice a={a} skip={skip} />}
        <div className="room-sound">
          <span className="label" id="room-sound">{T.ambientLabel}</span>
          <div className="sound-pick" role="group" aria-labelledby="room-sound">
            <button type="button" aria-pressed={!sound} onClick={() => pick(null)}>{T.ambient.off}</button>
            {AMBIENTS.map((s) => <button key={s} type="button" aria-pressed={sound === s} onClick={() => pick(s)}>{T.ambient[s]}</button>)}
          </div>
          <label className="room-volume">
            <span className="sr-only">{T.volume}</span>
            <span className="focus-range" style={fill(volume, 0, 1)}><input type="range" min={0} max={1} step={0.05} value={volume} disabled={!sound}
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); setAmbientVolume(v); }} /></span>
          </label>
        </div>
        {together.length > 0 && <p className="room-people"><i className="dot" aria-hidden="true" />{T.roomPeople(together.join(', '))}</p>}
        <p className="muted room-hint">{T.roomHint}</p>
      </div>
    </div>
  );
}
