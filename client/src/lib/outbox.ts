// Account-scoped durable writes. localStorage is also a synchronous journal for pagehide.
export interface PendingDoc { key: string; value: unknown; version: number }
let owner = '';
let database: Promise<IDBDatabase> | undefined;
const prefix = () => `sc-outbox:${owner}:`;
function db() {
  return database ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('sc-outbox', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('writes');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let chain = Promise.resolve();
export function keepPending(doc: PendingDoc | null, key: string) {
  if (!owner) return;
  const id = prefix() + key;
  try { localStorage.setItem(id, JSON.stringify(doc)); } catch { /* IndexedDB below */ }
  chain = chain.then(async () => {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('writes', 'readwrite');
      if (doc) tx.objectStore('writes').put(doc, id); else tx.objectStore('writes').delete(id);
      tx.oncomplete = () => { if (!doc) { try { if (localStorage.getItem(id) === 'null') localStorage.removeItem(id); } catch { /* unavailable */ } } resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }).catch(() => { /* localStorage fallback */ });
}
export async function openOutbox(user: string): Promise<PendingDoc[]> {
  owner = user;
  const result = new Map<string, PendingDoc>();
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const req = d.transaction('writes').objectStore('writes').openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) { resolve(); return; } if (String(c.key).startsWith(prefix())) result.set(c.value.key, c.value); c.continue(); };
      req.onerror = () => reject(req.error);
    });
  } catch { /* unavailable in some private contexts */ }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(prefix())) { const doc = JSON.parse(localStorage.getItem(k)!); if (doc) result.set(doc.key, doc); else result.delete(k.slice(prefix().length)); }
    }
  } catch { /* storage disabled */ }
  return [...result.values()];
}
