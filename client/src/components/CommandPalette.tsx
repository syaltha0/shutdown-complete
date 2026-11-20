import { useHistorySearch, type SearchResult as HistoryResult } from '../lib/historySearch';
import { SearchResult } from './SearchResult';
import '../screens/search.css';
﻿import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAccount, useSettings } from '../App';
import { useT, dict } from '../lib/i18n';
import { navigate, navigateSection } from '../lib/router';
import { addDays, today, weekOf, monthOf, quarterOf } from '../lib/dates';
import { emptyInbox, featureOn, uid, type Feature, type InboxDoc } from '../lib/model';
import { useDoc, updateKey } from '../lib/useDoc';
import { parseTaskDraft } from '../lib/taskQuickAdd';
import { useFocusDay, startFocus, pauseFocus, resumeFocus, finishPhase, resetCycle, settingsFocus } from '../lib/focus';
import { setThemePref, setMotionPref } from '../lib/theme';
import './palette.css';

const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '');
const matches = (text: string, query: string) => { let i = 0; const s = fold(text); for (const c of fold(query)) { i = s.indexOf(c, i); if (i < 0) return false; i++; } return true; };
const storage = 'sc:palette:recent';
function recent(): string[] { try { const v: unknown = JSON.parse(localStorage.getItem(storage) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []; } catch { return []; } }
function dateFrom(text: string): string | null {
  const q = fold(text.trim()), base = today();
  if (['yarin', 'tomorrow'].includes(q)) return addDays(base, 1);
  if (['bugun', 'today'].includes(q)) return base;
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) { const d = new Date(q + 'T12:00:00'); return Number.isFinite(+d) && d.toISOString().slice(0,10) === q ? q : null; }
  const weekdays = ['sunday|pazar', 'monday|pazartesi', 'tuesday|sali', 'wednesday|carsamba', 'thursday|persembe', 'friday|cuma', 'saturday|cumartesi'];
  const day = weekdays.findIndex(s => s.split('|').includes(q.replace(/^(next|gelecek) /, '')));
  if (day >= 0) return addDays(base, (day - new Date(base + 'T12:00:00').getDay() + 7) % 7 || 7);
  const m = q.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (!m) return null;
  const months = ['jan|january|oca|ocak','feb|february|sub|subat','mar|march|mart','apr|april|nis|nisan','may|mayis','jun|june|haz|haziran','jul|july|tem|temmuz','aug|august|agu|agustos','sep|september|eyl|eylul','oct|october|eki|ekim','nov|november|kas|kasim','dec|december|ara|aralik'];
  const month = months.findIndex(s => s.split('|').includes(m[2]));
  if (month < 0) return null;
  const result = `${m[3] ?? base.slice(0,4)}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return dateFrom(result);
}
type Command = { id: string; label: string; keywords?: string; shortcut?: string; result?: HistoryResult; run: () => unknown };
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const T = useT(), P = T.palette, { settings } = useSettings();
  const { active, key, holder } = useFocusDay();
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const {results: searchResults, loading: searching, error: searchError} = useHistorySearch(query);
  const [history] = useState(recent);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal(); input.current?.focus();
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const t = today();
  const locked = !!settingsFocus(settings).strict && active?.phase === 'focus';
  const destinations: [keyof typeof T.nav, string, string?, Feature?][] = [
    ['year',`/year/${t.slice(0,4)}`,'Y'],['home','/'],['today',`/day/${t}`,'T'],['week',`/week/${weekOf(t)}`,'W'],['month',`/month/${monthOf(t)}`,'M'],['quarter',`/quarter/${quarterOf(t)}`,'Q'],['focus','/focus','F'],['inbox','/tasks','I','inbox'],['habits','/habits','H','habits'],['metrics','/metrics',undefined,'metrics'],['boards','/boards',undefined,'boards'],['countdown','/countdown',undefined,'countdown'],['shutdown',`/shutdown/${t}`,'S'],['settings','/settings'],
  ];
  const { user } = useAccount();
  const commands: Command[] = destinations.filter(([, , , f]) => !f || featureOn(settings,f)).map(([id,path,shortcut]) => ({id, label:id === 'year' ? T.year.go : T.nav[id], keywords:`${dict('en').nav[id]} ${dict('tr').nav[id]}`,shortcut,run:()=>navigate(path)}));
  const sections = [['s-hours','workday'],['s-notif','notifications'],['s-focus','focus'],['s-data','data']] as const;
  for (const [id,name] of sections) commands.push({id, label:P.sections[name], keywords:dict('en').palette.sections[name]+' '+dict('tr').palette.sections[name],run:()=>navigateSection(id)});
  if(user.isAdmin) commands.push({id:'server-status',label:T.serverStatus.title,run:()=>navigate('/settings/status')});
  commands.push({id:'agenda',label:T.calendarViews.agenda,keywords:'agenda ajanda',shortcut:'A',run:()=>navigate('/agenda')});
  commands.push({id:'plan',label:T.keys.planWeek,keywords:`${dict('en').keys.planWeek} ${dict('tr').keys.planWeek}`,shortcut:'P',run:()=>navigate(`/plan/${weekOf(t)}`)}, {id:'review',label:T.review.open,keywords:`${dict('en').review.open} ${dict('tr').review.open}`,run:()=>navigate(`/review/${weekOf(t)}`)});
  const add = (id: keyof typeof P, run: () => unknown, available = true) => { if (available) commands.push({id, label: String(P[id]), keywords:`${dict('en').palette[id]} ${dict('tr').palette[id]}`,run}); };
  add('start',()=>startFocus({blockId:null,label:'',minutes:settingsFocus(settings).focusMin}),!!holder && !active);
  add('pause',()=>pauseFocus(key),!!active && !active.roomId && !locked && active.pausedLeft == null);
  add('resume',()=>resumeFocus(key),!!active && !active.roomId && !locked && active.pausedLeft != null);
  add('skip',()=>finishPhase(settings,true,{key,startedAt:active?.startedAt}),!!active && !active.roomId && !locked);
  add('reset',()=>resetCycle(key),!!holder?.focus);
  add('theme',()=>setThemePref(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  add('motion',()=>setMotionPref(document.documentElement.dataset.motion === 'reduce' ? 'full' : 'reduce'));
  commands.push({id:'help',label:T.keys.help,shortcut:'?',keywords:`${dict('en').keys.help} ${dict('tr').keys.help}`,run:()=>setTimeout(()=>window.dispatchEvent(new Event('sc:help')),0)});
  const colon = query.indexOf(':');
  const prefix = fold(query.slice(0,colon).trim()), body = query.slice(colon+1).trim();
  const task = colon >= 0 && P.taskAliases.some(s=>fold(s)===prefix), capture = colon >= 0 && P.captureAliases.some(s=>fold(s)===prefix);
  const draft = task ? parseTaskDraft(body,inbox?.lists ?? [],t) : {text:body};
  const date = dateFrom(query);
  let filtered = commands.filter(c=>matches(`${c.label} ${c.keywords ?? ''}`,query));
  if (date) filtered.unshift({id:'date',label:`${P.date}: ${date}`,run:()=>navigate(`/day/${date}`)});
  if ((task || capture) && body && inbox && featureOn(settings,'inbox')) filtered = [{id:task?'task':'capture',label:`${task?P.task:P.capture}: ${draft.text}`,run:()=>updateKey<InboxDoc>('inbox',emptyInbox,d=>({...d,items:[...d.items,{...draft,id:uid(),done:false,created:new Date().toISOString()}]}))}];
  if (!query) filtered.sort((a,b)=>(history.indexOf(a.id)<0?99:history.indexOf(a.id))-(history.indexOf(b.id)<0?99:history.indexOf(b.id)));
  const commandCount = filtered.length;
  if (!task && !capture && query.trim().length >= 2 && searchResults.length) filtered.push(...searchResults.map((r,i)=>({id:'history-'+i,label:r.title,result:r,run:()=>navigate(r.href)})), {id:'search-all',label:T.historySearch.more,run:()=>navigate('/search?q='+encodeURIComponent(query))});
  const index = Math.min(selected,Math.max(0,filtered.length-1));
  const execute = async (c: Command) => { if (busy) return; setBusy(true); setError(false); try { await c.run(); try { localStorage.setItem(storage,JSON.stringify([c.id,...history.filter(x=>x!==c.id)].slice(0,8))); } catch { /* optional device history */ } onClose(); } catch { setError(true); setBusy(false); } };
  useEffect(()=>{document.getElementById(`palette-option-${index}`)?.scrollIntoView({block:'nearest'});},[index]);
  return <dialog ref={dialog} className="command-palette" aria-label={P.title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <div className="palette-body" onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();input.current?.focus();} if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setSelected((index+(e.key==='ArrowDown'?1:-1)+filtered.length)%Math.max(1,filtered.length));} if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();if(filtered[index])void execute(filtered[index]);}}}>
      <input ref={input} role="combobox" aria-label={P.title} aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list" aria-activedescendant={filtered[index]?`palette-option-${index}`:undefined} placeholder={P.placeholder} value={query} onChange={e=>{setQuery(e.target.value);setSelected(0);}} />
      {task && body && <p className="palette-preview">{P.preview}: {draft.text} {draft.due} {draft.dueTime} {draft.tags?.map(x=>`@${x}`).join(' ')} {draft.priority && `!${draft.priority}`} {draft.list && inbox?.lists?.find(l=>l.id===draft.list)?.name}</p>}
      <div id="palette-results" role="listbox" aria-label={P.title} aria-busy={busy}>{filtered.map((c,i)=><div key={c.id} id={`palette-option-${i}`} role="option" aria-selected={i===index} onMouseMove={()=>setSelected(i)} onClick={()=>void execute(c)}><span>{i===commandCount && query.trim().length>=2 && !task && !capture && <small className="palette-history-heading">{T.historySearch.history}</small>}{c.result?<SearchResult result={c.result} query={query}/>:c.label}</span>{c.shortcut&&<kbd>{c.shortcut}</kbd>}</div>)}{!filtered.length&&<p role="status">{P.none}</p>}</div>
      {!task && !capture && query.trim().length >= 2 && !searchResults.length && <p role={searchError?'alert':'status'}>{T.historySearch.history}: {searching?T.historySearch.loading:searchError?T.historySearch.error:T.historySearch.none}</p>}
      {error&&<p role="alert">{P.error}</p>}
    </div>
  </dialog>;
}
