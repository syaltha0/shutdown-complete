// How much of a day is left once what is fixed, the deep work already planned and the tasks' estimates are taken out
// (the preview while spreading the week's items over its days). Time is counted with `unionMinutes`, so blocks that
// overlap, or a calendar event that is also blocked out on the day, take the same minutes once.
import { unionMinutes, type Span } from './intervals';
import { effectivePlan, emptyDay, minutesOfKind, type DayDoc, type DayTemplate, type Item, type Repeat, type ScheduleException } from './model';
import { isExcepted, placeRepeats, weekdayOf } from './repeat';

export interface CapacitySettings {
  startHour: number;
  endHour: number;
  wholeDay?: boolean;
  schedule?: Repeat[];
  templates?: DayTemplate[];
  exceptions?: ScheduleException[];
}

export interface CapacityInput {
  date: string;
  /** the day's document, none when it was never opened */
  doc?: DayDoc | null;
  /** the day's calendar events (the same ones the day grid shows) */
  events?: readonly { start: number; end: number; allDay: boolean }[];
  settings: CapacitySettings;
  /** minutes since midnight to count from (the time now, for today) */
  from?: number;
  /** tasks to be put on the day, not saved yet (a task the day already has by the same words is not counted twice) */
  adding?: readonly Item[];
}

export interface DayCapacity {
  /** the day's hours, from `from` on */
  available: number;
  /** calendar events, the schedule's and templates' blocks, personal blocks and other blocks that are not deep work */
  fixed: number;
  /** deep work planned on top of the fixed time */
  planned: number;
  /** the estimates of the open tasks not yet on the grid */
  estimated: number;
  /** what remains: negative when the day is overfull */
  left: number;
  /** open tasks (not on the grid) without an estimate */
  unestimated: number;
  /** deep minutes on the day as the week's capacity note counts them (whole day, overlap with fixed time included) */
  deep: number;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function dayCapacity({ date, doc, events = [], settings, from, adding = [] }: CapacityInput): DayCapacity {
  const base = doc ?? emptyDay();
  const day = placeRepeats(base, date, settings.schedule, settings.exceptions) ?? base; // the weekly schedule, as the day will place it
  const blocks = effectivePlan(day);
  // a day with no blocks is offered its template (unless the schedule exception covers it), as the day screen does
  const tpl = blocks.length === 0
    ? (settings.templates ?? []).find((t) => t.days.includes(weekdayOf(date)) && !isExcepted(settings.exceptions, date, t.id))
    : undefined;
  const all: { start: number; end: number; kind: string }[] = [...blocks, ...(tpl?.blocks ?? [])];

  const [h0, h1] = settings.wholeDay ? [0, 24] : [settings.startHour, settings.endHour];
  const r0 = Math.min(h0 * 60, ...all.map((b) => b.start));
  const r1 = Math.max(h1 * 60, ...all.map((b) => b.end));
  const lo = Math.max(r0, from ?? r0);
  const fixedSpans: Span[] = [...events.filter((e) => !e.allDay), ...all.filter((b) => b.kind !== 'deep')];
  const deepSpans: Span[] = all.filter((b) => b.kind === 'deep');
  const available = Math.max(0, r1 - lo);
  const fixed = unionMinutes(fixedSpans, lo, r1);
  const planned = unionMinutes([...fixedSpans, ...deepSpans], lo, r1) - fixed;

  // open tasks: those the day has, and those about to be put on it, minus any that already have a block
  const onGrid = new Set([...blocks, ...(tpl?.blocks ?? [])].map((b) => b.label.trim().toLocaleLowerCase()));
  const taskIds = new Set(blocks.flatMap((b) => (b.task ? [b.task.id] : [])));
  const own = day.tasks.filter((x) => !x.done && x.text.trim());
  const incoming = adding.filter((x) => !x.done && x.text.trim() && !day.tasks.some((t) => same(t.text, x.text)));
  const open = [...own, ...incoming].filter((x) => !onGrid.has(x.text.trim().toLocaleLowerCase()) && !taskIds.has(x.id));
  const estimated = open.reduce((n, x) => n + (x.estimate ?? 0), 0);
  const unestimated = open.filter((x) => !x.estimate).length;

  return { available, fixed, planned, estimated, left: available - fixed - planned - estimated, unestimated, deep: minutesOfKind(day, 'deep') };
}
