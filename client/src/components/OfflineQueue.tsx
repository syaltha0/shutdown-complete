import { useEffect, useState } from 'react';
import { usePendingCount } from '../lib/useDoc';
import { useT } from '../lib/i18n';
export function OfflineQueue() {
  const T = useT(), count = usePendingCount();
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => { const on = () => setOffline(!navigator.onLine); window.addEventListener('online', on); window.addEventListener('offline', on); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); }; }, []);
  return offline || count > 0 ? <p className="offline-queue muted" role="status">{offline ? T.offlinePending(count) : T.queuePending(count)}</p> : null;
}
