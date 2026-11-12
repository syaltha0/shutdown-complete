// Study for an exam: the topics are spread over the days before it, one sitting at a time, in the free time between
// the day's blocks (and its weekly schedule), within the hours chosen; the last days before the exam are for review.
// Spreading again keeps what is already behind you and plans the rest from now.
import { addDays, nowMinutes, today } from './dates';
import { activeColumn, emptyDay, uid, type Block, type DayDoc, type Repeat } from './model';
import { placeRepeats, weekdayOf } from './repeat';

export interface Exam {
  id: string;
  name: string;
  date: string;
  subject: string;
  topics: string[];
  daily: number; // minutes of study a day
  session: number; // minutes in one sitting
  days: number[]; // weekdays to study on, Monday = 0
  from: number; // the hours to study in, minutes
  to: number;
  review: number; // days right before the exam kept for review
}

export interface Sitting { date: string; start: number; end: number; label: string }

const GAP = 15; // a break between two sittings

/** The sittings for an exam, given the days as they are now. `docs` are the days' documents (missing = empty). */
export function planExam(exam: Exam, topics: string[], docs: Map<string, DayDoc>, schedule: Repeat[] | undefined, reviewLabel: string, againWord: string) {
  const t = today(), now = nowMinutes();
  const dates: string[] = [];
  for (let d = t; d < exam.date; d = addDays(d, 1)) if (exam.days.includes(weekdayOf(d))) dates.push(d);
  const reviewDates = new Set(dates.slice(Math.max(0, dates.length - exam.review)));
  const slots: Sitting[] = [];
  for (const date of dates) {
    const base = docs.get(`day:${date}`) ?? emptyDay();
    const day = placeRepeats(base, date, schedule) ?? base;
    const col = activeColumn(day);
    const busy = col.blocks.filter((b) => b.examId !== exam.id).map((b) => [b.start - GAP, b.end + GAP] as [number, number]);
    let from = Math.max(exam.from, col.from ?? 0);
    if (date === t) from = Math.max(from, Math.ceil((now + GAP) / 15) * 15);
    let left = exam.daily;
    for (let s = from; s + exam.session <= exam.to && left > 0; s += 15) {
      const e = s + Math.min(exam.session, left);
      if (e - s < 30) break;
      if (busy.some(([a, b]) => a < e && b > s)) continue;
      slots.push({ date, start: s, end: e, label: '' });
      busy.push([s - GAP, e + GAP]);
      left -= e - s;
      s = e + GAP - 15;
    }
  }
  // topics in order over the study sittings; more sittings than topics go round again, fewer share a sitting
  const study = slots.filter((x) => !reviewDates.has(x.date));
  const n = study.length;
  let crowded = false;
  if (topics.length && n) {
    if (topics.length <= n) study.forEach((x, i) => { x.label = i < topics.length ? topics[i] : `${topics[i % topics.length]} (${againWord})`; });
    else {
      crowded = true;
      study.forEach((x, i) => { x.label = topics.slice(Math.floor((i * topics.length) / n), Math.floor(((i + 1) * topics.length) / n)).join(', '); });
    }
  }
  for (const x of slots) if (reviewDates.has(x.date) || !x.label) x.label = reviewLabel;
  return { sittings: slots, crowded, days: new Set(slots.map((x) => x.date)).size };
}

/** A sitting as a block of the day. */
export const sittingBlock = (exam: Exam, x: Sitting): Block => ({
  id: uid(), start: x.start, end: x.end, label: x.label, note: exam.name, kind: 'deep', subject: exam.subject || exam.name, examId: exam.id,
});

/** Whether a sitting of this exam is still ahead (it may be moved by spreading again) or already behind. */
export const ahead = (date: string, b: Block) => date > today() || (date === today() && b.start >= nowMinutes());

/** Topics studied in sittings that are behind now; spreading again plans only the others. */
export function topicsLeft(exam: Exam, docs: Map<string, DayDoc>): string[] {
  const done = new Set<string>();
  for (const [k, d] of docs) {
    const date = k.slice(4);
    for (const b of activeColumn(d).blocks) if (b.examId === exam.id && !ahead(date, b)) b.label.split(', ').forEach((x) => done.add(x.replace(/ \(.*\)$/, '')));
  }
  return exam.topics.filter((x) => !done.has(x));
}
