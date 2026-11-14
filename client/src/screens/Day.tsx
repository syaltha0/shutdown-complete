import { emptyInbox, type InboxDoc } from '../lib/model';
import { decideMoves } from '../lib/taskDeferral';
import { FocusLog } from '../components/FocusLog';
import { CalendarView } from '../components/CalendarView';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { Checklist } from '../components/Checklist';
import { DocNotice, SaveStamp } from '../components/Common';
import { IconCalendar, IconLeft, IconPrint, IconRevise, IconRight, IconTemplate } from '../components/Icons';
import { addDays, clock, duration, gridHours, longDate, nowMinutes, parseISODate, shortDate, today, weekNumber, weekOf } from '../lib/dates';
import { useT } from '../lib/i18n';
import { unionMinutes } from '../lib/intervals';
import {
  activeColumn, emptyDay, emptyWeek, KIND_IDS, MAX_COLUMNS, minutesOfKind, plannedByKind, uid,
  type Block, type DayDoc, type DayTemplate, type Item, type MetricDef, type WeekDoc,
  featureOn,
} from '../lib/model';
import { onLinkClick } from '../lib/router';
import { useSwipeNav } from '../lib/swipe';
import { updateKey, useDoc, useRange } from '../lib/useDoc';
import { isExcepted, placeRepeats, repeatFromBlock } from '../lib/repeat';
import { estimateFor, insights } from '../lib/insights';
import { focusCount, focusMinutes, settingsFocus, startFocus } from '../lib/focus';
import { CapacityNote } from '../components/CapacityNote';
import { BlockEditor, ReviseDialog } from './BlockDialogs';
import { kindSwatch, PPM, revise, TimeGrid, undoRevision, useNow } from './TimeGrid';
import { applyTemplate, templateFromBlocks, TemplatesDialog, weekdayIndex } from './Templates';
import { Segmented } from '../components/Segmented';
import { eventUid, useCalendar, type CalEvent } from '../lib/calendar';
import { DRIFT_SPAN, driftOf } from '../lib/drift';
import { offerUndo } from '../lib/undo';
import { SHORTCUT, type ShortcutAction } from '../components/Shortcuts';
import { TaskMeta } from '../components/TaskMeta';
import { FromLists, InboxPicker, toDay } from './Tasks';
import { CardChip, PartOf, whereOf } from '../components/Links';
import { choicesOf, syncCards } from '../lib/links';

