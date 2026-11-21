import { useEffect, useRef, useState } from 'react';
import { dragBlock, type BlockDragMode } from '../lib/blockDrag';
import { offerUndo } from '../lib/undo';
import { layoutBlocks } from '../lib/layout';
import { clock, duration, minutesOf } from '../lib/dates';
import { useT } from '../lib/i18n';
import { IconRepeat } from '../components/Icons';
import { lockSwipe } from '../lib/swipe';
import { MAX_COLUMNS, uid, type Block, type Column, type DayDoc, type FocusSession, type Kind } from '../lib/model';
import { eventUid, type CalEvent } from '../lib/calendar';
import { Pop } from '../components/Pop';
import { useSettings } from '../App';

export const PPM = 1.2; // pixels per minute: a half hour is 36px
const SNAP = 15;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const floorSnap = (m: number) => Math.floor(m / SNAP) * SNAP;

type EditDrag = { mode: BlockDragMode; id: string; original: Block; start: number; end: number; moved: boolean; x0: number; y0: number; pointerId: number };
type Drag = { mode: 'create'; anchor: number; start: number; end: number; pointerId: number } | EditDrag;

export function TimeGrid({
  day, range, now, onColumns, onOpen, onChange, shownCol, preview, events = [], onEvent, focusAt = null, focusKey, sessions = [], drifts,
}: {
  /** blocks whose calendar event changed since they were made (by block id): marked, and told of when opened */
  drifts?: Map<string, 'moved' | 'gone'>;
  /** the focus sessions done on this day (a past day or today): a thin strip on the edge of the active column, where they ran */
  sessions?: FocusSession[];
  /** a minute to bring into view when the day opens (a whole-day grid is taller than the screen) */
  focusAt?: number | null;
  focusKey?: string;
  /** the linked calendars' timed events of this day, drawn faintly behind the blocks; a click blocks one out */
  events?: CalEvent[];
  onEvent?: (e: CalEvent, edit?: boolean) => void;
  preview?: { start: number; end: number; label: string } | null;
  day: DayDoc;
  range: [number, number];
  now: number | null; // minutes, only when the day is today
  onColumns: (fn: (cols: Column[]) => Column[]) => void;
  onOpen: (blockId: string) => void;
  onChange: (id: string, times: { start: number; end: number }) => void;
  shownCol: number;
}) {
  const T = useT();
  const [r0, r1] = range;
  const height = (r1 - r0) * PPM;
  const last = day.columns.length - 1;
  const [drag, setDrag] = useState<Drag | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ y: number; x: number; t: number } | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusAt == null) return;
    // content that arrives a moment later (notes above the grid, loaded data) pushes the grid down: centre again once
    // the page has settled, unless the person has started scrolling themselves
    let moved = false;
    const own = () => { moved = true; };
    const go = () => { if (!moved) focusRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' }); };
    go();
    const frame = requestAnimationFrame(go), soon = window.setTimeout(go, 400), later = window.setTimeout(go, 1200);
    window.addEventListener('wheel', own, { passive: true }); window.addEventListener('touchstart', own, { passive: true }); window.addEventListener('keydown', own);
    return () => {
      cancelAnimationFrame(frame); window.clearTimeout(soon); window.clearTimeout(later);
      window.removeEventListener('wheel', own); window.removeEventListener('touchstart', own); window.removeEventListener('keydown', own);
    };
  }, [focusKey, focusAt != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = day.columns[last];
  const floor = Math.max(r0, active.from ?? r0);
  const minuteAt = (clientY: number) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    return r0 + (clientY - rect.top) / PPM;
  };
  const clamp = (m: number) => Math.min(r1, Math.max(floor, m));

  const setBlocks = (fn: (b: Block[]) => Block[]) =>
    onColumns((cols) => cols.map((c, i) => (i === last ? { ...c, blocks: fn(c.blocks) } : c)));

  function createAt(start: number, end: number) {
    const b: Block = { id: uid(), start, end, label: '', note: '', kind: 'deep' };
    setBlocks((bs) => [...bs, b].sort((a, z) => a.start - z.start));
    onOpen(b.id);
  }

  // ---- pointer handling on the active column ----
  function onBodyDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('.block')) return;
    if (e.pointerType === 'touch') { touchStart.current = { y: e.clientY, x: e.clientX, t: Date.now() }; return; }
    if (e.button !== 0) return;
    const m = clamp(floorSnap(minuteAt(e.clientY)));
    if (m >= r1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ mode: 'create', anchor: m, start: m, end: Math.min(r1, m + SNAP), pointerId: e.pointerId });
  }
  function onBodyUp(e: React.PointerEvent) {
    if (e.pointerType === 'touch' && touchStart.current) {
      const t = touchStart.current;
      touchStart.current = null;
      if (Math.abs(e.clientY - t.y) < 8 && Math.abs(e.clientX - t.x) < 8 && !(e.target as HTMLElement).closest('.block')) {
        // a tap makes a half-hour block on the slot it landed in
        const start = clamp(Math.floor(minuteAt(e.clientY) / 30) * 30);
        if (start < r1) createAt(start, Math.min(r1, start + 30));
      }
    }
  }

  const suppressTap = useRef(false);
  const cancelTouch = useRef<(() => void) | null>(null);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { suppressTap.current = true; cancelTouch.current?.(); setDrag(null); }
    };
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('keydown', cancel); cancelTouch.current?.(); };
  }, [day]);

  function commit(d: EditDrag) {
    if (d.start === d.original.start && d.end === d.original.end) return;
    onChange(d.id, { start: d.start, end: d.end });
    offerUndo(T.blockChanged, () => onChange(d.id, { start: d.original.start, end: d.original.end }));
  }
  function advance(d: EditDrag, x: number, y: number): EditDrag {
    const moved = d.moved || Math.hypot(x - d.x0, y - d.y0) >= 4;
    return moved ? { ...d, moved, ...dragBlock(d.original, d.mode, (y - d.y0) / PPM, floor, r1) } : d;
  }
  // Native touchmove remains cancellable after the hold, while an early swipe scrolls normally.
  function pressBlock(initial: EditDrag) {
    cancelTouch.current?.();
    let cur: EditDrag | null = null;
    const timer = window.setTimeout(() => {
      lockSwipe(true);
      suppressTap.current = true;
      cur = { ...initial, moved: true };
      setDrag(cur);
    }, 350);
    const move = (te: TouchEvent) => {
      const t = te.touches[0];
      if (!t) return;
      if (!cur) { if (Math.hypot(t.clientX - initial.x0, t.clientY - initial.y0) >= 4) finish(false); return; }
      te.preventDefault();
      cur = advance(cur, t.clientX, t.clientY); setDrag(cur);
    };
    const finish = (save: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', cancel);
      cancelTouch.current = null;
      if (cur) { if (save) commit(cur); setDrag(null); }
      lockSwipe(false);
    };
    const end = () => finish(true), cancel = () => finish(false);
    cancelTouch.current = cancel;
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', cancel);
  }
  function onBlockDown(e: React.PointerEvent, b: Block) {
    if (e.button !== 0) return;
    e.stopPropagation();
    suppressTap.current = false;
    const edge = (e.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge;
    const initial: EditDrag = { mode: edge === 'start' ? 'start' : edge === 'end' ? 'end' : 'move', id: b.id, original: b, start: b.start, end: b.end, moved: false, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId };
    if (e.pointerType === 'touch') { pressBlock(initial); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(initial);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId || e.pointerType === 'touch') return;
    if (drag.mode === 'create') {
      const p = clamp(snap(minuteAt(e.clientY)));
      setDrag({ ...drag, start: Math.min(drag.anchor, p), end: Math.min(r1, Math.max(drag.anchor + SNAP, p)) });
    } else setDrag(advance(drag, e.clientX, e.clientY));
  }
  function onUp(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId || e.pointerType === 'touch') return;
    const d = drag; setDrag(null);
    if (d.mode === 'create') createAt(d.start, d.end - d.start < 30 ? Math.min(r1, d.start + 30) : d.end);
    else if (d.moved) { suppressTap.current = true; commit(d); }
  }
  function onBlockKey(e: React.KeyboardEvent, b: Block) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(b.id); return; }
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const times = dragBlock(b, e.shiftKey ? 'end' : 'move', e.key === 'ArrowUp' ? -5 : 5, floor, r1);
    commit({ mode: 'move', id: b.id, original: b, ...times, moved: true, x0: 0, y0: 0, pointerId: -1 });
  }

  // lines: one per half hour, the hour lines a step darker
  const lines: { top: number; hour: boolean }[] = [];
  for (let m = Math.ceil(r0 / 30) * 30; m < r1; m += 30) if (m > r0) lines.push({ top: (m - r0) * PPM, hour: m % 60 === 0 });
  // every hour is labelled, the end of the day too (the grid ends there; without it the last hour looked open-ended)
  const hourLabels: number[] = [];
  for (let m = Math.ceil(r0 / 60) * 60; m <= r1; m += 60) hourLabels.push(m);

  const nowTop = now != null && now >= r0 && now <= r1 ? (now - r0) * PPM : null;

  return (
    <div className="grid-wrap">
      <div className="hours" aria-hidden="true">
        <div style={{ height: 36, borderBottom: '1px solid var(--border)' }} />
        <div style={{ position: 'relative', height }}>
          {hourLabels.map((m) => (m === r1
            // the end of the day sits just above the last line, inside the grid (nothing hangs below it, so print keeps one page)
            ? <span key={m} className="end">{m === 1440 ? '24:00' : clock(m)}</span>
            : <span key={m} style={{ top: (m - r0) * PPM }}>{clock(m)}</span>))}
        </div>
      </div>
      <div className="cols">
        {day.columns.map((col, ci) => {
          const isActive = ci === last;
          const layout = layoutBlocks(col.blocks.map(b => isActive && drag && 'id' in drag && drag.id === b.id && drag.moved ? { ...b, start: drag.start, end: drag.end } : b));
          const name = ci === 0 ? T.plan : T.revisionN(ci);
          const before = col.from != null && col.from > r0 ? (col.from - r0) * PPM : 0;
          const ghost = drag && drag.mode === 'create' && isActive ? drag : null;
          return (
            <section
              key={ci}
              className={`col${isActive ? ' active' : ' closed'}${ci === shownCol && !isActive ? ' shown' : ''}`}
              aria-label={`${name}${col.closedAt != null ? T.revisedAt(clock(col.closedAt)) : ''}`}
            >
              <div className="col-head">
                <b>{name}</b>
                <span className="t">
                  {col.from != null ? T.fromT(clock(col.from)) : ''}
                  {col.closedAt != null ? `${col.from != null ? ' · ' : ''}${T.toT(clock(col.closedAt))}` : ''}
                  {isActive && day.columns.length > 1 ? ` · ${T.of(last + 1, MAX_COLUMNS)}` : ''}
                </span>
              </div>
              <div
                className="col-body" ref={isActive ? bodyRef : undefined} style={{ height }}
                onPointerDown={isActive ? onBodyDown : undefined}
                onPointerMove={isActive ? onMove : undefined}
                onPointerUp={isActive ? (e) => { onUp(e); onBodyUp(e); } : undefined}
                onPointerCancel={() => setDrag(null)}
              >
                {before > 0 && <div className="before" style={{ height: before }} />}
                {isActive && focusAt != null && <div ref={focusRef} className="grid-focus" style={{ top: (Math.min(r1, Math.max(r0, focusAt)) - r0) * PPM }} aria-hidden="true" />}
                {lines.map((l) => <div key={l.top} className={`line${l.hour ? ' hour' : ''}`} style={{ top: l.top }} />)}
                {isActive && events.filter((ev) => ev.end > r0 && ev.start < r1).map((ev, k) => {
                  const s = Math.max(r0, ev.start), e = Math.min(r1, ev.end);
                  return (
                    <CalendarEvent key={ev.cal + k} event={ev} top={(s - r0) * PPM + 1} height={Math.max(14, (e - s) * PPM - 2)} planned={day.columns.some((c) => c.blocks.some((b) => b.source?.calendar === ev.cal && b.source.uid === eventUid(ev)))} onEvent={onEvent} />
                  );
                })}
                {isActive && drag && 'id' in drag && drag.moved && <div className="block ghost drag-origin" aria-hidden="true" style={{ top: (drag.original.start - r0) * PPM + 1, height: (drag.original.end - drag.original.start) * PPM - 2 }} />}
                {col.blocks.map((b) => {
                  const { lane, lanes } = layout.get(b.id)!;
                  const live = drag && 'id' in drag && drag.id === b.id && isActive && drag.moved ? drag : null;
                  const start = live ? live.start : b.start, end = live ? live.end : b.end;
                  const crossed = col.closedAt != null && b.end > col.closedAt;
                  const current = isActive && now != null && now >= b.start && now < b.end;
                  const h = (end - start) * PPM;
                  const short = h < 44;
                  // a quarter hour is 16px tall: one line of smaller type, centred
                  const tiny = h < 26;
                  const drift = isActive ? drifts?.get(b.id) : undefined;
                  const driftText = drift ? (drift === 'gone' ? T.calDrift.goneMark : T.calDrift.mark) : '';
                  return (
                    <div
                      key={b.id}
                      role={isActive ? 'button' : undefined}
                      tabIndex={isActive ? 0 : undefined}
                      aria-label={T.blockAria(b.label || T.untitledBlock, clock(start), clock(end), T.kinds[b.kind].name, crossed) + (driftText ? `. ${driftText}` : '') + (isActive ? `. ${T.blockDragHelp}` : '')}
                      title={driftText || undefined}
                      className={`block k-${b.kind}${crossed ? ' crossed' : ''}${current ? ' current' : ''}${short ? ' short' : ''}${tiny ? ' tiny' : ''}${b.label ? '' : ' untitled'}${drift ? ' drifted' : ''}${live && (live.mode !== 'move' || live.moved) ? ' dragging' : ''}`}
                      data-lanes={lanes}
                      style={{ top: (start - r0) * PPM + 1, height: Math.max(14, h - 2), left: `calc(var(--block-space, 100%) * ${lane / lanes} + 6px)`, right: 'auto', width: `calc(var(--block-space, 100%) / ${lanes} - 12px)` }}
                      onPointerDown={isActive ? (e) => onBlockDown(e, b) : undefined}
                      onClick={() => {
                        if (suppressTap.current) { suppressTap.current = false; return; } // the end of a long-press move, not a tap
                        if (isActive) onOpen(b.id);
                      }}
                      onKeyDown={isActive ? (e) => onBlockKey(e, b) : undefined}
                    >
                      <span className="bl">{b.repeatId && <span className="rep" title={T.repeatsWeekly}><IconRepeat /></span>}{b.label || T.untitled}{day.tasks.find(t => b.task ? t.id === b.task.id : t.text === b.label)?.done && <span aria-label={T.taskBlock.done}> {T.taskBlock.done}</span>}{b.task?.list === 'day' && b.task.day && !day.tasks.some(t => t.id === b.task!.id) && <span>{T.taskBlock.deleted}</span>}</span>
                      <span className="bt">{lanes === 1 && b.subject && <span className="subj">{b.subject} · </span>}{clock(start)}–{clock(end)}{short || lanes > 1 ? '' : ` · ${duration(end - start)}`}</span>
                      {!short && b.note && h >= 64 && <span className="bn">{b.note}</span>}
                      {driftText && !tiny && <span className="bd">{driftText}</span>}
                      {isActive && <><span className="grip grip-start" data-edge="start" aria-hidden="true" /><span className="grip" data-edge="end" aria-hidden="true" /></>}
                      {live && <span className="block-drag-time" role="status">{clock(start)}–{clock(end)}</span>}
                    </div>
                  );
                })}
                {isActive && preview && (
                  <div className={`block ghost drop short${(preview.end - preview.start) * PPM < 26 ? ' tiny' : ''}`} style={{ top: (preview.start - r0) * PPM + 1, height: Math.max(14, (preview.end - preview.start) * PPM - 2) }}>
                    <span className="bl">{preview.label}</span><span className="bt">{clock(preview.start)}–{clock(preview.end)}</span>
                  </div>
                )}
                {ghost && (
                  <div className={`block ghost short${(ghost.end - ghost.start) * PPM < 26 ? ' tiny' : ''}`} style={{ top: (ghost.start - r0) * PPM + 1, height: Math.max(14, (ghost.end - ghost.start) * PPM - 2) }}>
                    <span className="bt">{clock(ghost.start)}–{clock(ghost.end)}</span>
                  </div>
                )}
                {isActive && col.blocks.length === 0 && !ghost && (
                  // the hint fills its first hour with the same air above and below
                  // (on a whole day it sits in the hour after the one the grid opens at, so it is seen and the now line stays clear)
                  <div className="col-empty" style={{ top: Math.min(height - 60 * PPM, Math.max(before, focusAt != null ? (Math.ceil(focusAt / 60) * 60 - r0) * PPM : 0)) + 12, height: 60 * PPM - 24 }}>
                    {ci === 0 ? T.dragHint : T.redrawFrom(clock(col.from ?? r0))}
                  </div>
                )}
                {isActive && sessions.map((s) => <ActualStrip key={s.id} session={s} r0={r0} r1={r1} />)}
                {nowTop != null && isActive && <div className="now-line" style={{ top: nowTop }} />}
              </div>
            </section>
          );
        })}
      </div>
      {nowTop != null && (
        <span className="now-tag" style={{ left: 2, right: 'auto', top: nowTop + 36 }} aria-hidden="true">{clock(now!)}</span>
      )}
    </div>
  );
}

