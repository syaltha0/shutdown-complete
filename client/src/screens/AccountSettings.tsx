import { CalendarPublication } from './Publication';
import { useEffect, useState } from 'react';
import { useAccount } from '../App';
import { api, ApiError, type AdminState, type SessionInfo, type SignupMode, type PasswordPolicy } from '../lib/api';
import { getLang, useT } from '../lib/i18n';
import { authError, useA } from '../lib/i18n-auth';
import { addPasskey, deviceName, passkeysSupported } from '../lib/passkey';
import { modeName, PasswordMeter, passwordOk, setPasswordPolicy } from './Auth';
import { passwordCheck } from '../../../server/src/passwords.mjs';
import { IconX } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Backups, Nextcloud, TaskApps } from './TaskSync';

function ago(iso: string, lang: string, justNow: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (Math.abs(s) < 90) return justNow;
  const rtf = new Intl.RelativeTimeFormat(lang === 'tr' ? 'tr' : 'en', { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800]];
  let unit: Intl.RelativeTimeFormatUnit = 'minute', n = s / 60;
  for (const [u, sec] of steps) if (Math.abs(s) >= sec) { unit = u; n = s / sec; }
  return rtf.format(Math.round(n), unit);
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setDone(false);
    try { await fn(); setDone(true); } catch (e) { setError(e instanceof ApiError ? e.code : 'other'); } finally { setBusy(false); }
  }
  return { busy, error, done, run, setError };
}

const Row = ({ id, title, about, children, className }: { id: string; title: string; about: string; children: React.ReactNode; className?: string }) => (
  <section className={`set-row${className ? ` ${className}` : ''}`} aria-labelledby={id}>
    <div className="about"><h2 id={id}>{title}</h2><p>{about}</p></div>
    <div className="set-panel">{children}</div>
  </section>
);

export function AccountSettings() {
  const A = useA();
  const { user, refresh } = useAccount();
  const [name, setName] = useState(user.name);
  const nameA = useAction();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const pwA = useAction();
  const [delPw, setDelPw] = useState('');
  const delA = useAction();

  return (
    <div className="settings">
      <Row id="a-account" title={A.account} about={A.accountAbout}>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); nameA.run(async () => { await api.updateAccount({ name }); refresh(); }); }}>
          <div className="field"><label htmlFor="a-name">{A.name}</label>
            <input id="a-name" className="input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><span className="label">{A.email}</span><span>{user.email}</span></div>
          <div className="row-actions">
            <button className="btn" type="submit" disabled={nameA.busy || !name.trim() || name === user.name}>{A.saveName}</button>
            {nameA.done && <span className="ok-line">{A.saved}</span>}
            <button type="button" className="btn" onClick={() => api.logout().finally(() => { location.href = '/login'; })}>{A.signOutHere}</button>
          </div>
        </form>
      </Row>

      <Row id="a-pw" title={A.changePassword} about={A.changePasswordAbout}>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); pwA.run(async () => { await api.changePassword(cur, next); setCur(''); setNext(''); }); }}>
          <div className="field"><label htmlFor="a-cur">{A.currentPassword}</label>
            <input id="a-cur" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div className="field"><label htmlFor="a-new">{A.newPassword}</label>
            <input id="a-new" className="input" type="password" autoComplete="new-password" value={next} aria-describedby="a-new-rules" onChange={(e) => setNext(e.target.value)} />
            <PasswordMeter id="a-new-rules" value={next} email={user.email} name={user.name} /></div>
          {pwA.error && <p className="err-line" role="alert">{authError(pwA.error)}</p>}
          {pwA.done && <p className="ok-line" role="status">{A.passwordChanged}</p>}
          <div><button className="btn" type="submit" disabled={pwA.busy || !cur || !passwordOk(next, user.email, user.name)}>{A.changePassword}</button></div>
        </form>
      </Row>

      <CalendarPublication />
      <Passkeys />
      <TwoStep />
      <Sessions />
      <TaskApps />
      <Nextcloud />

      <Row id="a-del" title={A.deleteTitle} about={A.deleteAbout} className="danger-zone">
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); delA.run(async () => { await api.deleteAccount(delPw); location.href = '/login'; }); }}>
          <div className="field"><label htmlFor="a-del-pw">{A.passwordToConfirm}</label>
            <input id="a-del-pw" className="input" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} /></div>
          {delA.error && <p className="err-line" role="alert">{authError(delA.error)}</p>}
          <div><button className="btn danger" type="submit" disabled={delA.busy || !delPw}>{A.deleteConfirm}</button></div>
        </form>
      </Row>
    </div>
  );
}

