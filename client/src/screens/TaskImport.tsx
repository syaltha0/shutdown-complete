import { useState } from 'react';
import { emptyInbox, type InboxDoc } from '../lib/model';
import { useDoc, updateKey } from '../lib/useDoc';
import { useT } from '../lib/i18n';
import { offerUndo } from '../lib/undo';
import { fileIdentity, mergeImport, parseImport, type Source, type Parsed } from '../lib/import/tasks';

export function TaskImport() {
  const T = useT().taskImport;
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  const [open, setOpen] = useState(false), [source, setSource] = useState<Source>('todoist');
  const [file, setFile] = useState<{ text: string; name: string; identity: string } | null>(null);
  const [completed, setCompleted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  let parsed: Parsed | null = null; try { parsed = file ? parseImport(file.text, source, file.name, completed) : null; } catch { /* error shown below */ }
  const next = inbox && parsed && file ? mergeImport(inbox, parsed, file.identity) : null;
  async function apply() {
    if (!file || !parsed || !inbox || busy) return;
    setBusy(true); setError(false);
    try {
      let added: string[] = [], lists: string[] = [];
      await updateKey<InboxDoc>('inbox', emptyInbox, doc => {
        const merged = mergeImport(doc, parsed!, file.identity);
        added = merged.items.filter(i => !doc.items.some(t => t.id === i.id)).map(i => i.id);
        lists = (merged.lists ?? []).filter(l => !doc.lists?.some(t => t.id === l.id)).map(l => l.id);
        return merged;
      });
      offerUndo(T.result(added.length), () => { void updateKey<InboxDoc>('inbox', emptyInbox, doc => ({ ...doc, items: doc.items.filter(i => !added.includes(i.id)), lists: doc.lists?.filter(l => !lists.includes(l.id) || doc.items.some(i => i.list === l.id && !added.includes(i.id))) })); });
      setFile(null); setOpen(false);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div data-testid="task-import">
    <button type="button" className="btn" onClick={() => setOpen(true)}>{T.title}</button>
    {open && <div className="panel" aria-busy={busy}>
      <label>{T.source}<select disabled={busy} value={source} onChange={e => { setSource(e.target.value as Source); setFile(null); setError(false); }}><option value="todoist">{T.todoist}</option><option value="ticktick">{T.ticktick}</option></select></label>
      <label>{T.file}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); setFile(null); setError(false); try { const text = await f.text(); parseImport(text, source, f.name); setFile({ text, name: f.name, identity: await fileIdentity(text, source) }); } catch { setError(true); } finally { setBusy(false); } }} /></label>
      <label><input type="checkbox" checked={completed} disabled={busy} onChange={e => setCompleted(e.target.checked)} />{T.completed}</label>
      {parsed && next && inbox && <div data-testid="task-import-preview">
        <h3>{T.preview}</h3><p>{T.count(next.items.length - inbox.items.length, (next.lists?.length ?? 0) - (inbox.lists?.length ?? 0))}</p>
        <ul>{parsed.tasks.slice(0, 5).map((t, i) => <li key={i}>{t.listName}: {t.text}</li>)}</ul>
        <p>{T.duplicates(parsed.tasks.length - (next.items.length - inbox.items.length))}</p><p>{T.skipped(parsed.skipped.length)}</p><ul>{parsed.skipped.map(s => <li key={s.row}>{s.row}: {T.reasons[s.reason]}</li>)}</ul>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void apply()}>{T.confirm}</button>
      </div>}
      <button type="button" className="btn" disabled={busy} onClick={() => { setOpen(false); setFile(null); setError(false); }}>{T.cancel}</button>
      {(error || (file && !parsed)) && <p className="notice" role="alert">{T.error}</p>}
    </div>}
  </div>;
}
