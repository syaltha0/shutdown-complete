import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { exportText } from '../lib/export';
export function CalendarPublication() {
  const P = useT().publication;
  const [active, setActive] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(false);
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone), [tasks, setTasks] = useState(false), [url, setUrl] = useState('');
  useEffect(() => { api.calendarFeed().then((s) => { setActive(!!s); if (s) { setZone(s.timezone); setTasks(!!s.tasks); } }).catch(() => setError(true)).finally(() => setBusy(false)); }, []);
  async function run(disable = false) {
    setBusy(true); setError(false); setUrl('');
    try {
      if (disable) { await api.disableCalendarFeed(); setActive(false); }
      else { const r = await api.createCalendarFeed(zone, tasks); setUrl(location.origin + r.path); setActive(true); }
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <section className="set-row" aria-labelledby="publication-title">
    <div className="about"><h2 id="publication-title">{P.title}</h2><p>{P.about}</p></div>
    <div className="set-panel">
      <label className="field">{P.zone}<input className="input" value={zone} onChange={(e) => setZone(e.target.value)} /></label>
      <label><input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} /> {P.tasks}</label>
      <div className="row-actions"><button className="btn" disabled={busy || !zone} onClick={() => run()}>{active ? P.renew : P.create}</button>
        {active && <button className="btn" disabled={busy} onClick={() => run(true)}>{P.disable}</button>}</div>
      {url && <input className="input" aria-label={P.title} readOnly value={url} onFocus={(e) => e.target.select()} />}
      {error && <p role="alert" className="err-line">{P.error}</p>}
    </div>
  </section>;
}
export function ExportDownloads() {
  const T = useT(), P = T.publication;
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  async function download(format: 'markdown' | 'blocks' | 'metrics') {
    setBusy(true); setError(false);
    try {
      const res = await fetch('/api/export');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const url = URL.createObjectURL(new Blob([exportText(data.docs, format, T)], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `shutdown-complete-${format}.${format === 'markdown' ? 'md' : 'csv'}`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <>{(['markdown', 'blocks', 'metrics'] as const).map((f) => <button type="button" className="btn" key={f} disabled={busy} onClick={() => download(f)}>{P[f]}</button>)}{error && <span role="alert">{P.error}</span>}</>;
}
