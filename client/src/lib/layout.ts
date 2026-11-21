type Interval = { start: number; end: number };

/** Half-open intervals: touching blocks can reuse a lane. */
export function layoutBlocks(blocks: readonly (Interval & { id: string })[]) {
  const result = new Map<string, { lane: number; lanes: number }>();
  let group: { id: string; lane: number }[] = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    for (const b of group) result.set(b.id, { lane: b.lane, lanes: ends.length });
    group = []; ends = [];
  };
  for (const b of [...blocks].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))) {
    if (b.start >= groupEnd) flush();
    let lane = ends.findIndex(end => end <= b.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = b.end;
    group.push({ id: b.id, lane });
    groupEnd = Math.max(group.length === 1 ? -Infinity : groupEnd, b.end);
  }
  flush();
  return result;
}

/** Find a usable gap, shortening the default hour rather than crossing its end. */
export function suggestBlockStart(blocks: readonly Interval[], start: number, end: number, now?: number): Interval & { noGap?: true } {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  let cursor = Math.max(start, now == null ? start : Math.ceil(now / 15) * 15);
  for (const b of sorted) {
    if (b.end <= cursor) continue;
    const gapEnd = Math.min(end, b.start);
    if (gapEnd - cursor >= 30) return { start: cursor, end: Math.min(cursor + 60, gapEnd) };
    cursor = Math.max(cursor, b.end);
  }
  if (end - cursor >= 30) return { start: cursor, end: Math.min(cursor + 60, end) };
  // No usable gap: keep a valid half hour inside the day; the editor warns on overlap.
  const lastEnd = Math.max(start, ...blocks.map(b => b.end));
  const fallback = Math.max(start, Math.min(end - 30, lastEnd));
  return { start: fallback, end: Math.min(end, fallback + 60), noGap: true };
}
