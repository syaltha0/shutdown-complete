import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError, type Doc } from './api';
import { keepPending, openOutbox } from './outbox';

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict' | 'offline';

const DEBOUNCE = 600;

/**
 * One shared store of documents. Every screen, the focus timer and the habit grid read and write the same entry
 * for a key, so the day open on Today and the timer ticking in the corner never overwrite each other.
 * A save carries the version it was based on; if another device wrote in between, the server refuses (409) and the
 * latest version replaces the local one, with status "conflict" so the screen can say so.
 */
interface Entry {
  value: unknown;
  version: number;
  loaded: boolean;
  status: SaveStatus;
  error: string | null;
  pending: unknown | null; // the value waiting to be saved
  inflight: boolean;
  timer?: number;
  loading?: Promise<void>;
  listeners: Set<() => void>;
  snap: { value: unknown; status: SaveStatus; error: string | null };
}

const entries = new Map<string, Entry>();
const queueListeners = new Set<() => void>();
export async function restorePending(user: string) {
  for (const doc of await openOutbox(user)) {
    const e = entry(doc.key);
    e.value = e.pending = doc.value; e.version = doc.version; e.loaded = true; e.status = 'offline'; emit(e);
  }
  if (navigator.onLine) retryPending();
}
function retryPending() { entries.forEach((e, k) => { if (e.pending != null) { e.status = 'unsaved'; void flush(k); } }); }
export function usePendingCount() {
  return useSyncExternalStore((l) => { queueListeners.add(l); return () => { queueListeners.delete(l); }; }, () => [...entries.values()].filter((e) => e.pending != null || e.inflight).length);
}

function entry(key: string): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { value: null, version: 0, loaded: false, status: 'loading', error: null, pending: null, inflight: false, listeners: new Set(), snap: { value: null, status: 'loading', error: null } };
    entries.set(key, e);
  }
  return e;
}

function emit(e: Entry) {
  queueListeners.forEach((l) => l());
  e.snap = { value: e.value, status: e.status, error: e.error };
  e.listeners.forEach((l) => l());
}

function load(key: string, force = false): Promise<void> {
  const e = entry(key);
  if (e.loading && !force) return e.loading;
  if (e.loaded && !force) return Promise.resolve();
  e.loading = api.get(key).then((doc) => {
    if (e.pending == null) { e.value = doc.value; e.version = doc.version; }
    e.loaded = true;
    e.status = e.pending == null ? 'saved' : e.status;
    e.error = null;
    emit(e);
  }).catch((err) => {
    e.status = 'error';
    e.error = err instanceof Error ? err.message : 'Could not load';
    emit(e);
  }).finally(() => { e.loading = undefined; });
  return e.loading;
}

async function flush(key: string, keepalive = false) {
  const e = entry(key);
  window.clearTimeout(e.timer);
  if (e.inflight || e.pending == null) return;
  const v = e.pending;
  e.pending = null;
  e.inflight = true;
  e.status = 'saving';
  emit(e);
  try {
    const doc: Doc<unknown> = await api.put(key, v, e.version, keepalive);
    e.version = doc.version;
    e.status = e.pending != null ? 'unsaved' : 'saved';
    e.error = null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.body?.current) {
      const cur = err.body.current as Doc<unknown>;
      e.version = cur.version;
      e.value = cur.value;
      e.pending = null;
      e.status = 'conflict';
    } else {
      if (e.pending == null) e.pending = v; // keep it for the retry
      const offline = err instanceof ApiError && err.status === 0;
      e.status = offline ? 'offline' : 'error';
      e.error = offline ? null : err instanceof Error ? err.message : 'Could not save';
    }
  } finally {
    e.inflight = false;
    keepPending(e.pending == null ? null : { key, value: e.pending, version: e.version }, key);
    emit(e);
    if (e.pending != null && e.status !== 'error' && e.status !== 'offline') e.timer = window.setTimeout(() => flush(key), DEBOUNCE);
  }
}

