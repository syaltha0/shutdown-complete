import { useEffect, useState } from 'react';
import { useSettings } from '../App';
import { addDays, addMonths, addWeeks, clock, duration, fmtDay, gridHours, longDate, monthOf, parseISODate, shortDate, today, weekDays, weekOf } from '../lib/dates';
import { useCalendar } from '../lib/calendar';
import { focusMinutes, settingsFocus, startFocus } from '../lib/focus';
import { useT } from '../lib/i18n';
import { insights } from '../lib/insights';
import {
  activeColumn, effectivePlan, emptyBoards, emptyDay, emptyInbox, type BoardsDoc, emptyMonth, emptyWeek, minutesOfKind, uid, type DayDoc, type InboxDoc, type MonthDoc, type WeekDoc, featureOn,
} from '../lib/model';
import { placeRepeats } from '../lib/repeat';
import { navigate, onLinkClick } from '../lib/router';
import { useSocial } from '../lib/social';
import { useDoc, useRange } from '../lib/useDoc';
import { useNow } from './TimeGrid';
import { cardsDue as boardCardsDue, personalProjects } from './Boards';
import { useTeams } from '../lib/teams';
import { cardDone } from '../lib/links';
import { nextDate } from './Countdown';

const HORIZON = 21; // days ahead the "coming up" list looks

/**
 * The overview: one look at where things stand. Its question is "what now, and am I on track?": the biggest block
 * is today (the plan as a line through the hours, the block running now or the next one, and the one-click way into
 * it); then what is left to do today, this week day by day, what is coming up (exams, dates, today's events), friends
 * focusing now, and one thing the plans of the last weeks say. It follows the first-run answers (exams, friends).
 */
