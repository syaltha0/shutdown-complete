import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError, type Doc } from './api';
import { keepPending, openOutbox } from './outbox';
import { clearDrafts, readDrafts, same, saveDraft, setDraftOwner } from './drafts';

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict' | 'offline';

const DEBOUNCE = 600;

/**
 * One shared store of documents. Every screen, the focus timer and the habit grid read and write the same entry
 * for a key, so the day open on Today and the timer ticking in the corner never overwrite each other.
 * A save carries the version it was based on; if another device wrote in between, the server refuses (409) and the
 * latest version replaces the local one, with status "conflict" so the screen can say so. What was refused is not
 * thrown away: it is kept as a draft (lib/drafts.ts) that the person can look at and put back.
 */
interface Entry {
  value: unknown;
  version: number;
  loaded: boolean;
  status: SaveStatus;
  error: string | null;
  pending: unknown | null; // the value waiting to be saved
  inflight: boolean;
  sentAt?: number; // when the save in flight left
  timer?: number;
  loading?: Promise<void>;
  listeners: Set<() => void>;
  snap: { value: unknown; status: SaveStatus; error: string | null };
}

const entries = new Map<string, Entry>();
const queueListeners = new Set<() => void>();
export async function restorePending(user: string) {
  setDraftOwner(user);
  for (const doc of await openOutbox(user)) {
    const e = entry(doc.key);
    e.value = e.pending = doc.value; e.version = doc.version; e.loaded = true; e.status = 'offline'; emit(e);
  }
  if (navigator.onLine) retryPending();
}
function retryPending() { entries.forEach((e, k) => { if (e.pending != null) { e.status = 'unsaved'; void flush(k); } }); }

/**
 * A server that cannot be reached while the browser itself is online (5xx, a dropped connection, no answer). A short
 * wait is normal and stays silent; once saves have failed for OUTAGE_AFTER (or three times in a row for OUTAGE_REPEAT),
 * `useOutage` turns true, and false again with the next save the server accepts.
 */
export const OUTAGE_AFTER = 20_000;
export const OUTAGE_REPEAT = 10_000;
const outageListeners = new Set<() => void>();
let outage: { since: number; fails: number } | null = null;
let stuck = false;
let outageTimer: number | undefined;
const unreachable = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status >= 500);
function judgeOutage() {
  window.clearTimeout(outageTimer);
  const now = Date.now();
  const hungSince = [...entries.values()].reduce((t, e) => (e.inflight && e.sentAt != null ? Math.min(t, e.sentAt) : t), Infinity); // a save that never answers
  const since = Math.min(outage?.since ?? Infinity, hungSince);
  const next = since !== Infinity && (now - since >= OUTAGE_AFTER || (!!outage && outage.fails >= 3 && now - since >= OUTAGE_REPEAT));
  if (!next && since !== Infinity) outageTimer = window.setTimeout(judgeOutage, Math.max(200, Math.min(since + OUTAGE_AFTER, outage && outage.fails >= 3 ? since + OUTAGE_REPEAT : Infinity) - now));
  if (next !== stuck) { stuck = next; outageListeners.forEach((l) => l()); }
}
function saveFailed() { outage = outage ?? { since: Date.now(), fails: 0 }; outage.fails++; judgeOutage(); }
function saveWorked() { if (outage) { outage = null; judgeOutage(); } }
/** Whether saves have been failing long enough to say so. */
export function useOutage() {
  return useSyncExternalStore((l) => { outageListeners.add(l); return () => { outageListeners.delete(l); }; }, () => stuck);
}
/** Send everything waiting again now (the "Retry" of the notice). */
export const retryNow = () => { if (outage) outage.fails = 0; retryPending(); };
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
  e.sentAt = Date.now();
  e.status = 'saving';
  emit(e);
  judgeOutage(); // a save that never answers counts too
  try {
    const doc: Doc<unknown> = await api.put(key, v, e.version, keepalive);
    saveWorked();
    if (readDrafts(key).some((d) => same(d.value, v))) clearDrafts(key);
    e.version = doc.version;
    e.status = e.pending != null ? 'unsaved' : 'saved';
    e.error = null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.body?.current) {
      saveWorked(); // the server answered
      const cur = err.body.current as Doc<unknown>;
      const mine = e.pending ?? v; // the newest local text (edits made while the save was out sit on top of it)
      if (!same(v, mine) && !same(v, cur.value)) saveDraft(key, v, cur.version);
      if (!same(mine, cur.value)) saveDraft(key, mine, cur.version);
      e.version = cur.version;
      e.value = cur.value;
      e.pending = null;
      e.status = 'conflict';
    } else {
      if (e.pending == null) e.pending = v; // keep it for the retry
      const offline = err instanceof ApiError && err.status === 0;
      e.status = offline ? 'offline' : 'error';
      e.error = offline ? null : err instanceof Error ? err.message : 'Could not save';
      if (unreachable(err)) {
        saveFailed();
        // try again by itself, a little later each time (the browser's own "online" and a click on Retry go straight away)
        if (navigator.onLine) e.timer = window.setTimeout(() => flush(key), Math.min(30_000, 2_000 * 2 ** Math.min(4, (outage?.fails ?? 1) - 1)));
      }
    }
  } finally {
    e.inflight = false;
    e.sentAt = undefined;
    judgeOutage();
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

/** Put a kept draft back as the document's next version (written over the server's, which the person confirmed). */
export async function restoreDraft(key: string, value: unknown) {
  await updateKey(key, () => value, () => value);
  await flush(key);
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
