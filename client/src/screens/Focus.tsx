import { FocusWidgets } from '../components/FocusWidgets';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FocusConfig } from '../components/FocusConfig';
import type { FocusPhase } from '../lib/model';
import { useSettings } from '../App';
import { DocNotice, SaveStamp } from '../components/Common';
import { RingLive, TimeLeft, useTick, useWatch } from '../components/FocusTimer';
import { SkipChoice, useSkip } from '../components/SkipChoice';
import { BlockChip, BlockSheet } from '../components/BlockPicker';
import { addDays, clock, duration, nowMinutes, shortDate, today } from '../lib/dates';
import { Chart, themeColor } from '../components/Chart';
import {
  cancelFocus, cycleDone, extendFocus, focusMinutes, MAX_PLANNED, mmss,  pauseFocus, resumeFocus, secondsLeft,
  resetCycle, settingsFocus, startFocus, resetFocus, useFocusDay,
} from '../lib/focus';
import { useT } from '../lib/i18n';
import { activeColumn, type DayDoc, type FocusActive, featureOn } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { useRange } from '../lib/useDoc';
import { FocusRoom } from '../components/FocusRoom';
import { FriendsPanel } from '../components/Friends';

const ROWS = 5;

/** The minutes a focus phase has run. */
const ranMinutes = (a: FocusActive) => a.phase === 'focus' ? Math.floor((a.plannedMin * 60 - secondsLeft(a)) / 60) : 0;

/** The question on Stop and Reset, with the minutes run: only this label follows the clock while it is asked. */
function StopAsk({ a }: { a: FocusActive }) {
  const T = useT();
  useTick(true);
  return <>{T.stopAsk(ranMinutes(a))}</>;
}

/**
 * On a desktop window the last card on the right lines up with the four-week chart on the left: the columns already
 * end together, so giving that card the chart card's height aligns their tops too (the sessions card takes up the
 * difference). A last card whose content needs more than that keeps its own height. The user asked for this.
 */
