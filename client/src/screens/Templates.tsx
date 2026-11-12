import { useEffect, useRef, useState } from 'react';
import { fmtDay, weekDays, weekOf, today } from '../lib/dates';
import { useT } from '../lib/i18n';
import { uid, type Block, type Column, type DayTemplate } from '../lib/model';

/** Monday-first short weekday names in the current language. */
export function weekdayNames() {
  return weekDays(weekOf(today())).map((d) => fmtDay(d, { weekday: 'short' }));
}

/** Monday = 0 … Sunday = 6 */
export const weekdayIndex = (date: string) => (new Date(`${date}T12:00:00`).getDay() + 6) % 7;

/**
 * The template's blocks added to a column: only those after the column's revision point, and none on top of a block
 * that is already there. Returns the new list of blocks and how many were added.
 */
export function applyTemplate(col: Column, tpl: DayTemplate, floor: number): { blocks: Block[]; added: number } {
  const blocks = [...col.blocks];
  let added = 0;
  for (const t of tpl.blocks) {
    if (t.start < floor) continue;
    if (blocks.some((b) => b.start < t.end && b.end > t.start)) continue;
    blocks.push({ id: uid(), start: t.start, end: t.end, label: t.label, note: t.note, kind: t.kind });
    added++;
  }
  return { blocks: blocks.sort((a, z) => a.start - z.start), added };
}

export const templateFromBlocks = (name: string, days: number[], blocks: Block[]): DayTemplate => ({
  id: uid(), name, days, blocks: blocks.map(({ start, end, label, note, kind, subject }) => ({ start, end, label, note, kind, subject })),
});

export function DayChips({ days, onChange, label }: { days: number[]; onChange: (d: number[]) => void; label: string }) {
  const names = weekdayNames();
  return (
    <div className="day-chips" role="group" aria-label={label}>
      {names.map((n, i) => (
        <button key={i} type="button" aria-pressed={days.includes(i)}
          onClick={() => onChange(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{n}</button>
      ))}
    </div>
  );
}

/** Apply a template to the day, or save the day as a new one. */
export function TemplatesDialog({
  open, templates, canSave, weekday, onApply, onSave, onClose,
}: {
  open: boolean;
  templates: DayTemplate[];
  canSave: boolean;
  weekday: number;
  onApply: (t: DayTemplate) => void;
  onSave: (name: string, days: number[]) => void;
  onClose: () => void;
}) {
  const T = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([weekday]);
  const names = weekdayNames();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setName(''); setDays([weekday]); }
    if (!open && d.open) d.close();
  }, [open, weekday]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-labelledby="tp-title">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim(), days); }}>
        <h2 id="tp-title">{T.tplTitle}</h2>
        {templates.length === 0 ? <p className="muted">{T.tplNone}</p> : (
          <div className="tpl-list">
            {templates.map((t) => (
              <div className="tpl-row" key={t.id}>
                <span>
                  <b>{t.name}</b>
                  <small className="muted">{T.tplBlocks(t.blocks.length)}{t.days.length ? ` · ${t.days.map((d) => names[d]).join(', ')}` : ''}</small>
                </span>
                <button type="button" className="btn" onClick={() => onApply(t)}>{T.tplApply}</button>
              </div>
            ))}
          </div>
        )}
        <div className="tpl-save">
          <b>{T.tplSaveTitle}</b>
          {canSave ? (
            <>
              <div className="field">
                <label htmlFor="tp-name">{T.tplName}</label>
                <input id="tp-name" className="input" value={name} placeholder={T.tplNamePh} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <span className="label">{T.tplDays}</span>
                <DayChips days={days} onChange={setDays} label={T.tplDays} />
              </div>
            </>
          ) : <p className="muted">{T.tplNothingToSave}</p>}
        </div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{T.cancel}</button>
          <div className="right"><button type="submit" className="btn primary" disabled={!canSave || !name.trim()}>{T.tplSave}</button></div>
        </div>
      </form>
    </dialog>
  );
}
