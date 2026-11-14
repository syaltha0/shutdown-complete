import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { addDays, addMonths, clock, duration, fmtDay, longDate, monthOf, today, weekDays, weekOf } from '../lib/dates';
import { focusMinutes, settingsFocus, startFocus } from '../lib/focus';
import { useT } from '../lib/i18n';
import { activeColumn, emptyDay, emptyInbox, emptyMonth, emptyWeek, featureOn, type DayDoc, type InboxDoc, type MonthDoc, type WeekDoc } from '../lib/model';
import { placeRepeats } from '../lib/repeat';
import { navigate, onLinkClick } from '../lib/router';
import { useDoc, useRange } from '../lib/useDoc';
import { useNow } from './TimeGrid';
import { nextDate } from './Countdown';
import { cardDone } from '../lib/links';

export function Home() {
  const T = useT(), { settings } = useSettings(), t = today(), now = useNow(true);
  const { value: day, update } = useDoc<DayDoc>(`day:${t}`, emptyDay);
  useEffect(() => {
    if (day && placeRepeats(day, t, settings.schedule, settings.exceptions)) update(d => placeRepeats(d, t, settings.schedule, settings.exceptions) ?? d);
  }, [day != null, settings.schedule, settings.exceptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const { docs } = useRange<DayDoc>(`day:${addDays(t, -60)}`, `day:${addDays(t, 1)}`);
  const wk = weekOf(t);
  const { value: week } = useDoc<WeekDoc>(`week:${wk}`, emptyWeek);
  const { value: m0 } = useDoc<MonthDoc>(`month:${monthOf(t)}`, emptyMonth);
  const { value: m1 } = useDoc<MonthDoc>(`month:${addMonths(monthOf(t), 1)}`, emptyMonth);
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  const todayPanel = useRef<HTMLElement>(null);
  const [blockLimit, setBlockLimit] = useState(4);
  useEffect(() => {
    const panel = todayPanel.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => {
      const mobile = window.innerWidth <= 860;
      const available = panel.clientHeight - 180;
      setBlockLimit(mobile ? 1000 : Math.max(1, Math.floor(available / 43)));
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const plan = day ? [...activeColumn(day).blocks].sort((a,b) => a.start-b.start) : [];
  const cur = plan.find(b => b.start <= now && b.end > now);
  const tasks = day?.tasks.filter(x => !x.done && x.text.trim()) ?? [];
  const habits = settings.metrics.filter(m => m.kind === 'check' && featureOn(settings, 'habits'));
  const openHabits = habits.filter(m => day?.metrics[m.id] !== true);
  const metrics = settings.metrics.filter(m => m.kind === 'number' && featureOn(settings, 'metrics') && day?.metrics[m.id] == null);
  const inboxCount = featureOn(settings, 'inbox') ? inbox?.items.length ?? 0 : 0;
  const docOf = (d: string) => d === t ? day : docs?.get(`day:${d}`);
  const recent = Array.from({length: 7}, (_,i) => addDays(t, -i));
  const deep = (d: DayDoc | null | undefined) => (d?.focus?.sessions ?? []).filter(s => s.kind === 'deep').reduce((n,s) => n+s.minutes,0);
  const max = Math.max(60, ...recent.map(d => deep(docOf(d))));
  let streak = 0;
  for (let d = day?.shutdown.done ? t : addDays(t,-1); streak < 60 && docOf(d)?.shutdown.done; d = addDays(d,-1)) streak++;
  const tomorrow = addDays(t,1), tomorrowDoc = docOf(tomorrow);
  const ahead = [
    ...(tomorrowDoc ? activeColumn(tomorrowDoc).blocks : []).slice().sort((a,b)=>a.start-b.start).map(b => ({id:`b${b.id}`,date:tomorrow,text:`${clock(b.start)} ? ${b.label || T.untitledBlock}`,href:`/day/${tomorrow}`})),
    ...[...(m0?.dates ?? []), ...(m1?.dates ?? [])].map(x => ({...x,href:`/month/${monthOf(x.date)}`})),
    ...(featureOn(settings,'countdown') ? settings.countdowns ?? [] : []).map(x => ({id:`c${x.id}`,date:nextDate(x,t),text:x.name,href:'/countdown'})),
  ].filter(x => x.date > t && x.date <= addDays(t,14)).sort((a,b)=>a.date.localeCompare(b.date));
  const weekly = week?.items.filter(x => !x.done) ?? [];
  const link = (href: string, text: string) => <a className="card-link" href={href} onClick={onLinkClick}>{text}</a>;
  const more = (n: number, href: string) => n > 0 ? <footer>{link(href,T.andMore(n))}</footer> : null;
  return <>
    <div className="title-row"><div><h1>{T.homeTitle}</h1><p className="sub">{longDate(t)}</p></div><a className="btn" href={`/day/${t}`} onClick={onLinkClick}>{T.openToday}</a></div>
    <div className="home overview">
      <section ref={todayPanel} className="panel home-today" aria-labelledby="overview-today">
        <header><h2 id="overview-today">{T.overviewToday}</h2></header>
        <p className="overview-summary">{plan.length ? T.overviewSummary(plan.filter(b=>b.end<=now).length,plan.length,duration(day ? focusMinutes(day):0),day?.tasks.filter(x=>x.done).length ?? 0,day?.tasks.length ?? 0) : T.overviewNoPlan}</p>
        {cur && <button className="btn overview-focus" onClick={() => startFocus({blockId:cur.id,label:cur.label || T.untitledBlock,minutes:settingsFocus(settings).focusMin}).then(()=>navigate('/focus'))}>{T.focusOn(cur.label || T.untitledBlock)}</button>}
        <div className="overview-scroll"><ul className="overview-list">{plan.slice(0,blockLimit).map(b => {
          const focused = (day?.focus?.sessions ?? []).filter(s=>s.blockId===b.id).reduce((n,s)=>n+s.minutes,0);
          return <li className={`overview-block${b===cur?' current':b.end<=now?' done':''}`} key={b.id}>
            <span className="num">{clock(b.start)}</span><a href={`/day/${t}`} onClick={onLinkClick}>{b.label || T.untitledBlock}</a>
            <small>{T.kinds[b.kind].name} · {b===cur?T.homeNow:b.end<=now?T.overviewDone:T.homeNext}{focused ? ` · ${duration(focused)}`:''}</small>
          </li>;
        })}</ul>{!plan.length && <p className="empty">{link(`/day/${t}`,T.planDay(T.todayLower))}</p>}</div>
        {plan.length > 0 && <footer>{link(`/day/${t}`,plan.length>blockLimit ? T.andMore(plan.length-blockLimit) : T.openToday)}</footer>}
      </section>
      <div className="overview-middle">
        <section className="panel home-tasks" aria-labelledby="overview-open">
          <header><h2 id="overview-open">{T.overviewOpen}</h2></header>
          <div className="overview-scroll"><ul className="overview-list">{tasks.slice(0,5).map(x=><li className="overview-task" key={x.id}><input type="checkbox" className="check" aria-label={T.doneLabel(x.text)} onChange={()=>{if(x.card) cardDone(x.card).catch(()=>{});update(d=>({...d,tasks:d.tasks.map(y=>y.id===x.id?{...y,done:true}:y)}));}}/><span>{x.text}</span></li>)}</ul>
          {openHabits.length>0 && <div className="home-habits">{openHabits.map(m=><button className="pick" key={m.id} onClick={()=>update(d=>({...d,metrics:{...d.metrics,[m.id]:true}}))}>{m.name}</button>)}</div>}
          {metrics.map(m=><p key={m.id}>{link(`/day/${t}`,T.overviewMetric(m.name))}</p>)}
          {!day?.shutdown.done && <p>{link(`/shutdown/${t}`,T.overviewShutdown)}</p>}
          {inboxCount>0 && <p>{link('/inbox',T.overviewInbox(inboxCount))}</p>}
          {!tasks.length && !openHabits.length && !metrics.length && day?.shutdown.done && !inboxCount && <p className="empty">{T.overviewNothingOpen}</p>}
          </div>{more(tasks.length-5,`/day/${t}`)}
        </section>
        <section className="panel home-coming" aria-labelledby="overview-ahead">
          <header><h2 id="overview-ahead">{T.overviewAhead}</h2></header>
          <div className="overview-scroll"><ul className="overview-list">{ahead.slice(0,8).map((x,i)=><li className="overview-date" key={x.id}>{(i===0 || ahead[i-1].date!==x.date) && <b>{fmtDay(x.date,{weekday:'short',month:'short',day:'numeric'})}</b>}{link(x.href,x.text)}</li>)}</ul>
          {weekly.length>0 && <><h3>{T.thisWeek}</h3><ul className="overview-list">{weekly.slice(0,3).map(x=><li key={x.id}>{link(`/week/${wk}`,x.text)}</li>)}</ul></>}
          {!ahead.length && !weekly.length && <p className="empty">{T.nothingComing}</p>}</div>
          {more(Math.max(0,ahead.length-8)+Math.max(0,weekly.length-3),`/week/${wk}`)}
        </section>
      </div>
      <section className="panel home-recent" aria-labelledby="overview-recent">
        <header><h2 id="overview-recent">{T.overviewRecent}</h2></header>
        <p className="overview-summary">{T.overviewLegend}</p>
        <div className="overview-scroll"><ul className="overview-list">{recent.map(d=>{const doc=docOf(d), minutes=deep(doc);return <li key={d} className={`overview-day${d===t?' current':''}`}><a href={`/day/${d}`} onClick={onLinkClick}>{fmtDay(d,{weekday:'short',day:'numeric'})}</a><span>{minutes?duration(minutes):'\u2013'}</span><span className="overview-bar" aria-hidden="true"><i style={{width:`${minutes/max*100}%`}}/></span><span aria-label={T.runShutdown}>{doc?.shutdown.done?'\u2713':'\u2013'}</span><span title={T.overviewOpen}>{doc?.tasks.filter(x=>x.done).length || '\u2013'}</span>{habits.length>0 && <span title={T.nav.habits}>{habits.some(m=>doc?.metrics[m.id]===true)?'\u25cf':'\u25cb'}</span>}</li>;})}</ul>
        {!recent.some(d=>{const doc=docOf(d);return doc && (focusMinutes(doc)>0 || doc.tasks.some(x=>x.done) || doc.shutdown.done);}) && <p className="empty">{T.overviewNoHistory}</p>}
        <p className="overview-summary">{T.overviewWeek(duration(weekDays(wk).filter(d=>d<=t).reduce((n,d)=>n+(docOf(d)?focusMinutes(docOf(d)!):0),0)),streak)}</p></div>
      </section>
    </div>
  </>;
}
