import { useEffect, useState } from 'react';
import { usePendingCount } from '../lib/useDoc';
import { useT } from '../lib/i18n';
export function OfflineQueue() {
  const T = useT(), count = usePendingCount();
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => { const on = () => setOffline(!navigator.onLine); window.addEventListener('online', on); window.addEventListener('offline', on); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); }; }, []);
  // only while offline: a change waiting a moment to sync online is normal and needs no word
  return offline ? <p className="offline-queue muted" role="status">{T.offlinePending(count)}</p> : null;
}
