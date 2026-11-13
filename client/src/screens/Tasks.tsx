import { useEffect, useMemo, useRef, useState } from 'react';
import { Checklist } from '../components/Checklist';
import { DocNotice, SaveStamp } from '../components/Common';
import { IconBell, IconGrip, IconMore, IconPlus, IconNotes, IconRepeat, IconSearch, IconTag, IconX } from '../components/Icons';
import { Pop } from '../components/Pop';
import { Segmented } from '../components/Segmented';
import { ESTIMATES, dueWords } from '../components/TaskMeta';
import { addDays, duration, longDate, shortDate, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import { emptyDay, emptyInbox, uid, type DayDoc, type InboxDoc, type Item, type LabelColor, type Recur, type TaskList } from '../lib/model';
import { navigate, onLinkClick } from '../lib/router';
import { useSettings } from '../App';
import { settingsFocus, startFocus } from '../lib/focus';
import {
  COLLECTIONS, DEFAULT_LIST, PRESETS, SORTS, TAG, daysTo, inView, listOf, listsOf, onRuleDay, presetOf, recurWords, rollOn, sortTasks, type Sort,
} from '../lib/tasks';
import { insertAt, offerUndo } from '../lib/undo';
import { DayChips } from './Templates';
import { refreshKey, updateKey, useDoc } from '../lib/useDoc';
import { parseTaskDraft } from '../lib/taskQuickAdd';
import { taskMatches } from '../lib/taskSearch';

const TINTS: LabelColor[] = ['blue', 'green', 'amber', 'red', 'grey'];
/** reminders, in minutes before the due time */
const REMINDS = [0, 5, 15, 30, 60, 120, 1440];
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };

/** What a day's task list gets of a task: the task without what only the lists need. */
const forDay = (t: Item): Item => ({ id: uid(), text: t.text, done: false, due: t.due, dueTime: t.dueTime, remind: t.remind, estimate: t.estimate, steps: t.steps?.map((s) => ({ ...s, done: false })), card: t.card });

/**
 * Tasks put on a day: a one-off task moves there (it leaves the lists); a repeating one is copied and comes back on
 * its next date.
 */
export async function toDay(items: Item[], date: string) {
  const copies = items.map(forDay);
  await updateKey<DayDoc>(`day:${date}`, emptyDay, (d) => ({ ...d, tasks: [...d.tasks, ...copies] }));
  await updateKey<InboxDoc>('inbox', emptyInbox, (b) => takeOut(b, items.map((x) => x.id)));
  return copies.map((c) => c.id);
}
/** One task put on a day, with an undo that takes it back off and returns the task as it was. */
async function planOn(t: Item, date: string, message: string) {
  const ids = await toDay([t], date);
  offerUndo(message, () => {
    updateKey<DayDoc>(`day:${date}`, emptyDay, (d) => ({ ...d, tasks: d.tasks.filter((x) => !ids.includes(x.id)) }));
    updateKey<InboxDoc>('inbox', emptyInbox, (b) => ({ ...b, items: b.items.some((x) => x.id === t.id) ? b.items.map((x) => (x.id === t.id ? t : x)) : [...b.items, t] }));
  });
}
const takeOut = (b: InboxDoc, ids: string[]): InboxDoc => ({
  ...b,
  items: b.items.flatMap((x) => (!ids.includes(x.id) ? [x] : x.repeat ? [{ ...x, ...rollOn(x) }] : [])),
});

/**
 * The task lists, after the tasks apps of calendar servers: lists of one's own (the first, "Inbox", always there) and
 * collections gathered from all of them (today, the next 7 days, important, in progress, completed). A task holds a
 * start and a due date, a priority (the star is "high"), how far along it is, tags, notes, subtasks, an estimate and a
 * rule to come back by (every day, every 2 days, on chosen weekdays, every month...). Click a task for its details.
 */
