// One board: its lists and cards, dragged, filtered and edited in place.
import { useRef, useState } from 'react';
import { DocNotice, SaveStamp } from '../../components/Common';
import { IconCopy, IconDue, IconMore, IconNotes, IconPencil, IconPlus, IconSearch, IconStopwatch, IconTasks, IconTrash, IconX, IconDay } from '../../components/Icons';
import { dueWords } from '../../components/TaskMeta';
import { duration, today, shortDate } from '../../lib/dates';
import { useT } from '../../lib/i18n';
import { uid, type Board, type Card } from '../../lib/model';
import { lockSwipe } from '../../lib/swipe';
import { insertAt, offerUndo } from '../../lib/undo';
import { daysTo, watchSecs, watchText } from '../../lib/boards';
import { Pop, useBoardTemplates, useTick } from './shared';
import { taskOfCard } from '../../lib/links';
import { TemplateDialog } from './NewBoard';
import { CardDialog } from './CardDialog';

type Over = { list: string; index: number } | null;

/**
 * One board, laid out as Planka does it: a bar with the board's name and the filter (labels, text), then the lists side
 * by side on the project's background, each with its cards and an "Add card" at its foot, and a last column to add a
 * list. Cards and lists are dragged (the mouse at once, a finger after holding for a moment); a card opens with a
 * click, and its pencil edits the title in place.
 */
