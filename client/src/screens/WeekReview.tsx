import { useEffect, useState } from 'react';
import { WeekFocus } from '../components/WeekFocus';
import { useSettings } from '../App';
import { LoadFailed } from '../components/Common';
import { IconLeft, IconRight } from '../components/Icons';
import { api, type WeekReviewData } from '../lib/api';
import { addWeeks, duration, rangeLabel, weekdayShort, weekNumber, weekOf, today } from '../lib/dates';
import { dayFocus } from '../lib/focus';
import { weekDays } from '../lib/dates';
import { useRange } from '../lib/useDoc';
import type { DayDoc } from '../lib/model';
import { useT } from '../lib/i18n';
import { emptyWeek, type WeekDoc } from '../lib/model';
import { useDoc } from '../lib/useDoc';
import { DocNotice, SaveStamp } from '../components/Common';
import { onLinkClick } from '../lib/router';

/** A change against last week, as "+1 h 20 m" / "−2", in the hue when it went up. */
function Delta({ now, before, fmt }: { now: number; before: number; fmt: (n: number) => string }) {
  const d = now - before;
  if (!d || !before) return null;
  return <span className={`wr-delta${d > 0 ? ' up' : ''}`}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}</span>;
}

/**
 * The week in review: how much was focused against the deep focus planned, how many days were closed with the
 * shutdown, what got done (tasks, the weekly plan), where the focus went, the habits; each against the week before.
 * Also where the Sunday e-mail of it is turned on.
 */
export function WeekReview({ id }: { id: string }) {
  const T = useT(), W = T.review;
  const { settings, update } = useSettings();
  const { value: week, update: updateWeek, status, error, retry } = useDoc<WeekDoc>(`week:${id}`, emptyWeek);
  const [review, setR] = useState<WeekReviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setR(null); setFailed(false);
    api.review(id).then((d) => { if (live) setR(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id, tries]);
  const previousDays = weekDays(addWeeks(id, -1)), currentDays = weekDays(id);
  const daily = useRange<DayDoc>('day:' + previousDays[0], 'day:' + currentDays[6]);
  const r = review && daily.docs ? {
    ...review,
    days: review.days.map(d => ({ ...d, focused: dayFocus(daily.docs!.get('day:' + d.date), settings).minutes })),
    totals: { ...review.totals, focused: currentDays.reduce((n, d) => n + dayFocus(daily.docs!.get('day:' + d), settings).minutes, 0) },
    prev: { ...review.prev, focused: previousDays.reduce((n, d) => n + dayFocus(daily.docs!.get('day:' + d), settings).minutes, 0) },
  } : null;
  const t = r?.totals;
  const max = r ? Math.max(60, ...r.days.map((d) => Math.max(d.planned, d.focused))) : 60;
  const current = weekOf(today());
  const hours = (m: number) => duration(m);
  return (
    <>
      <div className="title-row">
        <div>
          <h1>{W.title(weekNumber(id))}</h1>
          <p className="sub num">{r ? rangeLabel(r.from, r.to) : ' '}</p>
        </div>
        <div className="title-actions">
          <a className="btn ghost icon" href={`/review/${addWeeks(id, -1)}`} onClick={onLinkClick} aria-label={W.prev}><IconLeft /></a>
          {id < current && <a className="btn ghost icon" href={`/review/${addWeeks(id, 1)}`} onClick={onLinkClick} aria-label={W.next}><IconRight /></a>}
          <a className="btn" href={`/week/${id}`} onClick={onLinkClick}>{W.toWeek}</a>
        </div>
      </div>
      {failed || daily.error ? <LoadFailed retry={() => { setTries((n) => n + 1); daily.retry(); }} /> : !r || !t ? <div className="skeleton" style={{ height: 320 }} /> : (
        <div className="grid wr" data-anim>
          <section className="panel span-12 wr-stats" aria-label={W.title(weekNumber(id))}>
            <div><span className="wr-k">{W.focused}</span><b className="num">{hours(t.focused)}</b><span className="wr-s num">{W.ofDeep(hours(t.deep))} <Delta now={t.focused} before={r.prev.focused} fmt={hours} /></span></div>
            <div><span className="wr-k">{W.shutdowns}</span><b className="num">{t.shutdowns}/7</b><span className="wr-s num"><Delta now={t.shutdowns} before={r.prev.shutdowns} fmt={String} /></span></div>
            <div><span className="wr-k">{W.tasksDone}</span><b className="num">{t.tasksDone + t.listDone}</b><span className="wr-s num">{W.ofDayTasks(t.tasksDone, t.tasksAll)} <Delta now={t.tasksDone + t.listDone} before={r.prev.tasksDone} fmt={String} /></span></div>
            <div><span className="wr-k">{W.weekPlan}</span><b className="num">{r.plan.total ? `${r.plan.done}/${r.plan.total}` : '—'}</b><span className="wr-s">{r.plan.total ? '' : W.noPlan}</span></div>
          </section>

          <section className="panel span-8" aria-labelledby="wr-days">
            <header><h2 id="wr-days">{W.byDay}</h2><span className="meta wr-legend"><i className="pl" />{W.planned} <i className="fo" />{W.focusedShort}</span></header>
            <div className="wr-bars">
              {r.days.map((d) => (
                <a key={d.date} className={`wr-day${d.date === today() ? ' today' : ''}`} href={`/day/${d.date}`} onClick={onLinkClick} aria-label={W.dayLabel(weekdayShort(d.date), hours(d.planned), hours(d.focused))}>
                  <span className="wr-cols">
                    <i className="pl" style={{ height: `${(d.planned / max) * 100}%` }} />
                    <i className="fo" style={{ height: `${(d.focused / max) * 100}%` }} />
                  </span>
                  <span className="wr-name">{weekdayShort(d.date)}</span>
                  <span className={`wr-tick${d.shutdown ? ' on' : ''}`} aria-hidden="true" />
                </a>
              ))}
            </div>
            {t.revisions > 0 && <p className="muted wr-note">{W.revisions(t.revisions)}</p>}
          </section>

          <section className="panel span-4" aria-labelledby="wr-where">
            <header><h2 id="wr-where">{W.where}</h2></header>
            {r.focusOn.length === 0 ? <p className="muted">{W.noFocus}</p> : (
              <ul className="wr-list">{r.focusOn.map((x) => <li key={x.name}><span>{x.name}</span><b className="num">{hours(x.minutes)}</b></li>)}</ul>
            )}
            {r.habits.length > 0 && (
              <>
                <h3 className="wr-h3">{W.habits}</h3>
                <ul className="wr-list">{r.habits.map((h) => <li key={h.name}><span>{h.name}</span><b className="num">{h.days}/7</b></li>)}</ul>
              </>
            )}
          </section>

          <section className="panel span-12 field">
            <label htmlFor="week-experiment">{T.experiment.label}</label>
            <input id="week-experiment" className="input" value={week?.experiment ?? ''} disabled={!week}
              onChange={(e) => updateWeek((w) => ({ ...w, experiment: e.target.value }))} />
            <SaveStamp status={status} />
            <DocNotice status={status} error={error} retry={retry} />
          </section>
          <WeekFocus id={id} />

          <section className="panel span-12 wr-mail">
            {r.mail ? (
              <label className="tk-check-row">
                <input type="checkbox" className="check" checked={!!settings.weeklyMail} onChange={(e) => update((s) => ({ ...s, weeklyMail: e.target.checked }))} />
                {W.mailMe}
              </label>
            ) : <p className="muted">{W.noMail}</p>}
          </section>
        </div>
      )}
    </>
  );
}
