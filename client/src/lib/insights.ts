// What the revision columns say about how plans hold up. The first column is the plan; each later column starts where
// the plan broke. A block the day broke inside and that went on under the same name in the next column ran over by
// the difference; one that was dropped was cut. From weeks of that: where the day usually breaks, which kinds of
// blocks run long (and by how much), how much of the planned deep focus happened.
import type { Block, DayDoc } from './model';
import { effectivePlan } from './model';

const keyOf = (b: Block) => (b.subject?.trim() || b.label.trim()).toLocaleLowerCase();
const nameOf = (b: Block) => b.subject?.trim() || b.label.trim();

export interface Insights {
  days: number; // days with a plan
  revised: number; // of those, days redrawn at least once
  breakWindow: [number, number] | null; // the two hours in which the day breaks most often, as minutes
  overruns: { name: string; key: string; n: number; ratio: number }[]; // blocks that run long, longest first
  morning: { kept: number; total: number }; // plan blocks starting before noon that stayed as planned
  afternoon: { kept: number; total: number };
  deep: { planned: number; done: number };
}

export function insights(docs: Iterable<DayDoc>): Insights {
  let days = 0, revised = 0;
  const breaks = new Array(24).fill(0);
  const runs = new Map<string, { name: string; n: number; planned: number; actual: number }>();
  const morning = { kept: 0, total: 0 }, afternoon = { kept: 0, total: 0 };
  const deep = { planned: 0, done: 0 };
  for (const d of docs) {
    const plan = d.columns[0]?.blocks ?? [];
    if (!plan.length) continue;
    days++;
    if (d.columns.length > 1) revised++;
    for (const c of d.columns) if (c.closedAt != null) breaks[Math.min(23, Math.floor(c.closedAt / 60))]++;
    // each plan block: did it survive as planned, and if the day broke inside it, how long did it really take?
    for (const b of plan) {
      const half = b.start < 12 * 60 ? morning : afternoon;
      half.total++;
      const cut = d.columns[0].closedAt;
      if (cut == null || b.end <= cut) { half.kept++; continue; }
      if (b.start >= cut) continue; // redrawn before it began: a change of plan, not a block running long
      // follow the block through the columns under the same name
      let end: number | null = null;
      for (let i = 1; i < d.columns.length; i++) {
        const next = d.columns[i].blocks.find((x) => keyOf(x) === keyOf(b) && x.start <= (d.columns[i].from ?? 0) + 15);
        if (!next) break;
        end = d.columns[i].closedAt != null && next.end > d.columns[i].closedAt! ? null : next.end;
        if (end != null) break;
      }
      if (end == null || !keyOf(b)) continue;
      const r = runs.get(keyOf(b)) ?? { name: nameOf(b), n: 0, planned: 0, actual: 0 };
      r.n++; r.planned += b.end - b.start; r.actual += end - b.start;
      runs.set(keyOf(b), r);
    }
    deep.planned += plan.filter((b) => b.kind === 'deep').reduce((s, b) => s + b.end - b.start, 0);
    deep.done += effectivePlan(d).filter((b) => b.kind === 'deep').reduce((s, b) => s + b.end - b.start, 0);
  }
  // the hour the day breaks in most often (two hours when the breaks are spread over the next one too)
  let breakWindow: [number, number] | null = null;
  const peak = breaks.indexOf(Math.max(...breaks));
  if (breaks[peak] >= 2) {
    const wide = peak < 23 && breaks[peak + 1] >= breaks[peak] / 2;
    breakWindow = [peak * 60, (peak + (wide ? 2 : 1)) * 60];
  }
  const overruns = [...runs.entries()]
    .map(([key, r]) => ({ key, name: r.name, n: r.n, ratio: r.actual / r.planned }))
    .filter((r) => r.n >= 2 && r.ratio >= 1.15)
    .sort((a, b) => b.ratio - a.ratio);
  return { days, revised, breakWindow, overruns, morning, afternoon, deep };
}

/** For a block being planned: how long blocks like it have really taken, if they usually run long. */
export function estimateFor(ins: Insights | null, b: Block): { ratio: number; n: number; suggested: number } | null {
  if (!ins) return null;
  const r = ins.overruns.find((x) => x.key === keyOf(b));
  if (!r) return null;
  const len = b.end - b.start;
  return { ratio: r.ratio, n: r.n, suggested: Math.round((len * r.ratio) / 15) * 15 };
}