function useAlignedBottomRow() {
  // a callback ref: the grid appears only once the day has loaded, and the measuring must start then, not at mount
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const rewatch = useRef<(() => void) | null>(null);
  // the cards inside are re-created as data arrives (sessions, blocks summary, friends): re-bind and re-measure after every render
  useLayoutEffect(() => { rewatch.current?.(); });
  useLayoutEffect(() => {
    if (!grid) return;
    const el = grid; // narrowed for the closures below
    const wide = window.matchMedia('(min-width: 1000px) and (min-height: 601px)');
    let frame = 0;
    // a layout that was tried and did not fit is not tried again until something about it changes: trying it, dropping
    // it and trying it again on every resize made the cards flicker between the two layouts frame after frame
    let failed = '';
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    function apply() {
      {
        const history = el.querySelector<HTMLElement>('.focus-history');
        const last = el.querySelector<HTMLElement>(':scope > .stack > :last-child');
        if (!wide.matches || !history || !last) { delete el.dataset.alignRows; return; }
        const h = Math.round(history.getBoundingClientRect().height);
        el.style.setProperty('--history-h', `${h}px`);
        // what the last card's content needs, measured at its natural height
        const was = el.dataset.alignRows; delete el.dataset.alignRows;
        const stack0 = last.parentElement!, kids = [...stack0.children] as HTMLElement[];
        const gap = parseFloat(getComputedStyle(stack0).rowGap) || 0;
        const tried = `${h}|${el.clientWidth}|${kids.map((k) => `${k.className}:${k.textContent?.length ?? 0}`).join(',')}`;
        if (tried === failed) return;
        // four cards (blocks summary and Focus together both shown): the two of them together match the chart card
        const pairUp = kids.length >= 4 && last.classList.contains('friends') && kids[kids.length - 2].classList.contains('focus-byblock');
        if (pairUp) {
          const lastH = Math.ceil(last.getBoundingClientRect().height), prevH = Math.ceil(kids[kids.length - 2].getBoundingClientRect().height);
          if (lastH + gap + prevH > h + 1) { if (was != null) delete el.dataset.alignRows; return; }
          el.style.setProperty('--pair-h', `${h - gap - lastH}px`);
          el.dataset.alignRows = 'pair';
        } else if (kids.length === 2) {
          // two cards (Today and the sessions): they share the column in equal halves (user, 2026-11-14)
          el.dataset.alignRows = 'halves';
        } else {
          // three cards with the blocks summary and no Focus together keep their natural layout
          if (kids.length >= 3 && last.classList.contains('focus-byblock')) return;
          const need = last.classList.contains('focus-sessions') ? 0 : Math.ceil(last.getBoundingClientRect().height);
          if (need > h + 1) { if (was != null) delete el.dataset.alignRows; return; }
          el.dataset.alignRows = 'one';
        }
        // the sessions card gives up the difference, but never below two full rows (one with four cards, where the user
        // asked for the pair to always line up): otherwise keep the natural layout
        const sessions = el.querySelector<HTMLElement>('.focus-sessions');
        const list = sessions?.querySelector<HTMLElement>('.session-scroll');
        const row = list?.querySelector<HTMLElement>('.session')?.getBoundingClientRect().height ?? 0;
        const squeezed = !!sessions && sessions !== last && !pairUp && (sessions.scrollHeight > sessions.clientHeight + 1 || (!!list && list.getBoundingClientRect().height < Math.min((pairUp ? 1 : 2) * row, list.scrollHeight) - 1));
        const stack = last.parentElement!;
        // with four cards the session list is about to refit to one row, so judge the sessions card by that
        const sessionsFit = !pairUp || !sessions || !list || sessions.clientHeight + 1 >= sessions.scrollHeight - list.clientHeight + Math.min(row, list.scrollHeight);
        // the cards must end inside the column. Layout offsets, not on-screen boxes: the cards rise into place when the
        // page opens (a 14 px entrance transform), and measuring mid-animation used to drop the alignment at random
        const lastCard = stack.lastElementChild as HTMLElement | null;
        const spills = (lastCard ? lastCard.offsetTop + lastCard.offsetHeight : 0) > stack.offsetTop + stack.offsetHeight + 1 || !sessionsFit || [...stack.children].some((el) => (pairUp && el === sessions ? false : el.scrollHeight > el.clientHeight + 1));
        if (squeezed || spills) { delete el.dataset.alignRows; failed = tried; } else failed = '';
      }
    }
    const ro = new ResizeObserver(measure);
    let right: Element | null = null;
    const watch = () => {
      ro.disconnect(); ro.observe(el); el.querySelectorAll<HTMLElement>('.focus-history, :scope > .stack > *').forEach((c) => ro.observe(c));
      const now = el.querySelector(':scope > .stack');
      if (now !== right) { mo.disconnect(); right = now; if (right) mo.observe(right, { childList: true, subtree: true, characterData: true }); }
      measure();
    };
    // cards appear and go, and their content changes (blocks summary, friends, an incoming request, options); only the
    // right column is watched, so the timer's ticking does not set this off every second
    const mo = new MutationObserver(watch);
    wide.addEventListener('change', measure);
    rewatch.current = () => { watch(); apply(); };
    watch();
    apply(); // before the first paint, so the cards do not visibly jump into place
    return () => { rewatch.current = null; ro.disconnect(); mo.disconnect(); wide.removeEventListener('change', measure); cancelAnimationFrame(frame); };
  }, [grid]);
  return setGrid;
}

