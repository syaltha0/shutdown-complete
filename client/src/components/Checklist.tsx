import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { uid, type Item } from '../lib/model';
import { IconGrip, IconPlus, IconSteps, IconX } from './Icons';
import { insertAt, offerUndo } from '../lib/undo';

/**
 * The paper planner's checkbox rows: tick, edit in place, Enter adds the next one. A row can hold smaller steps
 * (`steps`), and a line under its words for what ties it to other plans (`line`), with quiet buttons on its right
 * (`tools`) to make such ties.
 */
export function Checklist({
  items, onChange, placeholder, label, readOnly = false, onGrab, age, meta, steps = false, line, tools, nested = false,
}: {
  /** rows can hold smaller steps */
  steps?: boolean;
  /** what shows under a row's words (what it is part of, what it is broken into, its board card) */
  line?: (item: Item, change: (patch: Partial<Item>) => void) => React.ReactNode;
  /** quiet buttons on a row's right, shown on hover (to tie it to a plan) */
  tools?: (item: Item, change: (patch: Partial<Item>) => void) => React.ReactNode;
  /** the steps of a row, drawn smaller inside it */
  nested?: boolean;
  /** what follows a row's text (a task's due date and estimate) */
  meta?: (item: Item, change: (patch: Partial<Item>) => void) => React.ReactNode;
  /** when set, each row has a grip that starts dragging the item (onto the time grid) */
  onGrab?: (item: Item, e: React.PointerEvent) => void;
  /** a short note after an item (how many days a carried task has waited) */
  age?: (item: Item) => string | null;
  items: Item[];
  onChange: (items: Item[]) => void;
  placeholder: string;
  label: string;
  readOnly?: boolean;
}) {
  const T = useT();
  const [draft, setDraft] = useState('');
  // rows whose steps show: those with open steps, unless folded; those just given a first step
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const stepsOpen = (it: Item) => shown[it.id] ?? !!it.steps?.some((x) => !x.done);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const addStep = (it: Item) => {
    setShown((m) => ({ ...m, [it.id]: true }));
    window.setTimeout(() => rowRefs.current.get(it.id)?.querySelector<HTMLInputElement>('.row-steps .adder input')?.focus(), 0);
  };
  const adder = useRef<HTMLInputElement>(null);
  const refs = useRef(new Map<string, HTMLTextAreaElement>());

  // the latest list and handler, so an undo a few seconds later puts the row back into what is there then
  const latest = useRef({ items, onChange });
  latest.current = { items, onChange };
  const set = (id: string, patch: Partial<Item>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const removeWithUndo = (it: Item, at: number) => {
    remove(it.id);
    if (it.text.trim()) offerUndo(T.deleted(it.text), () => latest.current.onChange(insertAt(latest.current.items, at, it)));
  };
  const remove = (id: string) => onChange(items.filter((i) => i.id !== id));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { id: uid(), text, done: false }]);
    setDraft('');
  };

  return (
    <ul className={`checklist${nested ? ' nested' : ''}`} aria-label={label}>
      {items.map((it, idx) => {
        const change = (p: Partial<Item>) => set(it.id, p);
        const lineBits = line?.(it, change);
        const st = it.steps ?? [];
        const sd = st.filter((x) => x.done).length;
        const open = steps && stepsOpen(it);
        return (
        <li key={it.id} ref={(el) => { if (el) rowRefs.current.set(it.id, el); else rowRefs.current.delete(it.id); }}
          className={`check-row${it.done ? ' done' : ''}${onGrab ? ' grabbable' : ''}`}>
          {onGrab && !readOnly && (
            <span className="grip" role="button" tabIndex={-1} aria-label={T.dragTask(it.text || T.untitled)} title={T.dragTask(it.text || T.untitled)}
              onPointerDown={(e) => { e.preventDefault(); onGrab(it, e); }}><IconGrip /></span>
          )}
          <input
            type="checkbox" className="check" checked={it.done} disabled={readOnly}
            aria-label={T.doneLabel(it.text || T.untitled)}
            onChange={(e) => set(it.id, { done: e.target.checked })}
          />
          <div className="row-main">
          <AutoText
            value={it.text} readOnly={readOnly} label={T.itemLabel(label, idx + 1)}
            refFn={(el) => { if (el) refs.current.set(it.id, el); else refs.current.delete(it.id); }}
            onChange={(e) => set(it.id, { text: e.target.value })}
            onBlur={(e) => { if (!e.target.value.trim()) remove(it.id); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); adder.current?.focus(); }
              if (e.key === 'Backspace' && !it.text) {
                e.preventDefault();
                const prev = items[idx - 1];
                remove(it.id);
                if (prev) refs.current.get(prev.id)?.focus(); else adder.current?.focus();
              }
            }}
          />
          {(lineBits || (steps && st.length > 0)) && (
            <div className="row-line">
              {steps && st.length > 0 && (
                <button type="button" className={`link-chip steps${sd === st.length ? ' all' : ''}`} aria-expanded={open}
                  aria-label={T.stepsChip(sd, st.length)} onClick={() => setShown((m) => ({ ...m, [it.id]: !open }))}>
                  <IconSteps /><span className="num">{sd}/{st.length}</span>
                </button>
              )}
              {lineBits}
            </div>
          )}
          {open && (
            <div className="row-steps">
              <Checklist nested label={T.stepsOf(it.text || T.untitled)} items={st} placeholder={T.stepPh} readOnly={readOnly}
                onChange={(next) => change({ steps: next.length ? next : undefined })} />
            </div>
          )}
          </div>
          {age?.(it) && <span className="item-age">{age(it)}</span>}
          {meta && !readOnly && meta(it, change)}
          {!readOnly && (tools || steps) && (
            // quiet buttons that float over the row's end on hover, so they take no room from the words
            <span className="row-tools">
              {tools?.(it, change)}
              {steps && (
                <button type="button" className="btn ghost icon row-tool" aria-label={T.addStepTo(it.text || T.untitled)} title={T.addStepTo(it.text || T.untitled)} onClick={() => addStep(it)}>
                  <IconSteps />
                </button>
              )}
            </span>
          )}
          {!readOnly && (
            <button type="button" className="btn ghost icon remove" aria-label={T.remove(it.text || T.itemWord)} onClick={() => removeWithUndo(it, idx)}>
              <IconX />
            </button>
          )}
        </li>
        );
      })}
      {!readOnly && (
        <li className="check-row adder">
          <span className="plus" aria-hidden="true"><IconPlus /></span>
          <input
            ref={adder} className="text" value={draft} placeholder={placeholder} aria-label={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
        </li>
      )}
    </ul>
  );
}

/** A one-line text field that wraps and grows instead of cutting the words off. */
function AutoText({ value, readOnly, label, refFn, onChange, onBlur, onKeyDown }: {
  value: string;
  readOnly: boolean;
  label: string;
  refFn: (el: HTMLTextAreaElement | null) => void;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onBlur: React.FocusEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const el = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const t = el.current;
    if (!t) return;
    const fit = () => { t.style.height = '0px'; t.style.height = `${t.scrollHeight}px`; };
    fit();
    let w = t.clientWidth;
    // refit when the column changes width, not when the row grows (that would loop)
    const ro = new ResizeObserver(() => { if (t.clientWidth !== w) { w = t.clientWidth; fit(); } });
    ro.observe(t.parentElement!);
    return () => ro.disconnect();
  }, [value]);
  return (
    <textarea
      className="text" rows={1} value={value} readOnly={readOnly} aria-label={label}
      ref={(t) => { el.current = t; refFn(t); }}
      onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown}
    />
  );
}