function Passkeys() {
  const T = useT();
  const A = useA();
  const [list, setList] = useState<{ id: string; name: string; created: string; lastUsed: string | null }[] | null>(null);
  const [name, setName] = useState(displayDevice(deviceName(), T));
  const act = useAction();
  const load = () => api.passkeys().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const lang = getLang();
  return (
    <Row id="a-pk" title={A.passkeys} about={A.passkeysAbout}>
      {!list ? <div className="skeleton" style={{ height: 56 }} /> : list.length === 0 ? <p className="muted">{A.noPasskeys}</p> : (
        <div className="session-list">
          {list.map((p) => (
            <div className="session-row" key={p.id}>
              <span><b>{displayDevice(p.name, T)}</b><small className="num">{A.signedInAt(ago(p.created, lang, A.justNow))} · {p.lastUsed ? A.passkeyLast(ago(p.lastUsed, lang, A.justNow)) : A.passkeyNever}</small></span>
              <button type="button" className="btn ghost icon" aria-label={A.removePasskey(p.name)} title={A.removePasskey(p.name)} onClick={() => api.passkeyRemove(p.id).then(load)}><IconX /></button>
            </div>
          ))}
        </div>
      )}
      {passkeysSupported() ? (
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          act.run(async () => {
            try { await addPasskey(name.trim() || deviceName()); } catch (err) { if (err instanceof DOMException) throw new ApiError(0, 'cancelled', { error: 'cancelled' }); throw err; }
            await load();
          });
        }}>
          <div className="field"><label htmlFor="a-pk-name">{A.passkeyName}</label>
            <input id="a-pk-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          {act.error && <p className="err-line" role="alert">{authError(act.error)}</p>}
          {act.done && <p className="ok-line" role="status">{A.passkeyAdded}</p>}
          <div><button className="btn primary" type="submit" disabled={act.busy}>{A.addPasskey}</button></div>
        </form>
      ) : <p className="muted">{A.noPasskeySupport}</p>}
    </Row>
  );
}