export function BoardView({ board, setBoard, onDelete, card, status, error, retry, project }: {
  project: string;
  board: Board; setBoard: (fn: (b: Board) => Board) => void; onDelete: () => void; card?: string;
  status: Parameters<typeof SaveStamp>[0]['status']; error: string | null; retry: () => void;
}) {
  const T = useT();
  const [open, setOpen] = useState<string | null>(card ?? null);
  const [filter, setFilter] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [composer, setComposer] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [addingList, setAddingList] = useState(false);
  const [listDraft, setListDraft] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ id: string; text: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ card: Card; from: string; x: number; y: number; over: Over } | null>(null);
  const [listDrag, setListDrag] = useState<{ id: string; name: string; x: number; y: number; to: number } | null>(null);
  const [tplFrom, setTplFrom] = useState<Board | null>(null);
  const tpl = useBoardTemplates();
  const swallowClick = useRef(false); // a drag ends with a click on what was dragged; that click does nothing
  const lane = useRef<HTMLDivElement>(null);
  useTick(board.lists.some((l) => l.cards.some((c) => c.stopwatch?.startedAt)));

  const q = query.trim().toLocaleLowerCase();
  const visible = (c: Card) => (!filter.length || filter.some((l) => c.labels.includes(l)))
    && (!q || c.title.toLocaleLowerCase().includes(q) || c.description.toLocaleLowerCase().includes(q));
  const filtering = filter.length > 0 || !!q;
  const setList = (listId: string, fn: (l: Board['lists'][number]) => Board['lists'][number]) => setBoard((b) => ({ ...b, lists: b.lists.map((l) => (l.id === listId ? fn(l) : l)) }));
  const setCard = (cardId: string, p: Partial<Card>) => setBoard((b) => ({ ...b, lists: b.lists.map((l) => ({ ...l, cards: l.cards.map((x) => (x.id === cardId ? { ...x, ...p } : x)) })) }));

  function addCard(listId: string) {
    const title = draft.trim();
    if (!title) return;
    setList(listId, (l) => ({ ...l, cards: [...l.cards, { id: uid(), title, description: '', labels: [], checklist: [], created: today() }] }));
    setDraft('');
    setComposer(null);
  }
  function addList() {
    const name = listDraft.trim();
    if (!name) return;
    setBoard((b) => ({ ...b, lists: [...b.lists, { id: uid(), name, cards: [] }] }));
    setListDraft('');
    window.setTimeout(() => lane.current?.scrollTo({ left: lane.current.scrollWidth, behavior: 'smooth' }), 50);
  }
  const moveList = (i: number, to: number) => setBoard((b) => {
    if (to < 0 || to >= b.lists.length || to === i) return b;
    const lists = [...b.lists];
    const [l] = lists.splice(i, 1);
    lists.splice(to, 0, l);
    return { ...b, lists };
  });
  const removeList = (listId: string) => {
    const at = board.lists.findIndex((l) => l.id === listId), l = board.lists[at];
    setBoard((b) => ({ ...b, lists: b.lists.filter((x) => x.id !== listId) }));
    offerUndo(T.deleted(l.name), () => setBoard((b) => ({ ...b, lists: insertAt(b.lists, at, l) })));
  };
  const removeCard = (c: Card) => {
    const l = board.lists.find((x) => x.cards.some((y) => y.id === c.id));
    if (!l) return;
    const at = l.cards.findIndex((x) => x.id === c.id);
    setBoard((b) => ({ ...b, lists: b.lists.map((x) => ({ ...x, cards: x.cards.filter((y) => y.id !== c.id) })) }));
    offerUndo(T.deleted(c.title), () => setList(l.id, (x) => ({ ...x, cards: insertAt(x.cards, at, c) })));
  };
  function drop(c: Card, over: Over) {
    if (!over) return;
    // a card tied to a day's task: into the last list ticks the task, out of it unticks it
    const last = board.lists[board.lists.length - 1]?.id;
    const from = board.lists.find((l) => l.cards.some((x) => x.id === c.id))?.id;
    if (c.planned && (over.list === last) !== (from === last)) taskOfCard(c.planned, over.list === last).catch(() => {});
    setBoard((b) => {
      const lists = b.lists.map((l) => ({ ...l, cards: l.cards.filter((x) => x.id !== c.id) }));
      return { ...b, lists: lists.map((l) => (l.id === over.list ? { ...l, cards: insertAt(l.cards, over.index, c) } : l)) };
    });
  }

  // the list lane scrolls sideways by itself while something is held near its edges
  function edgeScroll(x: number) {
    const el = lane.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (x < r.left + 60) el.scrollLeft -= 18;
    else if (x > r.right - 60) el.scrollLeft += 18;
  }
  // where the pointer is: the list under it, and the card slot by the cards' middles (the dragged one left out)
  function overAt(x: number, y: number, cardId: string): Over {
    const el = document.elementsFromPoint(x, y).find((e) => e instanceof HTMLElement && e.dataset.list) as HTMLElement | undefined;
    if (!el) return null;
    const cards = [...el.querySelectorAll<HTMLElement>('[data-card]')].filter((c) => c.dataset.card !== cardId);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { index = i; break; } }
    // the index in the full list (filtered-out cards keep their places)
    const list = board!.lists.find((l) => l.id === el.dataset.list)!;
    const ids = list.cards.filter((c) => c.id !== cardId).map((c) => c.id);
    const before = cards[index]?.dataset.card;
    return { list: list.id, index: before ? ids.indexOf(before) : ids.length };
  }
  // the list slot by the lists' middles (the dragged one left out)
  function listSlot(x: number, listId: string) {
    const els = [...(lane.current?.querySelectorAll<HTMLElement>('[data-list]') ?? [])].filter((e) => e.dataset.list !== listId);
    const i = els.findIndex((e) => { const r = e.getBoundingClientRect(); return x < r.left + r.width / 2; });
    return i < 0 ? els.length : i;
  }
  /** Holding and moving: a card (to a slot in any list) or a list (to a place in the row). */
  function hold(e: React.PointerEvent, start: () => void, step: (x: number, y: number) => void, finish: (commit: boolean) => void) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const x0 = e.clientX, y0 = e.clientY, touch = e.pointerType === 'touch';
    let on = false;
    const begin = () => { on = true; lockSwipe(true); try { navigator.vibrate?.(10); } catch { /* not here */ } start(); };
    const timer = touch ? window.setTimeout(begin, 320) : 0;
    const move = (ev: PointerEvent | TouchEvent) => {
      const p = 'touches' in ev ? ev.touches[0] : ev;
      if (!p) return;
      if (!on) {
        if (Math.hypot(p.clientX - x0, p.clientY - y0) > 6) { if (touch) end(false); else begin(); }
        if (!on) return;
      }
      if ('touches' in ev) ev.preventDefault();
      edgeScroll(p.clientX);
      step(p.clientX, p.clientY);
    };
    const end = (commit: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      if (on) {
        window.setTimeout(() => lockSwipe(false), 0);
        swallowClick.current = true;
        window.setTimeout(() => { swallowClick.current = false; }, 60); // the click that ends a drag comes at once, if at all
        finish(commit);
      }
    };
    const up = () => end(true);
    if (touch) { window.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', up); }
    else { window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); }
  }
  function grabCard(e: React.PointerEvent, c: Card, from: string) {
    let last: Over = null;
    hold(e, () => setDrag({ card: c, from, x: e.clientX, y: e.clientY, over: null }), (x, y) => {
      last = overAt(x, y, c.id);
      setDrag({ card: c, from, x, y, over: last });
    }, (commit) => { setDrag(null); if (commit) drop(c, last); });
  }
  function grabList(e: React.PointerEvent, listId: string, name: string) {
    if ((e.target as HTMLElement).closest('button, input, textarea, .kb-pop')) return;
    const from = board!.lists.findIndex((l) => l.id === listId);
    let to = from;
    hold(e, () => setListDrag({ id: listId, name, x: e.clientX, y: e.clientY, to: from }), (x, y) => {
      to = listSlot(x, listId);
      setListDrag({ id: listId, name, x, y, to });
    }, (commit) => { setListDrag(null); if (commit) moveList(from, to); });
  }
  const tapped = () => { if (swallowClick.current) { swallowClick.current = false; return false; } return true; };

  const others = board.lists.filter((l) => l.id !== listDrag?.id);
  const openCard = board.lists.flatMap((l) => l.cards.map((c) => ({ c, l }))).find((x) => x.c.id === open) ?? null;
  const shown = board.lists.reduce((n, l) => n + l.cards.filter(visible).length, 0), all = board.lists.reduce((n, l) => n + l.cards.length, 0);

  return (
    <>
      <div className="kb-bar">
        <div className="kb-filterbar">
          <span className="kb-bar-label">{T.kbFilterLabel}</span>
          <div className="kb-filter" role="group" aria-label={T.kbFilter}>
            {board.labels.map((l) => (
              <button key={l.id} type="button" className={`lbl lb-${l.color}`} aria-pressed={filter.includes(l.id)}
                onClick={() => setFilter((f) => (f.includes(l.id) ? f.filter((x) => x !== l.id) : [...f, l.id]))}>{l.name}</button>
            ))}
          </div>
          <label className="kb-search">
            <IconSearch />
            <span className="sr-only">{T.kbSearch}</span>
            <input className="input" type="search" placeholder={T.kbSearch} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {filtering && <span className="kb-bar-note num">{T.kbShown(shown, all)} <button type="button" className="linkish" onClick={() => { setFilter([]); setQuery(''); }}>{T.kbClear}</button></span>}
        </div>
        <div className="kb-bar-end">
          <SaveStamp status={status} />
          <div className="kb-pop-wrap">
            <button type="button" className="btn kb-bar-btn" aria-expanded={menu === 'board'} onClick={() => setMenu(menu === 'board' ? null : 'board')}><IconMore /><span>{T.kbMenu}</span></button>
            <Pop open={menu === 'board'} onClose={() => setMenu(null)} title={T.kbBoardActions} align="right">
              <label className="kb-pop-label" htmlFor="kb-board-name">{T.kbName}</label>
              <input id="kb-board-name" className="input kb-board-name" value={board.name} onChange={(e) => setBoard((b) => ({ ...b, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') setMenu(null); }} />
              <div className="kb-menu">
                <button type="button" onClick={() => { setMenu(null); setTplFrom(board); }}><IconCopy />{T.kbTplFromBoard}</button>
                <button type="button" className="danger" onClick={() => { setMenu(null); onDelete(); }}><IconTrash />{T.kbDeleteBoard}</button>
              </div>
            </Pop>
          </div>
        </div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />

      <div className="kanban" ref={lane} data-noswipe>
        {board.lists.map((l, li) => {
          const cardsShown = l.cards.filter(visible);
          const marker = listDrag && listDrag.id !== l.id && others.indexOf(l) === listDrag.to;
          return (
            <div key={l.id} className="kb-col">
              {marker && <div className="kb-list-drop" aria-hidden="true" />}
              <section className={`kb-list${drag?.over?.list === l.id ? ' over' : ''}${listDrag?.id === l.id ? ' lifted' : ''}`} data-list={l.id} aria-label={l.name}>
                <header onPointerDown={(e) => grabList(e, l.id, l.name)}>
                  {naming === l.id ? (
                    <input className="kb-list-name" autoFocus aria-label={T.kbListName} defaultValue={l.name}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v) setList(l.id, (x) => ({ ...x, name: v })); setNaming(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNaming(null); }} />
                  ) : (
                    <h2 className="kb-list-title" onClick={() => { if (tapped()) setNaming(l.id); }}>{l.name}</h2>
                  )}
                  <span className="kb-count num" aria-label={T.kbCardsN(l.cards.length)}>{filtering ? `${cardsShown.length}/${l.cards.length}` : l.cards.length}</span>
                  <div className="kb-pop-wrap">
                    <button type="button" className="btn ghost icon kb-list-more" aria-label={T.kbListMenu(l.name)} aria-expanded={menu === l.id} onClick={() => setMenu(menu === l.id ? null : l.id)}><IconMore /></button>
                    <Pop open={menu === l.id} onClose={() => setMenu(null)} title={T.kbListActions} align="right">
                      <div className="kb-menu">
                        <button type="button" onClick={() => { setMenu(null); setComposer(l.id); setDraft(''); }}><IconPlus />{T.kbAddCardBtn}</button>
                        <button type="button" onClick={() => { setMenu(null); setNaming(l.id); }}><IconPencil />{T.kbRename}</button>
                        <button type="button" disabled={li === 0} onClick={() => { setMenu(null); moveList(li, li - 1); }}><span className="kb-arrow">←</span>{T.kbMoveL}</button>
                        <button type="button" disabled={li === board.lists.length - 1} onClick={() => { setMenu(null); moveList(li, li + 1); }}><span className="kb-arrow">→</span>{T.kbMoveR}</button>
                        <button type="button" className="danger" onClick={() => { setMenu(null); removeList(l.id); }}><IconTrash />{T.kbDeleteList}</button>
                      </div>
                    </Pop>
                  </div>
                </header>
                <div className="kb-cards">
                  {l.cards.map((c) => {
                    if (!visible(c)) return null;
                    const showDrop = drag?.over?.list === l.id && drag.over.index === l.cards.filter((x) => x.id !== drag.card.id).findIndex((x) => x.id === c.id);
                    return (
                      <div key={c.id} className="kb-card-wrap">
                        {showDrop && <div className="kb-drop" aria-hidden="true" />}
                        {quick?.id === c.id ? (
                          <form className="kb-quick" onSubmit={(e) => { e.preventDefault(); if (quick.text.trim()) setCard(c.id, { title: quick.text.trim() }); setQuick(null); }}>
                            <textarea className="input" autoFocus rows={3} aria-label={T.kbCardTitle} value={quick.text}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setQuick({ id: c.id, text: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); }
                                if (e.key === 'Escape') setQuick(null);
                              }} />
                            <div className="kb-quick-row">
                              <button type="submit" className="btn primary sm">{T.kbSave}</button>
                              <button type="button" className="btn ghost sm" onClick={() => { setQuick(null); setOpen(c.id); }}>{T.kbOpenCard}</button>
                              <button type="button" className="btn ghost icon" aria-label={T.kbDeleteCard} onClick={() => { setQuick(null); removeCard(c); }}><IconTrash /></button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <button type="button" data-card={c.id} className={`kb-card${drag?.card.id === c.id ? ' lifted' : ''}`}
                              onPointerDown={(e) => grabCard(e, c, l.id)}
                              onClick={() => { if (tapped()) setOpen(c.id); }}>
                              <CardFace board={board} c={c} />
                            </button>
                            <button type="button" className="kb-card-edit" aria-label={T.kbEditCard(c.title)} onClick={() => setQuick({ id: c.id, text: c.title })}><IconPencil /></button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {drag?.over?.list === l.id && drag.over.index >= l.cards.filter((x) => x.id !== drag.card.id).length && <div className="kb-drop" aria-hidden="true" />}
                </div>
                {composer === l.id ? (
                  <form className="kb-composer" onSubmit={(e) => { e.preventDefault(); addCard(l.id); }}>
                    <label className="sr-only" htmlFor={`kb-add-${l.id}`}>{T.kbAddCard}</label>
                    <textarea id={`kb-add-${l.id}`} className="input" rows={2} autoFocus placeholder={T.kbCardPh} value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => { if (!draft.trim()) setComposer(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCard(l.id); }
                        if (e.key === 'Escape') { setComposer(null); setDraft(''); }
                      }} />
                    <div className="kb-quick-row">
                      <button type="submit" className="btn primary sm" disabled={!draft.trim()}>{T.kbAddCardBtn}</button>
                      <button type="button" className="btn ghost icon" aria-label={T.cancel} onMouseDown={(e) => e.preventDefault()} onClick={() => { setComposer(null); setDraft(''); }}><IconX /></button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="kb-add-card" onClick={() => { setComposer(l.id); setDraft(''); }}><IconPlus />{T.kbAddCardBtn}</button>
                )}
              </section>
            </div>
          );
        })}
        {listDrag && listDrag.to >= others.length && <div className="kb-list-drop" aria-hidden="true" />}
        <div className="kb-col">
          {addingList ? (
            <form className="kb-list kb-add-list-form" onSubmit={(e) => { e.preventDefault(); addList(); }}>
              <input className="input" autoFocus aria-label={T.kbListName} placeholder={T.kbListPh} value={listDraft}
                onChange={(e) => setListDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setAddingList(false); setListDraft(''); } }}
                onBlur={() => { if (!listDraft.trim()) setAddingList(false); }} />
              <div className="kb-quick-row">
                <button type="submit" className="btn primary sm" disabled={!listDraft.trim()}>{T.kbAddListBtn}</button>
                <button type="button" className="btn ghost icon" aria-label={T.cancel} onMouseDown={(e) => e.preventDefault()} onClick={() => { setAddingList(false); setListDraft(''); }}><IconX /></button>
              </div>
            </form>
          ) : (
            <button type="button" className="kb-add-list" onClick={() => setAddingList(true)}><IconPlus />{board.lists.length ? T.kbAddAnotherList : T.kbAddList}</button>
          )}
        </div>
      </div>

      {drag && <div className="drag-chip kb-chip" style={{ transform: `translate(${drag.x + 10}px, ${drag.y + 8}px)` }} aria-hidden="true">{drag.card.title}</div>}
      {listDrag && <div className="drag-chip kb-chip" style={{ transform: `translate(${listDrag.x + 10}px, ${listDrag.y + 8}px)` }} aria-hidden="true">{listDrag.name}</div>}
      <CardDialog project={project} board={board} entry={openCard} onClose={() => setOpen(null)} setBoard={setBoard} onRemove={removeCard} />
      <TemplateDialog value={tplFrom ? { board: tplFrom } : null} onClose={() => setTplFrom(null)}
        onSaved={(id) => { const n = tplFrom?.name ?? ''; setTplFrom(null); offerUndo(T.kbTplSaved(n), () => tpl.remove(id)); }} />
    </>
  );
}

/** A card on the board: its labels, title and badges (due, estimate, stopwatch, tasks, notes). */
function CardFace({ board, c }: { board: Board; c: Card }) {
  const T = useT();
  const done = c.checklist.filter((x) => x.done).length;
  const secs = watchSecs(c.stopwatch);
  return (
    <>
      {c.labels.length > 0 && <span className="kb-labels">{c.labels.map((lid) => { const lb = board.labels.find((x) => x.id === lid); return lb ? <i key={lid} className={`lbl lb-${lb.color}`}>{lb.name}</i> : null; })}</span>}
      <span className="kb-title">{c.title}</span>
      {(c.due || c.estimate || c.checklist.length > 0 || c.description || c.stopwatch || c.planned) && (
        <span className="kb-meta num">
          {c.planned && <span className="planned" title={T.kbPlannedOn(shortDate(c.planned.day))}><IconDay />{c.planned.day === today() ? T.todayBtn : shortDate(c.planned.day)}</span>}
          {c.due && <span className={`due${daysTo(c.due) < 0 ? ' late' : daysTo(c.due) === 0 ? ' today' : ''}`}><IconDue />{dueWords(T, c.due)}</span>}
          {c.stopwatch && (secs > 0 || c.stopwatch.startedAt) && <span className={`watch${c.stopwatch.startedAt ? ' on' : ''}`}><IconStopwatch />{watchText(secs)}</span>}
          {c.estimate && <span>{duration(c.estimate)}</span>}
          {c.checklist.length > 0 && (
            <span className={done === c.checklist.length ? 'all' : undefined} aria-label={T.kbChecklistDone(done, c.checklist.length)}><IconTasks />{done}/{c.checklist.length}</span>
          )}
          {c.description && <span aria-label={T.kbHasNote}><IconNotes /></span>}
        </span>
      )}
    </>
  );
}
