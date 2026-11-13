import { BlockTaskLink } from '../components/TaskBlockLink';
import { FocusLog } from '../components/FocusLog';
import { useEffect, useRef, useState } from 'react';
import { clock, duration } from '../lib/dates';
import { useT } from '../lib/i18n';
import { KIND_IDS, type Block, type DayDoc, type FocusSession } from '../lib/model';
import { kindSwatch, type ReviseMode } from './TimeGrid';
import { Segmented } from '../components/Segmented';
import { DayChips, weekdayNames } from './Templates';

function times(min: number, max: number) {
  const out: number[] = [];
  for (let m = Math.ceil(min / 15) * 15; m <= max; m += 15) out.push(m);
  return out;
}

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

/** Edits one block of the active column. Every change applies at once; Done closes. */
export function BlockEditor({
  date, day, sessions, block, min, max, onChange, onDelete, onClose, subjects = [], repeatDays = [], onRepeat, estimate, repeatEvery = 1, onRepeatEvery,
}: {
  date?: string;
  day?: DayDoc;
  sessions?: FocusSession[];
  block: Block | null;
  min: number;
  max: number;
  onChange: (patch: Partial<Block>) => void;
  onDelete: () => void;
  onClose: () => void;
  /** subjects given before, offered as suggestions */
  subjects?: string[];
  /** the weekdays (Monday = 0) this block comes back on; empty for a one-off */
  repeatDays?: number[];
  onRepeat?: (days: number[]) => void;
  /** every how many weeks the repeat comes (1 or 2) */
  repeatEvery?: number;
  onRepeatEvery?: (n: number) => void;
  /** how long blocks like this one really took, when they usually run long */
  estimate?: { ratio: number; n: number; suggested: number } | null;
}) {
  const T = useT();
  const ref = useModal(!!block);
  const kind = block ? T.kinds[block.kind] : null;
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-labelledby="be-title">
      {block && kind && <form method="dialog" onSubmit={onClose}>
        <h2 id="be-title">{block.label ? T.editBlock : T.newBlock}</h2>
        <FocusLog sessions={sessions} block={block} />
        <BlockTaskLink block={block} day={day} date={date} />
        <div className="field">
          <label htmlFor="be-label">{T.whatFor}</label>
          <input id="be-label" className="input" autoFocus value={block.label} placeholder={T.labelPh}
            onChange={(e) => onChange({ label: e.target.value, taskLabelCustom: true })} />
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="be-start">{T.starts}</label>
            <select id="be-start" className="input num" value={block.start}
              onChange={(e) => { const s = Number(e.target.value); onChange({ start: s, end: Math.max(block.end, s + 15) }); }}>
              {times(min, max - 15).map((m) => <option key={m} value={m}>{clock(m)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="be-end">{T.ends}</label>
            <select id="be-end" className="input num" value={block.end} onChange={(e) => onChange({ end: Number(e.target.value) })}>
              {times(block.start + 15, max).map((m) => <option key={m} value={m}>{clock(m)}</option>)}
            </select>
          </div>
        </div>
        {estimate && estimate.suggested > block.end - block.start && (
          <p className="est-hint">
            {T.estHint(Math.round((estimate.ratio - 1) * 100), estimate.n)}{' '}
            <button type="button" className="card-link" onClick={() => onChange({ end: Math.min(max, block.start + estimate.suggested) })}>{T.estApply(duration(estimate.suggested))}</button>
          </p>
        )}
        <div className="field">
          <span className="label" id="be-kind">{T.kind}</span>
          <div className="kind-pick" role="group" aria-labelledby="be-kind">
            {KIND_IDS.map((k) => (
              <button key={k} type="button" aria-pressed={block.kind === k} onClick={() => onChange({ kind: k })}>
                <i style={kindSwatch(k)} />{T.kinds[k].name}
              </button>
            ))}
          </div>
          <span className="kind-hint">{kind.hint}</span>
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="be-subject">{T.subject}</label>
            <input id="be-subject" className="input" list="be-subjects" value={block.subject ?? ''} placeholder={T.subjectPh}
              onChange={(e) => onChange({ subject: e.target.value || undefined })} />
            <datalist id="be-subjects">{subjects.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
        </div>
        {onRepeat && (
          <div className="field">
            <span className="label" id="be-repeat">{T.repeatWeekly}</span>
            <DayChips days={repeatDays} onChange={onRepeat} label={T.repeatWeekly} />
            {repeatDays.length > 0 && onRepeatEvery && (
              <Segmented className="sm" role="group" aria-label={T.repeatEveryLabel}>
                <button type="button" aria-pressed={repeatEvery <= 1} onClick={() => onRepeatEvery(1)}>{T.everyWeek}</button>
                <button type="button" aria-pressed={repeatEvery === 2} onClick={() => onRepeatEvery(2)}>{T.everyOtherWeek}</button>
              </Segmented>
            )}
            <span className="kind-hint">{repeatDays.length ? T.repeatOn(listOf(repeatDays.map((d) => weekdayNames()[d]))) : T.repeatNone}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="be-note">{T.note}</label>
          <textarea id="be-note" className="input" rows={2} value={block.note}
            placeholder={block.kind === 'overflow' ? T.notePhOverflow : T.notePh}
            onChange={(e) => onChange({ note: e.target.value })} />
        </div>
        <div className="foot">
          <button type="button" className="btn danger" onClick={onDelete}>{T.deleteBlock}</button>
          <div className="right"><button type="submit" className="btn primary">{T.done}</button></div>
        </div>
      </form>}
    </dialog>
  );
}

const listOf = (xs: string[]) => new Intl.ListFormat(useT().locale, { type: 'conjunction' }).format(xs);

/** The move when the day breaks: cross out the rest and redraw from now in the next column. */
export function ReviseDialog({
  open, defaultAt, min, max, remaining, onConfirm, onClose, preview,
}: {
  open: boolean;
  defaultAt: number;
  min: number;
  max: number;
  remaining: number; // columns left after this one
  onConfirm: (at: number, mode: ReviseMode) => void;
  onClose: () => void;
  /** what pushing the rest later would do from a time: blocks moved, blocks that no longer fit */
  preview?: (at: number) => { moved: number; leftover: number };
}) {
  const T = useT();
  const ref = useModal(open);
  const [at, setAt] = useState(defaultAt);
  const [mode, setMode] = useState<ReviseMode>('cut');
  useEffect(() => { if (open) { setAt(defaultAt); setMode('cut'); } }, [open, defaultAt]);
  const p = mode === 'shift' && preview ? preview(at) : null;
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-labelledby="rv-title">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); onConfirm(at, mode); }}>
        <h2 id="rv-title">{T.reviseTitle}</h2>
        <p className="muted">
          {T.reviseBody}
          {T.columnsLeft(remaining)}
        </p>
        <div className="field">
          <label htmlFor="rv-at">{T.redrawFromLabel}</label>
          <select id="rv-at" className="input num" value={at} onChange={(e) => setAt(Number(e.target.value))}>
            {times(min, max - 15).map((m) => <option key={m} value={m}>{clock(m)}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="label" id="rv-mode">{T.reviseRest}</span>
          <Segmented role="group" aria-labelledby="rv-mode">
            {(['cut', 'shift', 'none'] as ReviseMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{T.reviseModes[m]}</button>
            ))}
          </Segmented>
          <span className="kind-hint">{T.reviseModeHint[mode]}</span>
          {p && <span className="kind-hint num">{T.shiftPreview(p.moved, p.leftover)}</span>}
        </div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{T.cancel}</button>
          <div className="right"><button type="submit" className="btn primary">{T.reviseFrom(clock(at))}</button></div>
        </div>
      </form>
    </dialog>
  );
}