function TwoStep() {
  const A = useA();
  const { user, refresh } = useAccount();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'off' | 'codes' | null>(null);
  const [copied, setCopied] = useState(false);
  const act = useAction();

  const download = () => {
    const blob = new Blob([`Shutdown Complete — ${user.email}\n\n${codes!.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shutdown-complete-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Row id="a-2fa" title={A.twoStep} about={A.twoStepAbout}>
      <div className="row-actions">
        <span className={`badge${user.totp ? ' on' : ''}`}>{user.totp ? A.twoOn : A.twoOff}</span>
        {user.totp && !codes && <span className="muted num">{A.recoveryLeft(user.recoveryLeft)}</span>}
      </div>

      {codes ? (
        <div className="inline-form" style={{ maxWidth: 520 }}>
          <b>{A.recoveryTitle}</b>
          <p className="muted">{A.recoveryBody}</p>
          <div className="codes num">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="row-actions">
            <button type="button" className="btn" onClick={download}>{A.download}</button>
            <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => setCopied(true))}>{copied ? A.copied : A.copy}</button>
            <button type="button" className="btn primary" onClick={() => { setCodes(null); setCopied(false); refresh(); }}>{A.done}</button>
          </div>
        </div>
      ) : !user.totp ? (
        setup ? (
          <form className="qr-box" onSubmit={(e) => { e.preventDefault(); act.run(async () => { const r = await api.totpEnable(code); setCodes(r.recoveryCodes); setSetup(null); setCode(''); }); }}>
            <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qr }} />
            <div className="inline-form">
              <p>{A.scan}</p>
              <div><span className="muted">{A.orKey}</span><div className="secret num">{setup.secret.match(/.{1,4}/g)!.join(' ')}</div></div>
              <div className="field"><label htmlFor="a-code">{A.code}</label>
                <input id="a-code" className="input code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
              {act.error && <p className="err-line" role="alert">{authError(act.error)}</p>}
              <div className="row-actions">
                <button className="btn primary" type="submit" disabled={act.busy || code.trim().length < 6}>{A.confirmCode}</button>
                <button type="button" className="btn ghost" onClick={() => setSetup(null)}>{A.cancel}</button>
              </div>
            </div>
          </form>
        ) : (
          <div><button type="button" className="btn primary" disabled={act.busy} onClick={() => act.run(async () => setSetup(await api.totpStart()))}>{A.turnOn}</button></div>
        )
      ) : mode ? (
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          act.run(async () => {
            if (mode === 'off') { await api.totpDisable(pw); refresh(); } else { setCodes((await api.totpRecovery(pw)).recoveryCodes); }
            setPw(''); setMode(null);
          });
        }}>
          <div className="field"><label htmlFor="a-2pw">{A.passwordToConfirm}</label>
            <input id="a-2pw" className="input" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          {act.error && <p className="err-line" role="alert">{authError(act.error)}</p>}
          <div className="row-actions">
            <button className={`btn${mode === 'off' ? ' danger' : ' primary'}`} type="submit" disabled={act.busy || !pw}>{mode === 'off' ? A.turnOff : A.newCodes}</button>
            <button type="button" className="btn ghost" onClick={() => { setMode(null); setPw(''); act.setError(null); }}>{A.cancel}</button>
          </div>
        </form>
      ) : (
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => setMode('codes')}>{A.newCodes}</button>
          <button type="button" className="btn danger" onClick={() => setMode('off')}>{A.turnOff}</button>
        </div>
      )}
    </Row>
  );
}

function Sessions() {
  const T = useT();
  const A = useA();
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const load = () => api.sessions().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const lang = getLang();
  return (
    <Row id="a-sessions" title={A.sessions} about={A.sessionsAbout}>
      {!list ? <div className="skeleton" style={{ height: 112 }} /> : (
        <div className="session-list">
          {list.map((s) => (
            <div className="session-row" key={s.id}>
              <span>
                <b>{displayDevice(s.device, T)}</b>{s.current && <span className="badge on" style={{ marginLeft: 8 }}>{A.thisDevice}</span>}
                <small className="num">{A.lastActive(ago(s.lastSeen, lang, A.justNow))} · {A.signedInAt(ago(s.created, lang, A.justNow))} · {s.ip}{s.remember ? ` · ${A.remembered}` : ''}</small>
              </span>
              {!s.current && <button type="button" className="btn" onClick={() => api.endSession(s.id).then(load)}>{A.signOutDevice}</button>}
            </div>
          ))}
        </div>
      )}
      {list && list.length > 1 && <div><button type="button" className="btn" onClick={() => api.endOtherSessions().then(load)}>{A.signOutOthers}</button></div>}
    </Row>
  );
}

export function ServerSettings() {
  const A = useA();
  const { refresh } = useAccount();
  const [state, setState] = useState<AdminState | null>(null);
  useEffect(() => { api.adminState().then(setState).catch(() => setState(null)); }, []);
  if (!state) return <div className="settings"><div className="skeleton" style={{ height: 160 }} /></div>;
  const setMode = (mode: SignupMode) => api.setSignupMode(mode).then((r) => setState({ ...state, mode: r.mode, signups: r.signups }));
  const waiting = state.users.filter((u) => !u.approved);
  return (
    <div className="settings">
      <Row id="s-server" title={A.admin} about={A.adminAbout}>
        <div className="field">
          <span className="label" id="s-mode">{A.signupMode}</span>
          <Segmented role="group" aria-labelledby="s-mode">
            {(['open', 'approve', 'invite', 'closed'] as SignupMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={state.mode === m} onClick={() => setMode(m)}>{modeName(A, m)}</button>
            ))}
          </Segmented>
          <p className="hint">{A.modeAbout[state.mode]}</p>
        </div>
        {state.mode === 'open' && <Domains value={state.domains} onSaved={(domains) => setState({ ...state, domains })} />}
        <p className="muted">{state.mail ? A.mailOn : A.mailOff}</p>
        {!state.mail && <pre className="cli"><code>docker compose exec planner node server/src/cli.mjs reset-password &lt;email&gt;</code></pre>}
      </Row>
      <Policy value={state.policy} onChange={(policy) => { setState({ ...state, policy }); api.adminState().then(setState).catch(() => {}); }} />
      <Requests state={state} onChange={(requests, invites) => { setState({ ...state, requests, invites: invites ?? state.invites }); refresh(); }} />
      {waiting.length > 0 && (
        <Row id="s-waiting" title={A.waiting(waiting.length)} about={A.modeAbout.approve}>
          <div className="session-list">
            {waiting.map((u) => (
              <div className="session-row" key={u.id}>
                <div><b>{u.name}</b><small>{u.email}</small></div>
                <span className="row-actions">
                  <button type="button" className="btn primary" onClick={() => api.approveUser(u.id).then((r) => { setState({ ...state, users: r.users }); refresh(); })}>{A.approve}</button>
                  <button type="button" className="btn ghost" onClick={() => api.declineUser(u.id).then((r) => { setState({ ...state, users: r.users }); refresh(); })}>{A.decline}</button>
                </span>
              </div>
            ))}
          </div>
        </Row>
      )}
      <SignupNote value={state.note} onSaved={(note) => setState({ ...state, note })} />
      <Invites state={state} onChange={(invites) => setState({ ...state, invites })} />
      <Row id="s-users" title={A.accounts(state.users.length)} about={A.adminAbout}>
        <div className="user-list">
          {state.users.map((u) => (
            <div className="user-row" key={u.id}>
              <b style={{ fontWeight: 500 }}>{u.name}</b>
              {u.isAdmin && <span className="badge">{A.ownerTag}</span>}
              {u.totp && <span className="badge on">{A.twoTag}</span>}
              {!u.approved && <span className="badge warn">{A.waitingTag}</span>}
              {u.mustChange && <span className="badge">{A.mustTag}</span>}
              <span className="e">{u.email}</span>
            </div>
          ))}
        </div>
      </Row>
      <Backups />
    </div>
  );
}

/**
 * The password rules. Strong rules ask for the owner's password first and, when it does not meet them itself, a new one
 * that does; the standard rules come back at a click.
 */
function Policy({ value, onChange }: { value: PasswordPolicy; onChange: (p: PasswordPolicy) => void }) {
  const A = useA();
  const { user } = useAccount();
  const [asking, setAsking] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const act = useAction();
  const shown = asking ? 'strong' : value;
  const ownFits = !passwordCheck(cur, { email: user.email, name: user.name }, 'strong').problem;
  const close = () => { setAsking(false); setCur(''); setNext(''); };
  const choose = (p: PasswordPolicy) => {
    if (p === value) { close(); return; }
    if (p === 'strong') { setAsking(true); return; }
    act.run(async () => { const r = await api.setPasswordPolicy('basic'); setPasswordPolicy(r.policy); onChange(r.policy); });
  };
  return (
    <Row id="s-pw" title={A.policyTitle} about={A.policyAbout}>
      <div className="field">
        <span className="label sr-only" id="s-pw-label">{A.policyTitle}</span>
        <Segmented role="group" aria-labelledby="s-pw-label">
          {(['basic', 'strong'] as PasswordPolicy[]).map((p) => (
            <button key={p} type="button" aria-pressed={shown === p} onClick={() => choose(p)}>{p === 'strong' ? A.policyStrong : A.policyBasic}</button>
          ))}
        </Segmented>
        <p className="hint">{A.policyNote[shown]}</p>
      </div>
      {asking && (
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          act.run(async () => {
            const r = await api.setPasswordPolicy('strong', cur, ownFits ? undefined : next);
            setPasswordPolicy(r.policy); onChange(r.policy); close();
          });
        }}>
          <p className="muted">{A.policyConfirm}</p>
          <div className="field"><label htmlFor="s-pw-cur">{A.currentPassword}</label>
            <input id="s-pw-cur" className="input" type="password" autoComplete="current-password" value={cur} autoFocus onChange={(e) => setCur(e.target.value)} /></div>
          {cur && !ownFits && (
            <div className="field"><label htmlFor="s-pw-new">{A.newPassword}</label>
              <span className="hint">{A.policyOwnNew}</span>
              <input id="s-pw-new" className="input" type="password" autoComplete="new-password" value={next} aria-describedby="s-pw-rules" onChange={(e) => setNext(e.target.value)} />
              <PasswordMeter id="s-pw-rules" value={next} email={user.email} name={user.name} rules="strong" /></div>
          )}
          {act.error && <p className="err-line" role="alert">{authError(act.error)}</p>}
          <div className="row-actions">
            <button className="btn primary" type="submit" disabled={act.busy || !cur || (!ownFits && !passwordOk(next, user.email, user.name, 'strong'))}>{A.policyOn}</button>
            <button className="btn ghost" type="button" onClick={close}>{A.cancel}</button>
          </div>
        </form>
      )}
      {!asking && act.done && value === 'strong' && <p className="ok-line" role="status">{A.policyDone}</p>}
    </Row>
  );
}

/** A few lines from the owner, shown above the sign-up form. */
function SignupNote({ value, onSaved }: { value: string; onSaved: (n: string) => void }) {
  const A = useA();
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  return (
    <Row id="s-note" title={A.noteTitle} about={A.noteAbout}>
      <form className="note-form" onSubmit={(e) => { e.preventDefault(); api.setSignupNote(text).then((r) => { onSaved(r.note); setText(r.note); setSaved(true); }); }}>
        <div className="field">
          <label htmlFor="s-note-text">{A.noteLabel}</label>
          <textarea id="s-note-text" className="input" rows={3} maxLength={400} placeholder={A.notePh} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} />
        </div>
        <div><button type="submit" className="btn">{saved ? A.noteSaved : A.noteSave}</button></div>
      </form>
    </Row>
  );
}

/** With open sign-ups: the e-mail domains that may sign up by themselves. */
function Domains({ value, onSaved }: { value: string[]; onSaved: (d: string[]) => void }) {
  const A = useA();
  const [text, setText] = useState(value.join(', '));
  const [saved, setSaved] = useState(false);
  return (
    <form className="domains-form" onSubmit={(e) => {
      e.preventDefault();
      api.setDomains(text).then((r) => { onSaved(r.domains); setText(r.domains.join(', ')); setSaved(true); });
    }}>
      <div className="field grow">
        <label htmlFor="s-domains">{A.domainsLabel}</label>
        <input id="s-domains" className="input" placeholder={A.domainsPh} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} />
        <p className="hint">{A.domainsAbout}</p>
      </div>
      <button type="submit" className="btn">{saved ? A.domainsSaved : A.domainsSave}</button>
    </form>
  );
}

/** People who asked for an invite from the sign-up page: send one to their address, or decline. */
function Requests({ state, onChange }: { state: AdminState; onChange: (r: AdminState['requests'], i?: AdminState['invites']) => void }) {
  const A = useA();
  const lang = getLang();
  const [made, setMade] = useState<{ email: string; link: string; sent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' });
  // shown while someone asks, and after the last yes, until its link has been copied away
  if (!state.requests.length && !made) return null;
  return (
    <Row id="s-requests" title={state.requests.length ? A.requestsTitle(state.requests.length) : A.inviteMade(made!.email)} about={A.requestsAbout}>
      <div className="session-list">
        {state.requests.map((r) => (
          <div className="session-row" key={r.id}>
            <div><b>{r.email}</b><small>{r.note ? `“${r.note}” · ` : ''}{date(r.created)}</small></div>
            <span className="row-actions">
              <button type="button" className="btn primary" onClick={() => api.inviteRequest(r.id).then((x) => { setMade({ email: x.email, link: x.link, sent: x.sent }); setCopied(false); onChange(x.requests, x.invites); })}>{A.sendInvite}</button>
              <button type="button" className="btn ghost" onClick={() => api.declineRequest(r.id).then((x) => onChange(x.requests))}>{A.decline}</button>
            </span>
          </div>
        ))}
      </div>
      {made && (
        <div className="invite-link">
          <input className="input num" readOnly value={made.link} aria-label={A.inviteMade(made.email)} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(made.link).then(() => setCopied(true))}>{copied ? A.copied : A.copy}</button>
          <p className={made.sent ? 'ok-line' : 'hint'}>{made.sent ? A.inviteSent(made.email) : `${A.inviteMade(made.email)} ${A.inviteNotSent}`}</p>
        </div>
      )}
    </Row>
  );
}

/** Invite links: made here, shown once, listed with how often they were used, and revocable. */
function Invites({ state, onChange }: { state: AdminState; onChange: (i: AdminState['invites']) => void }) {
  const A = useA();
  const lang = getLang();
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState(7);
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const act = useAction();
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' });
  return (
    <Row id="s-invites" title={A.invitesTitle} about={A.invitesAbout}>
      {state.mode === 'closed' && <p className="notice">{A.invitesNeedMode}</p>}
      <form className="invite-form" onSubmit={(e) => {
        e.preventDefault();
        act.run(async () => {
          const r = await api.createInvite({ uses, days, note, email, lang });
          setLink(r.link); setSentTo(email ? (r.sent ? email : '') : null); setCopied(false); setNote(''); setEmail(''); onChange(r.invites);
        });
      }}>
        <div className="field iv-email">
          <label htmlFor="iv-email">{A.inviteEmail}</label>
          <input id="iv-email" className="input" type="email" placeholder={A.inviteEmailPh} value={email}
            onChange={(e) => { setEmail(e.target.value); if (e.target.value) setUses(1); }} />
        </div>
        <div className="field iv-note">
          <label htmlFor="iv-note">{A.inviteNote}</label>
          <input id="iv-note" className="input" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="iv-uses">{A.inviteUses}</label>
          <select id="iv-uses" className="input" value={uses} disabled={!!email} onChange={(e) => setUses(Number(e.target.value))}>
            <option value={1}>{A.usesOne}</option><option value={5}>{A.usesFive}</option><option value={0}>{A.usesAny}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="iv-days">{A.inviteDays}</label>
          <select id="iv-days" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>{A.days1}</option><option value={7}>{A.days7}</option><option value={30}>{A.days30}</option><option value={0}>{A.daysAny}</option>
          </select>
        </div>
        <span />
        <button type="submit" className="btn primary" disabled={act.busy}>{A.makeLink}</button>
      </form>
      {act.error && <p className="err-line">{authError(act.error)}</p>}
      {link && (
        <div className="invite-link">
          <input className="input num" readOnly value={link} aria-label={A.invitesTitle} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? A.copied : A.copy}</button>
          {sentTo != null && <p className={sentTo ? 'ok-line' : 'hint'}>{sentTo ? A.inviteSent(sentTo) : A.inviteNotSent}</p>}
          <p className="hint">{A.linkOnce}</p>
        </div>
      )}
      {state.invites.length === 0 ? <p className="muted">{A.noInvites}</p> : (
        <div className="session-list">
          {state.invites.map((i) => (
            <div className="session-row" key={i.id}>
              <div>
                <b>{i.note || i.email || date(i.created)}</b>
                {i.note && i.email && <small>{i.email}</small>}
                <small>
                  {i.live ? `${A.inviteUsed(i.uses, i.maxUses)} · ${i.expires ? A.inviteUntil(date(i.expires)) : A.inviteNoEnd}` : A.inviteDead}
                </small>
              </div>
              <button type="button" className="btn ghost" onClick={() => api.revokeInvite(i.id).then((r) => onChange(r.invites))}>{A.revoke}</button>
            </div>
          ))}
        </div>
      )}
    </Row>
  );
}

function displayDevice(name: string, T: ReturnType<typeof useT>) {
  if (!/^(Browser|Chrome|Edge|Firefox|Safari)( on (Windows|Mac|Linux|Android|iPhone))?$/.test(name)) return name;
  const [br, os] = name.split(' on ');
  const browser = br === 'Browser' ? T.browserName : br;
  return os ? T.deviceOn(browser, os) : browser;
}
