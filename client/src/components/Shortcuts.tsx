import { useEffect, useRef, useState } from 'react';
import { monthOf, quarterOf, today, weekOf } from '../lib/dates';
import { useT } from '../lib/i18n';
import { navigate } from '../lib/router';
import { useSettings } from '../App';
import { featureOn } from '../lib/model';
import { dismissUndo, undo, useUndoOffer } from '../lib/undo';
import { IconX } from './Icons';

// Keyboard shortcuts for the planner, and the note that offers to undo a deletion.
// Single keys work anywhere except while typing in a field or with a dialog open; ? lists them.

/** Screens listen for these to do their part (the Day screen adds a block, opens the revise dialog). */
export const SHORTCUT = 'sc:shortcut';
export type ShortcutAction = 'new-block' | 'revise';

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export function Shortcuts() {
  const T = useT(), K = T.keys;
  const [help, setHelp] = useState(false);
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // undo a deletion: Ctrl+Z / ⌘Z, unless a text field is undoing its own typing
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
        if (!typing(e.target) && undo()) e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      if (document.querySelector('dialog[open]') || document.querySelector('.more-sheet, .tour, .focus-room')) return;
      if (location.pathname.startsWith('/focus') && [' ', 's', 'r', '+', '='].includes(e.key.toLowerCase())) return;
      const t = today();
      const go = (to: string) => { e.preventDefault(); navigate(to); };
      const step = (dir: 'first' | 'last') => {
        const a = document.querySelector<HTMLAnchorElement>(`.canvas .stepper a:${dir}-child`);
        if (a) { e.preventDefault(); a.click(); }
      };
      const tell = (action: ShortcutAction) => { e.preventDefault(); window.dispatchEvent(new CustomEvent(SHORTCUT, { detail: action })); };
      switch (e.key) {
        case '?': e.preventDefault(); setHelp(true); break;
        case 'a': go('/agenda'); break;
        case 't': go(`/day/${t}`); break;
        case 'w': go(`/week/${weekOf(t)}`); break;
        case 'm': go(`/month/${monthOf(t)}`); break;
        case 'q': go(`/quarter/${quarterOf(t)}`); break;
        case 'f': go('/focus'); break;
        case 'h': if (featureOn(settingsRef.current, 'habits')) go(`/habits/${monthOf(t)}`); break;
        case 'i': if (featureOn(settingsRef.current, 'inbox')) go('/tasks'); break;
        case 's': go(`/shutdown/${t}`); break;
        case 'p': go(`/plan/${weekOf(t)}`); break;
        case 'ArrowLeft': step('first'); break;
        case 'ArrowRight': step('last'); break;
        case 'n': tell('new-block'); break;
        case 'r': tell('revise'); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (help && !d.open) d.showModal();
    if (!help && d.open) d.close();
  }, [help]);

  const rows: [string[], string][] = [
    [['Space', 'S', 'R', '+'], T.focusOptions.shortcuts],
    [['N'], K.newBlock], [['R'], K.revise], [['←', '→'], K.prevNext], [['T'], K.today], [['W'], K.week], [['M'], K.month],
    [['A'], T.calendarViews.agenda], [['Q'], K.quarter], [['P'], K.planWeek], [['F'], K.focus], [['H'], K.habits], [['I'], K.inbox], [['S'], K.shutdown], [['Ctrl', 'Z'], K.undo], [['?'], K.help],
  ];
  return (
    <>
      <dialog ref={dialog} className="sheet keys-sheet" aria-labelledby="keys-h" onClose={() => setHelp(false)} onClick={(e) => { if (e.target === dialog.current) setHelp(false); }}>
        <div className="keys-head">
          <h2 id="keys-h">{K.title}</h2>
          <button type="button" className="btn ghost icon" aria-label={T.close} onClick={() => setHelp(false)}><IconX /></button>
        </div>
        <dl className="keys">
          {rows.map(([keys, what]) => (
            <div key={what}><dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt><dd>{what}</dd></div>
          ))}
        </dl>
      </dialog>
      <UndoNote />
    </>
  );
}

/** The note at the bottom after a deletion: what went, and a way to put it back. */
function UndoNote() {
  const T = useT();
  const offer = useUndoOffer();
  if (!offer) return null;
  return (
    <div className="undo-note" role="status" key={offer.id}>
      <span>{offer.message}</span>
      <button type="button" className="btn" onClick={() => undo()}>{T.undo}</button>
      <button type="button" className="btn ghost icon" aria-label={T.close} onClick={dismissUndo}><IconX /></button>
    </div>
  );
}
