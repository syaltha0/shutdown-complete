import { useMemo, useState, useSyncExternalStore } from 'react';
import { useT } from '../lib/i18n';
import { today } from '../lib/dates';
import { clearDrafts, describe, draftKeys, draftRevision, keysForPath, liveKeys, readDrafts, same, subscribeDrafts, toText, type Draft, type Section } from '../lib/drafts';
import { restoreDraft } from '../lib/useDoc';
import { useDoc } from '../lib/useDoc';

/**
 * Shown when a save lost to another device (409): the local version was kept as a draft. A quiet note, then on request
 * the two versions side by side, in the fields a person knows (block names and times, notes, task texts).
 * Nothing is merged: the draft can be put back over the server's version (after a confirmation), copied or let go.
 */
export function ConflictDraft({ path }: { path: string }) {
  const rev = useSyncExternalStore(subscribeDrafts, draftRevision);
  const day = today();
  const found = useMemo(() => {
    const keys = [...new Set([...keysForPath(path, day), ...liveKeys()])];
    const stored = new Set(draftKeys());
    const key = keys.find((k) => stored.has(k) && readDrafts(k).length);
    return key ? { key, draft: readDrafts(key)[0] } : null;
  }, [path, day, rev]);
  return found ? <Note key={found.key + found.draft.at} docKey={found.key} draft={found.draft} /> : null;
}

function Note({ docKey, draft }: { docKey: string; draft: Draft }) {
  const T = useT(), D = T.draft;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const [copied, setCopied] = useState(false);
  const { value: server } = useDoc<unknown>(docKey, () => null);
  const sides = useMemo(() => {
    const a = describe(docKey, server, D.words), b = describe(docKey, draft.value, D.words);
    return { a, b, hidden: !same(server, draft.value) && a.every((s, i) => same(s.lines, b[i].lines)) };
  }, [docKey, server, draft, D]);
  const copy = () => {
    navigator.clipboard?.writeText(sides.hidden ? JSON.stringify(draft.value, null, 2) : toText(sides.b)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => { /* the clipboard is not available */ });
  };
  return (
    <div className="draft" role="status">
      <div className="draft-head">
        <span>{D.notice}</span>
        <span className="draft-actions">
          <button type="button" className="btn ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? D.hide : D.show}</button>
          <button type="button" className="btn ghost" onClick={() => clearDrafts(docKey)}>{D.dismiss}</button>
        </span>
      </div>
      {open && (
        <div className="draft-body">
          <div className="draft-cols" role="group">
            <b className="draft-col-head">{D.server}</b>
            <b className="draft-col-head">{D.mine}</b>
            {sides.a.map((s, i) => (s.lines.length || sides.b[i].lines.length) ? <Row key={i} server={s} mine={sides.b[i]} none={D.none} /> : null)}
          </div>
          {sides.hidden && <><p className="muted draft-hidden">{D.hiddenDiff}</p><div className="draft-cols"><Row server={{ title: D.server, lines: [JSON.stringify(server, null, 2)], prose: true }} mine={{ title: D.mine, lines: [JSON.stringify(draft.value, null, 2)], prose: true }} none={D.none} /></div></>}
          <div className="draft-foot">
            {ask ? (
              <>
                <span>{D.restoreAsk}</span>
                <button type="button" className="btn primary" onClick={() => { void restoreDraft(docKey, draft.value); }}>{D.restoreYes}</button>
                <button type="button" className="btn ghost" onClick={() => setAsk(false)}>{D.cancel}</button>
              </>
            ) : (
              <>
                <button type="button" className="btn" onClick={() => setAsk(true)}>{D.restore}</button>
                <button type="button" className="btn ghost" onClick={copy}>{copied ? D.copied : D.copy}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One field, the server's lines on the left and the local ones on the right; a line the other side lacks is marked. */
function Row({ server, mine, none }: { server: Section; mine: Section; none: string }) {
  const side = (s: Section, other: Section) => (
    <div className="draft-cell">
      <span className="draft-title">{s.title}</span>
      {s.lines.length ? (
        <ul className={s.prose ? 'draft-lines prose' : 'draft-lines'}>
          {s.lines.map((l, i) => <li key={i} className={other.lines.includes(l) ? undefined : 'changed'}>{l || ' '}</li>)}
        </ul>
      ) : <span className="muted">{none}</span>}
    </div>
  );
  return <>{side(server, mine)}{side(mine, server)}</>;
}
