import { Checklist } from '../components/Checklist';
import { DocNotice, SaveStamp } from '../components/Common';
import { IconLeft, IconRight } from '../components/Icons';
import {
  addQuarters, monthName, quarterMonths, quarterOf, quarterRange, quarterWeeks, rangeLabel, today, weekDays, weekNumber, weekOf,
} from '../lib/dates';
import { emptyQuarter, type DayDoc, type QuarterDoc, type WeekDoc } from '../lib/model';
import { useT } from '../lib/i18n';
import { onLinkClick } from '../lib/router';
import { useDoc, useRange } from '../lib/useDoc';
import { BrokenDown } from '../components/Links';
import { belowRange, servingOf } from '../lib/links';
import type { MonthDoc } from '../lib/model';
import '../styles/quarter.css';

export function Quarter({ id }: { id: string }) {
  const T = useT();
  const { value: q, update, status, error, retry } = useDoc<QuarterDoc>(`quarter:${id}`, emptyQuarter);
  const weeks = quarterWeeks(id);
  const [from, to] = quarterRange(id);
  const firstDay = weekDays(weeks[0])[0], lastDay = weekDays(weeks[weeks.length - 1])[6];
  const { docs: weekDocs } = useRange<WeekDoc>(`week:${weeks[0]}`, `week:${weeks[weeks.length - 1]}`);
  const { docs: dayDocs } = useRange<DayDoc>(`day:${firstDay}`, `day:${lastDay}`);
  const t = today();
  const cur = weekOf(t);
  const idx = weeks.indexOf(cur);
  const goals = q?.goals ?? [];
  const qkey = `quarter:${id}`;
  const [mFrom, mTo] = belowRange(qkey)!;
  const { docs: monthDocs } = useRange<MonthDoc>(mFrom, mTo);
  const servingFor = (g: { id: string }) => [...(monthDocs?.entries() ?? [])].flatMap(([k, d]) => servingOf(d.goals ?? [], qkey, g.id).map((item) => ({ key: k, item })));
  const [yy, qq] = id.split('-Q');

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.quarterTitle(qq, yy)}</h1>
          <p className="sub num">
            {rangeLabel(from, to)}
            {idx >= 0 && <> · <strong>{T.weekOfN(idx + 1, weeks.length)}</strong></>}
            {goals.length > 0 && T.goalsDone(goals.filter((g) => g.done).length, goals.length)}
            {' · '}<a className="card-link" style={{ fontWeight: 400 }} href={`/year/${yy}`} onClick={onLinkClick}>{T.year.title} {yy}</a>
            {quarterMonths(id).map((m) => <span key={m}>{' · '}<a className="card-link" style={{ fontWeight: 400 }} href={`/month/${m}`} onClick={onLinkClick}>{monthName(m)}</a></span>)}
          </p>
        </div>
        <div className="title-actions">
          <SaveStamp status={status} />
          <div className="stepper">
            <a className="btn icon" href={`/quarter/${addQuarters(id, -1)}`} onClick={onLinkClick} aria-label={T.prevQuarter}><IconLeft /></a>
            <a className="btn" href={`/quarter/${quarterOf(t)}`} onClick={onLinkClick}>{T.thisQuarter}</a>
            <a className="btn icon" href={`/quarter/${addQuarters(id, 1)}`} onClick={onLinkClick} aria-label={T.nextQuarter}><IconRight /></a>
          </div>
        </div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />

      <div className="grid">
        <section className="panel span-6 fill" aria-labelledby="goals-h">
          <header><h2 id="goals-h">{T.seasonFor}</h2><span className="meta hide-phone">{T.goalsMeta}</span></header>
          {q ? <Checklist label={T.quarterGoals} items={goals} placeholder={T.addGoal} onChange={(goals) => update((x) => ({ ...x, goals }))} steps
            line={(g) => <BrokenDown parent={{ key: qkey, item: g }} serving={servingFor(g)} place="line" />}
            tools={(g) => <BrokenDown parent={{ key: qkey, item: g }} serving={servingFor(g)} place="tool" />} />
            : <div className="skeleton" style={{ height: 176 }} />}
          {q && (
            <div className="field grow" style={{ marginTop: 20 }}>
              <label htmlFor="q-notes">{T.strategy}</label>
              <textarea id="q-notes" className="input" rows={5} value={q.notes}
                placeholder={T.strategyPh}
                onChange={(e) => update((x) => ({ ...x, notes: e.target.value }))} />
            </div>
          )}
        </section>

        <section className="panel flush span-6" style={{ alignSelf: 'start' }} aria-labelledby="weeks-h">
          <header><h2 id="weeks-h">{T.theWeeks}</h2><span className="meta">{T.nWeeks(weeks.length)}</span></header>
          <table className="quarter-weeks" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>{T.weekCol}</th><th className="hide-phone">{T.datesCol}</th><th className="n">{T.planDoneCol}</th><th className="n">{T.shutdownsCol}</th></tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const wd = weekDocs?.get(`week:${w}`);
                const days = weekDays(w);
                const sd = days.filter((d) => dayDocs?.get(`day:${d}`)?.shutdown.done).length;
                const past = w <= cur;
                return (
                  <tr key={w} className={w === cur ? 'is-current' : w < cur ? 'is-past' : 'is-future'}>
                    <td><a href={`/week/${w}`} onClick={onLinkClick}><b>{T.weekN(weekNumber(w))}</b></a>{w === cur && <span className="muted">{T.thisWeekSuffix}</span>}</td>
                    <td className="hide-phone muted num">{rangeLabel(days[0], days[6])}</td>
                    <td className="n">{wd?.items.length ? T.of(wd.items.filter((i) => i.done).length, wd.items.length) : <span className="muted">—</span>}</td>
                    <td className="n">{past && dayDocs ? T.of(sd, 7) : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
