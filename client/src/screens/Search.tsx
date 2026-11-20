import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { useHistorySearch, type SearchKind } from '../lib/historySearch';
import { onLinkClick } from '../lib/router';
import { SearchResult } from '../components/SearchResult';
import './search.css';
export function Search() {
  const T = useT().historySearch;
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const [kind, setKind] = useState<SearchKind | ''>('');
  useEffect(() => {
    const sync = () => { setQuery(new URLSearchParams(location.search).get('q') ?? ''); setKind(''); };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const {results, loading, error} = useHistorySearch(query);
  const filtered = results.filter(r => !kind || r.kind === kind);
  const groups = [...new Set(filtered.map(r => r.date || T.undated))];
  return <section className="history-search"><h1>{T.title}</h1>
    <input type="search" aria-label={T.placeholder} placeholder={T.placeholder} value={query} onChange={e => { const q=e.target.value; setQuery(q); history.replaceState(null,'','/search'+(q?'?q='+encodeURIComponent(q):'')); }} />
    <div className="history-filters" role="group" aria-label={T.title}><button className="btn ghost" aria-pressed={!kind} onClick={()=>setKind('')}>{T.all}</button>{(Object.keys(T.kinds) as SearchKind[]).map(k=><button className="btn ghost" key={k} aria-pressed={kind===k} onClick={()=>setKind(k)}>{T.kinds[k]}</button>)}</div>
    {loading ? <p role="status">{T.loading}</p> : error ? <p role="alert">{T.error}</p> : !filtered.length ? <div className="history-empty"><svg viewBox="0 0 40 40" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1"><circle cx="20" cy="20" r="19"/><circle cx="18" cy="18" r="7"/><path d="m23 23 7 7"/></svg><p>{query.trim().length<2?T.hint:T.none}</p></div> : groups.map(date=><section key={date}><h2>{date}</h2>{filtered.filter(r=>(r.date||T.undated)===date).map((r,i)=><a className="history-link" key={r.key+r.href+i} href={r.href} onClick={onLinkClick}><SearchResult result={r} query={query}/></a>)}</section>)}
  </section>;
}
