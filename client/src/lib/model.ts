import { dict, getLang, type Lang } from './i18n';

// The planner's documents. Each is stored whole under one key on the server (see server/src/db.mjs).

export type Kind = 'deep' | 'shallow' | 'meeting' | 'overflow' | 'personal';

export const KIND_IDS: Kind[] = ['deep', 'shallow', 'meeting', 'overflow', 'personal'];

export interface Block {
  id: string;
  start: number; // minutes since midnight
  end: number;
  label: string;
  note: string;
  kind: Kind;
  /** what the time is spent on (Maths, Project…), for the time-by-subject report */
  subject?: string;
  /** the weekly schedule entry this block was placed from */
  repeatId?: string;
  /** the exam this block is a study sitting for (lib/exam.ts) */
  examId?: string;
}

/** A block that comes back every week on `days` (Monday = 0), placed on each day from `since` on (lib/repeat.ts). */
export interface Repeat {
  id: string;
  label: string;
  note: string;
  kind: Kind;
  subject?: string;
  start: number;
  end: number;
  days: number[];
  since: string;
  /** every how many weeks: 1 (every week, the default) or 2 (an A/B timetable), counted from the week of `since` */
  every?: number;
}

/** One column of the day's plan. A revision starts at `from`; a column that was revised has `closedAt`. */
export interface Column {
  from: number | null;
  closedAt: number | null;
  blocks: Block[];
}

export interface Item {
  id: string;
  text: string;
  done: boolean;
  /** for a task carried over from an earlier day: the day it was first written down */
  since?: string;
  /** how long it will take, in minutes (the day warns when the tasks do not fit in its free time) */
  estimate?: number;
  /** the day it is due (homework, a form to send), and the hour on it (HH:MM) */
  due?: string;
  dueTime?: string;
  /** a notification this many minutes before the due time (0 = at it) */
  remind?: number;
  /** what it serves one scale up: a month goal serves a quarter goal, a week's item a month goal, a day's task a week's item */
  up?: ItemLink;
  /** its smaller steps (one level) */
  steps?: Item[];
  /** the board card this task was put on a day from (it moves to the board's last list when the task is done) */
  card?: CardLink;
  // the task lists (screens/Tasks.tsx) add these
  /** its list (none: the default list) */
  list?: string;
  /** when work on it begins */
  start?: string;
  /** 1 high, 5 medium, 9 low (as in iCalendar); none when not set */
  priority?: 1 | 5 | 9;
  /** how far along, 0-100 */
  percent?: number;
  tags?: string[];
  notes?: string;
  /** comes back when done */
  repeat?: Recur;
  /** times a repeating task was done, and the last day it was */
  doneCount?: number;
  lastDone?: string;
  /** when it was written down (ISO time) and done (a day) */
  created?: string;
  doneAt?: string;
  /** the name a task app gave it on the CalDAV side, when not <id>.ics */
  href?: string;
  /** minutes focused on it with the timer */
  spent?: number;
}

/**
 * A task that comes back: every `every` days / weeks / months / years; weeks may name their days (Monday = 0). Counted
 * from its due date, or from the day it is done (`after`).
 */
export interface Recur {
  every: number; unit: 'day' | 'week' | 'month' | 'year'; days?: number[]; after?: boolean;
  /** monthly and yearly: the day of the month it falls on (the 31st stays the 31st after a shorter month) */
  monthDay?: number;
  /** it ends: after this many times done, or after this day */
  count?: number;
  until?: string;
}
/** A list of tasks of one's own, with a colour of the labels' tints. */
export interface TaskList { id: string; name: string; color?: LabelColor }

/** An item of another document: its key (quarter:2026-Q4, month:2026-10, week:2026-W43) and its id. */
export interface ItemLink { key: string; id: string }
/** A card on a board: its project ('p:<id>' for one's own, 't:<id>' for a team's), board and card. */
export interface CardLink { project: string; board: string; card: string }

