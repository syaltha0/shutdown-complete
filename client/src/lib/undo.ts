import { useSyncExternalStore } from 'react';

// Undo for deletions: whatever was just removed (a block, a task, a template…) can be put back for a few seconds,
// from the note at the bottom of the screen or with Ctrl+Z (⌘Z). Only the latest deletion is kept.

interface Offer { id: number; message: string; restore: () => void; until: number }

const WINDOW = 8000;
let current: Offer | null = null;
let n = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Something was deleted: offer to put it back. `restore` must re-insert it into the latest state, not overwrite it. */
export function offerUndo(message: string, restore: () => void) {
  const offer = { id: ++n, message, restore, until: Date.now() + WINDOW };
  current = offer;
  emit();
  window.setTimeout(() => { if (current === offer) { current = null; emit(); } }, WINDOW);
}

/** Puts back the latest deletion, if it is still on offer. */
export function undo() {
  const o = current;
  if (!o || Date.now() > o.until) return false;
  current = null;
  emit();
  o.restore();
  return true;
}

export const dismissUndo = () => { current = null; emit(); };

export function useUndoOffer() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current);
}

/** Puts an item back at the place it had in a list (or at the end, if the list got shorter). */
export const insertAt = <T,>(list: T[], at: number, item: T) => [...list.slice(0, at), item, ...list.slice(at)];
