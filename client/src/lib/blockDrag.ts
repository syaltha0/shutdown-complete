export type BlockInterval = { start: number; end: number };
export type BlockDragMode = 'move' | 'start' | 'end';
export const snapBlockMinute = (minute: number) => Math.round(minute / 5) * 5;

/** Delta is measured from the original press, so rounding never accumulates. */
export function dragBlock(original: BlockInterval, mode: BlockDragMode, delta: number, min: number, max: number): BlockInterval {
  const bound = (value: number, low: number, high: number) => Math.max(low, Math.min(high, snapBlockMinute(value)));
  if (mode === 'start') return { start: bound(original.start + delta, min, original.end - 15), end: original.end };
  if (mode === 'end') return { start: original.start, end: bound(original.end + delta, original.start + 15, max) };
  const length = original.end - original.start;
  // An oversized imported block has no legal move; retain it for the editor to repair.
  if (length > max - min) return { ...original };
  const start = bound(original.start + delta, min, max - length);
  return { start, end: start + length };
}
