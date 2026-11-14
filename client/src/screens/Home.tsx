import { useEffect } from 'react';
import { useAccount, useSettings } from '../App';
import { addDays, addMonths, clock, duration, fmtDay, longDate, monthOf, today } from '../lib/dates';
import { settingsFocus, startFocus } from '../lib/focus';
import { useT } from '../lib/i18n';
import { activeColumn, emptyDay, emptyInbox, emptyMonth, featureOn, type DayDoc, type InboxDoc, type MonthDoc } from '../lib/model';
import { placeRepeats } from '../lib/repeat';
import { navigate, onLinkClick } from '../lib/router';
import { useDoc, useRange } from '../lib/useDoc';
import { useNow } from './TimeGrid';
import { nextDate } from './Countdown';
import './Year.css';
import { heatLevel } from '../lib/year';
import { OverviewRing } from '../components/OverviewRing';
import { cardDone } from '../lib/links';

export function Home() {
  const T = useT(), { settings } = useSettings(), t = today(), now = useNow(true);
  const { value: day, update } = useDoc<DayDoc>(`day:${t}`, emptyDay);
  useEffect(() => {
    if (day && placeRepeats(day, t, settings.schedule, settings.exceptions)) update(d => placeRepeats(d, t, settings.schedule, settings.exceptions) ?? d);
  }, [day != null, settings.schedule, settings.exceptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const { docs } = useRange<DayDoc>(`day:${addDays(t, -90)}`, `day:${addDays(t, 1)}`);
  const { value: m0 } = useDoc<MonthDoc>(`month:${monthOf(t)}`, emptyMonth);
  const { value: m1 } = useDoc<MonthDoc>(`month:${addMonths(monthOf(t), 1)}`, emptyMonth);
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  const plan = day ? [...activeColumn(day).blocks].sort((a,b) => a.start-b.start) : [];
  const cur = plan.find(b => b.start <= now && b.end > now);
  const tasks = day?.tasks.filter(x => !x.done && x.text.trim()) ?? [];
  const habits = settings.metrics.filter(m => m.kind === 'check' && featureOn(settings, 'habits'));
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
    ...(tomorrowDoc ? activeColumn(tomorrowDoc).blocks : []).slice().sort((a,b)=>a.start-b.start).map(b => ({id:`b${b.id}`,date:tomorrow,text:`${clock(b.start)} · ${b.label || T.untitledBlock}`,href:`/day/${tomorrow}`})),
    ...[...(m0?.dates ?? []), ...(m1?.dates ?? [])].map(x => ({...x,href:`/month/${monthOf(x.date)}`})),
    ...(featureOn(settings,'countdown') ? settings.countdowns ?? [] : []).map(x => ({id:`c${x.id}`,date:nextDate(x,t),text:x.name,href:'/countdown'})),
  ].filter(x => x.date >= t && x.date <= addDays(t,14)).sort((a,b)=>a.date.localeCompare(b.date));
  const { user } = useAccount();
  const B = T.bento;
  const link = (href: string, text: string) => <a href={href} onClick={onLinkClick}>{text}</a>;
  const totalTasks = day?.tasks.filter(x => x.text.trim()).length ?? 0;
  const doneTasks = totalTasks - tasks.length;
  const metricId = settings.focus?.metricId ?? 'deep';
  const goal = (settings.metrics.find(m => m.id === metricId)?.target ?? 0) * 60;
  const stored = day?.metrics[metricId];
  const focused = typeof stored === 'number' ? Math.max(0, Math.round(stored * 60)) : deep(day);
  const from = Math.min(settings.startHour * 60, plan[0]?.start ?? 1440);
  const to = Math.max(from + 60, settings.endHour * 60, plan.at(-1)?.end ?? 0);
  const at = (n: number) => Math.max(0, Math.min(100, (n-from)/(to-from)*100));
  const calendar = Array.from({length:14},(_,i)=>addDays(t,i));
  const heatStart = addDays(t,-77-((new Date(t+'T12:00:00').getDay()+6)%7));
  const ended = plan.length > 0 && now >= plan[plan.length-1].end;
  const greet = B.greeting(new Date().getHours(), user.name);
  const allDone = !tasks.length && !metrics.length && day?.shutdown.done && !inboxCount;
  return <>
    <div className="title-row"><h1>{T.homeTitle}</h1><span className="sub">{longDate(t)}</span></div>
    <div className={`home overview bento${featureOn(settings,'habits')?'':' no-habits'}`}>
      <section className="panel b-hello">
        <h2>{greet}</h2><div className="b-now">{cur ? cur.label || T.untitledBlock : ended ? B.ended : T.overviewNoPlan}</div>
        <p className="muted">{cur ? `${clock(cur.start)}–${clock(cur.end)} · ${B.left(duration(cur.end-now))}` : longDate(t)}</p>
        <div className="b-actions">{cur ? <button className="btn" onClick={()=>startFocus({blockId:cur.id,label:cur.label || T.untitledBlock,minutes:settingsFocus(settings).focusMin}).then(()=>navigate('/focus'))}>{T.focusOn(cur.label || T.untitledBlock)}</button> : ended ? link(`/shutdown/${t}`,T.runShutdown) : link('/focus',T.startFocus)}{link(`/day/${t}`,T.openToday)}</div>
      </section>
      <section className="panel b-focus"><h2>{B.focus}</h2><OverviewRing value={focused} total={goal} label={B.focus} text={focused?duration(focused):'–'}/><p>{focused ? goal ? B.of(duration(goal)) : B.focus : B.noFocus}</p>{link('/focus',T.startFocus)}</section>
      <section className="panel b-tasks"><h2>{B.tasks}</h2><OverviewRing value={doneTasks} total={totalTasks} label={B.tasks} text={totalTasks?`${doneTasks}/${totalTasks}`:'–'}/><p className="b-truncate">{tasks[0]?.text || (totalTasks?T.overviewNothingOpen:B.noTasks)}</p>{link(`/day/${t}`,T.openToday)}</section>
      <section className="panel b-timeline"><h2>{B.timeline}</h2><a className="b-track" href={`/day/${t}`} onClick={onLinkClick} aria-label={B.timeline}>{plan.map(b=><i key={b.id} title={`${clock(b.start)} ${b.label}`} className={b.kind==='deep'?'deep':''} style={{left:`${at(b.start)}%`,width:`${at(b.end)-at(b.start)}%`}}/>)}<b style={{left:`${at(now)}%`}}/>{(day?.focus?.sessions??[]).map((s,i)=>{const b=plan.find(b=>b.id===s.blockId);return b?<em key={i} style={{left:`${at(b.start)}%`,width:`${Math.min(at(b.end)-at(b.start),s.minutes/(to-from)*100)}%`}}/>:null;})}</a><div className="b-ticks">{[from,(from+to)/2,to].map(n=><span key={n}>{clock(Math.round(n))}</span>)}</div></section>
      <section className="panel b-open"><h2>{T.overviewOpen}</h2>{allDone ? <div className="b-done"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="m14 32 12 12 25-27" fill="none" stroke="currentColor" strokeWidth="3"/></svg>{T.overviewNothingOpen}</div> : <><ul>{tasks.slice(0,4).map(x=><li key={x.id}><input type="checkbox" className="check" aria-label={T.doneLabel(x.text)} onChange={()=>{if(x.card)cardDone(x.card).catch(()=>{});update(d=>({...d,tasks:d.tasks.map(y=>y.id===x.id?{...y,done:true}:y)}));}}/><span>{x.text}</span></li>)}</ul>{tasks.length>4 && link(`/day/${t}`,T.andMore(tasks.length-4))}{metrics.length>0 && link(`/day/${t}`,T.overviewMetric(metrics[0].name))}{!day?.shutdown.done && link(`/shutdown/${t}`,T.overviewShutdown)}{inboxCount>0 && link('/inbox',T.overviewInbox(inboxCount))}</>}</section>
      {featureOn(settings,'habits') && <section className="panel b-habits"><h2>{T.nav.habits}</h2><div className="b-chips">{habits.map(m=><button key={m.id} className={`b-chip${day?.metrics[m.id]===true?' on':''}`} aria-pressed={day?.metrics[m.id]===true} onClick={()=>update(d=>({...d,metrics:{...d.metrics,[m.id]:d.metrics[m.id]!==true}}))}><i/>{m.name}</button>)}</div>{!habits.length && <p>{B.noHabits}</p>}</section>}
      <section className="panel b-streak"><h2>{T.streak}</h2><strong className="b-number">{streak?B.days(streak):'–'}</strong><div className="b-dots">{[...recent].reverse().map(d=><a key={d} href={`/day/${d}`} onClick={onLinkClick} title={longDate(d)} aria-label={longDate(d)} className={docOf(d)?.shutdown.done?'on':''}/>)}</div></section>
      <section className="panel b-ahead"><h2>{B.ahead}</h2><div className="b-calendar">{calendar.map(d=><a key={d} href={`/day/${d}`} onClick={onLinkClick} className={d===t?'today':''}><small>{fmtDay(d,{weekday:'narrow'})}</small><span>{Number(d.slice(-2))}</span><i className={ahead.some(x=>x.date===d)?'on':''}/></a>)}</div><div className="b-events">{ahead.slice(0,3).map(x=><a key={x.id} href={x.href} onClick={onLinkClick}><span>{x.text}</span><small>{fmtDay(x.date,{month:'short',day:'numeric'})} · {B.inDays(Math.round((Date.parse(x.date)-Date.parse(t))/86400000))}</small></a>)}{!ahead.length && link(`/month/${monthOf(t)}`,B.nothing)}</div></section>
      <section className="panel b-recent"><h2>{B.recent}</h2><div className="b-bars">{[...recent].reverse().map(d=><a href={`/day/${d}`} key={d} onClick={onLinkClick} title={`${longDate(d)} · ${duration(deep(docOf(d)))}`}><div><i className={d===t?'today':''} style={{height:`${deep(docOf(d))/max*100}%`}}/></div><small>{fmtDay(d,{weekday:'short'})}</small></a>)}</div><p>{recent.some(d=>deep(docOf(d)))?B.week(duration(recent.reduce((n,d)=>n+deep(docOf(d)),0))):T.overviewNoHistory}</p></section>
      <section className="panel b-heat"><h2>{B.weeks}</h2><div className="b-heatmap">{Array.from({length:84},(_,i)=>{const d=addDays(heatStart,i),n=deep(docOf(d));return <a key={d} href={`/day/${d}`} onClick={onLinkClick} className={`year-cell heat-${heatLevel(n)}`} title={`${longDate(d)} · ${duration(n)}`} aria-label={`${longDate(d)} · ${duration(n)}`}/>;})}</div><p>{B.history}</p></section>
    </div>
  </>;
}
