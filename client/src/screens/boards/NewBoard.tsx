// Making a board: the form, the sketch of what it makes, board templates of one's own.
import { useEffect, useRef, useState } from 'react';
import { IconBoard, IconPlus, IconX } from '../../components/Icons';
import { today } from '../../lib/dates';
import { useT } from '../../lib/i18n';
import { uid, type Board, type LabelColor, type BoardTemplate, type TemplateCard } from '../../lib/model';
import { insertAt } from '../../lib/undo';
import { COLORS, Kind, TEMPLATES, TT, Template, customOf, makeBoard } from '../../lib/boards';
import { useBoardTemplates } from './shared';

const SKETCH_CARDS = [3, 2, 2, 1, 1];
const SKETCH_WIDTHS = ['86%', '64%', '74%'];

/** What the sketch draws for a choice: each list's name, and its cards' titles when a template of one's own has them. */
type SketchList = { name: string; cards: string[] | null };
function sketchOf(kind: Kind, T: TT, customs: BoardTemplate[]): SketchList[] {
  const c = customOf(kind, customs);
  const any = c?.lists.some((l) => l.cards?.length);
  if (c) return c.lists.map((l) => ({ name: l.name, cards: any ? (l.cards ?? []).map((x) => x.title) : null }));
  return (T.kbTemplates[kind as Template]?.lists ?? []).map((n: string) => ({ name: n, cards: null }));
}

/**
 * A new board: its name and the lists it starts with (the planner's sets and the account's own templates), next to a
 * sketch of the board it will make (the project's background, the board's tab with the name as it is typed, the
 * lists with ghost cards or a template's own cards), redrawn as the choice changes. A template of one's own can be
 * made from here too.
 */
export function NewBoardForm({ onCreate, autoFocus, page = false, team = false, onCancel }: {
  onCreate: (board: Board) => void; autoFocus?: boolean; page?: boolean; team?: boolean; onCancel?: () => void;
}) {
  const T = useT();
  const { templates } = useBoardTemplates();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('flow');
  const [tried, setTried] = useState(false);
  const [making, setMaking] = useState<{ edit?: BoardTemplate } | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const kinds: Kind[] = [...TEMPLATES, ...templates.map((t) => `custom:${t.id}` as Kind)];
  const current = kinds.includes(kind) ? kind : 'flow';
  const pick = (k: Kind, focus = false) => {
    setKind(k);
    if (focus) window.setTimeout(() => group.current?.querySelector<HTMLElement>(`[data-k="${k}"]`)?.focus(), 0);
  };
  const option = (k: Kind, title: string, lists: string, extra?: string) => (
    <button key={k} type="button" role="radio" data-k={k} aria-checked={current === k} tabIndex={current === k ? 0 : -1} className="kb-template" onClick={() => pick(k)}>
      <span className="kb-tpl-dot" aria-hidden="true" />
      <span className="kb-tpl-text">
        <b>{title}</b>
        <small>{lists || T.kbEmptyLists}{extra ? ` · ${extra}` : ''}</small>
      </span>
    </button>
  );
  const sketch = <BoardSketch name={name} lists={sketchOf(current, T, templates)} k={current} />;
  return (
    <div className={`kb-new-board${page ? ' page' : ''}`}>
      <form className="kb-new-form" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate(makeBoard(name.trim(), current, T, templates));
        else { setTried(true); nameRef.current?.focus(); }
      }}>
        <div className="field">
          <label htmlFor="kb-new-name">{T.kbName}</label>
          <input id="kb-new-name" ref={nameRef} className="input" autoFocus={autoFocus} maxLength={80} value={name} placeholder={T.kbBoardPh}
            aria-invalid={tried && !name.trim()} aria-describedby={tried && !name.trim() ? 'kb-new-name-err' : undefined}
            onChange={(e) => setName(e.target.value)} />
          {tried && !name.trim() && <p id="kb-new-name-err" className="err-line" role="alert">{T.kbNameFirst}</p>}
        </div>
        <div className="field">
          <span className="label" id="kb-tpl">{T.kbStart}</span>
          <div className="kb-templates" role="radiogroup" aria-labelledby="kb-tpl" ref={group}
            onKeyDown={(e) => {
              const at = kinds.indexOf(current);
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); pick(kinds[(at + 1) % kinds.length], true); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); pick(kinds[(at + kinds.length - 1) % kinds.length], true); }
            }}>
            {TEMPLATES.map((k) => option(k, T.kbTemplates[k].name, T.kbTemplates[k].lists.join(' · ')))}
            {templates.length > 0 && <span className="kb-tpl-group" aria-hidden="true">{T.kbTplMine}</span>}
            {templates.map((t) => {
              const n = t.lists.reduce((s, l) => s + (l.cards?.length ?? 0), 0);
              return option(`custom:${t.id}`, t.name, t.lists.map((l) => l.name).join(' · '), n ? T.kbCardsN(n) : undefined);
            })}
          </div>
          <button type="button" className="kb-tpl-make" onClick={() => setMaking({})}><IconPlus />{T.kbTplMake}</button>
        </div>
        {!page && sketch}
        <div className="kb-new-go">
          {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>{T.cancel}</button>}
          <button type="submit" className="btn primary">{T.kbNew}</button>
          {team && <small className="muted">{T.kbTeamSees}</small>}
        </div>
      </form>
      {page && sketch}
      <TemplateDialog value={making} onClose={() => setMaking(null)} onSaved={(id) => { setMaking(null); setKind(`custom:${id}`); }} />
    </div>
  );
}