/** Kanban boards (screens/Boards.tsx): lists of cards, each card a piece of work with labels, a due date, a checklist. */
export type LabelColor = 'grey' | 'blue' | 'green' | 'amber' | 'red';
export interface Card {
  id: string;
  title: string;
  description: string;
  labels: string[];
  due?: string;
  estimate?: number;
  checklist: Item[];
  created: string;
  /** time spent on it: `total` seconds stopped, plus the run since `startedAt` (ms) while it runs */
  stopwatch?: { total: number; startedAt?: number };
  /** the day's task made from it (the task keeps its id when carried to a later day) */
  planned?: { day: string; task: string };
}
export interface BoardList { id: string; name: string; cards: Card[] }
export type BoardBg = 'ocean' | 'forest' | 'plum' | 'slate' | 'rust' | 'ink';
/** A project's background: one of the tones above, or a colour of the person's own (#rrggbb). */
export type Background = BoardBg | `#${string}`;
export interface Board { id: string; name: string; lists: BoardList[]; labels: { id: string; name: string; color: LabelColor }[]; created: string; background?: Background }
/** A project (Planka's): boards that belong together, with a description and one background for all of them. */
export interface ProjectData { name: string; description?: string; background?: Background; boards: Board[]; created: string }
export interface Project extends ProjectData { id: string }
/** The account's own projects; `boards` is the single list kept before projects existed (moved into one project). */
/** A board template of the account's own: lists (with cards, if it was saved with them) and labels, by name. */
export interface TemplateCard { title: string; description?: string; labels?: string[]; checklist?: string[] }
export interface BoardTemplate { id: string; name: string; lists: { name: string; cards?: TemplateCard[] }[]; labels: { name: string; color: LabelColor }[]; created: string }
export interface BoardsDoc { projects?: Project[]; boards?: Board[]; favorites?: string[]; templates?: BoardTemplate[] }
export const emptyBoards = (): BoardsDoc => ({ projects: [] });
/** A team project: a document shared with its members (key team:<id>). */
export type TeamDoc = ProjectData;
export const emptyTeam = (): TeamDoc => ({ name: '', boards: [], created: '' });

/** A date to count down to (an exam, a trip); `time` in minutes, `created` the day it was added. */
export type CountdownKind = 'exam' | 'due' | 'event' | 'birthday' | 'trip';
export interface Countdown { id: string; name: string; date: string; time: number | null; created?: string; kind?: CountdownKind; yearly?: boolean }

/** Things to do that belong to no day yet; moved onto a day when there is room for them. */
/** The tasks (the doc keeps its first name, 'inbox'): all lists' tasks in one array, done ones too, and the lists. */
export interface InboxDoc { items: Item[]; lists?: TaskList[] }
export const emptyInbox = (): InboxDoc => ({ items: [] });

export type FocusPhase = 'focus' | 'short' | 'long';

/** A running focus timer. The time left is worked out from `startedAt`, so a reload or another device carries on. */
export interface FocusActive {
  phase: FocusPhase;
  startedAt: string; // ISO; for a paused timer, when it was paused
  plannedMin: number;
  pausedLeft: number | null; // seconds left while paused
  blockId: string | null;
  label: string;
  /** a shared session with friends (lib/social.ts) this timer belongs to */
  roomId?: string;
  /** the task worked on: one of the day's tasks (`day`) or of the lists; its focused minutes add up on it */
  task?: { id: string; text: string; day?: boolean };
  /** what this session is for, in the person's words (optional) */
  intent?: string;
  /** the break after a focus phase, in minutes, when chosen at the start (else the settings' short break) */
  breakMin?: number;
  /** a break phase: the session it follows, so a note written during the break lands on that session */
  sessionId?: string;
}

export interface FocusSession {
  id: string;
  blockId: string | null;
  label: string;
  kind: Kind | null;
  subject?: string;
  start: string;
  end: string;
  minutes: number;
  taskId?: string;
  taskText?: string;
  intent?: string;
  /** a short note written after the session */
  note?: string;
}

export interface DayDoc {
  columns: Column[];
  tasks: Item[];
  notes: string;
  metrics: Record<string, number | boolean | null>;
  shutdown: { done: boolean; at: string | null; steps: Record<string, boolean> };
  focus?: { active: FocusActive | null; sessions: FocusSession[] };
  /** the weekly schedule entries already placed on this day (or deliberately left off it) */
  repeats?: string[];
}

export interface MonthDoc {
  goals: Item[];
  notes: string;
  dates: { id: string; date: string; text: string }[];
}

export interface WeekDoc {
  items: Item[];
  notes: string;
  /** when the week was planned with the weekly planning steps */
  plannedAt?: string;
}

export interface QuarterDoc {
  goals: Item[];
  notes: string;
}

export interface MetricDef {
  id: string;
  name: string;
  kind: 'number' | 'check';
  unit: string; // "h", "words"; empty for a check
  target: number | null; // per day
}

export interface FocusSettings {
  autoBreak?: boolean;
  autoFocus?: boolean;
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
  sound: boolean;
  metricId: string | null; // the number metric that collects focus time spent in deep blocks (hours)
}

/** A day's recurring blocks, suggested on the weekdays in `days` (Monday = 0). */
export interface DayTemplate {
  id: string;
  name: string;
  days: number[];
  blocks: { start: number; end: number; label: string; note: string; kind: Kind; subject?: string }[];
}

/** The parts of the planner one can turn off (Settings -> Features); the day, its scales, focus and shutdown stay. */
export type Feature = 'inbox' | 'boards' | 'countdown' | 'habits' | 'metrics' | 'friends' | 'exams';
export const FEATURES: Feature[] = ['inbox', 'boards', 'countdown', 'habits', 'metrics', 'friends', 'exams'];
/** Whether a part is on: everything is, unless it was turned off. */
export const featureOn = (s: { features?: Partial<Record<Feature, boolean>> }, f: Feature) => s.features?.[f] !== false;