export function Home() {
  const T = useT();
  const { settings } = useSettings();
  const t = today();
  const now = useNow(true);
  const [selectedBlock, selectBlock] = useState<string | null>(null);
  const { value: day, update } = useDoc<DayDoc>(`day:${t}`, emptyDay);
  useEffect(() => {
    if (day && placeRepeats(day, t, settings.schedule, settings.exceptions)) update((d) => placeRepeats(d, t, settings.schedule, settings.exceptions) ?? d);
  }, [day != null, settings.schedule, settings.exceptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const wk = weekOf(t), days = weekDays(wk);
  const { docs: weekDocs } = useRange<DayDoc>(`day:${days[0]}`, `day:${days[6]}`);
  const { value: weekDoc } = useDoc<WeekDoc>(`week:${wk}`, emptyWeek);
  const { docs: past } = useRange<DayDoc>(`day:${addDays(t, -42)}`, `day:${addDays(t, -1)}`);
  const { value: m0 } = useDoc<MonthDoc>(`month:${monthOf(t)}`, emptyMonth);
  const { value: m1 } = useDoc<MonthDoc>(`month:${addMonths(monthOf(t), 1)}`, emptyMonth);
  const cal = useCalendar(t, t);
  const social = useSocial(false);
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  const { value: boardsDoc } = useDoc<BoardsDoc>('boards', emptyBoards);
  const teams = useTeams();
  const cardsDue = featureOn(settings, 'boards') ? boardCardsDue(personalProjects(boardsDoc, T), teams).map((x) => ({ id: x.c.id, text: x.c.title, due: x.c.due })) : [];
  const profile = settings.profile;
  const friendsShown = featureOn(settings, 'friends') && profile?.together !== false && !!social && social.friends.length > 0;

  const col = day ? activeColumn(day) : null;
  const blocks = col?.blocks ?? [];
  const cur = blocks.find((b) => now >= b.start && now < b.end) ?? null;
  const next = blocks.find((b) => b.start > now) ?? null;
  const focusing = day?.focus?.active ?? null;
  const docOf = (d: string) => (d === t ? day : weekDocs?.get(`day:${d}`)) ?? null;

  // the finding under the title: the one thing to know right now
  const finding = !day ? ' ' : cur
    ? <><span className="now">{T.nowLabel(cur.label || T.untitledBlock)}</span>{T.untilLeft(clock(cur.end), duration(cur.end - now))}</>
    : next ? <>{T.unplannedUntil(clock(next.start))}<strong>{next.label || T.untitledBlock}</strong></>
    : blocks.length === 0 ? <>{T.noBlocksYet}</>
    : day.shutdown.done ? <>{T.homeClosed}</>
    : <>{T.planEnded}<a className="card-link" href={`/shutdown/${t}`} onClick={onLinkClick}>{T.runShutdown}</a></>;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.homeTitle}</h1>
          <p className="sub">{finding}</p>
        </div>
        <div className="title-actions">
          {profile?.activities?.includes('exams') && <a className="btn" href={`/month/${monthOf(t)}`} onClick={onLinkClick}>{T.examPlan}</a>}
          {[0, 1].includes(parseISODate(t).getDay()) && <a className="btn" href={`/review/${parseISODate(t).getDay() === 1 ? addWeeks(weekOf(t), -1) : weekOf(t)}`} onClick={onLinkClick}>{T.review.home}</a>}
          <a className="btn primary" href={`/day/${t}`} onClick={onLinkClick}>{T.openToday}</a>
        </div>
      </div>

      <div className="grid home">
        {TodayPanel({ day, now, settings, focusing: !!focusing })}
        <TasksPanel day={day} update={update} />
        <WeekPanel days={days} docOf={docOf} weekDoc={weekDoc} past={past} wk={wk} />
        <ComingUp m0={m0} m1={m1} events={(cal?.days[t] ?? []).filter((e) => !e.allDay && e.end > now)} due={[...(featureOn(settings, 'inbox') ? inbox?.items ?? [] : []), ...(day?.tasks ?? []), ...cardsDue].filter((x) => x.due && !('done' in x && x.done))} />
        {friendsShown && <FriendsNow social={social!} />}
        <Insight past={past} wide={!friendsShown} />
      </div>
    </>
  );

  /** Today: the plan as one line through the hours, and the block that matters now. */
  function TodayPanel({ day, now, settings, focusing }: { day: DayDoc | null; now: number; settings: ReturnType<typeof useSettings>['settings']; focusing: boolean }) {
    if (!day) return <section className="panel span-8"><div className="skeleton" style={{ height: 220 }} /></section>;
    const plan = activeColumn(day).blocks;
    const [h0, h1] = gridHours(settings, now);
    const r0 = Math.min(h0 * 60, ...plan.map((b) => b.start)), r1 = Math.max(h1 * 60, ...plan.map((b) => b.end));
    const at = (m: number) => `${((m - r0) / (r1 - r0)) * 100}%`;
    const step = r1 - r0 > 12 * 60 ? 360 : r1 - r0 > 6 * 60 ? 180 : 120;
    const ticks: number[] = [];
    for (let m = Math.ceil(r0 / step) * step; m <= r1 - (r1 - r0) * 0.08; m += step) ticks.push(m);
    const deep = minutesOfKind(day, 'deep'), total = effectivePlan(day).reduce((s, b) => s + b.end - b.start, 0);
    const lead = cur ?? next;
    return (
      <section className="panel span-8 home-today" aria-labelledby="ht-h" data-anim>
        <header>
          <h2 id="ht-h">{longDate(t)}</h2>
          <span className="meta num">{plan.length ? T.homePlanned(plan.length, duration(total), duration(deep)) : ''}</span>
        </header>
        <div className="day-scale">
          <div className="day-line">
            {plan.map((b) => (
              <button type="button" key={b.id} onClick={() => selectBlock(b.id)} aria-pressed={selectedBlock === b.id} aria-label={`${b.label || T.untitledBlock}, ${clock(b.start)}–${clock(b.end)}`} title={b.label || T.untitledBlock} className={`k-${b.kind}${b === cur ? ' current' : ''}`} style={{ left: at(b.start), width: `calc(${((b.end - b.start) / (r1 - r0)) * 100}% - 2px)` }}>
                {(b.end - b.start) / (r1 - r0) > 0.08 && <span>{b.label}</span>}
              </button>
            ))}
            {now >= r0 && now <= r1 && <span className="now" style={{ left: at(now) }} />}
          </div>
          <div className="day-ticks num" aria-hidden="true">{ticks.map((m) => <span key={m} style={{ left: at(m) }}>{m >= 1440 ? T.nextDayTime(clock(m)) : clock(m)}</span>)}</div>
        </div>
        {plan.filter((b) => b.id === selectedBlock).map((b) => <p className="timeline-detail" role="status" key={b.id}><b>{b.label || T.untitledBlock}</b> <span className="num">{clock(b.start)}–{clock(b.end)}</span></p>)}
        <div className="home-now">
          {lead ? (
            <>
              <span className="label">{cur ? T.homeNow : T.homeNext}</span>
              <b className="lead">{lead.label || T.untitledBlock}</b>
              <span className="muted num">
                {clock(lead.start)}–{clock(lead.end)} · {cur ? T.minutesLeft(duration(lead.end - now)) : T.homeStartsIn(duration(lead.start - now))}
                {lead.subject ? ` · ${lead.subject}` : ''}
              </span>
              <span className="actions">
                {focusing ? <a className="btn" href="/focus" onClick={onLinkClick}>{T.openFocus}</a>
                  : cur && cur.kind !== 'personal' && <button type="button" className="btn primary" onClick={() => startFocus({ blockId: cur.id, label: cur.label || T.untitledBlock, minutes: settingsFocus(settings).focusMin }).then(() => navigate('/focus'))}>{T.focusOn(cur.label || T.untitledBlock)}</button>}
              </span>
            </>
          ) : (
            <>
              <span className="label">{plan.length ? T.homeDone : T.homeEmpty}</span>
              <span className="actions"><a className="btn" href={plan.length ? `/shutdown/${t}` : `/day/${t}`} onClick={onLinkClick}>{plan.length ? T.runShutdown : T.planDay(T.todayLower)}</a></span>
            </>
          )}
        </div>
      </section>
    );
  }
}

