import { FocusWidgets } from '../components/FocusWidgets';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FocusConfig } from '../components/FocusConfig';
import type { FocusPhase } from '../lib/model';
import { useSettings } from '../App';
import { DocNotice, SaveStamp } from '../components/Common';
import { Ring, useTick } from '../components/FocusTimer';
import { addDays, clock, duration, nowMinutes, shortDate, today } from '../lib/dates';
import { Chart, themeColor } from '../components/Chart';
import {
  cancelFocus, chime, extendFocus, finishPhase, focusMinutes, MAX_PLANNED, mmss, NOTE_MAX, noteSession, pauseFocus, resumeFocus, secondsLeft,
  settingsFocus, startFocus, resetFocus, useFocusDay,
} from '../lib/focus';
import { useT } from '../lib/i18n';
import { activeColumn, type DayDoc, featureOn } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { useRange } from '../lib/useDoc';
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
  const blockRank = (b: typeof blocks[number]) => b.id === running?.id ? 0 : b.start > now ? 1 : 2;
  const pickerBlocks = [...blocks].sort((a, b) => blockRank(a) - blockRank(b) || a.start - b.start);
  const current = running ?? blocks.find((b) => b.start > now && b.kind === 'deep') ?? blocks.find((b) => b.start > now && b.kind !== 'personal') ?? null;
  const [blockId, setBlockId] = useState<string | null | undefined>(undefined);
  const [config, setConfig] = useState(false);
  const configButton = useRef<HTMLButtonElement>(null);
  const configView = useRef<HTMLDivElement>(null);
  const closeConfig = () => { setConfig(false); configButton.current?.focus(); };
  useEffect(() => {
    if (!config) return;
    configView.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open], .focus-room')) { e.preventDefault(); closeConfig(); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [config]);
  const [picking, setPicking] = useState(false);
  const [noteDraft, setNoteDraft] = useState<{ id: string; text: string } | null>(null);
  const [room, setRoom] = useState(false);
  const autoRoom = useRef(false);
  useEffect(() => {
    if (f.fullscreenBreak && a && a.phase !== 'focus') { autoRoom.current = true; setRoom(true); }
    else if (autoRoom.current) { autoRoom.current = false; setRoom(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
  }, [a?.phase, f.fullscreenBreak]);
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
  const phase: FocusPhase = a?.phase ?? 'focus';
  const minutes = f.focusMin;
  const begin = { blockId: chosen, label: chosenBlock?.label || T.freeFocus, minutes, breakMin: f.shortMin, phase: 'focus' as const };
  // the note belongs to the session a break follows
  const lastSession = a && a.phase !== 'focus' ? (holder?.focus?.sessions ?? []).find((x) => x.id === a.sessionId) ?? null : null;
  // a note being typed is kept even when the break ends (or is skipped) before the field loses focus
  const noteRef = useRef(noteDraft);
  noteRef.current = noteDraft;
  const saveNote = () => { const n = noteRef.current; if (n) { noteSession(n.id, n.text, key); setNoteDraft(null); } };
  useEffect(() => () => { const n = noteRef.current; if (n) noteSession(n.id, n.text, key); }, [key]);
  useEffect(() => { if (!lastSession && noteRef.current) saveNote(); }, [lastSession?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A timer carried past midnight finishes in its original day's document.
  const cycleSessions = a ? holder?.focus?.sessions ?? [] : sessions;
  const roundsDone = cycleSessions.length % f.longEvery || (cycleSessions.length && phase !== 'focus' ? f.longEvery : 0);
  const cycleNo = ((cycleSessions.length % f.longEvery) + (a?.phase === 'focus' ? 1 : 0)) || f.longEvery;

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
  const [stopAsk, setStopAsk] = useState<'stop' | 'reset' | null>(null);
  useEffect(() => { if (!stopAsk) return; const t = window.setTimeout(() => setStopAsk(null), 4000); return () => window.clearTimeout(t); }, [stopAsk]);
  useEffect(() => setStopAsk(null), [a?.startedAt]);
  const ranMin = a && a.phase === 'focus' ? Math.floor((a.plannedMin * 60 - secondsLeft(a)) / 60) : 0;
  function stop(reset = false) {
    if (ranMin >= 1 && stopAsk !== (reset ? 'reset' : 'stop')) { setStopAsk(reset ? 'reset' : 'stop'); return; }
    setStopAsk(null);
    saveNote();
    if (reset) resetFocus(key); else cancelFocus(key);
  }

  async function finish() {
    if (!a || (f.strict && a.phase === 'focus')) return;
    if (a.phase !== 'focus') saveNote();
    const r = await finishPhase(settings, true, { key, startedAt: a.startedAt });
    if (r !== 'none' && f.sound) chime(f);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (config || e.repeat || e.ctrlKey || e.metaKey || e.altKey || el?.isContentEditable || el?.closest('input, textarea, select, button, [role="dialog"], dialog') || document.querySelector('dialog[open], [role="dialog"], .focus-room')) return;
      const k = e.key.toLowerCase();
      if (![' ', 's', 'r', '+', '='].includes(k)) return;
      e.preventDefault();
      if (!a) { if (k === ' ' && day) void startFocus(begin); return; }
      if (k === '+' || k === '=') { void extendFocus(5, key); return; }
      if (f.strict && a.phase === 'focus') return;
      if (k === ' ') { if (a.pausedLeft == null) void pauseFocus(key); else void resumeFocus(key); }
      if (k === 's') void finish();
      if (k === 'r' && !a.roomId) stop(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
        <section className={`panel span-7 focus-panel phase-${phase}`} aria-labelledby="fp-h" data-anim>
          <header className="focus-card-head"><h2 id="fp-h">{config ? T.focusSettings : T.focusRunning}{config && a && <small className="focus-config-time num">{T.phase[a.phase]} · {mmss(secondsLeft(a))}</small>}</h2><div className="focus-card-actions">
          <button type="button" className="btn ghost sm focus-room-btn" onClick={openRoom}>{T.roomOpen}</button>
          <div className="focus-config-anchor"><button ref={configButton} type="button" className="btn sm" aria-expanded={config} aria-controls="focus-settings-view" onClick={() => config ? closeConfig() : setConfig(true)}>{config ? T.focusBackTimer : T.nav.settings}</button></div>
          </div></header>
          <div className={`focus-card-body${config ? ' is-config' : ''}`}><div className="focus-stage" inert={config} aria-hidden={config || undefined}>
            <div className="focus-ring">
              {a ? <Ring a={a} size={248} stroke={5} /> : <svg width={248} height={248} viewBox="0 0 248 248" aria-hidden="true"><circle cx={124} cy={124} r={119} fill="none" stroke="var(--phase-color)" strokeWidth={5} /></svg>}
              <div className="focus-read">
                <span className="phase-name">{T.phase[phase]}</span>
                <b className="num" role="timer" aria-live="off">{a ? mmss(secondsLeft(a)) : mmss(minutes * 60)}</b>
                <span className="muted focus-label">{a ? (a.label || T.freeFocus) : chosenBlock ? chosenBlock.label || T.untitledBlock : T.freeFocus}</span>
              </div>
            </div>
            <p className="sr-only" role="status">{a ? `${T.phase[a.phase]}${a.pausedLeft != null ? ` · ${T.focusPaused}` : ''}` : ''}</p>

            <div className="focus-cycle-summary">
              <div className="focus-rounds" title={T.focusRoundsHint} aria-hidden="true">{Array.from({ length: f.longEvery }, (_, i) => <i key={i} className={i < roundsDone ? 'done' : a?.phase === 'focus' && i === roundsDone ? 'current' : ''} />)}</div>
              <span className="muted num">{T.sessionN(a?.phase === 'focus' ? cycleNo : roundsDone, f.longEvery)}</span>
            </div>
            <div className="focus-block-row"><span>{T.focusCurrent}: {a?.label || chosenBlock?.label || T.freeFocus}</span>{!a && <button type="button" className="btn ghost sm" aria-expanded={picking} onClick={() => setPicking(!picking)}>{T.focusChange}</button>}</div>
            {!a && <form className="focus-setup" onSubmit={(e) => { e.preventDefault(); if (day) startFocus(begin); }}>
              {picking && <div className="field"><label htmlFor="fc-block">{T.blockPick}</label><select id="fc-block" className="input" value={chosen ?? ''} onChange={(e) => { setBlockId(e.target.value || null); setPicking(false); }}><option value="">{T.freeFocus}</option>{pickerBlocks.map((b) => <option key={b.id} value={b.id}>{clock(b.start)} · {b.label || T.untitledBlock}</option>)}</select></div>}
              <div className="focus-go"><button type="submit" className="btn primary big" disabled={!day}>{phase === 'focus' ? T.startFocus : T.focusStartBreak}</button></div>
            </form>}

            {a && (
              <div className="focus-run">
                {a.phase === 'focus' && a.intent && <p className="focus-intent">{a.intent}</p>}
                <div className="focus-controls">
                  {a.pausedLeft == null
                    ? <button type="button" className={`btn primary`} disabled={!!f.strict && a.phase === 'focus'} onClick={() => pauseFocus(key)}>{T.pause}</button>
                    : <button type="button" className={`btn primary`} disabled={!!f.strict && a.phase === 'focus'} onClick={() => resumeFocus(key)}>{T.resume}</button>}
                </div>
                <div className="focus-secondary">
                  <button type="button" className="btn ghost sm" disabled={!!a.roomId || (!!f.strict && a.phase === 'focus')} aria-describedby={a.roomId ? 'focus-reset-hint' : undefined} onClick={() => stop(true)}>{stopAsk === 'reset' ? T.stopAsk(ranMin) : T.focusReset}</button>
                  {a.phase !== 'focus' && <button type="button" className="btn ghost sm" onClick={finish}>{T.skipBreak}</button>}
                  <button type="button" className="btn ghost sm num" disabled={a.plannedMin >= MAX_PLANNED} onClick={() => extendFocus(5, key)}>{T.plusFive}</button>
                  {a.phase === 'focus' && <button type="button" className="btn ghost" disabled={!!f.strict && a.phase === 'focus'} onClick={finish}>{T.finishNow}</button>}
                  <button type="button" className={`btn ghost focus-stop${stopAsk === 'stop' ? ' danger' : ''}`} aria-live="polite" disabled={!!f.strict && a.phase === 'focus'} onClick={() => stop()}>{stopAsk === 'stop' ? T.stopAsk(ranMin) : T.stop}</button>
                </div>
                {a.roomId && <p id="focus-reset-hint" className="muted focus-note">{T.focusSharedResetHint}</p>}
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
          {config && <div id="focus-settings-view" ref={configView} className="focus-settings-view" tabIndex={-1} role="region" aria-label={T.focusSettings}><FocusConfig /></div>}
          </div>
        </section>

        <div className="stack span-5">
        <FocusWidgets day={day} />
        <section className="panel focus-sessions" aria-labelledby="fs-h" data-anim>
          <header>
            <h2 id="fs-h">{T.sessionsToday}</h2>
            <a className="card-link" href={`/day/${today()}`} onClick={onLinkClick}>{T.nav.today}</a>
          </header>
          {sessions.length === 0 ? <div className="empty">{T.noSessions}</div> : (
            <div className="sessions">
              <div className="session-scroll" ref={listRef} tabIndex={sessions.length > ROWS ? 0 : -1} role="region" aria-label={T.sessionsToday}>
              {[...sessions].reverse().map((s) => {
                const st = new Date(s.start), en = new Date(s.end);
                return (
                  <div className="session" key={s.id}>
                    <span className="t num">{clock(st.getHours() * 60 + st.getMinutes())}–{clock(en.getHours() * 60 + en.getMinutes())}</span>
                    <span className="l" title={s.label || T.freeFocus}>{s.label || T.freeFocus}</span>
                    <span className="n num">{duration(s.minutes)}</span>
                    {(s.intent || s.note) && <span className="more">{[s.intent, s.note].filter(Boolean).join(' · ')}</span>}
                  </div>
                );
              })}
              </div>
              <div className="session total"><span className="l">{T.totalCol}</span><span className="n num">{duration(total)}</span></div>
            </div>
          )}
        </section>

        {focused.length > 0 && <section className="panel focus-byblock" aria-labelledby="fb-h" data-anim>
          <header><h2 id="fb-h">{T.focusByBlock}</h2></header>
          {(
            <div className="byblock">
              {focused.map((b) => {
                const got = byBlock(b), len = b.end - b.start;
                return (
                  <div className="bb" key={b.id}>
                    <div className="bb-top"><span className="l">{b.label || T.untitledBlock}</span><span className="num muted">{T.focusedOf(duration(got), duration(len))}</span></div>
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
          {past && (() => {
            // three figures above the chart: a card that stretches with the timer card is not just a tall chart
            const mins = days28.map((d) => (d === today() && day ? focusMinutes(day) : (past.get(`day:${d}`) ? focusMinutes(past.get(`day:${d}`)!) : 0)));
            const sinceMon = (new Date(`${today()}T12:00`).getDay() + 6) % 7;
            const week = mins.slice(27 - sinceMon).reduce((n, m) => n + m, 0);
            const logged = mins.filter((m) => m > 0);
            const bestAt = mins.indexOf(Math.max(...mins));
            return (
              <dl className="focus-stats">
                <div><dt>{T.focusStats.week}</dt><dd className="num">{duration(week)}</dd></div>
                <div><dt>{T.focusStats.avg}</dt><dd className="num">{logged.length ? duration(Math.round(logged.reduce((n, m) => n + m, 0) / logged.length)) : '—'}</dd></div>
                <div><dt>{T.focusStats.best}</dt><dd className="num">{mins[bestAt] > 0 ? <>{duration(mins[bestAt])} <small>{shortDate(days28[bestAt])}</small></> : '—'}</dd></div>
              </dl>
            );
          })()}
          {past ? (
            <Chart label={T.focusFourWeeks} deps={[past, T.locale, total]} draw={(el, C) => C.bars(el, {
              labels: days28.map((d) => shortDate(d)),
              values: days28.map((d) => (d === today() && day ? focusMinutes(day) : (past.get(`day:${d}`) ? focusMinutes(past.get(`day:${d}`)!) : null))),
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
