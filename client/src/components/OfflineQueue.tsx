import { useEffect, useState } from 'react';
import { retryNow, useOutage, usePendingCount } from '../lib/useDoc';
import { useT } from '../lib/i18n';
export function OfflineQueue() {
  const T = useT(), count = usePendingCount(), down = useOutage();
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => { const on = () => setOffline(!navigator.onLine); window.addEventListener('online', on); window.addEventListener('offline', on); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); }; }, []);
  // a change waiting a moment to sync online is normal and needs no word: only while offline, or once the server has
  // been out of reach for a while (several failed tries)
  if (offline) return <p className="offline-queue muted" role="status">{T.offlinePending(count)}</p>;
  return down && count > 0 ? (
    <div className="notice offline-queue" role="status">
      <span>{T.serverDown(count)}</span>
      <button type="button" className="btn ghost" onClick={retryNow}>{T.retry}</button>
    </div>
  ) : null;
}
