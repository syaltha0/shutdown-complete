import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { today } from '../lib/dates';
import { emptyInbox, uid, type InboxDoc } from '../lib/model';
import { useDoc, updateKey } from '../lib/useDoc';
import { parseTaskDraft, unknownTaskLists } from '../lib/taskQuickAdd';
import { IconX } from './Icons';

export function QuickCapture({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const T = useT();
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    const modal = dialog.current;
    modal?.showModal(); input.current?.focus();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  // The shared parser accepts 24-hour times; normalize English meridiem input first.
  const normalized = text.replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi, (_, hour: string, minute: string | undefined, period: string) => `${String(Number(hour) % 12 + (period.toLowerCase() === 'pm' ? 12 : 0)).padStart(2, '0')}:${minute ?? '00'}`);
  const draft = parseTaskDraft(normalized, inbox?.lists ?? [], today());
  const save = async () => {
    if (saving.current || !inbox || !draft.text) return;
    saving.current = true; setBusy(true); setError(false);
    try {
      await updateKey<InboxDoc>('inbox', emptyInbox, d => ({ ...d, items: [...d.items, { ...draft, id: uid(), done: false, created: new Date().toISOString() }] }));
      onSaved();
    } catch { saving.current = false; setBusy(false); setError(true); }
  };
  return <dialog ref={dialog} className="quick-capture" aria-label={T.quickCapture.title} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (e.target === dialog.current && !busy) onClose(); }}>
    <form className="capture-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="more-head"><b>{T.quickCapture.title}</b><button type="button" className="btn ghost icon" disabled={busy} aria-label={T.close} onClick={onClose}><IconX /></button></div>
      <input ref={input} aria-label={T.quickCapture.title} placeholder={T.quickCapture.placeholder} value={text} onChange={e => setText(e.target.value)} readOnly={busy} onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} />
      <p className="hint">{unknownTaskLists(text, inbox?.lists ?? []).map(name => <span key={name}>{T.unknownTaskList(name)} </span>)}{draft.text} {draft.due} {draft.dueTime}</p>
      {error && <p role="alert">{T.palette.error}</p>}
      <button type="submit" className="btn primary" disabled={busy || !inbox || !draft.text}>{busy ? T.save.saving : T.quickCapture.add}</button>
    </form>
  </dialog>;
}
