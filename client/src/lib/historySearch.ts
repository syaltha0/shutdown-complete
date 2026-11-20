import { useEffect, useState } from 'react';
import { api } from './api';
export type SearchKind = 'day-note' | 'note' | 'block' | 'task' | 'goal' | 'inbox' | 'list' | 'card' | 'countdown' | 'exam';
export interface SearchResult { key: string; kind: SearchKind; date?: string; title: string; snippet: string; href: string }
export function useHistorySearch(query: string) {
  const [state, setState] = useState<{query:string; results:SearchResult[]; error:boolean; loading:boolean}>({query:'', results:[], error:false, loading:false});
  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length < 2) return () => controller.abort();
    setState({query, results:[], error:false, loading:true});
    const timer = setTimeout(() => { void api.search(query, controller.signal).then(results => {
      if (!controller.signal.aborted) setState({query, results, error:false, loading:false});
    }).catch(() => { if (!controller.signal.aborted) setState({query, results:[], error:true, loading:false}); }); }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return query.trim().length < 2 || state.query !== query ? {results:[], error:false, loading:query.trim().length >= 2} : state;
}
