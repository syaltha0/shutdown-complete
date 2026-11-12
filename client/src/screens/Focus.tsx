import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Segmented } from '../components/Segmented';
import { useSettings } from '../App';
import { DocNotice, SaveStamp } from '../components/Common';
import { Ring, useTick } from '../components/FocusTimer';
import { addDays, clock, duration, nowMinutes, shortDate, today } from '../lib/dates';
import { Chart, themeColor } from '../components/Chart';
import {
  cancelFocus, chime, extendFocus, finishPhase, focusMinutes, MAX_PLANNED, mmss, NOTE_MAX, noteSession, pauseFocus, resumeFocus, secondsLeft,
  settingsFocus, startFocus, useFocusDay,
} from '../lib/focus';
import { useT } from '../lib/i18n';
import { activeColumn, type DayDoc, featureOn } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { useRange } from '../lib/useDoc';
import { kindSwatch } from './TimeGrid';
import { FocusRoom } from '../components/FocusRoom';
import { FriendsPanel } from '../components/Friends';

const ROWS = 5;

export function Focus() {
  const T = useT();
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  // today's document; the timer may still live in yesterday's (a session begun before midnight)
  const { value: day, status, error, retry, active: a, key, holder } = useFocusDay();
  useTick(!!a && a.pausedLeft == null);
  const blocks = day ? activeColumn(day).blocks : [];
  const now = nowMinutes();
  // the block to focus on: the one running now, unless it is lunch or a walk; then the next deep block
  const running = blocks.find((b) => now >= b.start && now < b.end && b.kind !== 'personal');
  const current = running ?? blocks.find((b) => b.start > now && b.kind === 'deep') ?? blocks.find((b) => b.start > now && b.kind !== 'personal') ?? null;
  const [blockId, setBlockId] = useState<string | null | undefined>(undefined);
  const [len, setLen] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const [brk, setBrk] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ id: string; text: string } | null>(null);
  const [room, setRoom] = useState(false);
  const openRoom = () => { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ } setRoom(true); };
  const chosen = blockId === undefined ? current?.id ?? null : blockId;
  const chosenBlock = blocks.find((b) => b.id === chosen) ?? null;
  const sessions = day?.focus?.sessions ?? [];
  const total = day ? focusMinutes(day) : 0;
  const deepDef = settings.metrics.find((m) => m.id === f.metricId);
  const untilLong = f.longEvery - (sessions.length % f.longEvery);
  const from28 = addDays(today(), -27);
  const { docs: past } = useRange<DayDoc>(`day:${from28}`, `day:${today()}`);
  const days28 = Array.from({ length: 28 }, (_, i) => addDays(from28, i));
  const workBlocks = blocks.filter((b) => b.kind !== 'personal');
  // a revision gives a block a new id, so a session also counts for a block of the same name
  const byBlock = (b: { id: string; label: string }) => sessions.filter((x) => x.blockId === b.id || (!!b.label && x.label === b.label)).reduce((n, x) => n + x.minutes, 0);
  const focused = workBlocks.filter((b) => byBlock(b) > 0);
  const lengths = [...new Set([15, 25, 45, 60, f.focusMin])].sort((x, y) => x - y);
  const breaks = [...new Set([5, 10, 15, f.shortMin])].sort((x, y) => x - y);
  const clampLen = (n: number) => Math.min(120, Math.max(5, Math.round(n)));
  const minutes = custom ? clampLen(parseInt(customText, 10) || f.focusMin) : len ?? f.focusMin, breakMin = brk ?? f.shortMin;
  const begin = { blockId: chosen, label: chosenBlock?.label || T.freeFocus, minutes, breakMin };
  // the note belongs to the session a break follows
  const lastSession = a && a.phase !== 'focus' ? (holder?.focus?.sessions ?? []).find((x) => x.id === a.sessionId) ?? null : null;
  // a note being typed is kept even when the break ends (or is skipped) before the field loses focus
  const noteRef = useRef(noteDraft);
  noteRef.current = noteDraft;
  const saveNote = () => { const n = noteRef.current; if (n) { noteSession(n.id, n.text, key); setNoteDraft(null); } };
  useEffect(() => () => { const n = noteRef.current; if (n) noteSession(n.id, n.text, key); }, [key]);
  useEffect(() => { if (!lastSession && noteRef.current) saveNote(); }, [lastSession?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cycleNo = ((sessions.length % f.longEvery) + (a?.phase === 'focus' ? 1 : 0)) || f.longEvery;

  // Today's sessions shows about five rows and scrolls inside, so a long day does not push the cards below
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const fit = () => {
      const rows = [...el.children].slice(0, ROWS) as HTMLElement[];
      const h = `${rows.reduce((n, r) => n + r.offsetHeight, 0)}px`;
      if (el.style.getPropertyValue('--rows-h') !== h) el.style.setProperty('--rows-h', h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessions]);

  // Stop throws the running session away: once it has run a minute, the first press asks, the second discards
  const [stopAsk, setStopAsk] = useState(false);
  useEffect(() => { if (!stopAsk) return; const t = window.setTimeout(() => setStopAsk(false), 4000); return () => window.clearTimeout(t); }, [stopAsk]);
  useEffect(() => setStopAsk(false), [a?.startedAt]);
  const ranMin = a && a.phase === 'focus' ? Math.floor((a.plannedMin * 60 - secondsLeft(a)) / 60) : 0;
  function stop() {
    if (ranMin >= 1 && !stopAsk) { setStopAsk(true); return; }
    setStopAsk(false);
    saveNote();
    cancelFocus(key);
  }

  async function finish() {
    if (!a) return;
    if (a.phase !== 'focus') saveNote();
    const r = await finishPhase(settings, true, { key, startedAt: a.startedAt });
    if (r !== 'none' && f.sound) chime();
  }

  return (
    <>
      <div className="title-row focus-title">
        <div>
          <h1>{T.focusTitle}</h1>
          <p className="sub num">{day ? <>{T.focusSummary(sessions.length, duration(total))}{a ? null : <> · {T.nextLong(untilLong)}</>}</> : ' '}</p>
        </div>
        <div className="title-actions"><SaveStamp status={status} /></div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />

      <div className="grid top focus-grid">
        <section className={`panel span-7 focus-panel${a ? ` phase-${a.phase}` : ''}`} aria-labelledby="fp-h" data-anim>
          <h2 id="fp-h" className="sr-only">{T.focusRunning}</h2>
          <button type="button" className="btn sm focus-room-btn" onClick={openRoom}>{T.roomOpen}</button>
          <div className="focus-stage">
            <div className="focus-ring">
              {a ? <Ring a={a} size={248} stroke={10} /> : <svg width={248} height={248} viewBox="0 0 248 248" aria-hidden="true"><circle cx={124} cy={124} r={119} fill="none" stroke="var(--raised)" strokeWidth={10} /></svg>}
              <div className="focus-read">
                <span className="phase-name">{a ? T.phase[a.phase] : T.phase.focus}</span>
                <b className="num" role="timer" aria-live="off">{a ? mmss(secondsLeft(a)) : mmss(minutes * 60)}</b>
                <span className="muted focus-label">{a ? (a.label || T.freeFocus) : chosenBlock ? chosenBlock.label || T.untitledBlock : T.freeFocus}</span>
              </div>
            </div>
            <p className="sr-only" role="status">{a ? `${T.phase[a.phase]}${a.pausedLeft != null ? ` · ${T.focusPaused}` : ''}` : ''}</p>

            {!a && (
              <form className="focus-setup" onSubmit={(e) => { e.preventDefault(); if (day) startFocus(begin); }}>
                <div className="field">
                  <label htmlFor="fc-block">{T.blockPick}</label>
                  <select id="fc-block" className="input" value={chosen ?? ''} onChange={(e) => setBlockId(e.target.value || null)}>
                    <option value="">{T.freeFocus}</option>
                    {blocks.map((b) => <option key={b.id} value={b.id}>{clock(b.start)}–{clock(b.end)} · {b.label || T.untitledBlock}</option>)}
                  </select>
                </div>
                <div className="focus-pair">
                <div className="field">
                  <span className="label" id="fc-len-l">{T.lengthLabel}</span>
                  <Segmented className="fill num" role="group" aria-labelledby="fc-len-l">
                    {lengths.map((m) => <button key={m} type="button" aria-pressed={!custom && minutes === m} onClick={() => { setLen(m); setCustom(false); }}>{T.minShort(m)}</button>)}
                    <button type="button" aria-pressed={custom} onClick={() => { setCustom(true); if (!customText) setCustomText(String(minutes)); }}>{T.lengthCustom}</button>
                  </Segmented>
                  {custom && <input className="input num focus-custom" type="number" inputMode="numeric" min={5} max={120} step={1} aria-label={T.customMin} value={customText}
                    onChange={(e) => setCustomText(e.target.value)} onBlur={() => setCustomText(String(minutes))} />}
                </div>
                <div className="field">
                  <span className="label" id="fc-brk-l">{T.breakLabel}</span>
                  <Segmented className="fill num" role="group" aria-labelledby="fc-brk-l">
                    {breaks.map((m) => <button key={m} type="button" aria-pressed={breakMin === m} onClick={() => setBrk(m)}>{T.minShort(m)}</button>)}
                  </Segmented>
                </div>
                </div>
                <div className="focus-go"><button type="submit" className="btn primary big" disabled={!day}>{T.startFocus}</button></div>
              </form>
            )}

            {a && (
              <div className="focus-run">
                {a.phase === 'focus' && a.intent && <p className="focus-intent">{a.intent}</p>}
                <p className="muted num focus-cycle">{a.phase === 'focus' ? T.sessionN(cycleNo, f.longEvery) : T.nextLong(untilLong)}</p>
                <div className="focus-controls">
                  {/* the one filled button: pause or resume while focusing, back to work on a break */}
                  {a.phase !== 'focus' && <button type="button" className="btn primary" onClick={finish}>{T.skipBreak}</button>}
                  {a.pausedLeft == null
                    ? <button type="button" className={`btn ${a.phase === 'focus' ? 'primary' : 'ghost'}`} onClick={() => pauseFocus(key)}>{T.pause}</button>
                    : <button type="button" className={`btn ${a.phase === 'focus' ? 'primary' : 'ghost'}`} onClick={() => resumeFocus(key)}>{T.resume}</button>}
                  <button type="button" className="btn ghost num" disabled={a.plannedMin >= MAX_PLANNED} onClick={() => extendFocus(5, key)}>{T.plusFive}</button>
                  {a.phase === 'focus' && <button type="button" className="btn ghost" onClick={finish}>{T.finishNow}</button>}
                  <button type="button" className={`btn ghost${stopAsk ? ' danger' : ''}`} aria-live="polite" onClick={stop}>{stopAsk ? T.stopAsk(ranMin) : T.stop}</button>
                </div>
                {lastSession && (
                  <div className="field focus-note-field">
                    <label htmlFor="fc-note">{T.noteLabel}</label>
                    <input id="fc-note" className="input" maxLength={NOTE_MAX} placeholder={T.sessionNotePh}
                      value={noteDraft?.id === lastSession.id ? noteDraft.text : lastSession.note ?? ''}
                      onChange={(e) => setNoteDraft({ id: lastSession.id, text: e.target.value })}
                      onBlur={saveNote}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                  </div>
                )}
              </div>
            )}
            {deepDef && !a && <p className="muted focus-note">{T.addsTo(deepDef.name)}</p>}
          </div>
        </section>

        <div className="stack span-5">
        <section className="panel focus-sessions" aria-labelledby="fs-h" data-anim>
          <header>
            <h2 id="fs-h">{T.sessionsToday}</h2>
            <a className="card-link" style={{ fontWeight: 400 }} href={`/day/${today()}`} onClick={onLinkClick}>{T.nav.today}</a>
          </header>
          {sessions.length === 0 ? <div className="empty">{T.noSessions}</div> : (
            <div className="sessions">
              <div className="session-scroll" ref={listRef} tabIndex={sessions.length > ROWS ? 0 : -1} role="region" aria-label={T.sessionsToday}>
              {[...sessions].reverse().map((s) => {
                const st = new Date(s.start), en = new Date(s.end);
                return (
                  <div className="session" key={s.id}>
                    <i style={s.kind ? kindSwatch(s.kind) : { background: 'var(--surface)', border: '1px solid var(--control)' }} />
                    <span className="t num">{clock(st.getHours() * 60 + st.getMinutes())}–{clock(en.getHours() * 60 + en.getMinutes())}</span>
                    <span className="l">{s.label || T.freeFocus}</span>
                    <span className="n num">{duration(s.minutes)}</span>
                    {(s.intent || s.note) && <span className="more">{[s.intent, s.note].filter(Boolean).join(' · ')}</span>}
                  </div>
                );
              })}
              </div>
              <div className="session total"><span /><span /><span className="l">{T.totalCol}</span><span className="n num">{duration(total)}</span></div>
            </div>
          )}
        </section>

        {focused.length > 0 && <section className="panel" aria-labelledby="fb-h" data-anim>
          <header><h2 id="fb-h">{T.focusByBlock}</h2></header>
          {(
            <div className="byblock">
              {focused.map((b) => {
                const got = byBlock(b), len = b.end - b.start;
                return (
                  <div className="bb" key={b.id}>
                    <div className="bb-top"><span className="l"><i className="kind-dot" style={kindSwatch(b.kind)} />{b.label || T.untitledBlock}</span><span className="num muted">{T.focusedOf(duration(got), duration(len))}</span></div>
                    <div className="bb-track"><i style={{ transform: `scaleX(${Math.min(1, got / len)})` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </section>}
        {featureOn(settings, 'friends') && <FriendsPanel />}
        <section className="panel" aria-labelledby="f4-h" data-anim>
          <div className="chart-head">
            <h2 id="f4-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.focusFourWeeks}</h2>
            <span className="meta">{T.todayInBlue}</span>
          </div>
          {past ? (
            <Chart label={T.focusFourWeeks} deps={[past, T.locale, total]} draw={(el, C) => C.bars(el, {
              labels: days28.map((d) => shortDate(d)),
              values: days28.map((d) => (d === today() && day ? focusMinutes(day) : (past.get(`day:${d}`) ? focusMinutes(past.get(`day:${d}`)!) : 0))),
              highlight: 27, colour: themeColor('--hue'), mutedColour: themeColor('--chart-1'), height: Math.max(200, el.clientHeight),
              format: (v: number) => duration(v), tickFormat: (v: number) => T.minShort(v),
              xAt: days28.map((_, i) => (i % (el.clientWidth < 640 ? 14 : 7) === 0 ? i : -1)).filter((i) => i >= 0),
            })} />
          ) : <div className="skeleton" style={{ height: 200 }} />}
        </section>
        </div>

        {room && <FocusRoom start={begin} onClose={() => setRoom(false)} />}
      </div>
    </>
  );
}
