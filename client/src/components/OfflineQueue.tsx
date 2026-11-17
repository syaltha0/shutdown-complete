import { useEffect, useState } from 'react';
import { retryNow, useLastSaved, useOutage, usePendingCount } from '../lib/useDoc';
import { clock } from '../lib/dates';
import { useT } from '../lib/i18n';
export function OfflineQueue() {
  const T = useT(), count = usePendingCount(), down = useOutage(), saved = useLastSaved();
  // the last change the server took, so closing the tab while offline is an informed choice
  const since = saved ? ` · ${T.lastSavedAt(clock(new Date(saved).getHours() * 60 + new Date(saved).getMinutes()))}` : '';
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => { const on = () => setOffline(!navigator.onLine); window.addEventListener('online', on); window.addEventListener('offline', on); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); }; }, []);
  // a change waiting a moment to sync online is normal and needs no word: only while offline, or once the server has
  // been out of reach for a while (several failed tries)
  if (offline) return <div className="notice offline-queue" role="status"><span>{T.offlinePending(count)}{since}</span><span className="muted">{T.offlineKept}</span></div>;
  return down && count > 0 ? (
    <div className="notice offline-queue" role="status">
      <span>{T.serverDown(count)}{since}</span>
      <button type="button" className="btn ghost" onClick={retryNow}>{T.retry}</button>
    </div>
  ) : null;
}
