import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../App';
import { addDays, clock, duration, fmtDay, nowMinutes, today } from '../lib/dates';
import { ahead, planExam, sittingBlock, topicsLeft, type Exam } from '../lib/exam';
import { useT } from '../lib/i18n';
import { emptyDay, emptyMonth, uid, type DayDoc, type MonthDoc } from '../lib/model';
import { placeRepeats } from '../lib/repeat';
import { updateKey, useRange } from '../lib/useDoc';
import { DayChips } from './Templates';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Plan for an exam: its date, its topics and how much to study a day; the sittings are spread over the days before
 * it in the free time between the blocks (a preview first), and saved as deep-focus blocks with the exam's subject.
 * Opened again for an exam, it spreads what is left from now on (sittings already behind stay where they were).
 */
export function ExamPlanner({ open, exam, onClose, start }: { open: boolean; exam: Exam | null; onClose: () => void; start?: { name: string; date: string } }) {
  const T = useT();
  const { settings, update } = useSettings();
  const ref = useRef<HTMLDialogElement>(null);
  const fresh = (): Exam => ({
    id: uid(), name: '', date: addDays(today(), 14), subject: '', topics: [], daily: 120, session: 60, days: ALL_DAYS,
    from: settings.wholeDay ? 9 * 60 : settings.startHour * 60, to: settings.wholeDay ? 22 * 60 : Math.max(settings.endHour * 60, 21 * 60), review: 1,
  });
  const [e, setE] = useState<Exam>(fresh);
  const [topicsText, setTopicsText] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); const x = exam ?? { ...fresh(), ...(start ?? {}) }; setE(x); setTopicsText(x.topics.join('\n')); setSaved(null); }
    if (!open && d.open) d.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = !!e.name.trim() && e.date > today();
  const { docs } = useRange<DayDoc>(`day:${today()}`, `day:${valid ? e.date : today()}`);
  const topics = topicsText.split('\n').map((x) => x.trim()).filter(Boolean);
  const plan = useMemo(() => {
    if (!valid || !docs) return null;
    // spreading again: this exam's sittings still ahead are planned anew, the topics already studied are left out
    const clean = new Map([...docs].map(([k, d]) => [k, { ...d, columns: d.columns.map((c) => ({ ...c, blocks: c.blocks.filter((b) => !(b.examId === e.id && ahead(k.slice(4), b))) })) }]));
    const left = exam ? topicsLeft({ ...e, topics }, docs) : topics;
    return planExam(e, left, clean, settings.schedule, T.examReviewLabel, T.examAgain, settings.exceptions);
  }, [valid, docs, e, topicsText, settings.schedule, settings.exceptions]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!plan || !valid) return;
    const x: Exam = { ...e, name: e.name.trim(), subject: e.subject.trim() || e.name.trim(), topics };
    const byDate = new Map<string, typeof plan.sittings>();
    for (const s of plan.sittings) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
    // every day up to the exam: this exam's sittings still ahead go, the new ones come in
    for (let d = today(); d < x.date; d = addDays(d, 1)) {
      const add = (byDate.get(d) ?? []).map((s) => sittingBlock(x, s));
      const touched = docs?.get(`day:${d}`)?.columns.some((c) => c.blocks.some((b) => b.examId === x.id));
      if (!add.length && !touched) continue;
      await updateKey<DayDoc>(`day:${d}`, emptyDay, (doc0) => {
        const doc = placeRepeats(doc0, d, settings.schedule, settings.exceptions) ?? doc0;
        const last = doc.columns.length - 1;
        return { ...doc, columns: doc.columns.map((c, i) => (i !== last ? c : {
          ...c, blocks: [...c.blocks.filter((b) => !(b.examId === x.id && (d > today() || b.start >= nowMinutes()))), ...add].sort((a, z) => a.start - z.start),
        })) };
      });
    }
    // the exam itself: in the list of exams, and among the month's dates to remember
    update((s) => ({ ...s, exams: [...(s.exams ?? []).filter((y) => y.id !== x.id), x] }));
    if (!exam) await updateKey<MonthDoc>(`month:${x.date.slice(0, 7)}`, emptyMonth, (m) => ({ ...m, dates: [...(m.dates ?? []), { id: uid(), date: x.date, text: x.name }] }));
    setSaved(plan.sittings.length);
  }

  const hours = Array.from({ length: 25 }, (_, h) => h * 60);
  const set = (p: Partial<Exam>) => setE((x) => ({ ...x, ...p }));
  return (
    <dialog ref={ref} className="sheet exam-sheet" onClose={onClose} aria-labelledby="ex-title">
      <form method="dialog" onSubmit={(ev) => { ev.preventDefault(); if (saved != null) onClose(); else save(); }}>
        <h2 id="ex-title">{exam ? T.examReplanTitle(exam.name) : T.examTitle}</h2>
        <p className="muted">{T.examAbout}</p>
        <div className="row2">
          <div className="field">
            <label htmlFor="ex-name">{T.examName}</label>
            <input id="ex-name" className="input" value={e.name} placeholder={T.examNamePh} autoFocus={!exam} onChange={(ev) => set({ name: ev.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ex-date">{T.examDate}</label>
            <input id="ex-date" className="input num" type="date" value={e.date} min={addDays(today(), 1)} onChange={(ev) => set({ date: ev.target.value })} />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="ex-subject">{T.subject}</label>
            <input id="ex-subject" className="input" list="ex-subjects" value={e.subject} placeholder={e.name || T.subjectPh} onChange={(ev) => set({ subject: ev.target.value })} />
            <datalist id="ex-subjects">{(settings.subjects ?? []).map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="ex-review">{T.examReview}</label>
            <select id="ex-review" className="input num" value={e.review} onChange={(ev) => set({ review: Number(ev.target.value) })}>
              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ex-topics">{T.examTopics}</label>
          <textarea id="ex-topics" className="input" rows={4} value={topicsText} placeholder={T.examTopicsPh} onChange={(ev) => setTopicsText(ev.target.value)} />
        </div>
        <div className="row4">
          <div className="field">
            <label htmlFor="ex-daily">{T.examDaily}</label>
            <select id="ex-daily" className="input num" value={e.daily} onChange={(ev) => set({ daily: Number(ev.target.value) })}>
              {[30, 45, 60, 90, 120, 150, 180, 240, 300].map((m) => <option key={m} value={m}>{duration(m)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ex-session">{T.examSession}</label>
            <select id="ex-session" className="input num" value={e.session} onChange={(ev) => set({ session: Number(ev.target.value) })}>
              {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{duration(m)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ex-from">{T.examFrom}</label>
            <select id="ex-from" className="input num" value={e.from} onChange={(ev) => set({ from: Number(ev.target.value), to: Math.max(e.to, Number(ev.target.value) + 60) })}>
              {hours.slice(0, 24).map((m) => <option key={m} value={m}>{clock(m)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ex-to">{T.examTo}</label>
            <select id="ex-to" className="input num" value={e.to} onChange={(ev) => set({ to: Number(ev.target.value) })}>
              {hours.filter((m) => m > e.from).map((m) => <option key={m} value={m}>{m === 1440 ? '24:00' : clock(m)}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <span className="label">{T.examDays}</span>
          <DayChips days={e.days} onChange={(days) => set({ days })} label={T.examDays} />
        </div>

        <div className="exam-preview" aria-live="polite">
          {!valid ? <p className="muted">{T.examFill}</p> : !plan ? <div className="skeleton" style={{ height: 80 }} /> : plan.sittings.length === 0 ? <p className="muted">{T.examNone}</p> : (
            <>
              <p><b>{T.examPreview(plan.sittings.length, plan.days)}</b>{plan.crowded ? <span className="muted"> · {T.examTight}</span> : null}</p>
              <ol className="exam-list">
                {plan.sittings.map((s, i) => (
                  <li key={i}><span className="num muted">{fmtDay(s.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {clock(s.start)}–{clock(s.end)}</span><span>{s.label}</span></li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div className="foot">
          <button type="button" className="btn ghost" onClick={onClose}>{T.cancel}</button>
          <div className="right">
            {saved != null && <span className="ok-line" role="status">{T.examDone(saved)}</span>}
            {saved != null
              ? <button type="submit" className="btn primary">{T.done}</button>
              : <button type="submit" className="btn primary" disabled={!plan || plan.sittings.length === 0}>{exam ? T.examReplan : T.examCreate}</button>}
          </div>
        </div>
      </form>
    </dialog>
  );
}