export function Focus() {
  const gridRef = useAlignedBottomRow();
  const T = useT();
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  // today's document; the timer may still live in yesterday's (a session begun before midnight)
  const { value: day, status, error, retry, active: a, key, holder } = useFocusDay();
  // This screen follows the minute (the block to focus on), not the second: the clock and the ring are leaves.
  useWatch(nowMinutes);
  const blocks = day ? activeColumn(day).blocks : [];
  const now = nowMinutes();
  // the block to focus on: the one running now, unless it is lunch or a walk; then the next deep block
  const running = blocks.find((b) => now >= b.start && now < b.end && b.kind !== 'personal');
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
  const chipRef = useRef<HTMLButtonElement>(null);
  const closePicker = () => setPicking(false);
  // the chip is inert while the list is open, so focus goes back to it once the list has closed
  const wasPicking = useRef(false);
  useEffect(() => { if (wasPicking.current && !picking) chipRef.current?.focus(); wasPicking.current = picking; }, [picking]);
  const [room, setRoom] = useState(false);
  const autoRoom = useRef(false);
  useEffect(() => {
    if (f.fullscreenBreak && a && a.phase !== 'focus') { autoRoom.current = true; setRoom(true); }
    else if (autoRoom.current) { autoRoom.current = false; setRoom(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
  }, [a?.phase, f.fullscreenBreak]);
  const openRoom = () => { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ } setRoom(true); };
  const chosen = blockId === undefined ? current?.id ?? null : blockId;
  const chosenBlock = blocks.find((b) => b.id === chosen) ?? null;
  // the block shown on the chip: the one the running timer belongs to, else the one chosen to focus on
  const shownBlock = a ? blocks.find((b) => b.id === a.blockId) ?? null : chosenBlock;
  useEffect(() => { if (a) setPicking(false); }, [a]);
  const sessions = day?.focus?.sessions ?? [];
  const total = day ? focusMinutes(day) : 0;
  const deepDef = settings.metrics.find((m) => m.id === f.metricId);
  const untilLong = f.longEvery - (cycleDone(day?.focus) % f.longEvery);
  const from28 = addDays(today(), -27);
  const { docs: past } = useRange<DayDoc>(`day:${from28}`, `day:${today()}`);
  const days28 = Array.from({ length: 28 }, (_, i) => addDays(from28, i));
  // the minutes focused on each of the 28 days; the chart draws again only when these change (the range hands out a new Map on every render)
  const goalMin = deepDef?.target != null && deepDef.target > 0 ? Math.round(deepDef.target * 60) : 0;
  const vals = past ? days28.map((d) => (d === today() && day ? focusMinutes(day) : (past.get(`day:${d}`) ? focusMinutes(past.get(`day:${d}`)!) : null))) : [];
  const workBlocks = blocks.filter((b) => b.kind !== 'personal');
  // a revision gives a block a new id, so a session also counts for a block of the same name
  const byBlock = (b: { id: string; label: string }) => sessions.filter((x) => x.blockId === b.id || (!!b.label && x.label === b.label)).reduce((n, x) => n + x.minutes, 0);
  const focused = workBlocks.filter((b) => byBlock(b) > 0);
  const phase: FocusPhase = a?.phase ?? 'focus';
  const minutes = f.focusMin;
  const begin = { blockId: chosen, label: chosenBlock?.label || T.freeFocus, minutes, breakMin: f.shortMin, phase: 'focus' as const };
  // a note being typed is kept even when the break ends (or is skipped) before the field loses focus
  // A timer carried past midnight finishes in its original day's document.
  // The rounds count from where the cycle last began (the day's start, or "Reset cycle"), not from all of today's sessions
  const inCycle = cycleDone(a ? holder?.focus : day?.focus);
  const roundsDone = inCycle % f.longEvery || (inCycle && phase !== 'focus' ? f.longEvery : 0);
  const cycleNo = ((inCycle % f.longEvery) + (a?.phase === 'focus' ? 1 : 0)) || f.longEvery;

  // Today's sessions shows about five rows and scrolls inside, so a long day does not push the cards below
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const fit = () => {
      const rows = [...el.children] as HTMLElement[];
      const available = el.parentElement!.clientHeight - (el.parentElement!.querySelector('.total')?.clientHeight ?? 0);
      // two rows at least; one when the four right-hand cards line up with the chart (useAlignedBottomRow)
      const minRows = el.closest('.focus-grid')?.getAttribute('data-align-rows') === 'pair' ? 1 : 2;
      let height = 0;
      for (const [i, row] of rows.slice(0, ROWS).entries()) {
        const rowHeight = row.getBoundingClientRect().height;
        if (i >= minRows && height + rowHeight > available) break;
        height += rowHeight;
      }
      const h = `${height}px`;
      if (el.style.getPropertyValue('--rows-h') !== h) el.style.setProperty('--rows-h', h);
      const tab = el.scrollHeight > el.clientHeight ? 0 : -1;
      if (el.tabIndex !== tab) el.tabIndex = tab;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(el.parentElement!);
    [...el.children].forEach((row) => ro.observe(row));
    return () => ro.disconnect();
  }, [sessions]);

  // Stop throws the running session away: once it has run a minute, the first press asks, the second discards
  const [stopAsk, setStopAsk] = useState<'stop' | 'reset' | null>(null);
  useEffect(() => { if (!stopAsk) return; const t = window.setTimeout(() => setStopAsk(null), 4000); return () => window.clearTimeout(t); }, [stopAsk]);
  useEffect(() => setStopAsk(null), [a?.startedAt]);
  function stop(reset = false) {
    if (a && ranMinutes(a) >= 1 && stopAsk !== (reset ? 'reset' : 'stop')) { setStopAsk(reset ? 'reset' : 'stop'); return; }
    setStopAsk(null);
    if (reset) resetFocus(key); else cancelFocus(key);
  }

  // Skip: a break goes at once, a focus phase asks what to count unless it has only just begun (see useSkip)
  const skip = useSkip(a, key);
  function skipPhase() {
    skip.request();
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
      if (k === 's') skipPhase();
      if (k === 'r' && !a.roomId) stop(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The button of a notification ("Start break" / "Start focus") opens /focus?go=break|focus. Once the phase that ended
  // has been settled (the shell logs it, and starts the next one only when that is automatic), the button's phase starts.
  const go = useRef(new URLSearchParams(window.location.search).get('go'));
  useEffect(() => {
    if (!go.current) return;
    const stop = window.setTimeout(() => { go.current = null; }, 20_000);
    return () => window.clearTimeout(stop);
  }, []);
  useEffect(() => {
    if (!go.current || !day) return;
    const done = () => { go.current = null; window.history.replaceState(window.history.state, '', window.location.pathname); };
    if (go.current === 'break' && a && a.phase !== 'focus' && a.pausedLeft != null) { done(); void resumeFocus(key); }
    else if (go.current === 'focus' && !a) { done(); void startFocus(begin); }
  }, [a, day, key]);

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

      <div className="grid top focus-grid" ref={gridRef}>
        <div className="span-7 focus-left">
        <section className={`panel focus-panel phase-${phase}`} aria-labelledby="fp-h" data-anim>
          <header className="focus-card-head"><h2 id="fp-h">{config ? T.focusSettings : T.focusRunning}{config && a && <small className="focus-config-time num">{T.phase[a.phase]} · <TimeLeft a={a} /></small>}</h2><div className="focus-card-actions">
          <button type="button" className="btn ghost sm focus-room-btn" onClick={openRoom}>{T.roomOpen}</button>
          <div className="focus-config-anchor"><button ref={configButton} type="button" className="btn sm" aria-expanded={config} aria-controls="focus-settings-view" onClick={() => config ? closeConfig() : setConfig(true)}>{config ? T.focusBackTimer : T.nav.settings}</button></div>
          </div></header>
          <div className={`focus-card-body${config ? ' is-config' : ''}`}><div className="focus-stage" inert={config || skip.asking || picking} aria-hidden={config || skip.asking || picking || undefined}>
            <div className="focus-ring">
              {a ? <RingLive a={a} size={248} stroke={5} /> : <svg width={248} height={248} viewBox="0 0 248 248" aria-hidden="true"><circle cx={124} cy={124} r={121.5} fill="none" stroke="var(--phase-color)" strokeWidth={5} /></svg>}
              <div className="focus-read">
                <span className="phase-name">{T.phase[phase]}</span>
                <b className="num" role="timer" aria-live="off">{a ? <TimeLeft a={a} /> : mmss(minutes * 60)}</b>
                <span className="muted focus-label">{a ? (a.label || T.freeFocus) : chosenBlock ? chosenBlock.label || T.untitledBlock : T.freeFocus}</span>
              </div>
            </div>
            <p className="sr-only" role="status">{a ? `${T.phase[a.phase]}${a.pausedLeft != null ? ` · ${T.focusPaused}` : ''}` : ''}</p>

            <div className="focus-cycle-summary">
              <div className="focus-rounds" title={T.focusRoundsHint} aria-hidden="true">{Array.from({ length: f.longEvery }, (_, i) => <i key={i} className={i < roundsDone ? 'done' : a?.phase === 'focus' && i === roundsDone ? 'current' : ''} />)}</div>
              <span className="muted num">{T.sessionN(a?.phase === 'focus' ? cycleNo : roundsDone, f.longEvery)}</span>
              {!a && roundsDone >= 1 && <button type="button" className="btn ghost sm focus-cycle-reset" onClick={() => resetCycle(key)}>{T.cycleReset}</button>}
            </div>
            <BlockChip block={shownBlock} label={a ? a.label || T.freeFocus : chosenBlock ? chosenBlock.label || T.untitledBlock : T.freeFocus} open={picking} locked={!!a} onOpen={() => setPicking(true)} chipRef={chipRef} />
            {!a && <form className="focus-setup" onSubmit={(e) => { e.preventDefault(); if (day) startFocus(begin); }}>
              <div className="focus-go"><button type="submit" className="btn primary big" disabled={!day}>{phase === 'focus' ? T.startFocus : T.focusStartBreak}</button></div>
            </form>}

            {a && (
              <div className="focus-run">
                {a.phase === 'focus' && a.intent && <p className="focus-intent">{a.intent}</p>}
                <div className="focus-controls">
                  {a.pausedLeft == null
                    ? <button type="button" className="btn primary focus-act" disabled={!!f.strict && a.phase === 'focus'} onClick={() => pauseFocus(key)}>{T.pause}</button>
                    : <button type="button" className="btn primary focus-act" disabled={!!f.strict && a.phase === 'focus'} onClick={() => resumeFocus(key)}>{T.resume}</button>}
                </div>
                <div className="focus-secondary">
                  <button type="button" className={`btn ghost sm focus-act${stopAsk === 'reset' ? ' danger' : ''}`} aria-live="polite" disabled={!!a.roomId || (!!f.strict && a.phase === 'focus')} aria-describedby={a.roomId ? 'focus-reset-hint' : undefined} onClick={() => stop(true)}>{stopAsk === 'reset' && a ? <StopAsk a={a} /> : T.focusReset}</button>
                  <button type="button" className="btn ghost sm focus-act num" disabled={a.plannedMin >= MAX_PLANNED} onClick={() => extendFocus(5, key)}>{T.plusFive}</button>
                  <button type="button" className="btn ghost sm focus-act" disabled={skip.locked} onClick={skipPhase}>{T.skip}</button>
                  <span className="focus-sep" aria-hidden="true" />
                  <button type="button" className={`btn ghost sm focus-act focus-stop${stopAsk === 'stop' ? ' danger' : ''}`} aria-live="polite" disabled={!!f.strict && a.phase === 'focus'} onClick={() => stop()}>{stopAsk === 'stop' && a ? <StopAsk a={a} /> : T.stop}</button>
                </div>
                {a.roomId && <p id="focus-reset-hint" className="muted focus-note">{T.focusSharedResetHint}</p>}
              </div>
            )}
            {deepDef && !a && <p className="muted focus-note">{T.addsTo(deepDef.name)}</p>}
          </div>
          {picking && !a && <BlockSheet blocks={blocks} value={chosen} nowMin={now} focusedMin={byBlock} onChoose={(id) => { setBlockId(id); closePicker(); }} onClose={closePicker} />}
          {skip.asking && a && <SkipChoice a={a} skip={skip} />}
          {config && <div id="focus-settings-view" ref={configView} className="focus-settings-view" tabIndex={-1} role="region" aria-label={T.focusSettings}><FocusConfig /></div>}
          </div>
        </section>

        <section className="panel focus-history" aria-labelledby="f4-h" data-anim>
          <div className="chart-head">
            <h2 id="f4-h">{T.focusFourWeeks}{past && <small className="session-count num">{goalMin ? T.focusStats.onTarget(vals.filter((v) => (v ?? 0) >= goalMin).length, 28) : T.focusStats.daysFocused(vals.filter((v) => (v ?? 0) > 0).length, 28)}</small>}</h2>
          </div>
          {past && (() => {
            // three figures above the chart: a card that stretches with the timer card is not just a tall chart
            const mins = vals.map((v) => v ?? 0);
            const sinceMon = (new Date(`${today()}T12:00`).getDay() + 6) % 7;
            const week = mins.slice(27 - sinceMon).reduce((n, m) => n + m, 0);
            const logged = mins.filter((m) => m > 0);
            // the same days of last week, so Monday is not compared with a whole week
            const lastWeek = mins.slice(20 - sinceMon, 21).reduce((n, m) => n + m, 0);
            const change = week - lastWeek;
            const bestAt = mins.indexOf(Math.max(...mins));
            return (
              <dl className="focus-stats">
                <div><dt>{T.focusStats.week}</dt><dd className="num">{duration(week)}{change !== 0 && <> <small title={T.focusStats.vsLastWeek}>{change > 0 ? '+' : '−'}{duration(Math.abs(change))}</small></>}</dd></div>
                <div><dt>{T.focusStats.avg}</dt><dd className="num">{logged.length ? duration(Math.round(logged.reduce((n, m) => n + m, 0) / logged.length)) : '—'}</dd></div>
                <div><dt>{T.focusStats.best}</dt><dd className="num">{mins[bestAt] > 0 ? <>{duration(mins[bestAt])} <small>{shortDate(days28[bestAt])}</small></> : '—'}</dd></div>
              </dl>
            );
          })()}
          {past ? (
            <Chart label={T.focusFourWeeks} deps={[from28, vals.join(), T.locale]} draw={(el, C) => C.bars(el, {
              labels: days28.map((d) => shortDate(d)),
              values: vals,
              // today is the one bar in the data colour; with no focus yet today, a thin marker shows where today is
              highlight: 27, colour: themeColor('--hue'), mutedColour: themeColor('--chart-1'), height: Math.min(240, Math.max(120, el.clientHeight)),
              annotations: vals[27] ? undefined : [{ at: 27, label: T.nav.today, short: T.nav.today }],
              // the daily goal as a quiet line, so the days that reached it read at a glance
              reference: goalMin ? { value: goalMin, label: T.focusStats.goal(duration(goalMin)), at: 'left' } : undefined,
              format: (v: number) => duration(v), tickFormat: (v: number) => T.minShort(v),
              xAt: days28.map((_, i) => (i % (el.clientWidth < 640 ? 14 : 7) === 0 ? i : -1)).filter((i) => i >= 0),
            })} />
          ) : <div className="skeleton" style={{ height: 200 }} />}
        </section>
        </div>

        <div className="stack span-5">
        <FocusWidgets day={day} />
        <section className="panel focus-sessions" aria-labelledby="fs-h" data-anim>
          <header>
            <h2 id="fs-h">{T.sessionsToday}<small className="session-count num">{T.sessionCount(sessions.length, duration(total))}</small></h2>
            <a className="card-link" href={`/day/${today()}`} onClick={onLinkClick}>{T.nav.today}</a>
          </header>
          {sessions.length === 0 ? <div className="empty fs-empty">
            <div className="fs-empty-copy"><b>{T.noSessions}</b><span>{T.noSessionsHint}</span></div>
            {/* a faint outline of the rows that will come, so the empty card reads as the list it will become */}
            <div className="fs-ghost" aria-hidden="true">{[0.8, 0.55, 0.7].map((w, i) => <div className="fs-ghost-row" key={i}><i style={{ width: 44 }} /><i style={{ width: `${w * 100}%` }} /><i style={{ width: 32 }} /></div>)}</div>
          </div> : (
            <div className="sessions">
              <div className="session-scroll" ref={listRef} tabIndex={-1} role="region" aria-label={T.sessionsToday}>
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
                    <div className="bb-top"><span className="l" title={b.label || T.untitledBlock}>{b.label || T.untitledBlock}</span><span className="num muted">{T.focusedOf(duration(got), duration(len))}</span></div>
                    <div className="bb-track"><i style={{ transform: `scaleX(${Math.min(1, got / len)})` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </section>}
        {featureOn(settings, 'friends') && <FriendsPanel />}

        </div>

        {room && <FocusRoom start={begin} onClose={() => setRoom(false)} />}
      </div>
    </>
  );
}
