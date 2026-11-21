import { useHistorySearch, type SearchResult as HistoryResult } from '../lib/historySearch';
import { SearchResult } from './SearchResult';
import '../screens/search.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAccount, useSettings } from '../App';
import { useT, dict } from '../lib/i18n';
import { navigate, navigateSection } from '../lib/router';
import { addDays, today, weekOf, monthOf, quarterOf, weekStart, weekNumber, rangeLabel, monthTitle, weekdayLong, shortDate, clock } from '../lib/dates';
import { effectivePlan, emptyDay, emptyInbox, featureOn, uid, type Block, type DayDoc, type Feature, type InboxDoc } from '../lib/model';
import { useDoc, updateKey } from '../lib/useDoc';
import { parseTaskDraft } from '../lib/taskQuickAdd';
import { parsePalette, type BlockDraft, type GoTarget } from '../lib/paletteParse';
import { offerUndo } from '../lib/undo';
import { useFocusDay, startFocus, pauseFocus, resumeFocus, finishPhase, resetCycle, settingsFocus } from '../lib/focus';
import { setThemePref, setMotionPref } from '../lib/theme';
import './palette.css';

const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '');
const matches = (text: string, query: string) => { let i = 0; const s = fold(text); for (const c of fold(query)) { i = s.indexOf(c, i); if (i < 0) return false; i++; } return true; };
const storage = 'sc:palette:recent';
function recent(): string[] { try { const v: unknown = JSON.parse(localStorage.getItem(storage) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []; } catch { return []; } }
type Command = { id: string; label: string; note?: string; keywords?: string; shortcut?: string; result?: HistoryResult; run: () => unknown };
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const T = useT(), P = T.palette, { settings } = useSettings();
  const { active, key, holder } = useFocusDay();
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const t = today();
  const colon = query.indexOf(':');
  const prefix = fold(query.slice(0,colon).trim()), body = query.slice(colon+1).trim();
  const task = colon >= 0 && P.taskAliases.some(s=>fold(s)===prefix), capture = colon >= 0 && P.captureAliases.some(s=>fold(s)===prefix);
  // a line read as a place to go, a block or a task (lib/paletteParse.ts); the "Task: …" form with a colon is handled below
  const parsed = task || capture ? null : parsePalette(query, t);
  const natural = parsed && (parsed.type !== 'task' || (inbox && featureOn(settings,'inbox'))) ? parsed : null;
  const adding = !!natural && natural.type !== 'go';
  const searchOn = !task && !capture && !adding;
  const {results: searchResults, loading: searching, error: searchError} = useHistorySearch(searchOn ? query : '');
  const { value: blockDay } = useDoc<DayDoc>(`day:${natural?.type === 'block' ? natural.draft.date : t}`, emptyDay);
  const [history] = useState(recent);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal(); input.current?.focus();
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
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
  const draft = task ? parseTaskDraft(body,inbox?.lists ?? [],t) : {text:body};
  const dayName = (d: string) => `${weekdayLong(d)} ${shortDate(d)}${d.slice(0,4) === t.slice(0,4) ? '' : ' ' + d.slice(0,4)}`;
  const goName = (g: GoTarget) => g.level === 'day' ? dayName(g.id) : g.level === 'week' ? `${T.nav.week} ${weekNumber(g.id)} · ${rangeLabel(weekStart(g.id), addDays(weekStart(g.id), 6))}` : g.level === 'month' ? monthTitle(g.id) : g.level === 'quarter' ? `Q${g.id.slice(-1)} ${g.id.slice(0,4)}` : g.id;
  const blockName = (d: BlockDraft) => `${P.blockWord} · ${dayName(d.date)} ${clock(d.start)}–${clock(d.end)} · ${T.kinds[d.kind].name} · ${d.label || T.untitledBlock}`;
  const addBlock = async (d: BlockDraft) => {
    const block: Block = { id: uid(), start: d.start, end: d.end, label: d.label, note: '', kind: d.kind }, key = `day:${d.date}`;
    await updateKey<DayDoc>(key, emptyDay, doc => ({ ...doc, columns: doc.columns.map((c, i) => i === doc.columns.length - 1 ? { ...c, blocks: [...c.blocks, block].sort((a, z) => a.start - z.start) } : c) }));
    offerUndo(P.added(blockName(d)), () => { void updateKey<DayDoc>(key, emptyDay, doc => ({ ...doc, columns: doc.columns.map(c => ({ ...c, blocks: c.blocks.filter(b => b.id !== block.id) })) })); });
  };
  const addTask = async (body: string) => {
    const item = { ...parseTaskDraft(body, inbox?.lists ?? [], t), id: uid(), done: false, created: new Date().toISOString() };
    await updateKey<InboxDoc>('inbox', emptyInbox, d => ({ ...d, items: [...d.items, item] }));
    offerUndo(P.added(`${P.taskWord} · ${item.text}`), () => { void updateKey<InboxDoc>('inbox', emptyInbox, d => ({ ...d, items: d.items.filter(x => x.id !== item.id) })); });
  };
  let filtered = commands.filter(c=>matches(`${c.label} ${c.keywords ?? ''}`,query));
  if (natural?.type === 'go') { const g = natural.target; filtered.unshift({id:'date',label:`${P.go}: ${goName(g)}`,run:()=>navigate(g.path)}); }
  if (natural?.type === 'block') {
    const d = natural.draft, clash = blockDay ? effectivePlan(blockDay).filter(b => b.start < d.end && d.start < b.end).map(b => b.label || T.untitledBlock) : [];
    filtered.unshift({id:'block-add',label:`${P.add}: ${blockName(d)}`,note:clash.length ? T.blockOverlap([...new Set(clash)].slice(0,2).join(', ')) : undefined,run:()=>addBlock(d)});
  }
  if (natural?.type === 'task') {
    const d = parseTaskDraft(natural.body, inbox?.lists ?? [], t), list = d.list && inbox?.lists?.find(l=>l.id===d.list)?.name;
    const meta = [d.due && shortDate(d.due), d.dueTime, d.priority && `!${d.priority}`, list, ...(d.tags ?? []).map(x=>`@${x}`)].filter(Boolean);
    const text = natural.body;
    filtered.unshift({id:'task-add',label:`${P.add}: ${P.taskWord} · ${[d.text, ...meta].join(' · ')}`,run:()=>addTask(text)});
  }
  if ((task || capture) && body && inbox && featureOn(settings,'inbox')) filtered = [{id:task?'task':'capture',label:`${task?P.task:P.capture}: ${draft.text}`,run:()=>updateKey<InboxDoc>('inbox',emptyInbox,d=>({...d,items:[...d.items,{...draft,id:uid(),done:false,created:new Date().toISOString()}]}))}];
  if (!query) filtered.sort((a,b)=>(history.indexOf(a.id)<0?99:history.indexOf(a.id))-(history.indexOf(b.id)<0?99:history.indexOf(b.id)));
  const commandCount = filtered.length;
  if (searchOn && query.trim().length >= 2 && searchResults.length) filtered.push(...searchResults.map((r,i)=>({id:'history-'+i,label:r.title,result:r,run:()=>navigate(r.href)})), {id:'search-all',label:T.historySearch.more,run:()=>navigate('/search?q='+encodeURIComponent(query))});
  const index = Math.min(selected,Math.max(0,filtered.length-1));
  const execute = async (c: Command) => { if (busy) return; setBusy(true); setError(false); try { await c.run(); try { localStorage.setItem(storage,JSON.stringify([c.id,...history.filter(x=>x!==c.id)].slice(0,8))); } catch { /* optional device history */ } onClose(); } catch { setError(true); setBusy(false); } };
  useEffect(()=>{document.getElementById(`palette-option-${index}`)?.scrollIntoView({block:'nearest'});},[index]);
  return <dialog ref={dialog} className="command-palette" aria-label={P.title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <div className="palette-body" onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();input.current?.focus();} if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setSelected((index+(e.key==='ArrowDown'?1:-1)+filtered.length)%Math.max(1,filtered.length));} if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();if(filtered[index])void execute(filtered[index]);}}}>
      <input ref={input} role="combobox" aria-label={P.title} aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list" aria-activedescendant={filtered[index]?`palette-option-${index}`:undefined} placeholder={P.placeholder} value={query} onChange={e=>{setQuery(e.target.value);setSelected(0);}} />
      {task && body && <p className="palette-preview">{P.preview}: {draft.text} {draft.due} {draft.dueTime} {draft.tags?.map(x=>`@${x}`).join(' ')} {draft.priority && `!${draft.priority}`} {draft.list && inbox?.lists?.find(l=>l.id===draft.list)?.name}</p>}
      <div id="palette-results" role="listbox" aria-label={P.title} aria-busy={busy}>{filtered.map((c,i)=><div key={c.id} id={`palette-option-${i}`} role="option" aria-selected={i===index} onMouseMove={()=>setSelected(i)} onClick={()=>void execute(c)}><span>{i===commandCount && query.trim().length>=2 && searchOn && <small className="palette-history-heading">{T.historySearch.history}</small>}{c.result?<SearchResult result={c.result} query={query}/>:c.label}{c.note&&<small className="palette-note">{c.note}</small>}</span>{c.shortcut&&<kbd>{c.shortcut}</kbd>}</div>)}{!filtered.length&&<p role="status">{P.none}</p>}</div>
      {searchOn && query.trim().length >= 2 && !searchResults.length && <p role={searchError?'alert':'status'}>{T.historySearch.history}: {searching?T.historySearch.loading:searchError?T.historySearch.error:T.historySearch.none}</p>}
      <p className="palette-help">{P.syntax}</p>
      {error&&<p role="alert">{P.error}</p>}
    </div>
  </dialog>;
}
