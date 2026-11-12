import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { AMBIENTS, ambientPlaying, ambientPref, onAmbient, playAmbient, setAmbientVolume, type Ambient } from '../lib/ambient';
import { today } from '../lib/dates';
import { cancelFocus, chime, finishPhase, mmss, pauseFocus, resumeFocus, secondsLeft, settingsFocus, startFocus } from '../lib/focus';
import { useT } from '../lib/i18n';
import { emptyDay, type DayDoc } from '../lib/model';
import { useDoc } from '../lib/useDoc';
import { Ring, useTick } from './FocusTimer';
import { IconX } from './Icons';
import { useSocial } from '../lib/social';

/**
 * The focus room: the whole screen for one session, nothing else on it. The ring, the time and the block; a
 * background sound if wanted. The controls fade after a few still seconds and come back with the pointer or a key.
 * Space pauses or resumes, Esc leaves (the session goes on outside the room).
 */
export function FocusRoom({ start, onClose }: { start: { blockId: string | null; label: string; minutes: number; task?: { id: string; text: string; day?: boolean } }; onClose: () => void }) {
  const T = useT();
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  const { value: day } = useDoc<DayDoc>(`day:${today()}`, emptyDay);
  const a = day?.focus?.active ?? null;
  useTick(!!a && a.pausedLeft == null);
  const [sound, setSound] = useState<Ambient | null>(ambientPlaying() ?? ambientPref().sound);
  const [volume, setVolume] = useState(ambientPref().volume);
  const [idle, setIdle] = useState(false);
  const social = useSocial(true);
  const together = a?.roomId && social?.room?.id === a.roomId ? social.room.people : [];
  const idleTimer = useRef(0);
  useEffect(() => onAmbient(() => setSound(ambientPlaying() ?? ambientPref().sound)), []);

  // the controls rest after three still seconds
  useEffect(() => {
    const wake = () => { setIdle(false); window.clearTimeout(idleTimer.current); idleTimer.current = window.setTimeout(() => setIdle(true), 3000); };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => { window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', wake); window.clearTimeout(idleTimer.current); };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); leave(); }
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement) && a) {
        e.preventDefault();
        if (a.pausedLeft == null) pauseFocus(); else resumeFocus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function leave() {
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* not in full screen */ }
    onClose();
  }
  function begin() {
    startFocus(start);
    if (sound && !ambientPlaying()) playAmbient(sound, volume);
  }
  function pick(s: Ambient | null) {
    setSound(s);
    playAmbient(s, volume);
  }
  async function finish() {
    const r = await finishPhase(settings, true);
    if (r !== 'none' && f.sound) chime();
  }

  return (
    <div className={`focus-room${idle ? ' idle' : ''}${a ? ` phase-${a.phase}` : ''}`} role="dialog" aria-modal="true" aria-label={T.roomTitle}>
      <button type="button" className="btn ghost room-leave" onClick={leave}><IconX />{T.roomLeave}</button>
      <div className="room-stage">
        <div className="focus-ring room-ring">
          {a ? <Ring a={a} size={340} stroke={8} /> : <svg width={340} height={340} viewBox="0 0 340 340" aria-hidden="true"><circle cx={170} cy={170} r={166} fill="none" stroke="var(--raised)" strokeWidth={8} /></svg>}
          <div className="focus-read">
            <span className="phase-name">{a ? T.phase[a.phase] : T.phase.focus}</span>
            <b className="num" aria-live="off">{a ? mmss(secondsLeft(a)) : mmss(start.minutes * 60)}</b>
            <span className="muted focus-label">{a ? a.label || T.freeFocus : start.label}</span>
          </div>
        </div>
        <div className="room-controls">
          {!a ? <button type="button" className="btn primary big" onClick={begin}>{T.startFocus}</button> : (
            <>
              {a.pausedLeft == null
                ? <button type="button" className="btn" onClick={() => pauseFocus()}>{T.pause}</button>
                : <button type="button" className="btn primary" onClick={() => resumeFocus()}>{T.resume}</button>}
              {a.phase === 'focus'
                ? <button type="button" className="btn" onClick={finish}>{T.finishNow}</button>
                : <button type="button" className="btn primary" onClick={finish}>{T.skipBreak}</button>}
              <button type="button" className="btn ghost" onClick={() => cancelFocus()}>{T.stop}</button>
            </>
          )}
        </div>
        <div className="room-sound">
          <span className="label" id="room-sound">{T.ambientLabel}</span>
          <div className="sound-pick" role="group" aria-labelledby="room-sound">
            <button type="button" aria-pressed={!sound} onClick={() => pick(null)}>{T.ambient.off}</button>
            {AMBIENTS.map((s) => <button key={s} type="button" aria-pressed={sound === s} onClick={() => pick(s)}>{T.ambient[s]}</button>)}
          </div>
          <label className="room-volume">
            <span className="sr-only">{T.volume}</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} disabled={!sound}
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); setAmbientVolume(v); }} />
          </label>
        </div>
        {together.length > 0 && <p className="room-people"><i className="dot" aria-hidden="true" />{T.roomPeople(together.join(', '))}</p>}
        <p className="muted room-hint">{T.roomHint}</p>
      </div>
    </div>
  );
}
