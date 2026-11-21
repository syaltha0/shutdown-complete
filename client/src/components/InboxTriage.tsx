import { useEffect, useRef, useState } from 'react';
import { addDays, shortDate, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import type { InboxDoc, Item, TaskList } from '../lib/model';
import { offerUndo, undo, useUndoOffer } from '../lib/undo';
import { IconX } from './Icons';

/** Dates after "pick date" and the lists after "move to list" take a second step inside the same card. */
type Step = 'main' | 'date' | 'list';

/**
 * Goes through the inbox one task at a time: a small card with the task and one-tap decisions (today, tomorrow, a date,
 * a list, star, delete, skip). The queue is the tasks that were waiting when it opened; each decision moves to the next,
 * and undoing one brings that task back to the card. Keys: T Y D L S, Delete, →, Esc (not while typing).
 */
export function InboxTriage({ ids, items, lists, update, onPlan, onRemove, onClose }: {
  ids: string[];
  items: Item[];
  /** the lists a task can be moved to (not the inbox itself) */
  lists: TaskList[];
  update: (fn: (b: InboxDoc) => InboxDoc) => void;
  onPlan: (t: Item, date: string, onUndone: () => void) => Promise<void>;
  onRemove: (t: Item, onUndone: () => void) => void;
  onClose: () => void;
}) {
  const T = useT(), W = T.triage;
  const [idx, setIdx] = useState(0), [step, setStep] = useState<Step>('main'), [date, setDate] = useState(addDays(today(), 2));
  const dialog = useRef<HTMLDialogElement>(null), card = useRef<HTMLDivElement>(null), busy = useRef(false);
  const current = useUndoOffer(), seen = useRef(current?.id);
  // only what was decided in this card is offered back here
  const offer = current && current.id !== seen.current ? current : null;
  useEffect(() => {
    const previous = document.activeElement, modal = dialog.current;
    modal?.showModal(); card.current?.focus();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  // a task that is gone meanwhile (deleted on another device) is passed over
  const at = (i: number) => items.find((t) => t.id === ids[i]);
  useEffect(() => { if (idx < ids.length && !at(idx)) setIdx((i) => Math.max(i, idx + 1)); }, [idx, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = idx < ids.length ? at(idx) : undefined;
  const finished = idx >= ids.length;
  // moving on is idempotent: the task may already have left the list (planned, deleted) when this runs
  const next = (id: string) => { setStep('main'); setIdx((i) => Math.max(i, ids.indexOf(id) + 1)); card.current?.focus(); };
  const back = (id: string) => () => { setStep('main'); setIdx(Math.max(0, ids.indexOf(id))); card.current?.focus(); };
  const patch = (id: string, p: Partial<Item>) => update((b) => ({ ...b, items: b.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const blank = !t?.text.trim();
  const run = async (job: () => Promise<void> | void) => {
    if (busy.current || !t) return;
    busy.current = true;
    const id = t.id;
    try { await job(); next(id); } finally { busy.current = false; }
  };
  const plan = (d: string) => { if (!blank) void run(() => onPlan(t!, d, back(t!.id))); };
  const star = () => {
    if (!t || busy.current) return;
    const was = t.priority;
    patch(t.id, { priority: was === 1 ? undefined : 1 });
    offerUndo(was === 1 ? W.unstarredMsg(t.text) : W.starredMsg(t.text), () => { patch(t.id, { priority: was }); back(t.id)(); });
    next(t.id);
  };
  const move = (l: TaskList) => {
    if (!t) return;
    const was = t.list;
    patch(t.id, { list: l.id });
    offerUndo(W.moved(t.text, l.name), () => { patch(t.id, { list: was }); back(t.id)(); });
    next(t.id);
  };
  const remove = () => { if (t) void run(() => onRemove(t, back(t.id))); };
  const skip = () => {
    if (!t || busy.current) return;
    offerUndo(W.skippedMsg(t.text), back(t.id));
    next(t.id);
  };
  const stepTo = (s: Step) => { if (!blank) setStep(s); };

  const onKey = (e: React.KeyboardEvent) => {
    const el = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); if (step !== 'main') setStep('main'); else onClose(); return; }
    if (el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
    if (finished || !t) return;
    const k = e.key.toLowerCase();
    if (step === 'list') { const n = Number(k); if (n >= 1 && n <= lists.length) { e.preventDefault(); move(lists[n - 1]); } return; }
    if (step === 'date') return;
    if (k === 't') plan(today());
    else if (k === 'y') plan(addDays(today(), 1));
    else if (k === 'd') stepTo('date');
    else if (k === 'l') { if (lists.length) stepTo('list'); }
    else if (k === 's') star();
    else if (e.key === 'Delete' || e.key === 'Backspace') remove();
    else if (e.key === 'ArrowRight') skip();
    else return;
    e.preventDefault();
  };

  const left = items.filter((x) => ids.includes(x.id) && !x.list && !x.due && !x.done).length;
  const pct = ids.length ? Math.min(100, Math.round((Math.min(idx, ids.length) / ids.length) * 100)) : 100;
  const key = (k: string) => <kbd aria-hidden="true">{k}</kbd>;

  return <dialog ref={dialog} className="quick-capture triage" aria-label={W.title} onCancel={(e) => { e.preventDefault(); if (step !== 'main') setStep('main'); else onClose(); }} onClick={(e) => { if (e.target === dialog.current) onClose(); }} onKeyDown={onKey}>
    <div className="triage-card" ref={card} tabIndex={-1}>
      <div className="more-head"><b>{W.title}</b><button type="button" className="btn ghost icon" aria-label={T.close} onClick={onClose}><IconX /></button></div>
      <div className="triage-progress" role="progressbar" aria-valuemin={0} aria-valuemax={ids.length} aria-valuenow={Math.min(idx, ids.length)} aria-label={W.title}><i style={{ width: `${pct}%` }} /></div>
      {finished || !t ? <div className="triage-done" role="status">
        <h2>{left ? W.leftTitle : W.emptyTitle}</h2>
        {left > 0 && <p className="muted">{W.leftBody(left)}</p>}
        <button type="button" className="btn primary" onClick={onClose}>{W.close}</button>
      </div> : <>
        <p className="triage-count num" aria-live="polite">{W.progress(idx + 1, ids.length)}</p>
        <label className="sr-only" htmlFor="triage-text">{W.taskLabel}</label>
        <input id="triage-text" className="input triage-text" value={t.text} onChange={(e) => patch(t.id, { text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); card.current?.focus(); } }} />
        <label className="sr-only" htmlFor="triage-note">{W.noteLabel}</label>
        <textarea id="triage-note" className="input triage-note" rows={2} placeholder={W.notePh} value={t.notes ?? ''} onChange={(e) => patch(t.id, { notes: e.target.value || undefined })} />
        {step === 'main' && <div className="triage-acts">
          <button type="button" className="btn triage-act" disabled={blank} onClick={() => plan(today())}>{W.today}{key('T')}</button>
          <button type="button" className="btn triage-act" disabled={blank} onClick={() => plan(addDays(today(), 1))}>{W.tomorrow}{key('Y')}</button>
          <button type="button" className="btn triage-act" disabled={blank} onClick={() => stepTo('date')}>{W.pickDate}{key('D')}</button>
          <button type="button" className="btn triage-act" disabled={blank || !lists.length} title={lists.length ? undefined : W.noLists} onClick={() => stepTo('list')}>{W.toList}{key('L')}</button>
          <button type="button" className={`btn triage-act${t.priority === 1 ? ' on' : ''}`} aria-pressed={t.priority === 1} disabled={blank} onClick={star}>{t.priority === 1 ? W.starred : W.star}{key('S')}</button>
          <button type="button" className="btn triage-act" onClick={remove}>{W.delete}{key('Del')}</button>
          <button type="button" className="btn triage-act ghost" onClick={skip}>{W.skip}{key('→')}</button>
        </div>}
        {step === 'date' && <form className="triage-step" onSubmit={(e) => { e.preventDefault(); if (date) plan(date); }}>
          <label className="sr-only" htmlFor="triage-date">{W.pickDate}</label>
          <input id="triage-date" type="date" className="input" value={date} min={today()} onChange={(e) => setDate(e.target.value)} autoFocus />
          <button type="submit" className="btn primary" disabled={!date}>{W.setDate}{date ? ` · ${shortDate(date)}` : ''}</button>
          <button type="button" className="btn ghost" onClick={() => setStep('main')}>{W.back}</button>
        </form>}
        {step === 'list' && <div className="triage-step" role="group" aria-label={W.pickList}>
          <p className="muted">{W.pickList}</p>
          <div className="triage-lists">{lists.map((l, i) => <button type="button" key={l.id} className="btn triage-act" onClick={() => move(l)}>{l.name}{i < 9 && key(String(i + 1))}</button>)}</div>
          <button type="button" className="btn ghost" onClick={() => setStep('main')}>{W.back}</button>
        </div>}
        <p className="triage-keys muted" aria-hidden="true">{W.keys}</p>
      </>}
      {offer && <div className="triage-undo" role="status"><span>{offer.message}</span><button type="button" className="btn ghost" onClick={() => undo()}>{T.undo}</button></div>}
    </div>
  </dialog>;
}
