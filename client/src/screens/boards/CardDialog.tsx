// A card opened: its window with labels, dates, stopwatch, description and tasks.
import { useEffect, useRef, useState } from 'react';
import { Checklist } from '../../components/Checklist';
import { IconBoard, IconCopy, IconDue, IconNotes, IconPlus, IconSend, IconStopwatch, IconTag, IconTasks, IconTrash, IconX } from '../../components/Icons';
import { ESTIMATES } from '../../components/TaskMeta';
import { duration, today } from '../../lib/dates';
import { useT } from '../../lib/i18n';
import { emptyDay, emptyInbox, uid, type Board, type Card, type DayDoc, type InboxDoc, type LabelColor } from '../../lib/model';
import { insertAt } from '../../lib/undo';
import { updateKey } from '../../lib/useDoc';
import { COLORS, daysTo, watchSecs, watchText } from '../../lib/boards';
import { Pop, useTick } from './shared';
import { taskOfCard } from '../../lib/links';

/** Picking a card's labels, and making a new one in a colour. */
function LabelPicker({ board, c, setBoard, toggle }: { board: Board; c: Card; setBoard: (fn: (b: Board) => Board) => void; toggle: (id: string, on?: boolean) => void }) {
  const T = useT();
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>(COLORS[board.labels.length % COLORS.length]);
  return (
    <div className="kb-labelpick">
      <div className="kb-label-opts">
        {board.labels.map((l) => (
          <button key={l.id} type="button" className={`kb-label-opt lb-${l.color}`} aria-pressed={c.labels.includes(l.id)} onClick={() => toggle(l.id)}>
            <span>{l.name}</span>{c.labels.includes(l.id) && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>}
          </button>
        ))}
      </div>
      <span className="kb-pop-label">{T.kbCreateLabel}</span>
      <div className="kb-newlabel">
        <input className="input" aria-label={T.kbNewLabel} placeholder={T.kbNewLabel} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !name.trim()) return;
            e.preventDefault();
            const lb = { id: uid(), name: name.trim(), color };
            setBoard((b) => ({ ...b, labels: [...b.labels, lb] }));
            toggle(lb.id, true);
            setName('');
          }} />
        <div className="kb-swatches" role="radiogroup" aria-label={T.kbLabelColor}>
          {COLORS.map((k) => <button key={k} type="button" role="radio" aria-checked={color === k} aria-label={T.kbColors[k]} className={`kb-swatch lb-${k}`} onClick={() => setColor(k)} />)}
        </div>
      </div>
    </div>
  );
}

/**
 * A card opened, Planka's card window: the title and its list on top; then on the left what is set (labels, due date,
 * estimate, stopwatch), the notes and the tasks with how far along they are; on the right "Add to card" and "Actions".
 */
