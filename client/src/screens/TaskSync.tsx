import { useEffect, useState } from 'react';
import { IconCopy, IconX } from '../components/Icons';
import { api, ApiError, type BackupState, type DavInfo, type NextcloudLink } from '../lib/api';
import { IconDown } from '../components/Icons';
import { getLang, useT } from '../lib/i18n';
import { clock } from '../lib/dates';

const ago = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  return s < 60 ? rtf.format(0, 'second') : s < 3600 ? rtf.format(-Math.round(s / 60), 'minute') : s < 86400 ? rtf.format(-Math.round(s / 3600), 'hour') : rtf.format(-Math.round(s / 86400), 'day');
};
function Copy({ text, label }: { text: string; label: string }) {
  const T = useT();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost sm" aria-label={label} onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }); }}>
      <IconCopy />{done ? T.dav.copied : T.dav.copy}
    </button>
  );
}
const Row = ({ id, title, about, children }: { id: string; title: string; about: React.ReactNode; children: React.ReactNode }) => (
  <section className="set-row" aria-labelledby={id}>
    <div className="about"><h2 id={id}>{title}</h2><p>{about}</p></div>
    <div className="set-panel">{children}</div>
  </section>
);

/**
 * Task apps over CalDAV: the address and user name to give a phone or desktop app, and a password per device (shown
 * once, revocable), since an app cannot do two-step sign-in.
 */
export function TaskApps() {
  const T = useT(), W = T.dav;
  const [info, setInfo] = useState<DavInfo | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.appPasswords().then(setInfo).catch(() => {}); }, []);
  return (
    <Row id="a-dav" title={W.appsTitle} about={W.appsAbout}>
      {!info ? <div className="skeleton" style={{ height: 56 }} /> : (
        <>
          <dl className="dav-facts">
            <div><dt>{W.serverAddress}</dt><dd><code>{info.url}</code><Copy text={info.url} label={W.copyAddress} /></dd></div>
            <div><dt>{W.userName}</dt><dd><code>{info.user}</code></dd></div>
          </dl>
          {fresh && (
            <div className="dav-fresh" role="status">
              <p>{W.madeFor(fresh.name)}</p>
              <div className="dav-pw"><code className="num">{fresh.password}</code><Copy text={fresh.password} label={W.copyPassword} /></div>
              <p className="muted">{W.onlyNow}</p>
            </div>
          )}
          {info.passwords.length > 0 && (
            <div className="session-list">
              {info.passwords.map((p) => (
                <div className="session-row" key={p.id}>
                  <span><b>{p.name}</b><small className="num">{W.made(ago(p.created))} · {p.lastUsed ? W.lastUsed(ago(p.lastUsed)) : W.neverUsed}</small></span>
                  <button type="button" className="btn ghost icon" aria-label={W.revoke(p.name)} title={W.revoke(p.name)}
                    onClick={() => api.appPasswordRemove(p.id).then((r) => { setInfo(r); if (fresh?.name === p.name) setFresh(null); })}><IconX /></button>
                </div>
              ))}
            </div>
          )}
          <form className="inline-form" onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            setBusy(true);
            api.appPasswordAdd(n).then((r) => { setInfo(r); setFresh({ name: n, password: r.password }); setName(''); }).finally(() => setBusy(false));
          }}>
            <div className="field"><label htmlFor="a-dav-name">{W.deviceName}</label>
              <input id="a-dav-name" className="input" maxLength={80} placeholder={W.devicePh} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><button className="btn primary" type="submit" disabled={busy || !name.trim()}>{W.makePassword}</button></div>
          </form>
        </>
      )}
    </Row>
  );
}

