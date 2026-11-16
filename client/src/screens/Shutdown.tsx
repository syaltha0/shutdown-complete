import { Segmented } from '../components/Segmented';
import { handoffTasks } from '../lib/shutdownHandoff';
import { decideMoves } from '../lib/taskDeferral';
import { emptyInbox, type InboxDoc } from '../lib/model';
import { updateKey } from '../lib/useDoc';
import { FocusLog } from '../components/FocusLog';
import { useEffect, useRef, useState } from 'react';
import { drawDayCard } from '../lib/daycard';
import { useSettings } from '../App';
import { DocNotice, SaveStamp } from '../components/Common';
import { addDays, clock, longDate, today, parseISODate, weekdayLong, weekOf } from '../lib/dates';
import { useT } from '../lib/i18n';
import { activeColumn, effectivePlan, emptyDay, emptyWeek, minutesOfKind, type Block, type DayDoc, type Settings, type WeekDoc } from '../lib/model';
import { onLinkClick } from '../lib/router';
import { useDoc } from '../lib/useDoc';
import { placeRepeats } from '../lib/repeat';
import { focusMinutes } from '../lib/focus';
import { duration } from '../lib/dates';

/** The shutdown: close every open loop, then say it — "Schedule shutdown, complete". */
export function Shutdown({ date }: { date: string }) {
  const T = useT();
  const { settings } = useSettings();
  const { value: day, update, status, error, retry } = useDoc<DayDoc>(`day:${date}`, emptyDay);
  const tomorrow = addDays(date, 1);
  const { value: next, update: updateNext } = useDoc<DayDoc>(`day:${tomorrow}`, emptyDay);
  const { value: week } = useDoc<WeekDoc>(`week:${weekOf(date)}`, emptyWeek);
  // tomorrow shows its weekly schedule here already, so the first blocks are planned around it
  useEffect(() => {
    if (next && placeRepeats(next, tomorrow, settings.schedule, settings.exceptions)) updateNext((n) => placeRepeats(n, tomorrow, settings.schedule, settings.exceptions) ?? n);
  }, [next != null, tomorrow, settings.schedule, settings.exceptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState('tomorrow');
  const [chosenDate, setChosenDate] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const busy = useRef(false);
  const target = mode === 'tomorrow' ? tomorrow : chosenDate;
  let suggested = tomorrow;
  while ([0, 6].includes(parseISODate(suggested).getDay())) suggested = addDays(suggested, 1);
  const steps = settings.ritual;
  const doneSteps = day ? steps.filter((s) => day.shutdown.steps[s.id]).length : 0;
  const isToday = date === today();
  const at = day?.shutdown.at ? new Date(day.shutdown.at) : null;
  const openTasks = day?.tasks.filter((t) => !t.done).sort((a, b) => Number(b.id === day.keyTaskId) - Number(a.id === day.keyTaskId)) ?? [];
  const openWeek = week?.items.filter((i) => !i.done) ?? [];
  const nextBlocks = next ? activeColumn(next).blocks : [];

  const setStep = (id: string, v: boolean) => update((d) => ({ ...d, shutdown: { ...d.shutdown, steps: { ...d.shutdown.steps, [id]: v } } }));
  const complete = (v: boolean) => update((d) => ({ ...d, shutdown: { ...d.shutdown, done: v, at: v ? new Date().toISOString() : null } }));

  async function moveTasks() {
    if (!day || !target || target <= date || busy.current) return;
    busy.current = true; setMoving(true);
    try {
      const selected = day.tasks.filter(t => !t.done && !excluded.includes(t.id));
      const result = await decideMoves(selected, T);
      if (!result) return;
      if (result.back.length || result.deleted.length) await updateKey<InboxDoc>('inbox', emptyInbox, b => ({ ...b,
        items: [...b.items, ...result.back.filter(t => !b.items.some(x => x.id === t.id))],
        trash: [...(b.trash ?? []), ...result.deleted.filter(t => !(b.trash ?? []).some(x => x.item.id === t.id)).map(item => ({ item, deletedAt: new Date().toISOString() }))],
      }));
      await handoffTasks(date, target, result.moving, selected.map(t => t.id));
    } finally { busy.current = false; setMoving(false); }
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.shutdownTitle(isToday ? null : longDate(date))}</h1>
          <p className="sub num">
            {day?.shutdown.done
              ? T.completeSub(at ? clock(at.getHours() * 60 + at.getMinutes()) : null, weekdayLong(tomorrow))
              : day ? T.stepsDone(doneSteps, steps.length, openTasks.length) : ' '}
          </p>
        </div>
        <div className="title-actions">
          <SaveStamp status={status} />
          <a className="btn" href={`/day/${date}`} onClick={onLinkClick}>{isToday ? T.backToToday : T.openTheDay}</a>
        </div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />

      {day && (
        <div className="kpis num" style={{ marginBottom: 'var(--gap)' }} aria-label={T.dayInNumbers}>
          {settings.metrics.slice(0, 4).map((m) => {
            const v = day.metrics[m.id];
            return (
              <div className="kpi" key={m.id}>
                <div className="kpi-label">{m.name}</div>
                <div className="kpi-value">{m.kind === 'check' ? (v === true ? T.yes : v === false ? T.no : <span className="muted">—</span>)
                  : typeof v === 'number' ? <>{v}<small>{m.unit}</small></> : <span className="muted">—</span>}</div>
                <div className="delta">{m.kind === 'number' && m.target != null ? T.targetLower(`${m.target} ${m.unit}`.trim()) : m.kind === 'check' ? T.todayLower : ' '}</div>
              </div>
            );
          })}
          <div className="kpi">
            <div className="kpi-label">{T.tasksDoneKpi}</div>
            <div className="kpi-value">{day.tasks.filter((x) => x.done).length}<small>/ {day.tasks.length}</small></div>
            <div className="delta">{T.capturedToday}</div>
          </div>
        </div>
      )}

      <div className="grid top shutdown-grid">
        <section className="panel span-7 fill" aria-labelledby="rit-h">
          <header><h2 id="rit-h">{T.theRitual}</h2><a className="card-link" style={{ fontWeight: 400 }} href="/settings" onClick={onLinkClick}>{T.editSteps}</a></header>
          {!day ? <div className="skeleton" style={{ height: 260 }} /> : (
            <>
              <div className="ritual">
                {steps.length === 0 && <div className="empty">{T.noSteps}</div>}
                {steps.map((s) => (
                  <div key={s.id}>
                    <label className={`ritual-step${day.shutdown.steps[s.id] ? ' done' : ''}`}>
                      <input type="checkbox" className="check lg" checked={!!day.shutdown.steps[s.id]} onChange={(e) => setStep(s.id, e.target.checked)} />
                      <span>{s.text}</span>
                    </label>
                    {s.id === 'tomorrow' && <Tomorrow date={tomorrow} next={next} blocks={nextBlocks} />}
                  </div>
                ))}
              </div>
              <div className="ritual-foot">
                {day.shutdown.done ? (
                  <>
                    <span className="complete-stamp"><input type="checkbox" className="check lg" checked readOnly tabIndex={-1} aria-hidden="true" />{T.shutdownComplete}</span>
                    <button type="button" className="btn ghost" onClick={() => complete(false)}>{T.reopen}</button>
                  </>
                ) : (
                  <>
                    <span className="muted">{doneSteps < steps.length ? T.stepsLeft(steps.length - doneSteps) : T.allClosed}</span>
                    <button type="button" className="btn primary" onClick={() => complete(true)}>{T.scheduleShutdown}</button>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        {day?.shutdown.done && <DayCard date={date} day={day} settings={settings} />}

        <div className="stack span-5" style={{ alignContent: 'start' }}>
          <section className="panel" aria-labelledby="open-h">
            <header>
              <h2 id="open-h">{T.stillOpen}</h2>
              {openTasks.length > 0 && <button type="button" className="card-link" disabled={moving || !target || target <= date || openTasks.every(t => excluded.includes(t.id))} onClick={moveTasks}>{T.moveTo(target ? longDate(target) : T.handoffDate)}</button>}
            </header>
            {!day ? <div className="skeleton" style={{ height: 88 }} /> : openTasks.length ? (
              <div>
                <div className="field">
                  <Segmented aria-label={T.handoffTarget}>
                    <button type="button" aria-pressed={mode === 'tomorrow'} onClick={() => setMode('tomorrow')}>{T.handoffTomorrow}</button>
                    <button type="button" aria-pressed={mode === 'date'} onClick={() => setMode('date')}>{T.handoffDate}</button>
                  </Segmented>
                  {mode === 'date' && <input type="date" className="input num" aria-label={T.handoffTarget} min={tomorrow} value={chosenDate} onChange={e => setChosenDate(e.target.value)} />}
                  {suggested !== tomorrow && <button type="button" className="card-link" onClick={() => { setChosenDate(suggested); setMode('date'); }}>{T.handoffSuggestion(longDate(suggested))}</button>}
                </div>
                {openTasks.map(t => <label className={`carry${t.id === day.keyTaskId ? " key-task-selected" : ""}`} title={t.id === day.keyTaskId ? T.keyTask : undefined} key={t.id}>
                  <input type="checkbox" className="check" checked={!excluded.includes(t.id)} onChange={e => setExcluded(ids => e.target.checked ? ids.filter(id => id !== t.id) : [...ids, t.id])} />
                  <span>{t.text}</span>
                </label>)}
              </div>
            ) : <div className="empty">{T.allTasksDone}</div>}
          </section>

          {!steps.some((x) => x.id === 'tomorrow') && (
            <section className="panel" aria-labelledby="tom-h">
              <header><h2 id="tom-h">{T.firstBlocks(weekdayLong(tomorrow))}</h2></header>
              <Tomorrow date={tomorrow} next={next} blocks={nextBlocks} />
            </section>
          )}

          {day && (
            <section className="panel" aria-labelledby="fo-h">
              <header><h2 id="fo-h">{T.focusMetric}</h2><a className="card-link" style={{ fontWeight: 400 }} href="/focus" onClick={onLinkClick}>{T.openFocus}</a></header>
              {(day.focus?.sessions.length ?? 0) === 0 ? <div className="empty">{T.noSessions}</div> : (
                <><FocusLog sessions={day.focus?.sessions} /><p className="focus-line num"><b>{duration(focusMinutes(day))}</b> · {T.focusRow(day.focus!.sessions.length, duration(focusMinutes(day)))}</p></>
              )}
              {(minutesOfKind(day, 'deep') > 0 || focusMinutes(day) > 0) && <p className="focus-plan muted num">{T.planVsActual(duration(minutesOfKind(day, 'deep')), duration(focusMinutes(day)))}</p>}
            </section>
          )}

          <section className="panel" aria-labelledby="wk-h">
            <header>
              <h2 id="wk-h">{T.leftInWeek}</h2>
              <a className="card-link" href={`/week/${weekOf(date)}`} onClick={onLinkClick}>{T.weeklyPlan}</a>
            </header>
            {!week ? <div className="skeleton" style={{ height: 88 }} /> : openWeek.length ? (
              <div>{openWeek.slice(0, 5).map((i) => <div className="carry" key={i.id}><span>{i.text}</span></div>)}
                {openWeek.length > 5 && <div className="list-foot">{T.andMore(openWeek.length - 5)}</div>}
              </div>
            ) : <div className="empty">{week.items.length ? T.weekAllDone : T.noWeeklyPlan}</div>}
          </section>
        </div>
      </div>
    </>
  );
}

function Tomorrow({ date, next, blocks }: { date: string; next: DayDoc | null; blocks: Block[] }) {
  const T = useT();
  if (!next) return <div className="skeleton tomorrow" style={{ height: 88 }} />;
  return (
    <div className="tomorrow">
      {blocks.length ? (
        <div className="mini-blocks">
          {blocks.slice(0, 4).map((b) => (
            <div className="mini-block" key={b.id}><span className="t">{clock(b.start)}–{clock(b.end)}</span><span>{b.label || T.untitled}</span></div>
          ))}
        </div>
      ) : <div className="empty">{T.nothingBlockedFor(longDate(date))}</div>}
      <a className="card-link" href={`/day/${date}`} onClick={onLinkClick}>{T.planDay(longDate(date))}</a>
    </div>
  );
}

/** The finished day as a picture (lib/daycard.ts): made when the day is closed, to save or share. */
function DayCard({ date, day, settings }: { date: string; day: DayDoc; settings: Settings }) {
  const T = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const at = day.shutdown.at ? new Date(day.shutdown.at) : null;
  const key = JSON.stringify([date, day.columns, day.tasks.map((t) => t.done), day.metrics, day.focus?.sessions.length, day.shutdown.at, T.locale]);
  useEffect(() => {
    let live = true;
    const c = canvas.current;
    if (!c) return;
    const checks = settings.metrics.filter((m) => m.kind === 'check');
    drawDayCard(c, {
      title: longDate(date), brand: 'Shutdown Complete', clock,
      blocks: effectivePlan(day).map((b) => ({ start: b.start, end: b.end, label: b.label || T.untitledBlock, kind: b.kind })),
      stats: [
        { label: T.focusMetric, value: duration(focusMinutes(day)) },
        { label: T.kinds.deep.name, value: duration(minutesOfKind(day, 'deep')) },
        { label: T.tasks, value: T.of(day.tasks.filter((x) => x.done).length, day.tasks.length) },
      ],
      habits: checks.map((m) => ({ name: m.name, done: day.metrics[m.id] === true })),
      shutdown: `${T.shutdownComplete}${at ? ` · ${clock(at.getHours() * 60 + at.getMinutes())}` : ''}`,
    }).then(() => c.toBlob((b) => {
      if (!live || !b) return;
      setFile(new File([b], `shutdown-${date}.png`, { type: 'image/png' }));
      setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
    }, 'image/png'));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  return (
    <section className="panel span-12 day-card" aria-labelledby="card-h">
      <header><h2 id="card-h">{T.cardTitle}</h2><span className="meta">{T.cardAbout}</span></header>
      <canvas ref={canvas} hidden />
      <div className="card-body">
        {url ? <img src={url} alt={T.cardAlt(longDate(date))} width={1080} height={1350} /> : <div className="skeleton card-skel" />}
        <div className="card-actions">
          {url && <a className="btn primary" href={url} download={`shutdown-${date}.png`}>{T.cardSave}</a>}
          {canShare && <button type="button" className="btn" onClick={() => navigator.share({ files: [file!], title: longDate(date) }).catch(() => {})}>{T.cardShare}</button>}
        </div>
      </div>
    </section>
  );
}
