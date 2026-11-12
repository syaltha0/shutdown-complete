import { useEffect, useState } from 'react';

// Installing the planner as an app, and its service worker (public/sw.js).
interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPrompt | null = null;
const events = new EventTarget();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPrompt; events.dispatchEvent(new Event('change')); });
window.addEventListener('appinstalled', () => { deferred = null; events.dispatchEvent(new Event('change')); });

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

/** Whether the browser offers to install the app right now, and a function that asks it to. */
export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((x) => x + 1);
    events.addEventListener('change', on);
    return () => events.removeEventListener('change', on);
  }, []);
  return {
    canPrompt: !!deferred,
    installed: isStandalone(),
    install: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      events.dispatchEvent(new Event('change'));
      return outcome === 'accepted';
    },
  };
}

/** Forget the cached copies of the planner on this device (signing out, or another account signing in). */
export async function clearOfflineData() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-data' });
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.endsWith('-data')).map((k) => caches.delete(k)));
  } catch { /* no caches */ }
}

/** A notification through the service worker when there is one (needed on phones), otherwise from the page. */
export async function showNotification(title: string, body: string, url = '/focus', tag = 'focus') {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url }, tag });
    else new Notification(title, { body, icon: '/icons/icon-192.png' });
  } catch { /* ignore */ }
}