/**
 * Revise from a time: the active column is closed there and a new one starts. What comes along:
 * - 'none': nothing, the rest of the day is drawn anew;
 * - 'cut': the unfinished blocks as they were, the running one from now on;
 * - 'shift': the unfinished blocks pushed later in order, each keeping its length (the running one starts again with its
 *   whole length), like dominoes: a block moves only as far as the one before it pushes it, and appointments stay where they
 *   are and are stepped around. Blocks that no longer fit before the end of the day come back as `leftover`.
 */
export type ReviseMode = 'none' | 'cut' | 'shift';
export function reviseColumns(cols: Column[], at: number, mode: ReviseMode | boolean, end = 24 * 60): Column[] {
  return revise(cols, at, mode === true ? 'cut' : mode === false ? 'none' : mode, end).cols;
}
export function revise(cols: Column[], at: number, mode: ReviseMode, end: number): { cols: Column[]; leftover: Block[]; moved: number } {
  const prev = cols[cols.length - 1];
  const open = prev.blocks.filter((b) => b.end > at).sort((a, z) => a.start - z.start);
  let carried: Block[] = [];
  const leftover: Block[] = [];
  let moved = 0;
  if (mode === 'cut') carried = open.map((b) => ({ ...b, id: uid(), start: Math.max(b.start, at) })).filter((b) => b.end - b.start >= SNAP);
  if (mode === 'shift') {
    const fixed = open.filter((b) => b.kind === 'meeting').map((b) => ({ ...b, id: uid(), start: Math.max(b.start, at) })).filter((b) => b.end - b.start >= SNAP);
    let cursor = at;
    for (const b of open.filter((x) => x.kind !== 'meeting')) {
      // the block the day broke in starts again from here with its whole length: the interruption took its time
      const len = b.end - b.start;
      let s = Math.max(cursor, b.start);
      for (const f of fixed) if (s < f.end && s + len > f.start) s = f.end;
      if (s + len > end) { leftover.push(b); continue; }
      if (s !== Math.max(b.start, at)) moved++;
      carried.push({ ...b, id: uid(), start: s, end: s + len });
      cursor = s + len;
    }
    carried = [...carried, ...fixed].sort((a, z) => a.start - z.start);
  }
  return { cols: [...cols.slice(0, -1), { ...prev, closedAt: at }, { from: at, closedAt: null, blocks: carried }], leftover, moved };
}