/** What is left to do today: the open tasks (tick them here) and today's habits. */
function TasksPanel({ day, update }: { day: DayDoc | null; update: (fn: (d: DayDoc) => DayDoc) => void }) {
  const T = useT();
  const { settings } = useSettings();
  const [draft, setDraft] = useState('');
  const open = day?.tasks.filter((x) => !x.done && x.text.trim()) ?? [];
  const habits = featureOn(settings, 'habits') ? settings.metrics.filter((m) => m.kind === 'check') : [];
  return (
    <section className="panel span-4 home-tasks" aria-labelledby="hk-h" data-anim>
      <header><h2 id="hk-h">{T.homeLeft}</h2><a className="card-link meta" href={`/day/${today()}`} onClick={onLinkClick}>{T.tasksDone(day ? day.tasks.filter((x) => x.done).length : 0, day?.tasks.length ?? 0)}</a></header>
      <ul className="home-list">
        {open.slice(0, 5).map((x) => (
          <li key={x.id}>
            <input type="checkbox" className="check" aria-label={T.doneLabel(x.text)} onChange={() => { if (x.card) cardDone(x.card).catch(() => {}); update((d) => ({ ...d, tasks: d.tasks.map((y) => (y.id === x.id ? { ...y, done: true } : y)) })); }} />
            <span>{x.text}</span>
          </li>
        ))}
        {open.length > 5 && <li className="more"><a className="card-link" href={`/day/${today()}`} onClick={onLinkClick}>{T.andMore(open.length - 5)}</a></li>}
        {day && open.length === 0 && <li className="muted">{day.tasks.length ? T.allTasksDone : T.homeNoTasks}</li>}
      </ul>
      <form className="home-add" onSubmit={(e) => { e.preventDefault(); const text = draft.trim(); if (!text) return; update((d) => ({ ...d, tasks: [...d.tasks, { id: uid(), text, done: false }] })); setDraft(''); }}>
        <label htmlFor="home-task" className="sr-only">{T.captureTask}</label>
        <input id="home-task" className="input" placeholder={T.captureTask} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>
      {habits.length > 0 && day && (
        <div className="home-habits" aria-label={T.nav.habits}>
          {habits.map((m) => {
            const on = day.metrics[m.id] === true;
            return (
              <button key={m.id} type="button" className="pick" aria-pressed={on}
                onClick={() => update((d) => ({ ...d, metrics: { ...d.metrics, [m.id]: !on } }))}><span className="tick" aria-hidden="true" />{m.name}</button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** This week, day by day: hours planned (the deep part darker), the shutdown done, today marked; the week in numbers. */
function WeekPanel({ days, docOf, weekDoc, past, wk }: { days: string[]; docOf: (d: string) => DayDoc | null; weekDoc: WeekDoc | null; past: Map<string, DayDoc> | null; wk: string }) {
  const T = useT();
  const t = today();
  const rows = days.map((d) => {
    const doc = docOf(d);
    const plan = doc ? effectivePlan(doc) : [];
    return { d, total: plan.reduce((s, b) => s + b.end - b.start, 0), deep: plan.filter((b) => b.kind === 'deep').reduce((s, b) => s + b.end - b.start, 0), shut: !!doc?.shutdown.done, focus: doc ? focusMinutes(doc) : 0 };
  });
  const max = Math.max(60, ...rows.map((r) => r.total));
  const focus = rows.reduce((s, r) => s + r.focus, 0);
  const deepDone = rows.filter((r) => r.d <= t).reduce((s, r) => s + r.deep, 0);
  const items = weekDoc?.items ?? [];
  // the shutdown streak: days in a row closed, back from today (today counts once it is closed)
  let streak = 0;
  for (let d = docOf(t)?.shutdown.done ? t : addDays(t, -1), i = 0; i < 60; i++, d = addDays(d, -1)) {
    const doc = d >= days[0] ? docOf(d) : past?.get(`day:${d}`) ?? null;
    if (doc?.shutdown.done) streak++; else break;
  }
  return (
    <section className="panel span-8 home-week" aria-labelledby="hw-h" data-anim>
      <header><h2 id="hw-h">{T.thisWeek}</h2><a className="card-link meta" href={`/week/${wk}`} onClick={onLinkClick}>{T.weekN(Number(wk.split('-W')[1]))}</a></header>
      <div className="week-strip">
        {rows.map((r) => (
          <a key={r.d} href={`/day/${r.d}`} onClick={onLinkClick} className={`wd${r.d === t ? ' today' : ''}${r.d < t ? ' past' : ''}`} aria-label={`${longDate(r.d)}: ${duration(r.total)}`}>
            <span className="wd-name">{fmtDay(r.d, { weekday: 'short' })}</span>
            <span className="wd-bar" aria-hidden="true">
              <i className="all" style={{ height: `${(r.total / max) * 100}%` }} />
              <i className="deep" style={{ height: `${(r.deep / max) * 100}%` }} />
            </span>
            <span className="wd-num num">{r.total ? duration(r.total) : '—'}</span>
            <span className={`wd-shut${r.shut ? ' on' : ''}`} aria-hidden="true" />
          </a>
        ))}
      </div>
      <div className="home-figures num">
        <div><span className="label">{T.focusMetric}</span><b>{duration(focus)}</b></div>
        <div><span className="label">{T.kinds.deep.name}</span><b>{duration(deepDone)}</b></div>
        <div><span className="label">{T.weeklyPlan}</span><b>{items.length ? T.of(items.filter((x) => x.done).length, items.length) : '—'}</b></div>
        <div><span className="label">{T.streak}</span><b>{streak}<small> {T.workdays(streak)}</small></b></div>
      </div>
    </section>
  );
}

/** What is coming up in the next three weeks: exams with their countdown, the months' dates, today's events. */
function ComingUp({ m0, m1, events, due }: { m0: MonthDoc | null; m1: MonthDoc | null; events: { title: string; start: number; end: number }[]; due: { id: string; text: string; due?: string }[] }) {
  const T = useT();
  const { settings } = useSettings();
  const t = today(), until = addDays(t, HORIZON);
  const left = (d: string) => Math.round((parseISODate(d).getTime() - parseISODate(t).getTime()) / 86400000);
  const examIds = new Set((settings.exams ?? []).map((x) => x.date + x.name));
  const rows = [
    ...(featureOn(settings, 'exams') ? settings.exams ?? [] : []).filter((x) => x.date >= t && x.date <= until).map((x) => ({ key: `e${x.id}`, date: x.date, text: x.name, exam: true })),
    ...(featureOn(settings, 'countdown') ? settings.countdowns ?? [] : []).map((x) => ({ ...x, date: nextDate(x, t) })).filter((x) => x.date >= t && x.date <= until).map((x) => ({ key: `c${x.id}`, date: x.date, text: x.name, exam: x.kind === 'exam' })),
    ...due.filter((x) => x.due! <= until).map((x) => ({ key: `t${x.id}`, date: x.due!, text: x.text, exam: false })),
    ...[...(m0?.dates ?? []), ...(m1?.dates ?? [])].filter((x) => x.date >= t && x.date <= until && !examIds.has(x.date + x.text)).map((x) => ({ key: `d${x.id}`, date: x.date, text: x.text, exam: false })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="panel span-4 home-coming" aria-labelledby="hc-h" data-anim>
      <header><h2 id="hc-h">{T.comingUp}</h2><a className="card-link meta" href={`/month/${monthOf(t)}`} onClick={onLinkClick}>{T.nav.month}</a></header>
      <ul className="home-list dates">
        {events.slice(0, 3).map((e, i) => <li key={`c${i}`}><span className="when num">{clock(e.start)}</span><span>{e.title}</span><small className="muted">{T.todayLower}</small></li>)}
        {rows.slice(0, 6).map((r) => (
          <li key={r.key} className={r.exam ? 'exam' : undefined}>
            <span className="when num">{shortDate(r.date)}</span>
            <span>{r.text}</span>
            <small className={`num ${left(r.date) < 0 ? 'late' : 'muted'}`}>{left(r.date) < 0 ? T.dueLate(-left(r.date)) : left(r.date) === 0 ? T.todayLower : T.examLeft(left(r.date))}</small>
          </li>
        ))}
        {rows.length === 0 && events.length === 0 && <li className="muted">{T.nothingComing}</li>}
      </ul>
    </section>
  );
}

/** Friends focusing right now. */
function FriendsNow({ social }: { social: NonNullable<ReturnType<typeof useSocial>> }) {
  const T = useT();
  const on = social.friends.filter((f) => f.status?.state === 'focus');
  return (
    <section className="panel span-4 home-friends" aria-labelledby="hf-h" data-anim>
      <header><h2 id="hf-h">{T.together}</h2><a className="card-link meta" href="/focus" onClick={onLinkClick}>{T.nav.focus}</a></header>
      {on.length === 0 ? <p className="muted">{T.nobodyFocusing}</p> : (
        <ul className="friend-list">{on.map((f) => <li key={f.id} className="on"><i className="dot" aria-hidden="true" /><span className="who"><b>{f.name}</b><small className="muted">{f.status?.label || T.friendFocusing}</small></span></li>)}</ul>
      )}
    </section>
  );
}

/** One thing the last six weeks of plans say (lib/insights.ts), with the way to the rest. */
function Insight({ past, wide }: { past: Map<string, DayDoc> | null; wide: boolean }) {
  const T = useT();
  if (!past) return null;
  const ins = insights(past.values());
  if (ins.days < 3) return null;
  const o = ins.overruns[0];
  const text = o ? T.overrun(o.name, Math.round((o.ratio - 1) * 100), o.n)
    : ins.revised === 0 ? T.neverRevised(ins.days)
    : `${T.revisedDays(ins.revised, ins.days)}${ins.breakWindow ? T.breakWindow(clock(ins.breakWindow[0]), clock(ins.breakWindow[1])) : ''}.`;
  return (
    <section className={`panel ${wide ? 'span-12' : 'span-8'} home-insight`} aria-labelledby="hi-h" data-anim>
      <header><h2 id="hi-h">{T.planReal}</h2><a className="card-link meta" href="/metrics" onClick={onLinkClick}>{T.nav.metrics}</a></header>
      <p>{text}</p>
    </section>
  );
}
