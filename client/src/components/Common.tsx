import { useT } from '../lib/i18n';
import type { SaveStatus } from '../lib/useDoc';

/** The quiet freshness stamp in the title row. */
export function SaveStamp({ status }: { status: SaveStatus }) {
  const text = useT().save[status];
  return <span className="stamp" role="status" aria-live="polite">{text}</span>;
}

/** Shown inside the screen, above its content, when a save failed or another device won. */
export function DocNotice({ status, error, retry }: { status: SaveStatus; error: string | null; retry: () => void }) {
  const T = useT();
  if (status === 'conflict') {
    return <div className="notice">{T.conflictNotice}</div>;
  }
  if (status === 'offline') {
    return <div className="notice" role="status">{T.offlineNotice}</div>;
  }
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