export function undoRevision(cols: Column[]): Column[] {
  if (cols.length < 2) return cols;
  const prev = cols[cols.length - 2];
  return [...cols.slice(0, -2), { ...prev, closedAt: null }];
}

export function kindSwatch(kind: Kind): React.CSSProperties {
  switch (kind) {
    case 'deep': return { background: 'var(--raised)', borderLeft: '3px solid var(--text)' };
    case 'shallow': return { background: 'var(--surface)', border: '1px solid var(--control)' };
    case 'meeting': return { background: 'var(--surface)', border: '1px solid var(--text)' };
    case 'overflow': return { background: 'var(--surface)', border: '1px dashed var(--line-strong)' };
    case 'personal': return { backgroundColor: 'var(--surface)', backgroundImage: 'var(--hatch)', border: '1px solid var(--border)' };
  }
}

export function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return minutesOf(now);
}

/** Where a focus session actually ran, from its start and end, as a strip the colour of the focus phase; hover or focus tells when and what. */
function ActualStrip({ session: s, r0, r1 }: { session: FocusSession; r0: number; r1: number }) {
  const T = useT();
  const a = new Date(s.start), z = Date.parse(s.end);
  const start = minutesOf(a) + a.getSeconds() / 60;
  const end = start + Math.max(0, (z - a.getTime()) / 60000);
  const from = Math.max(r0, start), to = Math.min(r1, end);
  if (!(to > from)) return null;
  const e = new Date(z);
  const range = `${clock(a.getHours() * 60 + a.getMinutes())}–${clock(e.getHours() * 60 + e.getMinutes())}`;
  const tip = T.actualTip(range, s.minutes, s.label || s.subject || T.freeFocus);
  return (
    <span className="actual" role="img" tabIndex={0} onClick={(e) => e.currentTarget.focus()} aria-label={tip} style={{ top: (from - r0) * PPM, height: Math.max(3, (to - from) * PPM) }}
      onPointerDown={(ev) => ev.stopPropagation()}>
      <span className="tip" aria-hidden="true">{tip}</span>
    </span>
  );
}