export function Day({ date }: { date: string }) {
  const T = useT();
  const { settings, update: updateSettings } = useSettings();
  const { value: day, update, status, error, retry } = useDoc<DayDoc>(`day:${date}`, emptyDay);
  useEffect(() => {
    if (!day) return;
    const changed = day.columns.some(c => c.blocks.some(b => { const task = b.task && day.tasks.find(t => t.id === b.task!.id); return task && !b.taskLabelCustom && b.label === b.taskLabel && b.label !== task.text; }));
    if (changed) update(d => ({...d, columns: d.columns.map(c => ({...c, blocks: c.blocks.map(b => { const task = b.task && d.tasks.find(t => t.id === b.task!.id); return task && !b.taskLabelCustom && b.label === b.taskLabel ? {...b, label: task.text, taskLabel: task.text} : b; })}))}));
  }, [day, update]);
  const [tplOpen, setTplOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(null), 3500); return () => window.clearTimeout(t); }, [flash]);
  // a task being dragged onto the grid: where the pointer is, and the slot it would take
  const [drag, setDrag] = useState<{ item: Item; x: number; y: number; slot: { start: number; end: number } | null } | null>(null);
  const dragLen = useRef(30);
  const [pickInbox, setPickInbox] = useState(false);
  const isToday = date === today();
  const now = useNow(isToday);
  const [openId, setOpenId] = useState<string | null>(new URLSearchParams(location.search).get('block'));
  useEffect(() => { const on = () => setOpenId(new URLSearchParams(location.search).get('block')); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  const [revising, setRevising] = useState(false);
  const [shownCol, setShownCol] = useState(-1);
  const shortcut = useShortcut();
  const swipe = useSwipeNav(`/day/${addDays(date, -1)}`, `/day/${addDays(date, 1)}`);

  const t = today();
  const title = isToday ? T.todayTitle(longDate(date)) : longDate(date);
  const cal = useCalendar(date, date);
  // blocks made from a calendar event are compared with the event as the calendar has it now (today and later days only)
  const watching = !!day && date >= t && activeColumn(day).blocks.some((b) => b.source?.start != null);
  const watch = useCalendar(addDays(date, -DRIFT_SPAN), addDays(date, DRIFT_SPAN), watching);
  const weekId = weekOf(date);
  const { value: weekDoc } = useDoc<WeekDoc>(`week:${weekId}`, emptyWeek);
  // the week's items a task can serve
  const weekChoices = choicesOf(`week:${weekId}`, weekDoc?.items, whereOf(`week:${weekId}`, T));
  const [weekNudgeOff, setWeekNudgeOff] = useState(() => { try { return localStorage.getItem(`sc-weekplan-${weekId}`) === 'later'; } catch { return false; } });
  const weekNudge = isToday && weekDoc && !weekDoc.plannedAt && !weekNudgeOff && weekdayIndex(date) <= 1;
  // the weekly schedule: its blocks are placed on a day (today or later) the first time it opens
  useEffect(() => {
    if (day && placeRepeats(day, date, settings.schedule, settings.exceptions)) update((d) => placeRepeats(d, date, settings.schedule, settings.exceptions) ?? d);
  }, [day != null, date, settings.schedule, settings.exceptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const carry = useCarry(isToday ? date : null, settings.carryTasks ?? 'ask');
  const { docs: history } = useRange<DayDoc>(`day:${addDays(date, -56)}`, `day:${addDays(date, -1)}`);
  const calDay = cal?.days[date] ?? [];
  const timedEvents = calDay.filter((e) => !e.allDay);
  const allDayEvents = calDay.filter((e) => e.allDay);

  const head = (
    <div className="title-row">
      <div>
        <h1>{title}</h1>
        <p className="sub">{day ? <Finding day={day} isToday={isToday} now={now} past={date < t} /> : ' '}</p>
      </div>
      <div className="title-actions"><CalendarView view="day" date={date} />
        <SaveStamp status={status} />
        <div className="stepper">
          <a className="btn icon" href={`/day/${addDays(date, -1)}`} onClick={onLinkClick} aria-label={T.prevDay}><IconLeft /></a>
          <a className="btn" href={`/day/${t}`} onClick={onLinkClick} aria-disabled={isToday}>{T.todayBtn}</a>
          <a className="btn icon" href={`/day/${addDays(date, 1)}`} onClick={onLinkClick} aria-label={T.nextDay}><IconRight /></a>
        </div>
        <button type="button" className="btn icon hide-phone" onClick={() => window.print()} aria-label={T.printTitle} title={T.printTitle}><IconPrint /></button>
        {day && <PlanActions day={day} onAdd={() => addBlock()} onRevise={() => setRevising(true)} />}
      </div>
    </div>
  );

  if (!day) {
    return (
      <div className="swipe-area" ref={swipe}>
        {head}

        {status === 'error' ? <DocNotice status={status} error={error} retry={retry} /> : <DaySkeleton />}
      </div>
    );
  }

  const col = activeColumn(day);
  const blocks = day.columns.flatMap((c) => c.blocks);
  // the grid shows the hours chosen in Settings, or all 24; a block outside them widens it
  const [h0, h1] = gridHours(settings, isToday ? now : null);
  const r0 = Math.min(h0 * 60, ...blocks.map((b) => b.start));
  const r1 = Math.max(h1 * 60, ...blocks.map((b) => b.end));
  // a whole day is taller than the screen: it opens at now (today), the first block, or the usual start of the day
  const focusAt = settings.wholeDay ? (isToday ? now : blocks.length ? Math.min(...blocks.map((b) => b.start)) : settings.startHour * 60) : null;
  const floor = Math.max(r0, col.from ?? r0);
  const openBlock = col.blocks.find((b) => b.id === openId) ?? null;
  const linked = (settings.calendars ?? []).map((c) => c.id);
  const drifts = watch && date >= t ? col.blocks.flatMap((b) => driftOf(b, date, watch.days, watch.errors, linked) ?? []) : [];
  const driftKinds = new Map(drifts.map((d) => [d.block.id, d.kind] as const));
  const openDrift = openBlock ? drifts.find((d) => d.block.id === openBlock.id) ?? null : null;

  const setCols = (fn: (c: DayDoc['columns']) => DayDoc['columns']) => update((d) => ({ ...d, columns: fn(d.columns) }));
  const patchBlock = (id: string, patch: Partial<Block>) => {
    setCols((cols) => cols.map((c, i) => (i === cols.length - 1
      ? { ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)).sort((a, z) => a.start - z.start) }
      : c)));
    // a repeating block carries its changes to the weeks ahead
    const rid = col.blocks.find((b) => b.id === id)?.repeatId;
    if (rid) {
      const keep: (keyof Block)[] = ['label', 'note', 'kind', 'subject', 'start', 'end'];
      const p = Object.fromEntries(Object.entries(patch).filter(([k]) => keep.includes(k as keyof Block)));
      if (Object.keys(p).length) updateSettings((s) => ({ ...s, schedule: (s.schedule ?? []).map((r) => (r.id === rid ? { ...r, ...p } : r)) }));
    }
  };
  const repeatOf = openBlock?.repeatId ? (settings.schedule ?? []).find((r) => r.id === openBlock.repeatId) : undefined;
  function deleteBlock(gone: Block) {
    setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: c.blocks.filter((b) => b.id !== gone.id) } : c)));
    offerUndo(T.deleted(gone.label || T.untitledBlock), () =>
      setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: [...c.blocks, gone].sort((a, z) => a.start - z.start) } : c))));
  }
  // The calendar moved or dropped the event behind a block. Only the plan changes, and only its active column, never before
  // that column's start (as with every other edit); nothing is written to the calendar.
  function driftAct(act: 'update' | 'keep' | 'remove') {
    const d = openDrift, src = d?.block.source;
    if (!d || !src) return;
    const b = d.block;
    if (act === 'remove') { deleteBlock(b); setOpenId(null); return; }
    const n = d.now;
    if (act === 'keep') {
      // a changed time is accepted as it stands; an event that moved to another day or left lets go of the block
      patchBlock(b.id, { source: n && n.date === date ? { ...src, start: n.start, end: n.end } : undefined });
      return;
    }
    if (!n) return;
    if (n.date === date) {
      const s0 = Math.max(floor, n.start), e0 = Math.min(r1, n.end);
      const start = e0 - s0 >= 5 ? s0 : Math.min(s0, r1 - 15), end = e0 - s0 >= 5 ? e0 : Math.min(r1, start + 15);
      patchBlock(b.id, { start, end, source: { ...src, start: n.start, end: n.end } });
    } else {
      const carried: Block = { ...b, source: { ...src, date: n.date, start: n.start, end: n.end } };
      updateKey<DayDoc>(`day:${n.date}`, emptyDay, (dd) => {
        if (dd.columns.some((c) => c.blocks.some((x) => x.source?.calendar === src.calendar && x.source.uid === src.uid && x.source.date === n.date))) return dd;
        const last = dd.columns.length - 1, from = dd.columns[last].from ?? 0;
        const start = Math.min(Math.max(from, n.start), 24 * 60 + (settings.dayStart ?? 0) - 15), end = Math.min(24 * 60 + (settings.dayStart ?? 0), Math.max(n.end, start + 15));
        return { ...dd, columns: dd.columns.map((c, i) => (i === last ? { ...c, blocks: [...c.blocks, { ...carried, start, end }].sort((a, z) => a.start - z.start) } : c)) };
      });
      setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: c.blocks.filter((x) => x.id !== b.id) } : c)));
      setOpenId(null);
    }
    setFlash(T.calDrift.updated);
  }
  function setRepeat(days: number[]) {
    if (!openBlock) return;
    if (!days.length) {
      // only this day from now on: the schedule entry goes, the block stays
      updateSettings((s) => ({ ...s, schedule: (s.schedule ?? []).filter((r) => r.id !== openBlock.repeatId) }));
      patchBlock(openBlock.id, { repeatId: undefined });
    } else if (repeatOf) {
      updateSettings((s) => ({ ...s, schedule: (s.schedule ?? []).map((r) => (r.id === repeatOf.id ? { ...r, days } : r)) }));
    } else {
      const r = repeatFromBlock(openBlock, days, date);
      updateSettings((s) => ({ ...s, schedule: [...(s.schedule ?? []), r] }));
      update((d) => ({ ...d, repeats: [...(d.repeats ?? []), r.id] }));
      patchBlock(openBlock.id, { repeatId: r.id });
    }
  }
  // a new subject is remembered for the next block once the dialog closes
  function closeEditor() {
    const subj = openBlock?.subject?.trim();
    if (subj && !(settings.subjects ?? []).includes(subj)) updateSettings((s) => ({ ...s, subjects: [...(s.subjects ?? []), subj].slice(-40) }));
    setOpenId(null);
  }

  function addBlock() {
    // the first free half hour from now (today) or from the start of the column
    const from = Math.max(floor, isToday ? Math.ceil(nowMinutes() / 15) * 15 : floor);
    let s = from;
    for (const b of [...col.blocks].sort((a, z) => a.start - z.start)) if (b.start < s + 30 && b.end > s) s = b.end;
    if (s + 30 > r1) s = Math.max(floor, r1 - 30);
    const b: Block = { id: uid(), start: s, end: Math.min(r1, s + 60), label: '', note: '', kind: 'deep' };
    setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: [...c.blocks, b] } : c)));
    setOpenId(b.id);
  }

  // the keyboard's N (a new block) and R (revise from now), passed on by the shell
  shortcut.current = (a) => {
    if (a === 'new-block') addBlock();
    if (a === 'revise' && (col.blocks.length > 0 || day.columns.length > 1) && day.columns.length < MAX_COLUMNS) setRevising(true);
  };

  const reviseDefault = Math.min(r1 - 15, Math.max(floor + 15, isToday ? Math.floor(now / 15) * 15 : floor + 60));
  const totals = plannedByKind(col);
  const span = r1 - floor;
  const planned = col.blocks.reduce((s, b) => s + b.end - b.start, 0);
  const nowBlock = isToday ? col.blocks.find((b) => now >= b.start && now < b.end && b.kind !== 'personal') ?? null : null;
  const kindsOnScreen = KIND_IDS.filter((k) => blocks.some((b) => b.kind === k));
  // what was really done shows next to the plan on a day that has begun, never on one still to come
  const actual = date <= t ? day.focus?.sessions ?? [] : [];
  const templates = settings.templates ?? [];
  const weekday = weekdayIndex(date);
  const suggested = col.blocks.length === 0 ? templates.find((t) => t.days.includes(weekday) && !isExcepted(settings.exceptions, date, t.id)) : undefined;

  // a calendar event becomes a meeting block, kept inside the column's hours
  const asBlock = (e: CalEvent): Block | null => {
    const start = Math.max(floor, e.start), end = Math.min(r1, e.end);
    return end - start >= 5 ? { id: uid(), start, end, label: e.title, note: [e.location, e.description].filter(Boolean).join('\n').slice(0, 1000), kind: 'shallow', source: { calendar: e.cal, uid: eventUid(e), date, start: e.start, end: e.end } } : null;
  };
  const overlaps = (s: number, e: number) => col.blocks.some((b) => b.start < e && b.end > s);
  const isPlanned = (e: CalEvent) => blocks.some((b) => b.source?.calendar === e.cal && b.source.uid === eventUid(e) && b.source.date === date);
  const uncovered = timedEvents.filter((e) => e.end > floor && !isPlanned(e));
  function blockOutEvent(e: CalEvent, edit = false) {
    if (isPlanned(e)) { setFlash(T.calAlreadyPlanned); return; }
    const b = asBlock(e);
    if (!b) return;
    setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: [...c.blocks, b].sort((a, z) => a.start - z.start) } : c)));
    if (edit) setOpenId(b.id);
  }
  function blockOutAll() {
    const add: Block[] = [];
    for (const e of uncovered) { const b = asBlock(e); if (b && !overlaps(b.start, b.end) && !add.some((x) => x.start < b.end && x.end > b.start)) add.push(b); }
    setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: [...c.blocks, ...add].sort((a, z) => a.start - z.start) } : c)));
    setFlash(T.calBatchResult(add.length, uncovered.length - add.length));
  }

  function applyTpl(t: DayTemplate) {
    if (isExcepted(settings.exceptions, date, t.id)) return;
    const res = applyTemplate(col, t, floor);
    setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: res.blocks } : c)));
    setTplOpen(false);
    setFlash(T.tplApplied(res.added));
  }

  // where on the active column a pointer is, as a quarter-hour slot of half an hour
  function slotAt(x: number, y: number) {
    const body = document.querySelector('.col.active .col-body');
    if (!body) return null;
    const r = body.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const m = Math.floor((r0 + (y - r.top) / PPM) / 15) * 15;
    const len = Math.max(15, Math.min(240, dragLen.current));
    const start = Math.min(r1 - len, Math.max(floor, m));
    return { start, end: start + len };
  }

  // a task dragged onto the hours; one from the lists (`from`) also joins the day's tasks (a repeating one rolls on)
  function grabTask(item: Item, e: React.PointerEvent, from?: Item) {
    dragLen.current = item.estimate ?? 30;
    setDrag({ item, x: e.clientX, y: e.clientY, slot: null });
    const move = (ev: PointerEvent) => setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, slot: slotAt(ev.clientX, ev.clientY) } : d));
    const up = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const slot = slotAt(ev.clientX, ev.clientY);
      setDrag(null);
      if (!slot) return;
      const taskId = from ? (await toDay([from], date))[0] : item.id;
      const b: Block = { id: uid(), start: slot.start, end: slot.end, label: item.text, taskLabel: item.text, task: { id: taskId, list: 'day', day: date }, note: '', kind: 'shallow' };
      setCols((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, blocks: [...c.blocks, b].sort((a, z) => a.start - z.start) } : c)));
      setOpenId(b.id);

    };
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  return (
    <div className="swipe-area" ref={swipe}>
      <PrintHeader date={date} />
      {head}
      {(settings.exceptions ?? []).filter(e => e.from <= date && date <= e.to).map(e => <p className="muted" role="note" key={e.id}>{T.scheduleExceptions.noClasses}: {e.label}</p>)}
      <DocNotice status={status} error={error} retry={retry} />
      {weekNudge && (
        <div className="week-nudge" role="note">
          <span>{T.weekPlan.nudge}</span>
          <a className="btn primary" href={`/plan/${weekId}`} onClick={onLinkClick}>{T.weekPlan.start}</a>
          <button type="button" className="btn ghost" onClick={() => { try { localStorage.setItem(`sc-weekplan-${weekId}`, 'later'); } catch { /* private mode */ } setWeekNudgeOff(true); }}>{T.weekPlan.later}</button>
        </div>
      )}
      {carry.offer && (
        <div className="week-nudge" role="note">
          <span>{T.carryOffer(carry.offer.count, carry.offer.from === addDays(date, -1) ? T.yesterday : T.fromDay(shortDate(carry.offer.from)))}</span>
          <button type="button" className="btn primary" onClick={carry.bring}>{T.carryBring}</button>
          <button type="button" className="btn ghost" onClick={carry.dismiss}>{T.carryLeave}</button>
        </div>
      )}
      {drifts.length > 1 && (
        <div className="week-nudge" role="note">
          <span>{T.calDrift.summary(drifts.length)}</span>
          <button type="button" className="btn" onClick={() => setOpenId(drifts[0].block.id)}>{T.calDrift.review}</button>
        </div>
      )}
      <div className="spread">
        <div className="page-left">
          <MetricsBox day={day} date={date} defs={settings.metrics} update={update} />
          <section className="panel capture" data-tour="capture" data-anim>
            <section aria-labelledby="tasks-h">
              <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 id="tasks-h">{T.tasks}</h2>
                <span className="meta num">{day.tasks.length ? T.tasksDone(day.tasks.filter((x) => x.done).length, day.tasks.length) : ''}</span>
              </header>
              <Overload day={day} r0={settings.startHour * 60} r1={settings.endHour * 60} floor={floor} now={isToday ? now : null} past={date < t} />
              <Checklist label={T.tasks} items={day.tasks} placeholder={T.captureTask} onChange={(tasks) => { syncCards(day.tasks, tasks); update((d) => ({ ...d, tasks })); }} onGrab={grabTask}
                steps
                line={(it, change) => (it.due || it.estimate || it.card || it.up) && <>
                  {(it.due || it.estimate) && <TaskMeta item={it} onChange={change} />}
                  <PartOf up={it.up} choices={weekChoices} onChange={(up) => change({ up })} level={T.levels.week} place="line" />
                  {it.card && <CardChip link={it.card} />}
                </>}
                tools={(it, change) => <>
                  {!it.due && !it.estimate && <TaskMeta item={it} onChange={change} />}
                  <PartOf up={it.up} choices={weekChoices} onChange={(up) => change({ up })} level={T.levels.week} place="tool" />
                </>}
                age={(it) => (it.since && it.since < date ? T.waitingDays(daysBetween(it.since, date)) : null)}
              />
              {featureOn(settings, 'inbox') && date >= t && <FromLists date={date} onGrab={(item, from, e) => grabTask(item, e, from)} />}
              {featureOn(settings, 'inbox') && <button type="button" className="card-link quiet inbox-pull" onClick={() => setPickInbox(true)}>{T.fromInbox}</button>}
              <InboxPicker open={pickInbox} onClose={() => setPickInbox(false)}
                onTake={(items) => update((d) => ({ ...d, tasks: [...d.tasks, ...items] }))} />
            </section>
            <section aria-labelledby="notes-h">
              <h2 id="notes-h">{T.notes}</h2>
              <textarea className="notes-area" aria-labelledby="notes-h" value={day.notes}
                placeholder={T.notesPh}
                onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))} />
            </section>
          </section>
        </div>

        <section className="panel plan page-right" aria-labelledby="plan-h" data-tour="grid" data-anim>
          <div className="plan-head">
            <h2 id="plan-h">{T.timeBlocks}</h2>
            <p className="meta plan-actual-help">{T.planActualHelp}</p>
            <div className="plan-totals num" aria-label={T.plannedInColumn}>
              <span>{T.deep} <b>{duration(totals.deep)}</b></span>
              <span>{T.shallow} <b>{duration(totals.shallow + totals.meeting)}</b></span>
              <span>{T.open} <b>{duration(Math.max(0, span - planned))}</b></span>
            </div>
            {(kindsOnScreen.length > 0 || actual.length > 0) && (
              <div className="legend" aria-label={T.kindsOfBlock}>
                {kindsOnScreen.map((k) => <span key={k}><i style={kindSwatch(k)} />{T.kinds[k].name}</span>)}
                {actual.length > 0 && <span><i className="lg-actual" />{T.actualLegend}</span>}
              </div>
            )}
            {day.columns.length > 1 && (
              <div className="phone-only">
                <Segmented className="sm" role="group" aria-label={T.column}>
                  {day.columns.map((_, i) => (
                    <button key={i} type="button" aria-pressed={i === day.columns.length - 1 ? shownCol < 0 || shownCol === i : shownCol === i}
                      onClick={() => setShownCol(i === day.columns.length - 1 ? -1 : i)}>
                      {i === 0 ? T.plan : T.revShort(i)}
                    </button>
                  ))}
                </Segmented>
              </div>
            )}
            {isToday && (day.focus?.active
              ? <a className="card-link" href="/focus" onClick={onLinkClick}>{T.openFocus}</a>
              : nowBlock && <button type="button" className="btn focus-start" onClick={() => startFocus({ blockId: nowBlock.id, label: nowBlock.label || T.untitledBlock, minutes: settingsFocus(settings).focusMin })}>
                  <span className="dot" aria-hidden="true" />{T.focusOn(nowBlock.label || T.untitledBlock)}
                </button>)}
            {suggested && <button type="button" className="btn" onClick={() => applyTpl(suggested)}><IconTemplate />{T.tplApplyNamed(suggested.name)}</button>}
            {uncovered.length > 0 && date >= t && <button type="button" className="btn" onClick={blockOutAll}><IconCalendar />{T.calBlockOut(uncovered.length)}</button>}
            <button type="button" className="btn ghost tpl-btn" onClick={() => setTplOpen(true)}><IconTemplate />{T.tplButton}</button>
            {day.columns.length > 1 && (
              <button type="button" className="card-link hide-phone" style={{ fontWeight: 400 }}
                onClick={() => setCols(undoRevision)}>{T.undoRevision}</button>
            )}
            {flash && <span className="stamp flash" role="status" key={flash}>{flash}</span>}
          </div>
          {date >= t && <CapacityNote scope="day" id={date} from={date} planned={minutesOfKind(day, 'deep')} thisOne={isToday} />}
          {allDayEvents.length > 0 && (
            <div className="all-day" aria-label={T.allDay}>
              <span className="lbl">{T.allDay}</span>
              {allDayEvents.map((e, k) => <span key={k} className="chip">{e.title}</span>)}
            </div>
          )}
          <TimeGrid day={day} range={[r0, r1]} now={isToday ? now : null} onColumns={setCols} onOpen={setOpenId} shownCol={shownCol}
            focusAt={focusAt} focusKey={date} sessions={actual} drifts={driftKinds}
            preview={drag?.slot ? { ...drag.slot, label: drag.item.text } : null} events={timedEvents} onEvent={blockOutEvent} />
        </section>
      </div>

      <BlockEditor
        date={date} day={day} sessions={day.focus?.sessions} block={openBlock} min={floor} max={r1}
        subjects={settings.subjects} repeatDays={repeatOf?.days ?? []} onRepeat={date >= t ? setRepeat : undefined}
        repeatEvery={repeatOf?.every ?? 1}
        onRepeatEvery={repeatOf ? (n) => updateSettings((s) => ({ ...s, schedule: (s.schedule ?? []).map((r) => (r.id === repeatOf.id ? { ...r, every: n, since: date } : r)) })) : undefined}
        estimate={openBlock && history ? estimateFor(insights(history.values()), openBlock) : null}
        onChange={(p) => openBlock && patchBlock(openBlock.id, p)}
        drift={openDrift} onDrift={driftAct}
        onDelete={() => {
          if (openBlock) deleteBlock(openBlock);
          setOpenId(null);
        }}
        onClose={closeEditor}
      />
      <TemplatesDialog
        open={tplOpen} templates={templates} canSave={col.blocks.length > 0} weekday={weekday}
        onApply={applyTpl} onClose={() => setTplOpen(false)}
        onSave={(name, days) => {
          updateSettings((s) => ({ ...s, templates: [...(s.templates ?? []), templateFromBlocks(name, days, col.blocks)] }));
          setTplOpen(false);
        }}
      />
      {drag && <div className="drag-chip" style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 10}px)` }} aria-hidden="true">{drag.item.text}</div>}
      <ReviseDialog
        open={revising} defaultAt={reviseDefault} min={floor + 15} max={r1}
        remaining={MAX_COLUMNS - day.columns.length - 1}
        onClose={() => setRevising(false)}
        preview={(at) => { const r = revise(day.columns, at, 'shift', r1); return { moved: r.moved, leftover: r.leftover.length }; }}
        onConfirm={(at, mode) => {
          // what no longer fits in the day comes back as tasks, with the time it needed, so nothing is lost
          update((d) => {
            const r = revise(d.columns, at, mode, r1);
            const back = r.leftover.map((b) => ({ id: uid(), text: b.label || T.untitledBlock, done: false, estimate: b.end - b.start }));
            return { ...d, columns: r.cols, tasks: [...d.tasks, ...back] };
          });
          setRevising(false); setShownCol(-1);
        }}
      />
    </div>
  );
}

function PlanActions({ day, onAdd, onRevise }: { day: DayDoc; onAdd: () => void; onRevise: () => void }) {
  const T = useT();
  const hasBlocks = activeColumn(day).blocks.length > 0 || day.columns.length > 1;
  const full = day.columns.length >= MAX_COLUMNS;
  if (!hasBlocks) return <button type="button" className="btn primary" onClick={onAdd}>{T.addBlock}</button>;
  return (
    <>
      <button type="button" className="btn" onClick={onAdd}>{T.addBlock}</button>
      <button type="button" className="btn primary" onClick={onRevise} disabled={full} data-tour="revise"
        title={full ? T.allColumnsUsed : undefined}>
        <IconRevise />{full ? T.noColumnsLeft : T.reviseFromNow}
      </button>
    </>
  );
}

/** The line under the title: the one thing to know about this day. */
function Finding({ day, isToday, now, past }: { day: DayDoc; isToday: boolean; now: number; past: boolean }) {
  const T = useT();
  const col = activeColumn(day);
  const rev = day.columns.length > 1 ? T.revisionSuffix(day.columns.length - 1) : '';
  const deep = minutesOfKind(day, 'deep');
  const open = day.tasks.filter((t) => !t.done).length;
  const at = day.shutdown.at ? new Date(day.shutdown.at) : null;
  const atClock = at ? clock(at.getHours() * 60 + at.getMinutes()) : null;
  if (isToday) {
    const cur = col.blocks.find((b) => now >= b.start && now < b.end);
    if (cur) {
      return <><span className="now">{T.nowLabel(cur.label || T.untitledBlock)}</span>{T.untilLeft(clock(cur.end), duration(cur.end - now))}{rev}</>;
    }
    const next = col.blocks.find((b) => b.start > now);
    if (next) return <>{T.unplannedUntil(clock(next.start))}<strong>{next.label || T.untitledBlock}</strong>{rev}</>;
    if (col.blocks.length === 0) return <>{T.noBlocksYet}</>;
    return day.shutdown.done
      ? <>{T.shutdownCompleteAt(atClock ?? '—')}</>
      : <>{T.planEnded}<a className="card-link" href={`/shutdown/${today()}`} onClick={onLinkClick}>{T.runShutdown}</a></>;
  }
  if (past) {
    return <>{T.pastSummary(duration(deep), open)}{day.shutdown.done ? T.shutdownAtLower(atClock) : T.noShutdownRecorded}</>;
  }
  const n = col.blocks.length;
  return <>{n ? T.futureSummary(n, duration(deep)) : T.nothingBlocked}</>;
}

function MetricsBox({ day, date, defs, update }: { day: DayDoc; date: string; defs: MetricDef[]; update: (fn: (d: DayDoc) => DayDoc) => void }) {
  const T = useT();
  const deepPlanned = minutesOfKind(day, 'deep');
  const setMetric = (id: string, v: number | boolean | null) => update((d) => ({ ...d, metrics: { ...d.metrics, [id]: v } }));
  const at = day.shutdown.at ? new Date(day.shutdown.at) : null;
  return (
    <section className="panel metrics-box" aria-labelledby="metrics-h" data-tour="metrics" data-anim>
      <header>
        <h2 id="metrics-h">{T.dailyMetrics}</h2>
        <a className="card-link" style={{ fontWeight: 400 }} href={`/week/${weekOf(date)}`} onClick={onLinkClick}>{T.weekN(weekNumber(weekOf(date)))}</a>
      </header>
      <div className="metric-rows">
        {defs.length === 0 && <div className="empty">{T.noMetricsYet} <a className="card-link" href="/settings" onClick={onLinkClick}>{T.nav.settings}</a></div>}
        {defs.map((m) => {
          const v = day.metrics[m.id];
          const hint = m.kind === 'number'
            ? [m.target != null ? T.target(`${m.target} ${m.unit}`.trim()) : '', m.id === 'deep' ? T.plannedDeep(duration(deepPlanned)) : ''].filter(Boolean).join(' · ')
            : '';
          return (
            <div className="metric-row" key={m.id}>
              <label className="name" htmlFor={`m-${m.id}`}>{m.name}{hint && <small>{hint}</small>}</label>
              {m.kind === 'check' ? (
                <input id={`m-${m.id}`} type="checkbox" className="check lg" checked={v === true} onChange={(e) => setMetric(m.id, e.target.checked)} />
              ) : (
                <span className="metric-input">
                  <input id={`m-${m.id}`} type="number" inputMode="decimal" min={0} step="any" placeholder="—"
                    value={typeof v === 'number' ? v : ''}
                    onChange={(e) => setMetric(m.id, e.target.value === '' ? null : Number(e.target.value))} />
                  <span className="unit">{m.unit}</span>
                </span>
              )}
            </div>
          );
        })}
        {(day.focus?.sessions.length ?? 0) > 0 && (
          <div className="metric-row">
            <span className="name">{T.focusMetric}</span>
            <a className="card-link num" style={{ fontWeight: 400 }} href="/focus" onClick={onLinkClick}>{T.focusRow(focusCount(day), duration(focusMinutes(day)))}</a>
          </div>
        )}
      </div>
      <FocusLog sessions={day.focus?.sessions} />
      <div className="shutdown-line">
        <a className="card-link" style={{ fontWeight: 400 }} href={`/shutdown/${date}`} onClick={onLinkClick}>{T.shutdownRitual}</a>
        <span className="spacer" />
        {day.shutdown.done && at && <span className="when num">{clock(at.getHours() * 60 + at.getMinutes())}</span>}
        <label>
          {T.shutdownComplete}
          <input type="checkbox" className="check lg" checked={day.shutdown.done}
            onChange={(e) => update((d) => ({ ...d, shutdown: { ...d.shutdown, done: e.target.checked, at: e.target.checked ? new Date().toISOString() : null } }))} />
        </label>
      </div>
    </section>
  );
}

function DaySkeleton() {
  return (
    <div className="spread" aria-busy="true">
      <div className="page-left">
        <div className="panel" style={{ height: 196 }}><div className="skeleton" style={{ width: 120, height: 20 }} /></div>
        <div className="panel" style={{ height: 360 }}><div className="skeleton" style={{ width: 80, height: 20 }} /></div>
      </div>
      <div className="panel page-right" style={{ height: 620 }}><div className="skeleton" style={{ width: 110, height: 20 }} /></div>
    </div>
  );
}


/** Only on paper: the date and the product's name, like the planner's page header. */
function PrintHeader({ date }: { date: string }) {
  const T = useT();
  return <div className="print-only print-head"><b>{longDate(date)}</b><span>{T.weekN(weekNumber(weekOf(date)))} · Shutdown Complete</span></div>;
}

/** A handler (set on each render) for the shortcuts the shell passes on to this screen. */
function useShortcut() {
  const ref = useRef<(a: ShortcutAction) => void>(() => {});
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<ShortcutAction>).detail);
    window.addEventListener(SHORTCUT, on);
    return () => window.removeEventListener(SHORTCUT, on);
  }, []);
  return ref;
}

const daysBetween = (a: string, b: string) => Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86400000);

/**
 * Open tasks left on the last seven days, for today: offered in a note ("3 open tasks from yesterday: bring them"),
 * or moved by themselves when Settings says so. Moving takes them off the earlier day and keeps the day they were
 * first written down, so the list shows how long each has waited.
 */
function useCarry(date: string | null, mode: 'ask' | 'auto') {
  const T = useT();
  const from = date ? addDays(date, -7) : '0000-00-00', to = date ? addDays(date, -1) : '0000-00-00';
  const { docs } = useRange<DayDoc>(`day:${from}`, `day:${to}`);
  const [gone, setGone] = useState(() => { try { return date != null && localStorage.getItem(`sc-carry-${date}`) === 'left'; } catch { return false; } });
  const left: { day: string; tasks: Item[] }[] = [];
  if (date && docs) {
    for (const [k, d] of docs) {
      const open = d.tasks.filter((x) => !x.done && x.text.trim());
      if (open.length) left.push({ day: k.slice(4), tasks: open });
    }
  }
  left.sort((a, b) => (a.day < b.day ? 1 : -1));
  const count = left.reduce((n, x) => n + x.tasks.length, 0);
  const bring = async () => {
    if (!date || !count) return;
    const moving = [...left].reverse().flatMap((x) => x.tasks.map((it) => ({ ...it, since: it.since ?? x.day })));
    const decisions = await decideMoves(moving, T); if (!decisions) return;
    if(decisions.back.length || decisions.deleted.length) await updateKey<InboxDoc>('inbox',emptyInbox,b=>({...b,items:[...b.items,...decisions.back],trash:[...(b.trash??[]),...decisions.deleted.map(item=>({item,deletedAt:new Date().toISOString()}))]}));
    for (const x of left) updateKey<DayDoc>(`day:${x.day}`, emptyDay, (d) => ({ ...d, tasks: d.tasks.filter((it) => it.done || !it.text.trim()) }));
    updateKey<DayDoc>(`day:${date}`, emptyDay, (d) => ({ ...d, tasks: [...decisions.moving, ...d.tasks] }));
  };
  const auto = mode === 'auto' && count > 0;
  useEffect(() => { if (auto) bring(); }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = () => { try { if (date) localStorage.setItem(`sc-carry-${date}`, 'left'); } catch { /* private mode */ } setGone(true); };
  return { offer: date && count && mode === 'ask' && !gone ? { count, from: left[0].day } : null, bring, dismiss };
}

/**
 * Whether the day's open tasks fit in its free time (Sunsama's workload check): the estimates of tasks not yet on the
 * grid against the time no block takes, from now on for today. Quiet when they fit; a plain warning when they do not.
 */
function Overload({ day, r0, r1, floor, now, past }: { day: DayDoc; r0: number; r1: number; floor: number; now: number | null; past: boolean }) {
  const T = useT();
  if (past) return null;
  const col = activeColumn(day);
  const onGrid = new Set(col.blocks.map((b) => b.label.trim().toLocaleLowerCase()));
  const open = day.tasks.filter((x) => !x.done && x.estimate && !onGrid.has(x.text.trim().toLocaleLowerCase()));
  const need = open.reduce((n, x) => n + (x.estimate ?? 0), 0);
  if (!need) return null;
  const from = Math.max(r0, floor, now ?? 0);
  const busy = unionMinutes(col.blocks, from, r1); // blocks that overlap take the same minutes once
  const free = Math.max(0, r1 - from - busy);
  const over = need - free;
  return (
    <p className={`overload${over > 0 ? ' over' : ''}`} role={over > 0 ? 'status' : undefined}>
      {over > 0 ? T.overloaded(duration(need), duration(free), duration(over)) : T.fits(duration(need), duration(free))} �E {T.workBudget(clock(r0), clock(r1))}
    </p>
  );
}
