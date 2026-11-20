import { useT } from '../lib/i18n';
import type { SearchResult as Result } from '../lib/historySearch';
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g,'i').normalize('NFD').replace(/\p{M}/gu,'');
export function Highlight({text, query}: {text:string; query:string}) {
  const terms = fold(query).trim().split(/\s+/).filter(Boolean), chars = [...text];
  let offset = 0;
  const ranges = chars.map(c => { const start = offset; offset += fold(c).length; return [start, offset]; });
  const flat = fold(text), hits: [number,number][] = [];
  for (const term of terms) { let i = flat.indexOf(term); while (i >= 0) { hits.push([i,i+term.length]); i = flat.indexOf(term, i+term.length); } }
  return <>{chars.map((c,i) => hits.some(([a,b])=>ranges[i][0]<b && ranges[i][1]>a) ? <mark key={i}>{c}</mark> : c)}</>;
}
export function SearchResult({result:r, query}: {result:Result; query:string}) {
  const T = useT().historySearch;
  return <span className="history-result"><small>{T.kinds[r.kind]}{r.date && <> · <time>{r.date}</time></>}</small><strong>{r.title}</strong><span><Highlight text={r.snippet} query={query} /></span></span>;
}
