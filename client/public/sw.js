// Shutdown Complete service worker: the app opens without a network and shows the plan it last saw.
// - built assets (/assets/*, hashed, immutable): cache first
// - pages: network first, falling back to the cached app
// - reads of the planner's documents: network first, falling back to the last copy
// Writes (PUT/POST) always go to the network; the app keeps unsent changes and sends them when back online.
const VERSION = 'sc-v2'; // v2: the new mark (icons and favicon changed)
const SHELL = `${VERSION}-shell`, DATA = `${VERSION}-data`, ASSETS = `${VERSION}-assets`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/mark.svg', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    // fonts: whatever is cached, refreshed in the background
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
      e.respondWith(caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((r) => { c.put(req, r.clone()); return r; }).catch(() => hit);
        return hit || net;
      }));
    }
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(ASSETS).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.pathname.startsWith('/tutorial/')) return; // the sign-in videos stream from the network
  if (url.pathname.startsWith('/api/')) {
    if (/^\/api\/(doc\/|docs|auth\/state|account$|session)/.test(url.pathname)) e.respondWith(networkFirst(req, DATA));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { caches.open(SHELL).then((c) => c.put('/', r.clone())); return r; }).catch(() => caches.match('/')));
  }
});

// signing out forgets the cached planner
self.addEventListener('message', (e) => {
  if (e.data?.type === 'clear-data') e.waitUntil(caches.delete(DATA));
  if (e.data?.type === 'push-words') e.waitUntil(caches.open(DATA).then((c) => c.put('/push-words', new Response(JSON.stringify({ title: e.data.title, body: e.data.body })))));
});

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const words = await (await caches.match('/push-words'))?.json();
    const now = new Date(), pad = (n) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    await self.registration.showNotification(words?.title || 'Shutdown Complete', {
      body: words?.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'block', data: { url: `/day/${date}` },
    });
  })());
});

// a tap on a focus notification brings the planner forward
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    const target = new URL(e.notification.data?.url || '/focus', self.location.origin);
    const url = target.origin === self.location.origin ? target.href : self.location.origin;
    return open ? open.navigate(url).then((c) => c?.focus()) : self.clients.openWindow(url);
  }));
});
