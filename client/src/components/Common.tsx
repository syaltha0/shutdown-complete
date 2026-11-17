import { useT } from '../lib/i18n';
import type { SaveStatus } from '../lib/useDoc';

/** The stamp in the title row speaks only when something is wrong; a normal save stays silent. */
export function SaveStamp({ status }: { status: SaveStatus }) {
  const save = useT().save;
  const text = status === 'error' ? save[status] : '';
  return <span className="stamp" role="status" aria-live="polite">{text}</span>;
}

/** A part of a screen that could not load: says so and offers another try, instead of showing it as empty. */
export function LoadFailed({ retry }: { retry: () => void }) {
  const T = useT();
  return (
    <div className="notice error" role="alert">
      <span>{T.loadFailed}</span>
      <button type="button" className="btn ghost" onClick={retry}>{T.retry}</button>
    </div>
  );
}

/** Shown inside the screen, above its content, when a save failed or another device won. */
export function DocNotice({ status, error, retry }: { status: SaveStatus; error: string | null; retry: () => void }) {
  const T = useT();
  // a refused local version is kept and shown by ConflictDraft; a conflict with nothing to keep only refreshes the page
  if (status === 'conflict') return null;
  // offline is said once, for the whole app, by OfflineQueue
  if (status === 'offline') return null;
  if (status === 'error') {
    return (
      <div className="notice error" role="alert">
        <span>{error || T.somethingWrong} {T.errorKept}</span>
        <button type="button" className="btn ghost" onClick={retry}>{T.retry}</button>
      </div>
    );
  }
  return null;
}