/** The board a choice will make, drawn small: a picture to choose by, not a working board. */
function BoardSketch({ name, lists, k }: { name: string; lists: SketchList[]; k: string }) {
  const T = useT();
  return (
    <figure className="kb-sketch" aria-hidden="true">
      <figcaption>{T.kbPreview}</figcaption>
      <div className={`kb-sketch-frame${lists.length ? '' : ' no-lists'}`}>
        <span className="kb-sketch-tab"><IconBoard /><span>{name.trim() || T.kbNewBoard}</span></span>
        <div className="kb-sketch-lane" key={k}>
          {lists.map((l, i) => (
            <div key={`${i}-${l.name}`} className="kb-sketch-list" style={{ '--i': i } as React.CSSProperties}>
              <b>{l.name || ' '}</b>
              {l.cards
                ? l.cards.slice(0, 4).map((c, j) => <i key={j} className="real">{c}</i>)
                : Array.from({ length: i === lists.length - 1 ? 1 : SKETCH_CARDS[i] ?? 1 }, (_, j) => (
                  <i key={j}><s style={{ width: SKETCH_WIDTHS[(i + j) % 3] }} />{(i + j) % 2 === 0 && <s style={{ width: '38%' }} />}</i>
                ))}
              {l.cards && l.cards.length > 4 && <small className="kb-sketch-more">+{l.cards.length - 4}</small>}
              <em><IconPlus />{T.kbAddCardBtn}</em>
            </div>
          ))}
          <div className="kb-sketch-add" style={{ '--i': lists.length } as React.CSSProperties}><IconPlus />{lists.length ? T.kbAddAnotherList : T.kbAddList}</div>
        </div>
      </div>
    </figure>
  );
}

type DraftList = { key: string; name: string; cards?: TemplateCard[] };
type DraftLabel = { key: string; name: string; color: LabelColor };

/**
 * Making or changing a board template of one's own: its name, its lists (named, ordered, added and taken away) and
 * its labels; made from a board, it can keep that board's cards (titles, descriptions, labels and tasks; no dates).
 * The sketch shows the board it will make.
 */
