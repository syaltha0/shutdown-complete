import { useBlockTask } from './TaskBlockLink';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { clock, duration } from '../lib/dates';
import { useT } from '../lib/i18n';
import type { Block } from '../lib/model';
import { IconX } from './Icons';

function WaitingMark({ block }: { block: Block }) {
  const T = useT();
  const { item } = useBlockTask(block);
  return item?.waiting ? <span className="bp-meta" title={item.waitingNote}>{T.tkWaiting}{item.waitingNote ? ': ' + item.waitingNote : ''}</span> : null;
}

/** The kind of a block as a small mark (deep: filled, small tasks: outlined) with its name for a screen reader. */
function KindMark({ kind }: { kind: Block['kind'] }) {
  const T = useT();
  if (kind !== 'deep' && kind !== 'shallow') return null;
  return <><i className={`bp-kind ${kind}`} aria-hidden="true" /><span className="sr-only"> ({T.kinds[kind].name})</span></>;
}

const range = (b: Block) => `${clock(b.start)}–${clock(b.end)}`;

/**
 * The block the focus belongs to, as a chip on the timer card: its name, its hours, whether it is deep work, and a
 * chevron. Pressing it opens the list (BlockSheet). While a timer runs the chip only shows the block (locked).
 */
export function BlockChip({ block, label, open, locked, onOpen, chipRef }: {
  block: Block | null; label: string; open: boolean; locked: boolean; onOpen: () => void; chipRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const T = useT();
  const body = <>
    <span className="sr-only">{T.blockPick}: </span>
    <span className="bp-name">{label}</span>
    {block && <span className="bp-time num">{range(block)}</span>}
    {block && <KindMark kind={block.kind} />}
  </>;
  if (locked) return <div className="bp-chip is-locked" aria-disabled="true" title={T.blockLocked}>{body}</div>;
  return (
    <button ref={chipRef} type="button" className="bp-chip" aria-haspopup="listbox" aria-expanded={open} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onOpen(); } }}>
      {body}<i className="bp-chevron" aria-hidden="true" />
    </button>
  );
}

type Entry = { key: string; id: string | null; block: Block | null; past: boolean };

/**
 * The list a block chip opens, over the timer card: a search field, then the block running now, the ones still to come
 * with their hours, those already past (muted), and last the unplanned focus. Each shows the minutes already focused on
 * it. Arrow keys move, Enter chooses, Esc closes; the field is the combobox and the list its listbox.
 */
export function BlockSheet({ blocks, value, nowMin, focusedMin, onChoose, onClose }: {
  blocks: Block[]; value: string | null; nowMin: number; focusedMin: (b: Block) => number; onChoose: (id: string | null) => void; onClose: () => void;
}) {
  const T = useT();
  const uid = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLocaleLowerCase(T.locale);
  const groups = useMemo(() => {
    const match = (b: Block) => !q || (b.label || T.untitledBlock).toLocaleLowerCase(T.locale).includes(q);
    const byStart = (x: Block, y: Block) => x.start - y.start || x.end - y.end;
    const entry = (b: Block, past: boolean): Entry => ({ key: b.id, id: b.id, block: b, past });
    const now = blocks.filter((b) => match(b) && b.start <= nowMin && nowMin < b.end).sort(byStart).map((b) => entry(b, false));
    const later = blocks.filter((b) => match(b) && b.start > nowMin).sort(byStart).map((b) => entry(b, false));
    const earlier = blocks.filter((b) => match(b) && b.end <= nowMin).sort((x, y) => byStart(y, x)).map((b) => entry(b, true));
    return [
      // unplanned focus first: it is always there, whatever the search
      { name: 'free', title: '', items: [{ key: 'free', id: null, block: null, past: false } as Entry] },
      { name: 'now', title: T.focusCurrent, items: now },
      { name: 'later', title: T.blockLater, items: later },
      { name: 'earlier', title: T.blockEarlier, items: earlier },
    ].filter((g) => g.items.length);
  }, [blocks, q, nowMin, T]);
  const flat = groups.flatMap((g) => g.items);
  const optionId = (e: Entry) => `${uid}-${e.key}`;
  // opens on the chosen block, so Enter at once keeps it
  useEffect(() => { input.current?.focus(); setActive(Math.max(0, flat.findIndex((e) => e.id === value))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive((i) => Math.min(i, Math.max(0, flat.length - 1))); }, [flat.length]);
  // the list follows the arrow keys; on opening it stays at the top
  const follow = useRef(false);
  useEffect(() => { if (follow.current) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); follow.current = false; }, [active]);
  const move = (to: number) => { follow.current = true; setActive(Math.max(0, Math.min(flat.length - 1, to))); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(flat.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const pick = flat[active]; if (pick) onChoose(pick.id); }
  };
  const noMatch = !!q && !groups.some((g) => g.name !== 'free');
  return (
    <div className="bp-sheet" onKeyDown={onKeyDown} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onClose(); }}>
      <div className="bp-top">
        <h3>{T.blockSheetTitle}</h3>
        <button type="button" className="btn ghost sm bp-close" onClick={onClose}><IconX />{T.close}</button>
      </div>
      <div className="bp-search">
        <svg className="bp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input ref={input} className="input" type="text" role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-autocomplete="list"
          aria-activedescendant={flat[active] ? optionId(flat[active]) : undefined} aria-label={T.blockSearch} placeholder={T.blockSearch}
          autoComplete="off" value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} />
      </div>
      <div className="bp-list" id={`${uid}-list`} role="listbox" aria-label={T.blockPick} ref={list}>
        {groups.map((g) => (
          <div key={g.name} className={`bp-group bp-${g.name}`} role="group" aria-labelledby={g.title ? `${uid}-g-${g.name}` : undefined} aria-label={g.title ? undefined : T.freeFocus}>
            {g.title && <div className="bp-heading" id={`${uid}-g-${g.name}`}>{g.title}</div>}
            {g.items.map((e) => {
              const i = flat.indexOf(e), done = e.block ? focusedMin(e.block) : 0;
              return (
                <div key={e.key} id={optionId(e)} role="option" aria-selected={e.id === value} data-active={i === active} className={`bp-option${e.past ? ' is-past' : ''}${e.id === value ? ' is-chosen' : ''}`}
                  onMouseDown={(ev) => ev.preventDefault()} onMouseMove={() => { if (i !== active) setActive(i); }} onClick={() => onChoose(e.id)}>
                  {e.block ? <span className="bp-when num">{range(e.block)}</span> : <span className="bp-when bp-free-mark" aria-hidden="true" />}
                  <span className="bp-body">
                    <span className="bp-line"><span className="bp-name">{e.block ? e.block.label || T.untitledBlock : T.freeFocus}</span>{e.block && (e.block.kind === 'deep' || e.block.kind === 'shallow') && <span className={`bp-tag ${e.block.kind}`}>{T.kinds[e.block.kind].name}</span>}</span>
                    {e.block ? <>{e.block && <WaitingMark block={e.block} />}{done > 0 && <span className="bp-meta num">{T.blockFocused(duration(done))}</span>}</> : <span className="bp-meta">{T.freeFocusHint}</span>}
                    {g.name === 'now' && e.block && <span className="bp-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, ((nowMin - e.block.start) / Math.max(1, e.block.end - e.block.start)) * 100))}%` }} /></span>}
                  </span>
                  <span className="bp-check" aria-hidden="true">{e.id === value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 5 5 9-10" /></svg>}</span>
                </div>
              );
            })}
          </div>
        ))}
        {noMatch && <p className="muted bp-none" role="status">{T.blockNone}</p>}
      </div>
    </div>
  );
}
