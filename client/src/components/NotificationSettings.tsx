import { useState } from 'react';
import { useSettings } from '../App';
import { useT } from '../lib/i18n';
import { notifyView } from '../lib/notify';
import { pushSupported, setPush, usePush } from '../lib/push';
import { isIOS, isStandalone } from '../lib/pwa';
import type { NotifyChoices } from '../lib/model';

/** Settings → Notifications: what reaches this device while the app is closed, and when. */
export function NotificationSettings() {
  const T = useT(), N = T.notif;
  const { settings, update } = useSettings();
  const enabled = usePush();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const n = notifyView(settings);
  const set = (patch: Partial<NotifyChoices>) => update((s) => ({ ...s, notify: { ...s.notify, ...patch } }));
  const supported = pushSupported();
  const [, refresh] = useState(0);
  const ua = navigator.userAgent;
  const help = isIOS() ? N.iosHelp : /Android/i.test(ua) ? N.android : /Edg/i.test(ua) ? N.edge : /Firefox/i.test(ua) ? N.firefox : /Chrome|Chromium/i.test(ua) ? N.chrome : /Safari/i.test(ua) ? N.safari : N.generic;
  const blocked = supported && 'Notification' in window && Notification.permission === 'denied';
  const allow = async () => {
    setBusy(true); setError(false);
    try { await setPush(true, T); } catch { setError(true); } finally { setBusy(false); }
  };

  return (
    <div className="notif-panel" data-state={!supported ? 'unsupported' : blocked ? 'blocked' : enabled === true ? 'on' : 'off'}>
      {!supported && <p className="muted notif-status">{isIOS() && !isStandalone() ? N.ios : N.unavailable}</p>}
      {supported && blocked && <><p className="muted notif-status">{N.blocked}</p><details><summary>{N.help}</summary><p>{help}</p></details><button className="btn" onClick={()=>refresh(v=>v+1)}>{N.recheck}</button></>}
      {supported && !blocked && enabled !== true && (
        <p className="notif-status">
          <span className="muted">{N.statusOff}</span>{' '}
          <button type="button" className="btn" disabled={busy || enabled == null} onClick={allow}>{N.allow}</button>
        </p>
      )}
      {supported && !blocked && enabled === true && <p className="muted notif-status">{N.statusOn}</p>}
      {supported && !blocked && enabled === true && <button className="btn" onClick={async()=>{try { await (await navigator.serviceWorker.ready).showNotification(N.test); } catch { setError(true); }}}>{N.test}</button>}
      {error && <p role="alert">{T.pushError}</p>}

      <fieldset className="notif-choices" disabled={enabled !== true}>
        <label className="switch-row">
          <input type="checkbox" className="switch" checked={n.focus} onChange={(e) => set({ focus: e.target.checked })} />{N.focusEnds}
        </label>
        <div className="notif-line">
          <label className="switch-row">
            <input type="checkbox" className="switch" checked={n.morning} onChange={(e) => set({ morning: e.target.checked })} />{N.morning}
          </label>
          <input type="time" className="input num" aria-label={`${N.morning}: ${N.at}`} value={n.morningAt} disabled={!n.morning}
            onChange={(e) => set({ morningAt: e.target.value || undefined })} />
        </div>
        <div className="notif-line">
          <label className="switch-row">
            <input type="checkbox" className="switch" checked={n.evening} onChange={(e) => set({ evening: e.target.checked })} />{N.evening}
          </label>
          <input type="time" className="input num" aria-label={`${N.evening}: ${N.at}`} value={n.eveningAt} disabled={!n.evening}
            onChange={(e) => set({ eveningAt: e.target.value || undefined })} />
        </div>
        <label className="switch-row">
          <input type="checkbox" className="switch" checked={n.weekends} disabled={!n.morning && !n.evening} onChange={(e) => set({ weekends: e.target.checked })} />{N.weekends}
        </label>
      </fieldset>
    </div>
  );
}