/** Change a document from anywhere (the habit grid writes days it never opened). */
export async function updateKey<T>(key: string, fallback: () => T, fn: (v: T) => T) {
  const e = entry(key);
  if (!e.loaded) await load(key);
  const next = fn(((e.pending ?? e.value) as T | null) ?? fallback());
  e.value = next;
  e.pending = next;
  keepPending({ key, value: next, version: e.version }, key);
  if (e.status !== 'error' && e.status !== 'offline') e.status = 'unsaved';
  emit(e);
  window.clearTimeout(e.timer);
  e.timer = window.setTimeout(() => flush(key), DEBOUNCE);
}

/**
 * Fetch a document again if nothing local is waiting to be saved (a shared document others edit too); listeners
 * hear of it only when its version moved.
 */
export function refreshKey(key: string) {
  const e = entry(key);
  if (!e.loaded || e.pending != null || e.inflight || e.loading) return;
  api.get(key).then((doc) => {
    if (e.pending != null || e.inflight || doc.version === e.version) return;
    e.value = doc.value;
    e.version = doc.version;
    if (e.status === 'conflict' || e.status === 'error') e.status = 'saved';
    emit(e);
  }).catch(() => { /* the next round tries again */ });
}

/** Forget a document (a team project one has left): the next use loads it anew. */
export function dropKey(key: string) { const e = entries.get(key); if (e && e.pending == null) entries.delete(key); }

/** Save everything pending now (the page is being hidden or closed). */
function flushAll() { entries.forEach((e, k) => { if (e.pending != null) flush(k, true); }); }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
  // back online: send what could not be sent
  window.addEventListener('online', retryPending);
  window.addEventListener('focus', retryPending);
}

/** Whether any document is still waiting to be saved. */
export const hasPending = () => [...entries.values()].some((e) => e.pending != null || e.inflight);

/** One document, loaded from the server and saved back a moment after each change. */
export function useDoc<T>(key: string, fallback: () => T) {
  const e = entry(key);
  const subscribe = useCallback((l: () => void) => { const en = entry(key); en.listeners.add(l); return () => { en.listeners.delete(l); }; }, [key]);
  const snap = useSyncExternalStore(subscribe, () => entry(key).snap);
  useEffect(() => { load(key); }, [key]);
  const update = useCallback((fn: (v: T) => T) => updateKey(key, fallback, fn), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = e.loaded ? ((snap.value as T | null) ?? fallback()) : null;
  return {
    value,
    update,
    status: snap.status,
    error: snap.error,
    retry: () => (entry(key).pending != null ? flush(key) : load(key, true)),
  };
}

/** Every document of one kind between two keys. They join the shared store, so edits elsewhere show here at once. */
export function useRange<T>(from: string, to: string) {
  const [keys, setKeys] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    api.range<T>(from, to)
      .then((list) => {
        if (!live) return;
        for (const d of list) {
          const e = entry(d.key);
          if (e.pending == null && !e.inflight && (!e.loaded || d.version >= e.version)) {
            e.value = d.value; e.version = d.version; e.loaded = true; e.status = 'saved'; emit(e);
          }
        }
        setKeys(list.map((d) => d.key));
      })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [from, to, n]);
  // re-render when any document of this kind and range changes (also ones created after the range loaded)
  useEffect(() => {
    const kind = from.split(':')[0] + ':';
    const ls: (() => void)[] = [];
    const on = () => tick((x) => x + 1);
    const watch = () => {
      entries.forEach((e, k) => { if (k.startsWith(kind) && k >= from && k <= to && !e.listeners.has(on)) { e.listeners.add(on); ls.push(() => e.listeners.delete(on)); } });
    };
    watch();
    const t = window.setInterval(watch, 1000);
    return () => { window.clearInterval(t); ls.forEach((f) => f()); };
  }, [from, to, keys]);
  let docs: Map<string, T> | null = null;
  if (keys) {
    docs = new Map();
    entries.forEach((e, k) => { if (k >= from && k <= to && k.split(':')[0] === from.split(':')[0] && e.loaded && e.value != null) docs!.set(k, e.value as T); });
  }
  return { docs, error, retry: () => setN((x) => x + 1) };
}