export interface Settings {
  /** the week in review by e-mail every Sunday (when the server sends e-mail) */
  weeklyMail?: boolean;
  /** parts of the planner turned off (missing = on) */
  features?: Partial<Record<Feature, boolean>>;
  lang?: Lang;
  templates?: DayTemplate[];
  tourDone?: boolean;
  /** the first-run setup (workday, metrics, look) was finished or skipped */
  setupDone?: boolean;
  /** the first-run setup opened again from Settings (it then starts from the current settings and can be left unchanged) */
  setupAgain?: boolean;
  /** read-only calendar feeds (ICS) whose events show on the day's grid */
  calendars?: { id: string; name: string; url: string }[];
  focus?: FocusSettings;
  startHour: number;
  endHour: number;
  /** plan all 24 hours instead of startHour..endHour (kept, for switching back) */
  wholeDay?: boolean;
  /** blocks that come back every week */
  schedule?: Repeat[];
  /** dates counted down to on the Countdown screen */
  countdowns?: Countdown[];
  /** exams being studied for, with their study plan's settings */
  exams?: import('./exam').Exam[];
  /** subjects given to blocks so far, offered when naming the next one */
  subjects?: string[];
  /** a notification as a block begins (`before` minutes ahead; null = none) and a focus session started by itself */
  reminders?: { before: number | null; autoFocus: boolean };
  /** the first-run answers: what the planner is for, what it is used for, whether to focus with friends */
  profile?: { uses: string[]; activities: string[]; together: boolean };
  /** open tasks of earlier days: offered on today ('ask', the default) or moved by themselves ('auto') */
  carryTasks?: 'ask' | 'auto';
  metrics: MetricDef[];
  ritual: { id: string; text: string }[];
}

export const defaultFocus = (): FocusSettings => ({ focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, sound: true, metricId: 'deep' });

export const MAX_COLUMNS = 4;

export const uid = () => Math.random().toString(36).slice(2, 10);

export const emptyDay = (): DayDoc => ({
  columns: [{ from: null, closedAt: null, blocks: [] }],
  tasks: [],
  notes: '',
  metrics: {},
  shutdown: { done: false, at: null, steps: {} },
});

export const emptyWeek = (): WeekDoc => ({ items: [], notes: '' });
export const emptyQuarter = (): QuarterDoc => ({ goals: [], notes: '' });
export const emptyMonth = (): MonthDoc => ({ goals: [], notes: '', dates: [] });

// The shutdown ritual, in the language the planner starts in.
export const defaultSettings = (lang: Lang = getLang()): Settings => {
  const d = dict(lang).defaults;
  return {
    lang,
    focus: defaultFocus(),
    startHour: 9,
    endHour: 17,
    metrics: [
      { id: 'deep', name: d.metrics.deep.name, kind: 'number', unit: d.metrics.deep.unit, target: 3 },
      { id: 'exercise', name: d.metrics.exercise.name, kind: 'check', unit: '', target: null },
    ],
    ritual: ['inbox', 'capture', 'calendar', 'week', 'tomorrow'].map((id) => ({ id, text: d.ritual[id] })),
  };
};

/** On a language switch, default words the user never changed follow the new language; their own words stay. */
export function translateDefaults(s: Settings, from: Lang, to: Lang): Settings {
  const a = dict(from).defaults, b = dict(to).defaults;
  const ms = a.metrics as Record<string, { name: string; unit: string }>, mt = b.metrics as Record<string, { name: string; unit: string }>;
  return {
    ...s,
    lang: to,
    metrics: s.metrics.map((m) => (ms[m.id] ? {
      ...m,
      name: m.name === ms[m.id].name ? mt[m.id].name : m.name,
      unit: m.unit === ms[m.id].unit ? mt[m.id].unit : m.unit,
    } : m)),
    ritual: s.ritual.map((r) => (a.ritual[r.id] && r.text === a.ritual[r.id] ? { ...r, text: b.ritual[r.id] } : r)),
  };
}

/** The column being worked in: the last one. */
export const activeColumn = (d: DayDoc) => d.columns[d.columns.length - 1];

/** Minutes of each kind planned in a column, from its start (or revision point) on. */
export function plannedByKind(col: Column): Record<Kind, number> {
  const out = { deep: 0, shallow: 0, meeting: 0, overflow: 0, personal: 0 } as Record<Kind, number>;
  for (const b of col.blocks) out[b.kind] += b.end - b.start;
  return out;
}

/** Blocks of the plan as it stood at the end: each column's blocks up to where it was revised, then the last column. */
export function effectivePlan(d: DayDoc): Block[] {
  const out: Block[] = [];
  for (const col of d.columns) {
    for (const b of col.blocks) {
      if (col.closedAt == null) out.push(b);
      else if (b.start < col.closedAt) out.push({ ...b, end: Math.min(b.end, col.closedAt) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function minutesOfKind(d: DayDoc, kind: Kind): number {
  return effectivePlan(d).filter((b) => b.kind === kind).reduce((s, b) => s + b.end - b.start, 0);
}