export function TemplateDialog({ value, onClose, onSaved }: {
  value: { edit?: BoardTemplate; board?: Board } | null; onClose: () => void; onSaved?: (id: string) => void;
}) {
  const T = useT();
  const { save } = useBoardTemplates();
  const ref = useRef<HTMLDialogElement>(null);
  const listsRef = useRef<HTMLOListElement>(null);
  const [name, setName] = useState('');
  const [lists, setLists] = useState<DraftList[]>([]);
  const [labels, setLabels] = useState<DraftLabel[]>([]);
  const [keepCards, setKeepCards] = useState(false);
  const [tried, setTried] = useState(false);
  const board = value?.board;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (value && !d.open) {
      d.showModal();
      setTried(false);
      setKeepCards(false);
      if (value.edit) {
        setName(value.edit.name);
        setLists(value.edit.lists.map((l) => ({ key: uid(), name: l.name, cards: l.cards })));
        setLabels(value.edit.labels.map((l) => ({ key: uid(), ...l })));
      } else if (value.board) {
        const b = value.board;
        const lname = (id: string) => b.labels.find((x) => x.id === id)?.name;
        setName(b.name);
        setLists(b.lists.map((l) => ({
          key: uid(), name: l.name,
          cards: l.cards.map((c) => ({ title: c.title, description: c.description || undefined, labels: c.labels.map(lname).filter(Boolean) as string[], checklist: c.checklist.map((x) => x.text).filter(Boolean) })),
        })));
        setLabels(b.labels.map((l) => ({ key: uid(), name: l.name, color: l.color })));
      } else {
        setName('');
        setLists(T.kbTemplates.flow.lists.map((n: string) => ({ key: uid(), name: n })));
        setLabels([]);
      }
    }
    if (!value && d.open) d.close();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const cardsIn = lists.reduce((n, l) => n + (l.cards?.length ?? 0), 0);
  const withCards = value?.edit ? cardsIn > 0 : keepCards;
  const focusList = (i: number) => window.setTimeout(() => listsRef.current?.querySelectorAll<HTMLInputElement>('input')[i]?.focus(), 0);
  const addList = (at = lists.length) => { setLists((x) => insertAt(x, at, { key: uid(), name: '' })); focusList(at); };
  const move = (i: number, by: number) => setLists((x) => {
    const j = i + by;
    if (j < 0 || j >= x.length) return x;
    const y = [...x];
    [y[i], y[j]] = [y[j], y[i]];
    return y;
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setTried(true); return; }
    const t: BoardTemplate = {
      id: value?.edit?.id ?? uid(),
      name: name.trim(),
      created: value?.edit?.created ?? today(),
      labels: labels.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), color: l.color })),
      lists: lists.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), ...(withCards && l.cards?.length ? { cards: l.cards } : {}) })),
    };
    save(t);
    if (onSaved) onSaved(t.id); else onClose();
  }

  return (
    <dialog ref={ref} className="sheet kb-sheet kt-sheet" onClose={onClose} aria-labelledby="kt-h"
      onClick={(e) => e.stopPropagation()}>
      {value && (
        <form className="kt-form" noValidate onSubmit={submit}>
          <h2 id="kt-h">{value.edit ? T.kbTplEdit : board ? T.kbTplFromBoard : T.kbTplNew}</h2>
          <p className="muted">{T.kbTplAbout}</p>
          <div className="kt-body">
            <div className="kt-fields">
              <div className="field">
                <label htmlFor="kt-name">{T.kbTplName}</label>
                <input id="kt-name" className="input" autoFocus maxLength={80} value={name} placeholder={T.kbTplNamePh} aria-invalid={tried && !name.trim()} onChange={(e) => setName(e.target.value)} />
                {tried && !name.trim() && <p className="err-line" role="alert">{T.kbTplNameFirst}</p>}
              </div>
              <div className="field">
                <span className="label" id="kt-lists-h">{T.kbTplLists}</span>
                <ol className="kt-lists" ref={listsRef} aria-labelledby="kt-lists-h">
                  {lists.map((l, i) => (
                    <li key={l.key}>
                      <span className="kt-n num" aria-hidden="true">{i + 1}</span>
                      <input className="input" aria-label={T.kbTplListN(i + 1)} placeholder={T.kbTplListPh} maxLength={60} value={l.name}
                        onChange={(e) => setLists((x) => x.map((y) => (y.key === l.key ? { ...y, name: e.target.value } : y)))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addList(i + 1); }
                          if (e.key === 'Backspace' && !l.name && lists.length > 1) { e.preventDefault(); setLists((x) => x.filter((y) => y.key !== l.key)); focusList(Math.max(0, i - 1)); }
                        }} />
                      {withCards && (l.cards?.length ?? 0) > 0 && <small className="muted num kt-cards">{T.kbCardsN(l.cards!.length)}</small>}
                      <span className="kt-tools">
                        <button type="button" className="btn ghost icon" aria-label={T.kbTplUp(l.name || String(i + 1))} disabled={i === 0} onClick={() => move(i, -1)}><span aria-hidden="true">↑</span></button>
                        <button type="button" className="btn ghost icon" aria-label={T.kbTplDown(l.name || String(i + 1))} disabled={i === lists.length - 1} onClick={() => move(i, 1)}><span aria-hidden="true">↓</span></button>
                        <button type="button" className="btn ghost icon" aria-label={T.remove(l.name || String(i + 1))} onClick={() => setLists((x) => x.filter((y) => y.key !== l.key))}><IconX /></button>
                      </span>
                    </li>
                  ))}
                </ol>
                <button type="button" className="kb-tpl-make" onClick={() => addList()}><IconPlus />{T.kbTplAddList}</button>
              </div>
              <div className="field">
                <span className="label" id="kt-labels-h">{T.kbLabels}</span>
                <ul className="kt-labels" aria-labelledby="kt-labels-h">
                  {labels.map((l) => (
                    <li key={l.key}>
                      <div className="kb-swatches" role="radiogroup" aria-label={T.kbLabelColor}>
                        {COLORS.map((k) => <button key={k} type="button" role="radio" aria-checked={l.color === k} aria-label={T.kbColors[k]} className={`kb-swatch lb-${k}`}
                          onClick={() => setLabels((x) => x.map((y) => (y.key === l.key ? { ...y, color: k } : y)))} />)}
                      </div>
                      <input className={`input kt-label lb-${l.color}`} aria-label={T.kbNewLabel} placeholder={T.kbTplLabelPh} maxLength={30} value={l.name}
                        onChange={(e) => setLabels((x) => x.map((y) => (y.key === l.key ? { ...y, name: e.target.value } : y)))} />
                      <button type="button" className="btn ghost icon" aria-label={T.remove(l.name || T.kbLabels)} onClick={() => setLabels((x) => x.filter((y) => y.key !== l.key))}><IconX /></button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="kb-tpl-make" onClick={() => setLabels((x) => [...x, { key: uid(), name: '', color: COLORS[x.length % COLORS.length] }])}><IconPlus />{T.kbTplAddLabel}</button>
              </div>
              {board && cardsIn > 0 && (
                <label className="switch-row"><input type="checkbox" className="switch" checked={keepCards} onChange={(e) => setKeepCards(e.target.checked)} />{T.kbTplKeepCards(cardsIn)}</label>
              )}
              {value.edit && cardsIn > 0 && <p className="muted kt-note">{T.kbTplHasCards(cardsIn)}</p>}
            </div>
            <BoardSketch name={name} k="tpl"
              lists={lists.map((l) => ({ name: l.name, cards: withCards && cardsIn > 0 ? (l.cards ?? []).map((c) => c.title) : null }))} />
          </div>
          <div className="foot">
            <button type="button" className="btn ghost" onClick={onClose}>{T.cancel}</button>
            <div className="right"><button type="submit" className="btn primary">{T.kbTplSave}</button></div>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function NewBoardDialog({ open, onClose, onCreate, team }: { open: boolean; onClose: () => void; onCreate: (board: Board) => void; team?: boolean }) {
  const T = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet kb-sheet kb-board-sheet" onClose={onClose} aria-labelledby="kb-dlg-h">
      {open && (
        <div className="kb-dlg">
          <h2 id="kb-dlg-h">{T.kbNewBoard}</h2>
          <NewBoardForm onCreate={onCreate} autoFocus team={team} onCancel={onClose} />
        </div>
      )}
    </dialog>
  );
}
