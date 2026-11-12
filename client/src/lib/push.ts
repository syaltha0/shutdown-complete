import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
let active: boolean | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export function usePush() {
  const enabled = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => active);
  useEffect(() => {
    if (!pushSupported()) { active = false; emit(); return; }
    let live = true;
    const check = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const info = sub ? await api.pushInfo(sub.endpoint) : null;
        if (live) { active = !!info?.subscribed && Notification.permission === 'granted'; emit(); }
      } catch { if (live && active == null) { active = false; emit(); } }
    };
    void check(); window.addEventListener('focus', check);
    return () => { live = false; window.removeEventListener('focus', check); };
  }, []);
  return enabled;
}
export async function setPush(enabled: boolean, title: string, body: string) {
  if (enabled && await Notification.requestPermission() !== 'granted') throw new Error('permission');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (enabled) {
    const { publicKey } = await api.pushInfo();
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api.pushSubscribe(sub);
    reg.active?.postMessage({ type: 'push-words', title, body });
  } else if (sub) { await api.pushRemove(sub.endpoint); await sub.unsubscribe(); }
  active = enabled; emit();
}