/** The link to a Nextcloud: made with its address, a user name and an app password from it; synced every few minutes. */
export function Nextcloud() {
  const T = useT(), W = T.dav;
  const [link, setLink] = useState<NextcloudLink | null | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.nextcloud().then(setLink).catch(() => setLink(null)); }, []);
  const said = (code: string | null | undefined) => (code ? W.errors[code] ?? W.errors.failed : null);
  const act = (fn: () => Promise<NextcloudLink | null>) => {
    setBusy(true); setError(null);
    fn().then(setLink).catch((e) => setError(e instanceof ApiError ? e.code : 'failed')).finally(() => setBusy(false));
  };
  return (
    <Row id="a-nc" title={W.ncTitle} about={W.ncAbout}>
      {link === undefined ? <div className="skeleton" style={{ height: 56 }} /> : link ? (
        <div className="dav-linked">
          <p><b>{W.linkedTo(link.url)}</b><small className="num">{W.as(link.username)} · {W.listsN(link.lists)}{link.lastSync ? ` · ${W.synced(ago(link.lastSync))}` : ''}</small></p>
          {link.error && <p className="err-line" role="alert">{said(link.error)}</p>}
          <div className="row-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => act(() => api.nextcloudSync())}>{busy ? W.syncing : W.syncNow}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => act(() => api.nextcloudUnlink())}>{W.unlink}</button>
          </div>
          <p className="muted">{W.howItSyncs}</p>
          <p className="muted">{W.duplicateWarning}</p>
          {link.routes.map(route => <label className="session-row" key={route.id}>
            <span>{route.name}<small>{W.viaNextcloud}</small></span>
            <span><input type="checkbox" checked={route.published} disabled={busy} onChange={e => act(() => api.nextcloudPublish(route.id, e.target.checked))} />{W.publishDirect}</span>
          </label>)}
        </div>
      ) : (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act(() => api.nextcloudLink({ url: url.trim(), username: user.trim(), password: pw.trim() })); }}>
          <div className="field"><label htmlFor="a-nc-url">{W.ncAddress}</label>
            <input id="a-nc-url" className="input" type="url" inputMode="url" autoComplete="url" placeholder="https://cloud.example.org" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <div className="field"><label htmlFor="a-nc-user">{W.ncUser}</label>
            <input id="a-nc-user" className="input" autoComplete="off" autoCapitalize="off" value={user} onChange={(e) => setUser(e.target.value)} /></div>
          <div className="field"><label htmlFor="a-nc-pw">{W.ncPassword}</label>
            <input id="a-nc-pw" className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
            <span className="hint">{W.ncPasswordHint}</span></div>
          {error && <p className="err-line" role="alert">{said(error)}</p>}
          <div><button className="btn primary" type="submit" disabled={busy || !url.trim() || !user.trim() || !pw.trim()}>{busy ? W.linking : W.link}</button></div>
        </form>
      )}
    </Row>
  );
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Backups of the whole server (owner only): made every night and on asking, downloaded, brought from a file, and put
 * back in place (with the owner's password; the server stops and starts again on the copy).
 */
export function Backups() {
  const T = useT(), W = T.backup;
  const [st, setSt] = useState<BackupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [restarting, setRestarting] = useState(false);
  useEffect(() => { api.backups().then(setSt).catch(() => {}); }, []);
  const run = (fn: () => Promise<BackupState | null>) => {
    setBusy(true); setError(null);
    fn().then((r) => { if (r) setSt(r); }).catch((e) => setError(e instanceof ApiError ? e.code : 'failed')).finally(() => setBusy(false));
  };
  const when = (iso: string) => new Date(iso).toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' });
  // after a restore: wait for the server to come back, then start afresh
  useEffect(() => {
    if (!restarting) return;
    const t = window.setInterval(() => { fetch('/api/health').then((r) => { if (r.ok) location.href = '/'; }).catch(() => {}); }, 2000);
    return () => window.clearInterval(t);
  }, [restarting]);
  return (
    <Row id="s-backup" title={W.title} about={st ? W.about(st.hour >= 0 ? clock(st.hour * 60) : '', st.keep) : W.title}>
      {restarting ? <p role="status">{W.restarting}</p> : !st ? <div className="skeleton" style={{ height: 56 }} /> : (
        <>
          <div className="row-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => run(() => api.backupNow())}>{busy ? W.making : W.makeNow}</button>
            <label className="btn ghost">
              {W.upload}
              <input type="file" className="sr-only" accept=".gz,.db" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(() => api.backupUpload(f)); }} />
            </label>
          </div>
          {error && <p className="err-line" role="alert">{W.errors[error] ?? W.errors.failed}</p>}
          {st.list.length === 0 ? <p className="muted">{W.none}</p> : (
            <div className="session-list">
              {st.list.map((b) => (
                <div className="session-row backup-row" key={b.name}>
                  <span><b>{when(b.at)}</b><small className="num">{W.kinds[b.kind]} · {size(b.size)}</small></span>
                  <span className="row-actions">
                    <a className="btn ghost icon" href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download aria-label={W.download(when(b.at))} title={W.download(when(b.at))}><IconDown /></a>
                    <button type="button" className="btn ghost" onClick={() => { setSure(sure === b.name ? null : b.name); setPw(''); setError(null); }}>{W.restore}</button>
                  </span>
                  {sure === b.name && (
                    <form className="backup-sure" onSubmit={(e) => {
                      e.preventDefault();
                      setBusy(true); setError(null);
                      api.backupRestore(b.name, pw).then(() => setRestarting(true)).catch((x) => setError(x instanceof ApiError ? x.code : 'failed')).finally(() => setBusy(false));
                    }}>
                      <p>{W.sure(when(b.at))}</p>
                      <div className="field"><label htmlFor={`bk-pw-${b.name}`}>{W.password}</label>
                        <input id={`bk-pw-${b.name}`} className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
                      <div className="row-actions">
                        <button type="submit" className="btn danger" disabled={busy || !pw}>{W.restoreNow}</button>
                        <button type="button" className="btn ghost" onClick={() => setSure(null)}>{T.cancel}</button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Row>
  );
}