export function CardDialog({ board, entry, onClose, setBoard, onRemove, project }: {
  /** the project the board is in ('p:<id>' or 't:<id>'), so a task made from a card stays tied to it */
  project: string;
  board: Board; entry: { c: Card; l: Board['lists'][number] } | null; onClose: () => void; setBoard: (fn: (b: Board) => Board) => void; onRemove: (c: Card) => void;
}) {
  const T = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [pop, setPop] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const tasksRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (entry && !d.open) { d.showModal(); d.querySelector<HTMLElement>('.kc')?.focus(); setSent(null); setExtra([]); setPop(null); setDesc(null); }
    if (!entry && d.open) d.close();
  }, [entry?.c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = entry?.c;
  useTick(!!c?.stopwatch?.startedAt);
  const set = (p: Partial<Card>) => c && setBoard((b) => ({ ...b, lists: b.lists.map((l) => ({ ...l, cards: l.cards.map((x) => (x.id === c.id ? { ...x, ...p } : x)) })) }));
  const toggleLabel = (lid: string, on?: boolean) => c && setBoard((b) => ({
    ...b, lists: b.lists.map((l) => ({ ...l, cards: l.cards.map((x) => (x.id !== c.id ? x : { ...x, labels: (on ?? !x.labels.includes(lid)) ? [...x.labels.filter((y) => y !== lid), lid] : x.labels.filter((y) => y !== lid) })) })),
  }));
  const show = (k: string, focus?: string) => {
    setExtra((x) => (x.includes(k) ? x : [...x, k]));
    if (focus) window.setTimeout(() => (document.getElementById(focus) as HTMLElement | null)?.focus(), 30);
  };
  async function toToday() {
    if (!c) return;
    const id = uid(), day = today();
    await updateKey<DayDoc>(`day:${day}`, emptyDay, (d) => ({ ...d, tasks: [...d.tasks, { id, text: c.title, done: false, due: c.due, estimate: c.estimate, card: { project, board: board.id, card: c.id } }] }));
    set({ planned: { day, task: id } });
    setSent(T.kbSentToday);
  }
  async function toInbox() {
    if (!c) return;
    await updateKey<InboxDoc>('inbox', emptyInbox, (b) => ({ ...b, items: [...b.items, { id: uid(), text: c.title, done: false, due: c.due, estimate: c.estimate, card: { project, board: board.id, card: c.id } }] }));
    setSent(T.kbSentInbox);
  }
  function duplicate() {
    if (!c || !entry) return;
    const copy: Card = { ...c, id: uid(), title: T.kbCopyOf(c.title), checklist: c.checklist.map((x) => ({ ...x, id: uid() })), created: today(), stopwatch: undefined };
    setBoard((b) => ({ ...b, lists: b.lists.map((l) => (l.id !== entry.l.id ? l : { ...l, cards: insertAt(l.cards, l.cards.findIndex((x) => x.id === c.id) + 1, copy) })) }));
    setSent(T.kbDuplicated);
  }
  function toggleWatch() {
    if (!c) return;
    const s = c.stopwatch;
    set({ stopwatch: s?.startedAt ? { total: watchSecs(s) } : { total: s?.total ?? 0, startedAt: Date.now() } });
  }
  const secs = watchSecs(c?.stopwatch);
  const done = c ? c.checklist.filter((x) => x.done).length : 0;
  const pct = c && c.checklist.length ? Math.round((done / c.checklist.length) * 100) : 0;
  const has = (k: string) => extra.includes(k);
  return (
    <dialog ref={ref} className="sheet kb-sheet kb-card-sheet" onClose={onClose} aria-labelledby="kc-title"
      onCancel={(e) => { if (pop || desc != null) { e.preventDefault(); setPop(null); } }}>
      {c && entry && <div className="kc" tabIndex={-1}>
        <header className="kc-head">
          <span className="kc-icon" aria-hidden="true"><IconBoard /></span>
          <div className="kc-headtext">
            <textarea id="kc-title" className="kb-card-title" rows={1} aria-label={T.kbCardTitle} value={c.title}
              onChange={(e) => set({ title: e.target.value.replace(/\n/g, ' ') })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
            <p className="muted kb-in">
              {T.kbInList}{' '}
              <select className="input kb-move" aria-label={T.kbMoveTo} value={entry.l.id} onChange={(e) => {
                const to = e.target.value, card = c;
                const last = board.lists[board.lists.length - 1]?.id;
                if (card.planned && (to === last) !== (entry.l.id === last)) taskOfCard(card.planned, to === last).catch(() => {});
                setBoard((b) => ({ ...b, lists: b.lists.map((l) => (l.id === to ? { ...l, cards: [...l.cards.filter((x) => x.id !== card.id), card] } : { ...l, cards: l.cards.filter((x) => x.id !== card.id) })) }));
              }}>{board.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </p>
          </div>
          <button type="button" className="btn ghost icon" aria-label={T.close} onClick={onClose}><IconX /></button>
        </header>

        <div className="kc-body">
          <div className="kc-main">
            {(c.labels.length > 0 || c.due || has('due') || c.estimate || has('estimate') || c.stopwatch || has('watch')) && (
              <div className="kc-attrs">
                {c.labels.length > 0 && (
                  <div className="kc-attr">
                    <span className="kc-attr-h">{T.kbLabels}</span>
                    <div className="kb-labels kc-labels">
                      {c.labels.map((lid) => { const lb = board.labels.find((x) => x.id === lid); return lb ? <i key={lid} className={`lbl lb-${lb.color}`}>{lb.name}</i> : null; })}
                      <span className="kb-pop-wrap">
                        <button type="button" className="kc-attr-add" aria-label={T.kbLabels} onClick={() => setPop(pop === 'labels-a' ? null : 'labels-a')}><IconPlus /></button>
                        <Pop open={pop === 'labels-a'} onClose={() => setPop(null)} title={T.kbLabels}><LabelPicker board={board} c={c} setBoard={setBoard} toggle={toggleLabel} /></Pop>
                      </span>
                    </div>
                  </div>
                )}
                {(c.due || has('due')) && (
                  <div className="kc-attr">
                    <label className="kc-attr-h" htmlFor="kc-due">{T.kbDueDate}</label>
                    <input id="kc-due" type="date" className={`input num kc-due${c.due && daysTo(c.due) < 0 ? ' late' : ''}`} value={c.due ?? ''} onChange={(e) => set({ due: e.target.value || undefined })} />
                  </div>
                )}
                {(c.estimate || has('estimate')) && (
                  <div className="kc-attr">
                    <label className="kc-attr-h" htmlFor="kc-est">{T.kbEstimate}</label>
                    <select id="kc-est" className="input num" value={c.estimate ?? ''} onChange={(e) => set({ estimate: e.target.value ? Number(e.target.value) : undefined })}>
                      <option value="">{T.estimateNone}</option>
                      {ESTIMATES.map((m) => <option key={m} value={m}>{duration(m)}</option>)}
                    </select>
                  </div>
                )}
                {(c.stopwatch || has('watch')) && (
                  <div className="kc-attr">
                    <span className="kc-attr-h">{T.kbStopwatch}</span>
                    <span className="kc-watch">
                      <button type="button" className={`btn sm kc-watch-btn${c.stopwatch?.startedAt ? ' on' : ''}`} onClick={toggleWatch}>
                        <IconStopwatch /><span className="num">{watchText(secs)}</span>
                      </button>
                      <button type="button" className="btn ghost sm" onClick={toggleWatch}>{c.stopwatch?.startedAt ? T.kbSwStop : T.kbSwStart}</button>
                      {secs > 0 && !c.stopwatch?.startedAt && <button type="button" className="btn ghost icon" aria-label={T.kbSwReset} onClick={() => set({ stopwatch: undefined })}><IconX /></button>}
                    </span>
                  </div>
                )}
              </div>
            )}

            <section className="kc-sec" aria-labelledby="kc-desc-h">
              <div className="kc-sec-h">
                <IconNotes /><h3 id="kc-desc-h">{T.kbDescription}</h3>
                {desc == null && c.description && <button type="button" className="btn ghost sm" onClick={() => setDesc(c.description)}>{T.kbEdit}</button>}
              </div>
              {desc != null ? (
                <div className="kc-desc-edit">
                  <textarea id="kc-desc" className="input" rows={6} autoFocus value={desc} placeholder={T.kbDescriptionPh} aria-label={T.kbDescription}
                    onChange={(e) => setDesc(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); set({ description: desc }); setDesc(null); }
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDesc(null); }
                    }} />
                  <div className="kb-quick-row">
                    <button type="button" className="btn primary sm" onClick={() => { set({ description: desc }); setDesc(null); }}>{T.kbSave}</button>
                    <button type="button" className="btn ghost sm" onClick={() => setDesc(null)}>{T.cancel}</button>
                  </div>
                </div>
              ) : c.description ? (
                <div className="kc-desc" onClick={() => setDesc(c.description)}>{c.description}</div>
              ) : (
                <button type="button" className="kc-desc-empty" onClick={() => setDesc('')}>{T.kbDescEmpty}</button>
              )}
            </section>

            <section className="kc-sec" aria-labelledby="kc-tasks-h" ref={tasksRef}>
              <div className="kc-sec-h"><IconTasks /><h3 id="kc-tasks-h">{T.kbTasks}</h3></div>
              {c.checklist.length > 0 && (
                <div className="kc-progress num" aria-label={T.kbChecklistDone(done, c.checklist.length)}>
                  <span>{pct}%</span><span className="bar"><i style={{ transform: `scaleX(${pct / 100})` }} className={pct === 100 ? 'all' : undefined} /></span>
                </div>
              )}
              <Checklist label={T.kbTasks} items={c.checklist} placeholder={T.kbChecklistPh} onChange={(checklist) => set({ checklist })} />
            </section>
          </div>

          <aside className="kc-side">
            <span className="kc-side-h">{T.kbAddToCard}</span>
            <span className="kb-pop-wrap">
              <button type="button" className="kc-side-btn" aria-expanded={pop === 'labels'} onClick={() => setPop(pop === 'labels' ? null : 'labels')}><IconTag />{T.kbLabels}</button>
              <Pop open={pop === 'labels'} onClose={() => setPop(null)} title={T.kbLabels} className="kc-side-pop"><LabelPicker board={board} c={c} setBoard={setBoard} toggle={toggleLabel} /></Pop>
            </span>
            <button type="button" className="kc-side-btn" onClick={() => show('due', 'kc-due')}><IconDue />{T.kbDueDate}</button>
            <button type="button" className="kc-side-btn" onClick={() => show('estimate', 'kc-est')}><span className="kb-arrow" aria-hidden="true">≈</span>{T.kbEstimate}</button>
            <button type="button" className="kc-side-btn" onClick={() => { if (!c.stopwatch) set({ stopwatch: { total: 0 } }); show('watch'); }}><IconStopwatch />{T.kbStopwatch}</button>
            <button type="button" className="kc-side-btn" onClick={() => tasksRef.current?.querySelector<HTMLInputElement>('.adder input, input')?.focus()}><IconTasks />{T.kbTasks}</button>
            <span className="kc-side-h">{T.kbActions}</span>
            <button type="button" className="kc-side-btn" onClick={toToday}><IconSend />{T.kbToToday}</button>
            <button type="button" className="kc-side-btn" onClick={toInbox}><IconSend />{T.kbToInbox}</button>
            <button type="button" className="kc-side-btn" onClick={duplicate}><IconCopy />{T.kbDuplicate}</button>
            <button type="button" className="kc-side-btn danger" onClick={() => { onRemove(c); onClose(); }}><IconTrash />{T.kbDeleteCard}</button>
            {sent && <span className="ok-line" role="status">{sent}</span>}
          </aside>
        </div>
      </div>}
    </dialog>
  );
}