export function Tasks({ view: asked }: { view?: string }) {
  const T = useT();
  const { value: doc, update, status, error, retry } = useDoc<InboxDoc>('inbox', emptyInbox);
  const items = doc?.items ?? [];
  const lists = listsOf(doc ?? emptyInbox(), T);
  const allTags = useMemo(() => [...new Set(items.flatMap((t) => t.tags ?? []))].sort((a, b) => a.localeCompare(b)), [items]);
  // the address names a collection, a list, or a tag (tag:<name>)
  const wanted = asked ? decodeURIComponent(asked) : '';
  const tagView = wanted.startsWith(TAG) ? wanted.slice(TAG.length) : null;
  const view = (COLLECTIONS as readonly string[]).includes(wanted) || lists.some((l) => l.id === wanted) || (tagView && allTags.includes(tagView)) ? wanted : 'all';
  const isList = !(COLLECTIONS as readonly string[]).includes(view) && !view.startsWith(TAG);
  const viewName = isList ? lists.find((l) => l.id === view)!.name : view.startsWith(TAG) ? `#${view.slice(TAG.length)}` : T.tkViews[view as keyof typeof T.tkViews];
  const [sort, setSort] = useState<Sort>(() => (SORTS as string[]).includes(store.get('sc-tasks-sort') ?? '') ? store.get('sc-tasks-sort') as Sort : 'due');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState('');
  const [smartAdd, setSmartAdd] = useState(true);
  const parsedDraft = smartAdd ? parseTaskDraft(draft, lists, today()) : { text: draft.trim() };
  const addInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (new URLSearchParams(location.search).has('add')) addInput.current?.focus(); }, [!!doc]);
  useEffect(() => { setOpenId(null); setShowDone(false); }, [view]);
  // single keys on this screen: N writes a task, / searches, X starts or ends picking several (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || (el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))) return;
      if (document.querySelector('dialog[open], .more-sheet, .tour, .kb-pop')) return;
      if (e.key === 'n' && addInput.current) { e.preventDefault(); addInput.current.focus(); }
      else if (e.key === '/') { e.preventDefault(); searchInput.current?.focus(); }
      else if (e.key === 'x') { e.preventDefault(); setOpenId(null); setSel((s) => (s ? null : new Set())); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // changes from a phone's task app or a Nextcloud arrive on the server: looked for now and then, and on coming back
  useEffect(() => {
    const look = () => { if (document.visibilityState === 'visible') refreshKey('inbox'); };
    const t = window.setInterval(look, 20_000);
    window.addEventListener('focus', look);
    return () => { window.clearInterval(t); window.removeEventListener('focus', look); };
  }, []);

  const set = (id: string, p: Partial<Item>) => update((b) => ({ ...b, items: b.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const matches = (t: Item) => taskMatches(t, q);
  const shown = sortTasks(items.filter((t) => inView(t, view) && matches(t)), sort);
  // in a list, its done tasks fold away under the open ones
  const doneHere = isList ? sortTasks(items.filter((t) => t.done && listOf(t) === view && matches(t)), sort) : [];
  const count = (v: string) => items.filter((t) => inView(t, v)).length;
  const open = items.find((t) => t.id === openId) ?? null;

  /** Ticked: a repeating task comes back on its next date, any other is done (both can be undone). */
  const tick = (t: Item) => {
    if (t.done) {
      set(t.id, { done: false, doneAt: undefined });
      offerUndo(T.tkReopenedN(1), () => set(t.id, { done: t.done, doneAt: t.doneAt }));
      return;
    }
    if (t.repeat) {
      const p = rollOn(t);
      set(t.id, p);
      // the last time of a rule that ends: done for good
      offerUndo(p.done ? T.tkSeriesDone(t.text) : T.tkNext(t.text, shortDate(p.due ?? p.start!)),
        () => set(t.id, { repeat: t.repeat, due: t.due, start: t.start, percent: t.percent, steps: t.steps, doneCount: t.doneCount, lastDone: t.lastDone, done: false, doneAt: undefined }));
      return;
    }
    set(t.id, { done: true, doneAt: today() });
    offerUndo(T.doneLabel(t.text), () => set(t.id, { done: false, doneAt: undefined }));
  };
  const remove = (t: Item) => {
    const at = items.findIndex((x) => x.id === t.id);
    update((b) => ({ ...b, items: b.items.filter((x) => x.id !== t.id) }));
    if (openId === t.id) setOpenId(null);
    offerUndo(T.deleted(t.text), () => update((b) => ({ ...b, items: insertAt(b.items, at, t) })));
  };
  // a task written in a collection gets what the collection is about
  const add = (text: string) => {
    const t: Item = { id: uid(), text, done: false, created: new Date().toISOString(), list: isList && view !== DEFAULT_LIST ? view : undefined };
    if (view === 'today' || view === 'week') t.due = today();
    if (view === 'important') t.priority = 1;
    if (view === 'current') t.start = today();
    if (view.startsWith(TAG)) t.tags = [view.slice(TAG.length)];
    const parsed = smartAdd ? parseTaskDraft(text, lists, today()) : { text };
    const tags = [...new Set([...(t.tags ?? []), ...(parsed.tags ?? [])])];
    const task: Item = { ...t, ...parsed, tags: tags.length ? tags : undefined };
    if (task.list === DEFAULT_LIST) task.list = undefined;
    update((b) => ({ ...b, items: [...b.items, task] }));
  };
  /** The completed tasks on screen come back open (one undo puts them all back as they were). */
  const reopenDone = () => {
    const back = (view === 'completed' ? shown : doneHere).filter((t) => t.done);
    const ids = new Set(back.map((t) => t.id));
    update((b) => ({ ...b, items: b.items.map((x) => (ids.has(x.id) ? { ...x, done: false, doneAt: undefined } : x)) }));
    offerUndo(T.tkReopenedN(back.length), () => update((b) => ({ ...b, items: b.items.map((x) => { const was = back.find((y) => y.id === x.id); return was ? { ...x, done: was.done, doneAt: was.doneAt } : x; }) })));
  };
  const clearDone = () => {
    const gone = items.filter((t) => t.done && (view === 'completed' || listOf(t) === view));
    update((b) => ({ ...b, items: b.items.filter((x) => !gone.includes(x)) }));
    offerUndo(T.tkDoneDeleted(gone.length), () => update((b) => ({ ...b, items: [...b.items, ...gone] })));
  };

  // ---- dragging a task: by its grip, onto another row (one's own order) or onto a list, a tag or a collection ----
  type Over = { kind: 'row'; id: string; after: boolean } | { kind: 'view'; view: string } | null;
  const [drag, setDrag] = useState<{ t: Item; x: number; y: number; over: Over } | null>(null);
  const overAt = (x: number, y: number, id: string): Over => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const r = el?.closest<HTMLElement>('.tk-main .tk-row[data-id]');
    if (r) { if (r.dataset.id === id) return null; const b = r.getBoundingClientRect(); return { kind: 'row', id: r.dataset.id!, after: y > b.top + b.height / 2 }; }
    const v = el?.closest<HTMLElement>('[data-drop]');
    return v && v.dataset.drop !== view ? { kind: 'view', view: v.dataset.drop! } : null;
  };
  const grab = (t: Item, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, over: Over = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      over = overAt(ev.clientX, ev.clientY, t.id);
      setDrag({ t, x: ev.clientX, y: ev.clientY, over });
    };
    const end = (drop: boolean) => () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setDrag(null);
      if (!drop || !over) return;
      if (over.kind === 'row') reorder(t.id, over.id, over.after);
      else dropOn(t, over.view);
    };
    const up = end(true), cancel = end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };
  /** One's own order: the shown tasks take their new sequence in the places they held among all tasks. */
  const reorder = (id: string, target: string, after: boolean) => {
    const ids = shown.map((x) => x.id).filter((x) => x !== id);
    ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, id);
    update((b) => {
      const at = b.items.map((x, i) => (ids.includes(x.id) ? i : -1)).filter((i) => i >= 0);
      const next = [...b.items];
      at.forEach((i, k) => { next[i] = b.items.find((x) => x.id === ids[k])!; });
      return { ...b, items: next };
    });
    if (sort !== 'manual') { setSort('manual'); store.set('sc-tasks-sort', 'manual'); }
  };
  /** Dropped on the side column: into a list, given a tag, starred, due today, started, or done. */
  const dropOn = (t: Item, v: string) => {
    if (v === 'completed') { tick(t); return; }
    const p: Partial<Item> = v === 'today' ? { due: today() } : v === 'important' ? { priority: 1 } : v === 'current' ? { start: today() }
      : v.startsWith(TAG) ? { tags: [...new Set([...(t.tags ?? []), v.slice(TAG.length)])] }
      : { list: v === DEFAULT_LIST ? undefined : v };
    set(t.id, p);
    const name = v.startsWith(TAG) ? `#${v.slice(TAG.length)}` : lists.find((l) => l.id === v)?.name ?? T.tkViews[v as keyof typeof T.tkViews];
    offerUndo(T.tkMovedTo(t.text, name), () => set(t.id, { due: t.due, priority: t.priority, start: t.start, tags: t.tags, list: t.list }));
  };
  const target = (v: string) => (drag?.over?.kind === 'view' && drag.over.view === v ? ' drop' : '');

  // ---- several tasks at once: picked with "Select" (or Ctrl/Cmd + click), then moved, dated, starred, tagged, done or deleted ----
  const [sel, setSel] = useState<Set<string> | null>(null);
  useEffect(() => setSel(null), [view]);
  const pick = (id: string) => setSel((s) => { const n = new Set(s ?? []); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const picked = items.filter((t) => sel?.has(t.id));
  /** One change to every picked task (null = deleted), undone together. */
  const bulk = (change: (t: Item) => Partial<Item> | null, message: string) => {
    const before = picked;
    const ids = new Set(before.map((t) => t.id));
    update((b) => ({ ...b, items: b.items.flatMap((x) => { if (!ids.has(x.id)) return [x]; const p = change(x); return p ? [{ ...x, ...p }] : []; }) }));
    offerUndo(message, () => update((b) => ({ ...b, items: [...b.items.filter((x) => !ids.has(x.id)), ...before] })));
    setSel(new Set());
  };
  const bulkDone = (t: Item): Partial<Item> => (t.done ? {} : t.repeat ? rollOn(t) : { done: true, doneAt: today() });
  const [bulkTag, setBulkTag] = useState('');

  const row = (t: Item) => {
    const list = lists.find((l) => l.id === listOf(t));
    const steps = t.steps?.length ? `${t.steps.filter((s) => s.done).length}/${t.steps.length}` : '';
    const late = t.due && !t.done && daysTo(t.due) < 0;
    return (
      <li key={t.id} data-id={t.id} className={`tk-row${t.id === openId ? ' on' : ''}${sel?.has(t.id) ? ' picked' : ''}${t.done ? ' done' : ''}${t.priority ? ` p${t.priority}` : ''}${drag?.t.id === t.id ? ' lifted' : ''}${drag?.over?.kind === 'row' && drag.over.id === t.id ? (drag.over.after ? ' drop-after' : ' drop-before') : ''}`}>
        {t.done ? <span className="tk-grip" aria-hidden="true" />
          : <span className="tk-grip" role="button" tabIndex={-1} aria-label={T.tkDrag(t.text)} title={T.tkDrag(t.text)} onPointerDown={(e) => grab(t, e)}><IconGrip /></span>}
        <input type="checkbox" className="check" checked={!!t.done} aria-label={T.doneLabel(t.text)} onChange={() => tick(t)} />
        <button type="button" className="tk-open" aria-expanded={sel ? undefined : t.id === openId} aria-pressed={sel ? sel.has(t.id) : undefined}
          onClick={(e) => {
            if (sel || e.ctrlKey || e.metaKey) { if (!sel) setOpenId(null); pick(t.id); return; }
            setOpenId(t.id === openId ? null : t.id);
          }}>
          <span className="tk-title">{t.text}</span>
          <span className="tk-line num">
            {!isList && list && <span className="tk-in"><i className={`tk-dot c-${list.color ?? 'none'}`} />{list.name}</span>}
            {t.start && !t.done && t.start > today() && <span>{T.tkStarts(shortDate(t.start))}</span>}
            {t.due && <span className={late ? 'late' : t.due === today() ? 'today' : ''}>{dueWords(T, t.due)}{t.dueTime ? ` ${t.dueTime}` : ''}</span>}
            {t.remind != null && t.dueTime && !t.done && <span className="tk-has" aria-label={T.tkRemindSet}><IconBell /></span>}
            {t.repeat && <span className="tk-rep"><IconRepeat />{recurWords(T, t.repeat)}</span>}
            {steps && <span>{T.tkStepsN(steps)}</span>}
            {(t.percent ?? 0) > 0 && !t.done && <span className="tk-pc"><i><b style={{ width: `${t.percent}%` }} /></i>{t.percent}%</span>}
            {(t.spent || t.estimate) && <span className={t.spent && t.estimate && t.spent > t.estimate ? 'over' : ''}>{t.spent ? T.tkSpent(duration(t.spent), t.estimate ? duration(t.estimate) : '') : duration(t.estimate!)}</span>}
            {t.notes && <span className="tk-has" aria-label={T.tkNotes}><IconNotes /></span>}
            {t.tags?.map((g) => <span key={g} className="lbl lb-grey">{g}</span>)}
          </span>
        </button>
        <button type="button" className={`btn ghost icon kb-star tk-star${t.priority === 1 ? ' on' : ''}`} aria-pressed={t.priority === 1} aria-label={T.tkStar(t.text)}
          onClick={() => set(t.id, { priority: t.priority === 1 ? undefined : 1 })}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" /></svg>
        </button>
      </li>
    );
  };

  const go = (v: string) => navigate(`/tasks/${encodeURIComponent(v)}`);
  // the collections a task can be dropped on (into "all" or "next 7 days" means nothing)
  const DROPS = ['today', 'important', 'current', 'completed'];

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.tkTitle}</h1>
          <p className="sub num">{doc ? T.tkSummary(count('all'), count('today')) : ' '}</p>
        </div>
        <div className="title-actions"><SaveStamp status={status} /></div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />
      <div className={`tk${open ? ' with-detail' : ''}`} data-anim>
        <nav className="tk-side" aria-label={T.tkTitle}>
          <ul className="tk-views">
            {COLLECTIONS.map((v) => (
              <li key={v}><button type="button" className={target(v)} data-drop={DROPS.includes(v) ? v : undefined} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}>
                <span>{T.tkViews[v]}</span><span className="num">{count(v) || ''}</span>
              </button></li>
            ))}
          </ul>
          <ListsPart lists={lists} view={view} count={count} go={go} doc={doc} update={update} target={target} />
          {/* tags: every tag in use, a view of its own */}
          {allTags.length > 0 && (
            <>
              <h3 className="tk-side-h">{T.tkTags}</h3>
              <ul className="tk-views tk-tag-views">
                {allTags.map((g) => (
                  <li key={g}><button type="button" className={target(TAG + g)} data-drop={TAG + g} aria-current={view === TAG + g ? 'page' : undefined} onClick={() => go(TAG + g)}>
                    <span><IconTag />{g}</span><span className="num">{count(TAG + g) || ''}</span>
                  </button></li>
                ))}
              </ul>
            </>
          )}
        </nav>
        {/* phones: the lists as one select over the tasks */}
        <label className="tk-pick">
          <span className="sr-only">{T.tkTitle}</span>
          <select className="input" value={view} onChange={(e) => go(e.target.value)}>
            <optgroup label={T.tkTitle}>{COLLECTIONS.map((v) => <option key={v} value={v}>{T.tkViews[v]} ({count(v)})</option>)}</optgroup>
            <optgroup label={T.tkLists}>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({count(l.id)})</option>)}</optgroup>
            {allTags.length > 0 && <optgroup label={T.tkTags}>{allTags.map((g) => <option key={g} value={TAG + g}>#{g} ({count(TAG + g)})</option>)}</optgroup>}
          </select>
        </label>

        <section className="panel tk-main" aria-labelledby="tk-h">
          <header className="tk-head">
            <h2 id="tk-h">{viewName}</h2>
            <label className="tk-search">
              <IconSearch />
              <span className="sr-only">{T.tkSearch}</span>
              <input ref={searchInput} type="search" className="input" placeholder={T.tkSearch} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { if (q) setQ(''); else e.currentTarget.blur(); } }} />
            </label>
            <button type="button" className={`btn${sel ? ' primary' : ' ghost'}`} aria-pressed={!!sel} onClick={() => { setSel(sel ? null : new Set()); setOpenId(null); }}>{sel ? T.tkSelectDone : T.tkSelect}</button>
            <label className="tk-sort">
              <span className="sr-only">{T.tkSortLabel}</span>
              <select className="input" value={sort} onChange={(e) => { setSort(e.target.value as Sort); store.set('sc-tasks-sort', e.target.value); }}>
                {SORTS.map((s) => <option key={s} value={s}>{T.tkSorts[s]}</option>)}
              </select>
            </label>
          </header>
          {view !== 'completed' && (
            <form className="tk-add" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { add(t); setDraft(''); setSmartAdd(true); } }}>
              <label htmlFor="tk-new" className="sr-only">{isList ? T.tkAddPh(viewName) : T.tkAddPhAny}</label>
              <input id="tk-new" ref={addInput} className="input" autoComplete="off" aria-describedby="tk-add-help" placeholder={isList ? T.tkAddPh(viewName) : T.tkAddPhAny} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); setSmartAdd(true); e.currentTarget.blur(); } }} />
              <button type="submit" className="btn primary" disabled={!draft.trim()}>{T.tkAdd}</button>
            </form>
          )}
          {view !== 'completed' && <div id="tk-add-help" className="muted tk-quick-help">
            {draft.trim() && parsedDraft.text !== draft.trim() ? <>
              <span role="status">{T.tkDetected}: {parsedDraft.text} · {[parsedDraft.due, parsedDraft.dueTime, parsedDraft.list && lists.find((l) => l.id === parsedDraft.list)?.name, parsedDraft.priority && `${T.tkPriority} ${parsedDraft.priority}`, parsedDraft.tags?.map((g) => `@${g}`).join(' '), parsedDraft.repeat && recurWords(T, parsedDraft.repeat)].filter(Boolean).join(' · ')}</span>{' '}
              <button type="button" className="card-link quiet" onClick={() => setSmartAdd(false)}>{T.tkLiteral}</button>
            </> : <span>{T.tkQuickHelp}</span>}
          </div>}
          {shown.length > 0 && <ul className="tk-list">{shown.map(row)}</ul>}
          {doc && shown.length === 0 && <p className="muted tk-empty">{q.trim() ? T.tkNoMatch : T.tkEmpty[view as keyof typeof T.tkEmpty] ?? T.tkEmpty.list}</p>}
          {(doneHere.length > 0 || (view === 'completed' && shown.length > 0)) && (
            <div className="tk-done-bar">
              {view !== 'completed' && <button type="button" className="card-link quiet" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>{T.tkCompletedN(doneHere.length, showDone)}</button>}
              <button type="button" className="card-link quiet" onClick={reopenDone}>{T.tkReopenDone}</button>
              <button type="button" className="card-link quiet" onClick={clearDone}>{T.tkDeleteDone}</button>
            </div>
          )}
          {showDone && doneHere.length > 0 && <ul className="tk-list">{doneHere.map(row)}</ul>}
          {sel && (
            <div className="tk-bulk" role="toolbar" aria-label={T.tkPickedN(picked.length)}>
              <span className="num tk-bulk-n">{T.tkPickedN(picked.length)}</span>
              <button type="button" className="card-link quiet" onClick={() => setSel(picked.length === shown.length ? new Set() : new Set(shown.map((t) => t.id)))}>{picked.length === shown.length && shown.length ? T.tkPickNone : T.tkPickAll}</button>
              <span className="tk-bulk-acts" aria-disabled={!picked.length}>
                <select className="input" value="" disabled={!picked.length} aria-label={T.tkMoveTo} onChange={(e) => { const v = e.target.value; if (v) bulk(() => ({ list: v === DEFAULT_LIST ? undefined : v }), T.tkMovedN(picked.length, lists.find((l) => l.id === v)!.name)); }}>
                  <option value="">{T.tkMoveTo}</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <select className="input" value="" disabled={!picked.length} aria-label={T.tkDue} onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const due = v === 'none' ? undefined : v === 'today' ? today() : v === 'tomorrow' ? addDays(today(), 1) : addDays(today(), 7);
                  bulk(() => ({ due, ...(due ? {} : { dueTime: undefined, remind: undefined }) }), T.tkDatedN(picked.length));
                }}>
                  <option value="">{T.tkDue}</option>
                  <option value="today">{T.todayBtn}</option>
                  <option value="tomorrow">{T.tomorrow}</option>
                  <option value="week">{T.tkInAWeek}</option>
                  <option value="none">{T.tkNoDue}</option>
                </select>
                <button type="button" className="btn" disabled={!picked.length} onClick={() => { const on = !picked.every((t) => t.priority === 1); bulk(() => ({ priority: on ? 1 : undefined }), on ? T.tkStarredN(picked.length) : T.tkUnstarredN(picked.length)); }}>{T.tkStarAll}</button>
                <form className="tk-bulk-tag" onSubmit={(e) => { e.preventDefault(); const g = bulkTag.trim(); if (!g || !picked.length) return; bulk((t) => ({ tags: [...new Set([...(t.tags ?? []), g])] }), T.tkTaggedN(picked.length, g)); setBulkTag(''); }}>
                  <input className="input" list="tk-bulk-tags" placeholder={T.tkTagPh} value={bulkTag} disabled={!picked.length} aria-label={T.tkTagPh} onChange={(e) => setBulkTag(e.target.value)} />
                  <datalist id="tk-bulk-tags">{allTags.map((g) => <option key={g} value={g} />)}</datalist>
                </form>
                {view === 'completed'
                  ? <button type="button" className="btn" disabled={!picked.length} onClick={() => bulk(() => ({ done: false, doneAt: undefined }), T.tkReopenedN(picked.length))}>{T.tkReopen}</button>
                  : <button type="button" className="btn" disabled={!picked.length} onClick={() => bulk(bulkDone, T.tkDoneN(picked.length))}>{T.tkMarkDone}</button>}
                <button type="button" className="btn ghost danger" disabled={!picked.length} onClick={() => bulk(() => null, T.tkDeletedN(picked.length))}>{T.tkDeleteAll}</button>
              </span>
            </div>
          )}
        </section>

        {open && <Detail key={open.id} t={open} lists={lists} tags={allTags} set={(p) => set(open.id, p)} tick={() => tick(open)} remove={() => remove(open)} close={() => setOpenId(null)} />}
      </div>
      {drag && <div className="drag-chip" style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 10}px)` }} aria-hidden="true">{drag.t.text}</div>}
    </>
  );
}

/** The lists of one's own in the side column: pick, rename, colour, delete (with its tasks, undoable), add. */
function ListsPart({ lists, view, count, go, doc, update, target }: {
  lists: TaskList[]; view: string; count: (v: string) => number; go: (v: string) => void; doc: InboxDoc | null; update: (f: (d: InboxDoc) => InboxDoc) => void;
  target: (v: string) => string;
}) {
  const T = useT();
  const [menu, setMenu] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const setList = (id: string, p: Partial<TaskList>) => update((d) => ({ ...d, lists: (d.lists ?? []).map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  const drop = (l: TaskList) => {
    const before = doc!;
    update((d) => ({ ...d, lists: (d.lists ?? []).filter((x) => x.id !== l.id), items: d.items.filter((t) => listOf(t) !== l.id) }));
    setMenu(null);
    if (view === l.id) go('all');
    offerUndo(T.tkListDeleted(l.name), () => update((d) => ({ ...d, lists: before.lists, items: [...d.items, ...before.items.filter((t) => listOf(t) === l.id)] })));
  };
  return (
    <>
      <h3 className="tk-side-h">{T.tkLists}</h3>
      <ul className="tk-views tk-lists">
        {lists.map((l) => (
          <li key={l.id} className="kb-pop-wrap">
            <button type="button" className={target(l.id)} data-drop={l.id} aria-current={view === l.id ? 'page' : undefined} onClick={() => go(l.id)}>
              <span><i className={`tk-dot c-${l.color ?? 'none'}`} />{l.name}</span><span className="num">{count(l.id) || ''}</span>
            </button>
            {l.id !== DEFAULT_LIST && (
              <button type="button" className="btn ghost icon tk-list-menu" aria-label={T.tkListMenu(l.name)} aria-expanded={menu === l.id} onClick={() => setMenu(menu === l.id ? null : l.id)}><IconMore /></button>
            )}
            <Pop open={menu === l.id} onClose={() => setMenu(null)} title={l.name} align="right">
              <label className="field"><span>{T.tkRename}</span>
                <input className="input" value={l.name} maxLength={60} onChange={(e) => setList(l.id, { name: e.target.value })} />
              </label>
              <span className="label">{T.tkColour}</span>
              <div className="tk-tints">
                {[undefined, ...TINTS].map((c) => (
                  <button key={c ?? 'none'} type="button" className={`tk-tint c-${c ?? 'none'}`} aria-pressed={l.color === c} aria-label={c ? T.kbColors[c] : T.tkNoColour} onClick={() => setList(l.id, { color: c })} />
                ))}
              </div>
              <button type="button" className="btn ghost danger" onClick={() => drop(l)}>{T.tkDeleteList}</button>
            </Pop>
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="tk-new-list" onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          const id = `l${uid().slice(0, 8)}`;
          update((d) => ({ ...d, lists: [...(d.lists ?? []), { id, name: n }] }));
          setName(''); setAdding(false); go(id);
        }}>
          <label htmlFor="tk-list-name" className="sr-only">{T.tkListPh}</label>
          <input id="tk-list-name" className="input" autoFocus maxLength={60} placeholder={T.tkListPh} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
          <button type="submit" className="btn" disabled={!name.trim()}>{T.tkAdd}</button>
        </form>
      ) : <button type="button" className="card-link quiet tk-add-list" onClick={() => setAdding(true)}>+ {T.tkNewList}</button>}
    </>
  );
}

/** A task's details beside the list (over it on narrow screens): everything it can hold, changed as typed. */
function Detail({ t, lists, tags, set, tick, remove, close }: {
  t: Item; lists: TaskList[]; tags: string[]; set: (p: Partial<Item>) => void; tick: () => void; remove: () => void; close: () => void;
}) {
  const T = useT();
  const { settings } = useSettings();
  const [tag, setTag] = useState('');
  const preset = presetOf(t.repeat);
  const [custom, setCustom] = useState(preset === 'custom');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.kb-pop')) close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [close]);
  // a rule needs a date to count from (today, when the task has none), on one of its weekdays when it names them
  const setRepeat = (r: Recur | undefined) => {
    const from = t.due ?? (t.start ? undefined : today());
    set({ repeat: r, ...(r && from ? { due: onRuleDay(r, from) } : {}) });
  };
  const addTag = () => {
    const g = tag.trim().replace(/,$/, '');
    if (g && !t.tags?.includes(g)) set({ tags: [...(t.tags ?? []), g] });
    setTag('');
  };
  const r = t.repeat;
  return (
    <aside className="panel tk-detail" ref={ref} aria-label={t.text}>
      <div className="tk-d-head">
        <input type="checkbox" className="check" checked={!!t.done} aria-label={T.doneLabel(t.text)} onChange={tick} />
        <textarea className="tk-d-title" rows={1} value={t.text} aria-label={T.tkTaskLabel} maxLength={300}
          onChange={(e) => set({ text: e.target.value.replace(/\n/g, ' ') })} />
        <button type="button" className="btn ghost icon" aria-label={T.tkClose} onClick={close}><IconX /></button>
      </div>

      <div className="tk-fields">
        <label className="field"><span>{T.tkList}</span>
          <select className="input" value={listOf(t)} onChange={(e) => set({ list: e.target.value === DEFAULT_LIST ? undefined : e.target.value })}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <div className="tk-two">
          <label className="field"><span>{T.tkStart}</span>
            <input type="date" className="input num" value={t.start ?? ''} max={t.due} onChange={(e) => set({ start: e.target.value || undefined })} />
          </label>
          <label className="field"><span>{T.tkDue}</span>
            <input type="date" className="input num" value={t.due ?? ''} min={t.start} onChange={(e) => set({ due: e.target.value || undefined, ...(t.repeat?.monthDay ? { repeat: { ...t.repeat, monthDay: undefined } } : {}) })} />
          </label>
        </div>
        {/* the hour it is due and a reminder before it */}
        {t.due && (
          <div className="tk-two">
            <label className="field"><span>{T.tkDueTime}</span>
              <input type="time" className="input num" value={t.dueTime ?? ''} onChange={(e) => set({ dueTime: e.target.value || undefined, ...(e.target.value ? {} : { remind: undefined }) })} />
            </label>
            <label className="field"><span>{T.tkRemind}</span>
              <select className="input" value={t.remind ?? ''} disabled={!t.dueTime} onChange={(e) => set({ remind: e.target.value === '' ? undefined : Number(e.target.value) })}>
                <option value="">{T.tkRemindNone}</option>
                {REMINDS.map((m) => <option key={m} value={m}>{m === 0 ? T.tkRemindAt : T.tkRemindBefore(m >= 1440 ? T.tkDaysN(m / 1440) : duration(m))}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="field">
          <span id="tk-prio">{T.tkPriority}</span>
          <Segmented role="group" aria-labelledby="tk-prio">
            {([undefined, 9, 5, 1] as const).map((p) => (
              <button key={p ?? 0} type="button" aria-pressed={t.priority === p} onClick={() => set({ priority: p })}>{T.tkPrios[p ?? 0]}</button>
            ))}
          </Segmented>
        </div>
        <label className="field"><span>{T.tkProgress} <b className="num">{t.percent ?? 0}%</b></span>
          <input type="range" className="tk-range" min={0} max={100} step={5} value={t.percent ?? 0}
            style={{ '--v': `${t.percent ?? 0}%` } as React.CSSProperties} onChange={(e) => set({ percent: Number(e.target.value) || undefined })} />
        </label>

        {/* coming back: the usual rules in one list, or any "every N days / weeks / months / years" */}
        <div className="field tk-repeat">
          <label htmlFor="tk-rep">{T.tkRepeat}</label>
          <select id="tk-rep" className="input" value={custom ? 'custom' : preset} onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') { setCustom(true); if (!r) setRepeat({ every: 1, unit: 'week' }); return; }
            setCustom(false);
            setRepeat(v === 'none' ? undefined : { ...PRESETS.find((p) => p.id === v)!.rule, after: r?.after, count: r?.count, until: r?.until });
          }}>
            <option value="none">{T.tkRepeats.none}</option>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{T.tkRepeats[p.id as keyof typeof T.tkRepeats]}</option>)}
            <option value="custom">{T.tkRepeats.custom}</option>
          </select>
          {r && (custom || r.unit === 'week') && (
            <div className="tk-rule">
              {custom && (
                <span className="tk-every">
                  <span>{T.tkEveryWord}</span>
                  <input type="number" className="input num" min={1} max={365} value={r.every} aria-label={T.tkEveryWord}
                    onChange={(e) => setRepeat({ ...r, every: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />
                  <select className="input" value={r.unit} aria-label={T.tkUnitLabel} onChange={(e) => setRepeat({ ...r, unit: e.target.value as Recur['unit'], days: e.target.value === 'week' ? r.days : undefined })}>
                    {(['day', 'week', 'month', 'year'] as const).map((u) => <option key={u} value={u}>{T.tkUnits[u](r.every)}</option>)}
                  </select>
                </span>
              )}
              {r.unit === 'week' && (
                <DayChips days={r.days ?? []} label={T.tkOnDays} onChange={(days) => setRepeat({ ...r, days: days.length ? days : undefined })} />
              )}
            </div>
          )}
          {r && (
            <>
              {/* when it ends: never, after a number of times, or after a day */}
              <div className="tk-ends">
                <label htmlFor="tk-end">{T.tkEnds}</label>
                <select id="tk-end" className="input" value={r.count ? 'count' : r.until ? 'until' : 'never'} onChange={(e) => {
                  const v = e.target.value;
                  setRepeat({ ...r, count: v === 'count' ? Math.max(2, (t.doneCount ?? 0) + 5) : undefined, until: v === 'until' ? addDays(t.due ?? today(), 90) : undefined });
                }}>
                  <option value="never">{T.tkEndNever}</option>
                  <option value="count">{T.tkEndCount}</option>
                  <option value="until">{T.tkEndUntil}</option>
                </select>
                {r.count != null && (
                  <input type="number" className="input num" min={1} max={999} value={r.count} aria-label={T.tkEndCount}
                    onChange={(e) => setRepeat({ ...r, count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} />
                )}
                {r.until != null && (
                  <input type="date" className="input num" min={t.due ?? today()} value={r.until} aria-label={T.tkEndUntil}
                    onChange={(e) => setRepeat({ ...r, until: e.target.value || undefined })} />
                )}
              </div>
              <label className="tk-check-row"><input type="checkbox" className="check" checked={!!r.after} onChange={(e) => setRepeat({ ...r, after: e.target.checked || undefined })} />{T.tkAfter}</label>
              <p className="tk-note num">{recurWords(T, r)}{t.due ? ` · ${T.tkNextOn(longDate(t.due))}` : ''}{t.doneCount ? ` · ${T.tkDoneTimes(t.doneCount)}` : ''}</p>
            </>
          )}
        </div>

        <label className="field"><span>{T.tkEstimate}{t.spent ? <b className="num">{T.tkFocusedFor(duration(t.spent))}</b> : null}</span>
          <select className="input num" value={t.estimate ?? ''} onChange={(e) => set({ estimate: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">{T.estimateNone}</option>
            {ESTIMATES.map((m) => <option key={m} value={m}>{duration(m)}</option>)}
          </select>
        </label>

        <div className="field">
          <label htmlFor="tk-tag">{T.tkTags}</label>
          <div className="tk-tags">
            {t.tags?.map((g) => (
              <span key={g} className="lbl lb-grey tk-tag">{g}
                <button type="button" aria-label={T.tkRemoveTag(g)} onClick={() => set({ tags: t.tags!.filter((x) => x !== g).length ? t.tags!.filter((x) => x !== g) : undefined })}><IconX /></button>
              </span>
            ))}
            <input id="tk-tag" className="input" list="tk-tag-list" placeholder={T.tkTagPh} value={tag} onChange={(e) => (e.target.value.endsWith(',') ? (setTag(e.target.value), setTimeout(addTag)) : setTag(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} onBlur={addTag} />
            <datalist id="tk-tag-list">{tags.filter((g) => !t.tags?.includes(g)).map((g) => <option key={g} value={g} />)}</datalist>
          </div>
        </div>

        <label className="field"><span>{T.tkNotes}</span>
          <textarea className="input tk-notes" rows={4} placeholder={T.tkNotesPh} value={t.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
        </label>

        <div className="field">
          <span>{T.tkSubtasks}</span>
          <Checklist label={T.tkSubtasks} items={t.steps ?? []} placeholder={T.tkSubPh} onChange={(steps) => set({ steps: steps.length ? steps : undefined })} />
        </div>

        {!t.done && (<>
          <div className="field">
            <span>{T.tkFocusTitle}</span>
            <div className="tk-plan">
              <button type="button" className="btn" onClick={() => { startFocus({ blockId: null, label: t.text, minutes: settingsFocus(settings).focusMin, task: { id: t.id, text: t.text } }).then(() => navigate('/focus')); }}>{T.tkFocusOn}</button>
            </div>
          </div>
          <div className="field">
            <span>{T.tkPlan}</span>
            <div className="tk-plan">
              <button type="button" className="btn" onClick={() => planOn(t, today(), T.tkPlanned(longDate(today())))}>{T.todayBtn}</button>
              <button type="button" className="btn ghost" onClick={() => planOn(t, addDays(today(), 1), T.tkPlanned(longDate(addDays(today(), 1))))}>{T.tomorrow}</button>
              <input type="date" required className="input num" min={today()} value="" aria-label={T.toDayLabel(t.text)} onChange={(e) => { if (e.target.value) planOn(t, e.target.value, T.tkPlanned(longDate(e.target.value))); }} />
            </div>
            <p className="tk-note">{t.repeat ? T.tkPlanRepeat : T.tkPlanMoves}</p>
          </div>
        </>)}
      </div>

      <div className="tk-d-foot">
        <span className="tk-note num">{t.created ? T.tkCreated(shortDate(t.created.slice(0, 10))) : ''}{t.doneAt ? ` · ${T.tkDoneOn(shortDate(t.doneAt))}` : ''}</span>
        <button type="button" className="btn ghost danger" onClick={remove}>{T.tkDeleteTask}</button>
      </div>
    </aside>
  );
}

/**
 * On a day: the tasks of the lists that ask for it (due or started by then, or starred), each with a grip to drag onto
 * the hours (a block of its estimate; the task joins the day's tasks) and a + to add it to the day's tasks.
 */
export function FromLists({ date, onGrab }: { date: string; onGrab: (task: Item, from: Item, e: React.PointerEvent) => void }) {
  const T = useT();
  const { value: doc } = useDoc<InboxDoc>('inbox', emptyInbox);
  const all = sortTasks((doc?.items ?? []).filter((t) => !t.done && ((t.due && t.due <= date) || (t.start && t.start <= date) || t.priority === 1)), 'due');
  if (!all.length) return null;
  const shown = all.slice(0, 6);
  return (
    <div className="from-lists">
      <span className="from-lists-h">{T.tkFromLists}<span className="muted"> · {T.tkDragHint}</span></span>
      <ul>
        {shown.map((t) => (
          <li key={t.id}>
            <span className="tk-grip" role="button" tabIndex={-1} aria-label={T.tkDragToDay(t.text)} title={T.tkDragToDay(t.text)} onPointerDown={(e) => { e.preventDefault(); onGrab(forDay(t), t, e); }}><IconGrip /></span>
            <span className="text">{t.text}</span>
            <span className="task-meta num">
              {t.repeat && <span className="tk-rep"><IconRepeat /></span>}
              {t.priority === 1 && <span className="tk-starred" role="img" aria-label={T.tkViews.important}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" /></svg></span>}
              {t.due && <span className={`due${t.due < today() ? ' late' : t.due === today() ? ' today' : ''}`}>{dueWords(T, t.due)}</span>}
            </span>
            <button type="button" className="btn ghost icon sm" aria-label={T.tkAddToDay(t.text)} title={T.tkAddToDay(t.text)} onClick={() => toDay([t], date)}><IconPlus /></button>
          </li>
        ))}
      </ul>
      {all.length > shown.length && <a className="card-link quiet" href="/tasks/today" onClick={onLinkClick}>{T.tkMoreInLists(all.length - shown.length)}</a>}
    </div>
  );
}

/** On a day: pick open tasks from the lists to add to its tasks (a one-off moves, a repeating one is copied and rolls on). */
export function InboxPicker({ open, onClose, onTake }: { open: boolean; onClose: () => void; onTake: (items: Item[]) => void }) {
  const T = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const { value: doc, update } = useDoc<InboxDoc>('inbox', emptyInbox);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setChosen([]); }
    if (!open && d.open) d.close();
  }, [open]);
  const lists = listsOf(doc ?? emptyInbox(), T);
  const items = sortTasks((doc?.items ?? []).filter((x) => !x.done), 'due');
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-labelledby="ip-title">
      <form method="dialog" onSubmit={(e) => {
        e.preventDefault();
        const take = items.filter((x) => chosen.includes(x.id));
        onTake(take.map(forDay));
        update((b) => takeOut(b, chosen));
        onClose();
      }}>
        <h2 id="ip-title">{T.fromInbox}</h2>
        {items.length === 0 ? <p className="muted">{T.tkEmpty.all}</p> : (
          <ul className="inbox-list pick-list">
            {items.map((x) => (
              <li key={x.id}>
                <label>
                  <input type="checkbox" className="check" checked={chosen.includes(x.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, x.id] : c.filter((y) => y !== x.id)))} />
                  <span className="text">{x.text}</span>
                  <span className="task-meta num">
                    {lists.length > 1 && <span className="tk-in"><i className={`tk-dot c-${lists.find((l) => l.id === listOf(x))?.color ?? 'none'}`} />{lists.find((l) => l.id === listOf(x))?.name}</span>}
                    {x.repeat && <span className="tk-rep"><IconRepeat /></span>}
                    {x.due && <span className={`due${daysTo(x.due) < 0 ? ' late' : x.due === today() ? ' today' : ''}`}>{dueWords(T, x.due)}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="foot">
          <button type="button" className="btn ghost" onClick={onClose}>{T.cancel}</button>
          <div className="right"><button type="submit" className="btn primary" disabled={!chosen.length}>{T.addToToday(chosen.length)}</button></div>
        </div>
      </form>
    </dialog>
  );
}
