// The ties between plans, as they show on an item's row: what it is part of (one scale up), what it is broken down
// into (one scale down), and the board card a task stands for. See lib/links.ts.
import { useState } from 'react';
import { monthName, shortDate, weekNumber, weekdayShort } from '../lib/dates';
import { useT } from '../lib/i18n';
import { addBelow, belowKey, linkOf, sameLink, type Choice } from '../lib/links';
import { emptyBoards, type BoardsDoc, type CardLink, type Item, type ItemLink } from '../lib/model';
import { navigate, onLinkClick } from '../lib/router';
import { useTeams } from '../lib/teams';
import { useDoc } from '../lib/useDoc';
import { IconBoard, IconBranch, IconUp } from './Icons';
import { Pop } from './Pop';

type TT = ReturnType<typeof useT>;

/** A document key in words: "November", "Week 44", "Mon 27 Oct". */
export function whereOf(key: string, T: TT) {
  const [kind, id] = key.split(':');
  if (kind === 'quarter') return T.quarterShort(id);
  if (kind === 'month') return monthName(id);
  if (kind === 'week') return T.weekN(weekNumber(id));
  if (kind === 'day') return `${weekdayShort(id)} ${shortDate(id)}`;
  return key;
}
/** The screen a document key is shown on. */
export const hrefOf = (key: string) => { const [kind, id] = key.split(':'); return `/${kind}/${id}`; };

/**
 * What an item is part of: once tied, a chip with the plan above (click to change); untied, a quiet button on the
 * row (`place` 'tool') that opens the same choice. `level` names the scale above ("a season goal", "a month goal").
 */
export function PartOf({ up, choices, onChange, level, place }: {
  up?: ItemLink; choices: Choice[]; onChange: (l: ItemLink | undefined) => void; level: string; place: 'line' | 'tool';
}) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const cur = up ? choices.find((c) => sameLink(linkOf(c), up)) : undefined;
  if (place === 'line' && !cur) return null;
  if (place === 'tool' && cur) return null;
  return (
    <span className="kb-pop-wrap link-wrap">
      {cur ? (
        <button type="button" className={`link-chip up${cur.done ? ' done' : ''}`} aria-expanded={open} title={`${T.linkPartOf}: ${cur.text} · ${cur.where}`} onClick={() => setOpen(!open)}>
          <IconUp /><span>{cur.text}</span>
        </button>
      ) : (
        <button type="button" className="btn ghost icon row-tool" aria-expanded={open} aria-label={T.linkTie(level)} title={T.linkTie(level)} onClick={() => setOpen(!open)}><IconUp /></button>
      )}
      <Pop open={open} onClose={() => setOpen(false)} title={T.linkPartOfLevel(level)} align="right" className="link-pop">
        {choices.length === 0 ? <p className="muted link-empty">{T.linkNoChoices(level)}</p> : (
          <div className="link-opts" role="radiogroup" aria-label={T.linkPartOfLevel(level)}>
            {choices.map((c) => {
              const on = sameLink(linkOf(c), up);
              return (
                <button key={`${c.key}/${c.id}`} type="button" role="radio" aria-checked={on} className={`link-opt${c.done ? ' done' : ''}`}
                  onClick={() => { onChange(on ? undefined : linkOf(c)); setOpen(false); }}>
                  <span className="kb-tpl-dot" aria-hidden="true" />
                  <span className="link-opt-text"><b>{c.text}</b><small className="muted">{c.where}</small></span>
                </button>
              );
            })}
          </div>
        )}
        {cur && <button type="button" className="btn ghost sm link-untie" onClick={() => { onChange(undefined); setOpen(false); }}>{T.linkUntie}</button>}
      </Pop>
    </span>
  );
}

/**
 * What an item is broken down into one scale down: once it has some, a chip with how many are done (click for the
 * list, each one opening its page, and a way to add another); with none, a quiet button on the row to add the first.
 */
export function BrokenDown({ parent, serving, place }: {
  parent: { key: string; item: Item }; serving: { key: string; item: Item }[]; place: 'line' | 'tool';
}) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const below = belowKey(parent.key);
  if (!below) return null;
  if (place === 'line' && !serving.length) return null;
  if (place === 'tool' && serving.length) return null;
  const done = serving.filter((x) => x.item.done).length;
  const add = async () => { const k = await addBelow(parent); setOpen(false); if (k) navigate(hrefOf(k)); };
  return (
    <span className="kb-pop-wrap link-wrap">
      {serving.length ? (
        <button type="button" className={`link-chip down${done === serving.length ? ' all' : ''}`} aria-expanded={open} aria-label={T.linkDownAria(done, serving.length)} onClick={() => setOpen(!open)}>
          <IconBranch /><span className="num">{done}/{serving.length}</span>
          <i className="link-bar" aria-hidden="true"><i style={{ transform: `scaleX(${done / serving.length})` }} /></i>
        </button>
      ) : (
        <button type="button" className="btn ghost icon row-tool" aria-expanded={open} aria-label={T.linkBreak} title={T.linkBreak} onClick={() => setOpen(!open)}><IconBranch /></button>
      )}
      <Pop open={open} onClose={() => setOpen(false)} title={T.linkDownTitle} align="right" className="link-pop">
        {serving.length > 0 && (
          <ul className="link-list">
            {serving.map(({ key, item }) => (
              <li key={`${key}/${item.id}`} className={item.done ? 'done' : undefined}>
                <span className="link-tick" aria-hidden="true" />
                <a href={hrefOf(key)} onClick={(e) => { setOpen(false); onLinkClick(e); }}><span>{item.text}</span><small className="muted">{whereOf(key, T)}</small></a>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn sm link-add" onClick={add}>{T.linkAddTo(whereOf(below, T))}</button>
      </Pop>
    </span>
  );
}

/** The board card a task stands for: a chip with the board's name that opens the card. */
export function CardChip({ link }: { link: CardLink }) {
  const T = useT();
  const { value: doc } = useDoc<BoardsDoc>('boards', emptyBoards);
  const teams = useTeams();
  const team = link.project.startsWith('t:');
  const project = team ? teams?.find((t) => t.id === link.project.slice(2))?.value : doc?.projects?.find((p) => p.id === link.project.slice(2));
  const board = project?.boards.find((b) => b.id === link.board);
  const href = `/${team ? 'team' : 'project'}/${link.project.slice(2)}/${link.board}/${link.card}`;
  return (
    <a className="link-chip card" href={href} onClick={onLinkClick} title={T.linkCard}>
      <IconBoard /><span>{board ? board.name : T.linkCard}</span>
    </a>
  );
}