function CalendarEvent({ event: ev, top, height, planned, onEvent }: { event: CalEvent; top: number; height: number; planned: boolean; onEvent?: (e: CalEvent, edit?: boolean) => void }) {
  const T = useT();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); ref.current?.focus(); };
  return <div className="cal-event-wrap" style={{ position: 'absolute', top, height, left: 0, right: 0 }} onPointerDown={(e) => e.stopPropagation()}>
    <button ref={ref} type="button" className="cal-event" style={{ top: 0, height: '100%' }} aria-expanded={open}
      aria-label={T.calEventAria(ev.title, clock(ev.start), clock(ev.end))}
      onKeyDown={(e) => { if (e.key === 'Escape') close(); }} onClick={() => setOpen(!open)}>
      <span className="ct">{ev.title}{planned && <small> {'\u00b7'} {T.calPlanned}</small>}</span><span className="cw num">{clock(ev.start)}{'\u2013'}{clock(ev.end)}</span>
    </button>
    <Pop open={open} onClose={close} title={ev.title} beside>
      <p>{clock(ev.start)}{'\u2013'}{clock(ev.end)} {'\u00b7'} {settings.calendars?.find((c) => c.id === ev.cal)?.name ?? ev.cal}</p>
      {planned && <p role="status">{T.calAlreadyPlanned}</p>}
      <button type="button" className="btn" onClick={() => { close(); onEvent?.(ev); }}>{T.calMakeBlock}</button>
      <button type="button" className="btn" onClick={() => { close(); onEvent?.(ev, true); }}>{T.calMakeEdit}</button>
    </Pop>
  </div>;
}
