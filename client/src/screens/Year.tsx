import { DocNotice, SaveStamp } from '../components/Common';
import { IconLeft, IconRight } from '../components/Icons';
import { useT } from '../lib/i18n';
import { useDoc, useRange } from '../lib/useDoc';
import { onLinkClick } from '../lib/router';
import type { DayDoc, QuarterDoc } from '../lib/model';
import { focusMinutes } from '../lib/focus';
import { today } from '../lib/dates';
import { yearDays, heatLevel, longestStreak } from '../lib/year';
import './Year.css';
interface YearDoc { good: string; change: string }
const emptyYear = (): YearDoc => ({ good: '', change: '' });
export function Year({ id }: { id: string }) {
 const T = useT(), Y = T.year;
 const { value, update, status, error, retry } = useDoc<YearDoc>(`year:${id}`, emptyYear);
 const days = yearDays(Number(id));
 const daily = useRange<DayDoc>(`day:${id}-01-01`, `day:${id}-12-31`);
 const quarters = useRange<QuarterDoc>(`quarter:${id}-Q1`, `quarter:${id}-Q4`);
 const minutes = days.map(d => daily.docs?.get(`day:${d}`)).map(d => d ? focusMinutes(d) : 0);
 const topics = new Map<string, number>();
 daily.docs?.forEach(d => d.focus?.sessions.forEach(s => { const name = s.subject || s.label; if(name) topics.set(name,(topics.get(name) ?? 0) + s.minutes); }));
 const offset = (new Date(`${id}-01-01T12:00:00Z`).getUTCDay()+6)%7;
 const cells = Math.ceil((offset+days.length)/7)*7;
 const dateLabel = (d: string) => new Intl.DateTimeFormat(T.locale,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
 return <>
 <div className="title-row"><h1>{Y.title} {id}</h1><div className="title-actions"><SaveStamp status={status}/><div className="stepper"><a className="btn icon" aria-label={Y.prev} href={`/year/${Number(id)-1}`} onClick={onLinkClick}><IconLeft/></a><a className="btn" href={`/year/${today().slice(0, 4)}`} onClick={onLinkClick}>{Y.current}</a><a className="btn icon" aria-label={Y.next} href={`/year/${Number(id)+1}`} onClick={onLinkClick}><IconRight/></a></div></div></div>
 <DocNotice status={status} error={error} retry={retry}/>
 <DocNotice status={daily.error || quarters.error ? 'error' : 'saved'} error={daily.error || quarters.error} retry={()=>{daily.retry();quarters.retry();}}/>
 <div className="grid year-view">
 <section className="panel span-12"><h2>{Y.heat}</h2><p className="year-scroll-hint meta">{T.uiux.yearScroll}</p><div className="year-scroll" tabIndex={0} aria-label={Y.heat}><div className="year-months">{Array.from({length:12},(_,m)=><span key={m}>{new Intl.DateTimeFormat(T.locale,{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(Number(id),m,1)))}</span>)}</div><div className="year-heat" style={{gridTemplateColumns:`repeat(${cells/7}, 1fr)`}}>{Array.from({length:cells},(_,i)=>{const index=i-offset,d=days[index];const future=d>today(), label=d ? `${dateLabel(d)} · ${future ? Y.future : minutes[index] ? Y.time(minutes[index]) : Y.noRecord}` : '';return d ? <a key={i} className={`year-cell heat-${heatLevel(minutes[index])}${future ? ' year-future' : ''}`} href={`/day/${d}`} onClick={onLinkClick} title={label} aria-label={label} data-date={d} data-minutes={minutes[index]}/> : <span key={i}/>;})}</div></div><div className="year-mobile-months">{Array.from({length:12},(_,m) => { const month = `${id}-${String(m+1).padStart(2,'0')}`; const label = new Intl.DateTimeFormat(T.locale,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`)); return <a className="year-mobile-month" key={month} href={`/month/${month}`} onClick={onLinkClick} aria-label={label}><strong>{label}</strong><span className="year-mobile-days" aria-hidden="true">{days.filter(d=>d.startsWith(month)).map(d=><span key={d} className={`year-mini heat-${heatLevel(minutes[days.indexOf(d)])}`}>{Number(d.slice(8))}</span>)}</span></a>; })}</div><div className="year-legend">{Y.legend.map((label,i)=><span key={label}><i className={`year-swatch heat-${i}`} aria-hidden="true"/>{label}</span>)}</div></section>
 <section className="panel span-12"><div className="year-stats">{[[Y.heat,Y.time(minutes.reduce((a,b)=>a+b,0))],[Y.days,minutes.filter(n=>n>0).length],[Y.streak,longestStreak(minutes)],[Y.shutdowns,[...(daily.docs?.values() ?? [])].filter(d=>d.shutdown?.done).length]].map(([label,n])=><div key={label}><div className="meta">{label}</div><strong className="num">{n}</strong></div>)}</div><h3>{Y.top}</h3>{[...topics].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,n])=><p key={name}>{name} · {Y.time(n)}</p>)}</section>
 {[1,2,3,4].map(n=>{const key=`${id}-Q${n}`,q=quarters.docs?.get(`quarter:${key}`),goals=q?.goals ?? [];return <section className="panel span-6" key={n}><h2><a href={`/quarter/${key}`} onClick={onLinkClick}>{T.quarterTitle(String(n),id)}</a></h2><p className="meta">{goals.length ? T.goalsDone(goals.filter(g=>g.done).length,goals.length) : Y.noGoals}</p><ul>{goals.map(g=><li key={g.id}><input type="checkbox" checked={g.done} readOnly tabIndex={-1} aria-label={g.text}/>{g.text}</li>)}</ul></section>;})}
 <section className="panel span-12"><h2>{Y.review}</h2>{value && (['good','change'] as const).map(field=><div className="field" key={field}><label htmlFor={`year-${field}`}>{Y[field]}</label><textarea className="input" id={`year-${field}`} rows={4} value={value[field]} onChange={e=>update(v=>({...v,[field]:e.target.value}))}/></div>)}</section>
 </div></>;
}
