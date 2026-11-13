import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import type { Words } from './words/en';

/** What the service worker needs to word each notification, in the language of the app (it cannot load the app's words). */
export function pushWords(T: Words) {
  const p = T.notif.push;
  return {
    block: { title: T.remindTitle, body: T.pushBody },
    'focus-end': { title: p.focusTitle, body: p.focusBody, action: p.focusAction },
    'break-end': { title: p.breakTitle, body: p.breakBody, action: p.breakAction },
    morning: { title: p.morningTitle, body: p.morningBody, bodyOne: p.morningOne, bodyMany: p.morningMany },
    evening: { title: p.eveningTitle, body: p.eveningBody },
  };
}
export async function sendPushWords(T: Words) {
  try { (await navigator.serviceWorker.ready).active?.postMessage({ type: 'push-words', words: pushWords(T) }); } catch { /* no service worker */ }
}

// the server reckons the morning and evening times in the zone this device told it; tell it again after travel
const ZONE = 'sc-push-zone';
async function syncZone(sub: PushSubscription) {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (localStorage.getItem(ZONE) === zone) return;
    await api.pushSubscribe(sub);
    localStorage.setItem(ZONE, zone);
  } catch { /* try again next time */ }
}
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
        if (sub && info?.subscribed) void syncZone(sub);
      } catch { if (live && active == null) { active = false; emit(); } }
    };
    void check(); window.addEventListener('focus', check);
    return () => { live = false; window.removeEventListener('focus', check); };
  }, []);
  return enabled;
}
export async function setPush(enabled: boolean, T: Words) {
  if (enabled && await Notification.requestPermission() !== 'granted') throw new Error('permission');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (enabled) {
    const { publicKey } = await api.pushInfo();
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api.pushSubscribe(sub);
    try { localStorage.setItem(ZONE, Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* private mode */ }
    reg.active?.postMessage({ type: 'push-words', words: pushWords(T) });
  } else if (sub) { await api.pushRemove(sub.endpoint); await sub.unsubscribe(); }
  active = enabled; emit();
}
