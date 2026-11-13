// Time taken by a set of ranges: where blocks overlap, a minute counts once (the union, not the sum).
export interface Span { start: number; end: number }

/** Minutes covered by the spans, optionally clipped to [from, to]. */
export function unionMinutes(spans: readonly Span[], from = -Infinity, to = Infinity): number {
  const clipped = spans
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let total = 0, edge = -Infinity;
  for (const s of clipped) {
    if (s.end <= edge) continue;
    total += s.end - Math.max(s.start, edge);
    edge = s.end;
  }
  return total;
}
