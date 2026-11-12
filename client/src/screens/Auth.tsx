import { useEffect, useRef, useState } from 'react';
import { passwordPolicy } from '../lib/authRules';
import { api, ApiError, type AuthState, type PasswordPolicy, type SignupMode, type User } from '../lib/api';
import { getLang } from '../lib/i18n';
import { reducedMotion } from '../lib/theme';
import { authError, useA } from '../lib/i18n-auth';
import { navigate, onLinkClick, usePath } from '../lib/router';
import { IconEye, IconEyeOff, Mark } from '../components/Icons';
import { Showcase } from '../components/Showcase';
import { passkeysSupported, signInWithPasskey } from '../lib/passkey';
import { emailSuggestion } from '../lib/emailHint';
import { passwordCheck, POLICIES } from '../../../server/src/passwords.mjs';

/** Everything before sign-in: setup, sign in (and its second step), sign up, forgotten and reset passwords, e-mail checks. */
export function Auth({ state, onIn }: { state: AuthState; onIn: () => void }) {
  const path = usePath();
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';

  let view: React.ReactNode;
  if (state.setup) view = <Setup onIn={onIn} />;
  else if (path === '/register') view = <Register state={state} onIn={onIn} />;
  else if (path === '/forgot') view = <Forgot />;
  else if (path === '/reset') view = <Reset token={token} />;
  else if (path === '/verify') view = <Verify token={token} onIn={onIn} />;
  else view = <SignIn state={state} onIn={onIn} />;

  return <AuthFrame source={state.source} viewKey={path + (state.setup ? 's' : '')}>{view}</AuthFrame>;
}

function AuthFrame({ source, viewKey, children }: { source: string; viewKey: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-form-side">
        <div className="auth-top">
          <a className="auth-brand" href="/login" onClick={onLinkClick}><Mark /><span>Shutdown Complete</span></a>
        </div>
        <div className="auth-form-wrap" key={viewKey} onKeyDown={arrowsBetweenFields}>{children}</div>
        <AuthFoot source={source} />
      </main>
      <Showcase />
    </div>
  );
}

/**
 * Signed in, but a new password comes first: the owner made the rules stricter and this one does not meet them, or the
 * password was a temporary one from the command line. The server refuses everything else until it is done.
 */
export function MustChange({ user, source }: { user: User; source: string }) {
  const A = useA();
  const [cur, setCur] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const s = useSubmit();
  return (
    <AuthFrame source={source} viewKey="must-change">
      <form className="auth-form" onSubmit={(e) => {
        e.preventDefault();
        s.run(async () => { await api.changePassword(cur, password); setDone(true); await settle(); location.reload(); });
      }}>
        <Title>{A.mustTitle}</Title>
        <p className="auth-sub">{user.mustChange === 2 ? A.mustTemp : A.mustRules}</p>
        <input type="email" autoComplete="username" value={user.email} readOnly hidden />
        <Field id="current" label={A.currentPassword}>
          <PasswordInput id="current" value={cur} onChange={setCur} autoComplete="current-password" autoFocus />
        </Field>
        <Field id="password" label={A.newPassword}>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-rules" />
          <PasswordMeter id="password-rules" value={password} email={user.email} name={user.name} />
        </Field>
        <ErrorLine code={s.error} />
        <button className="btn primary big" type="submit" disabled={s.busy || !cur || !passwordOk(password, user.email, user.name)}>
          <Busy busy={s.busy} done={done} idle={A.mustSave} working={A.saving} />
        </button>
        <p className="auth-alt"><a className="card-link" href="/login" onClick={(e) => { e.preventDefault(); api.logout().finally(() => { location.href = '/login'; }); }}>{A.signOutHere}</a></p>
      </form>
    </AuthFrame>
  );
}

/**
 * ↓ and ↑ move between the text fields of these forms (e-mail, password…), round from the last to the first; Enter in
 * any field but the last moves on to the next one, and only Enter in the last field sends the form.
 */
function arrowsBetweenFields(e: React.KeyboardEvent) {
  const enter = e.key === 'Enter';
  if ((!enter && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const el = e.target;
  const typing = (i: EventTarget): i is HTMLInputElement => i instanceof HTMLInputElement && ['text', 'email', 'password', 'tel'].includes(i.type);
  if (!typing(el)) return;
  const form = el.closest('form');
  if (!form) return;
  const fields = [...form.querySelectorAll('input')].filter((i) => typing(i) && !i.disabled && !i.closest('.hp') && i.offsetParent !== null);
  if (fields.length < 2) return;
  const at = fields.indexOf(el);
  if (enter && at === fields.length - 1) {
    // the form cannot be sent yet (its button is disabled): show what is missing rather than doing nothing
    const send = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (send?.disabled) { e.preventDefault(); form.classList.add('tried'); }
    return;
  }
  const next = fields[(at + (e.key === 'ArrowUp' ? -1 : 1) + fields.length) % fields.length];
  e.preventDefault();
  next.focus();
  // the caret goes to the end where the field allows it (e-mail fields do not)
  try { next.setSelectionRange(next.value.length, next.value.length); } catch { /* not a text field */ }
}

function AuthFoot({ source }: { source: string }) {
  const A = useA();
  return (
    <>
      <a className="card-link how-link" href="#how">{A.howItWorks}</a>
      <p className="auth-foot">{A.selfHosted} · <a href={source} target="_blank" rel="noreferrer">AGPL-3.0</a></p>
    </>
  );
}

// ---------------- forms ----------------

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.code : 'other'); } finally { setBusy(false); }
  }
  return { busy, error, setError, run };
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="field-error" id={`${id}-error`} role="alert">{error}</span> : hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

/** Which fields the person has left, so their errors show under them then and not while they are still typing. */
function useTouched() {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  return { touched: (k: string) => !!touched[k], leave: (k: string) => () => setTouched((t) => ({ ...t, [k]: true })) };
}
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

// An address carried from one form to the next (sign-up to sign-in or reset) without putting it in the URL.
const PREFILL = 'sc-prefill-email';
const takePrefill = () => { try { const v = sessionStorage.getItem(PREFILL) || ''; sessionStorage.removeItem(PREFILL); return v; } catch { return ''; } };
const goWith = (path: string, email: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  try { sessionStorage.setItem(PREFILL, email); } catch { /* private mode */ }
  navigate(path);
};

// The server's password rules live in lib/authRules.ts (the shell sets them before this screen loads).
export { isAuthPath, setPasswordPolicy } from '../lib/authRules';

// Tells password managers (Chrome, Safari and iCloud Keychain, 1Password…) the rules a new password must meet, so the
// strong password they offer is accepted the first time. `passwordrules` is Safari's own attribute.
const newPasswordRules = () => {
  const P = POLICIES[passwordPolicy()];
  const need = (['upper', 'lower', 'digit', 'special'] as const).filter((k) => P[k]).map((k) => `required: ${k};`).join(' ');
  return { minLength: P.min, maxLength: 200, passwordrules: `minlength: ${P.min}; maxlength: 200; ${need}` } as React.InputHTMLAttributes<HTMLInputElement>;
};

function PasswordInput({ id, value, onChange, autoComplete, describedBy, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string; autoFocus?: boolean;
}) {
  const A = useA();
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const watchCaps = (e: React.KeyboardEvent) => setCaps(e.getModifierState('CapsLock'));
  return (
    <>
      <div className="pw">
        <input id={id} className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} autoFocus={autoFocus}
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          {...(autoComplete === 'new-password' ? newPasswordRules() : {})}
          aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} onKeyDown={watchCaps} onKeyUp={watchCaps} onBlur={() => setCaps(false)} required />
        <button type="button" className="pw-toggle" aria-pressed={show} aria-controls={id} aria-label={show ? A.hide : A.show} title={show ? A.hide : A.show}
          onClick={() => setShow(!show)}>{show ? <IconEyeOff /> : <IconEye />}</button>
      </div>
      {caps && <span className="caps-warn" role="status">{A.capsOn}</span>}
    </>
  );
}

/** An e-mail field that offers a fix for a mistyped provider (gmial.com → gmail.com) once the person moves on. */
function EmailInput({ value, onChange, autoFocus, onBlur, locked }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; onBlur?: () => void; locked?: boolean }) {
  const A = useA();
  const [checked, setChecked] = useState('');
  const hint = checked === value ? emailSuggestion(value) : null;
  useEffect(() => { const t = window.setTimeout(() => setChecked(value), 900); return () => window.clearTimeout(t); }, [value]);
  return (
    <>
      <input id="email" className="input" type="email" autoComplete="username" value={value} autoFocus={autoFocus} readOnly={locked}
        onChange={(e) => onChange(e.target.value)} onBlur={() => { setChecked(value); onBlur?.(); }} required aria-describedby={hint ? 'email-fix' : undefined} />
      {hint && !locked && (
        <p className="email-fix" id="email-fix" aria-live="polite">
          {A.didYouMean} <button type="button" onClick={() => { onChange(hint); setChecked(hint); }}>{hint}</button>{A.didYouMeanEnd}
        </p>
      )}
    </>
  );
}

/**
 * A line that glides to its length instead of jumping: a critically damped spring whose speed is capped, so a small
 * step settles softly and a long one travels at an even pace. The width is written straight to the element each
 * frame (no re-render).
 */
function useGlide(target: number) {
  const el = useRef<HTMLElement | null>(null);
  const pos = useRef(target), vel = useRef(0);
  useEffect(() => {
    let raf = 0, last = performance.now();
    const w = 10, cap = reducedMotion() ? 2.4 : 0.85; // widths per second
    const tick = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      vel.current = Math.max(-cap, Math.min(cap, vel.current + (-w * w * (pos.current - target) - 2 * w * vel.current) * dt));
      pos.current += vel.current * dt;
      const done = Math.abs(pos.current - target) < 0.002 && Math.abs(vel.current) < 0.02;
      if (done) { pos.current = target; vel.current = 0; }
      if (el.current) el.current.style.transform = `scaleX(${pos.current})`;
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return el;
}

/** How long a crossing-off stroke may take in all: a pasted or generated password is crossed off quickly. */
const STROKE_MAX = 480;

/**
 * What a new password needs, written as one sentence ("At least 8 characters, a capital letter and a symbol") whose
 * parts are crossed off as they are met, like the struck-through blocks of the planner. Once all are, the sentence gives
 * way to how strong the password is: one line in the strength's colour and a word, with a tip. The check is the
 * server's own (server/src/passwords.mjs), so a password this accepts is never turned away.
 *
 * In use: a part not yet met turns red once the person leaves the field or presses Enter (`.tried`, see
 * arrowsBetweenFields), so a disabled button never leaves them guessing; a space at either end is pointed out (it is
 * easy to paste and hard to see); the strength line keeps the sentence's height so the button below does not move.
 */
export function PasswordMeter({ value, email, name, id, rules: p = passwordPolicy() }: { value: string; email?: string; name?: string; id?: string; rules?: PasswordPolicy }) {
  const A = useA();
  const { problem, rules, min, bits } = passwordCheck(value, { email, name }, p);
  const met = !!value && rules.every((r) => r.ok);
  const parts = new Intl.ListFormat(getLang() === 'tr' ? 'tr' : 'en-GB', { type: 'conjunction' }).formatToParts(rules.map((r) => r.id));
  const ruleOk = (i: number) => parts[i]?.type === 'element' && rules.find((r) => r.id === parts[i].value)!.ok;
  // a comma or "and" between two crossed-off parts is crossed off with them
  const cap = (t: string, i: number) => (i === 0 ? t.charAt(0).toLocaleUpperCase(getLang() === 'tr' ? 'tr' : 'en') + t.slice(1) : t);
  const segs = parts.map((part, i) => ({
    part, text: part.type === 'element' ? cap(A.rule[part.value](min), i) : part.value,
    done: part.type === 'element' ? ruleOk(i) : ruleOk(i - 1) && ruleOk(i + 1),
  }));
  // One pen stroke: the parts crossed off by this keystroke are drawn left to right at an even speed, starting where
  // the line on their left ends, or will end if it is still being drawn (fast typing). Everything at once (a paste)
  // is drawn faster, so the whole sentence takes at most STROKE_MAX.
  const struck = useRef<boolean[]>([]);
  const endsAt = useRef<number[]>([]);
  const now = performance.now();
  let pen = 0;
  const raw = segs.map((sg, i) => {
    if (!sg.done) { pen = 0; return null; }
    if (struck.current[i]) { pen = Math.max(0, (endsAt.current[i] ?? 0) - now); return null; }
    const t = Math.max(60, sg.text.length * 16), d = pen;
    pen += t;
    return { d, t };
  });
  const total = Math.max(0, ...raw.map((x) => (x ? x.d + x.t : 0)));
  const speed = total > STROKE_MAX ? STROKE_MAX / total : 1;
  const timing = raw.map((x) => (x ? { d: Math.round(x.d * speed), t: Math.round(x.t * speed) } : null));
  const drawn = Math.round(total * speed);
  useEffect(() => {
    struck.current = segs.map((sg) => sg.done);
    timing.forEach((x, i) => { if (x) endsAt.current[i] = now + x.d + x.t; });
  });
  // the last part is crossed off before the sentence makes way for the strength
  const [shown, setShown] = useState(met);
  useEffect(() => {
    if (!met) { setShown(false); return; }
    const t = window.setTimeout(() => setShown(true), drawn + 200);
    return () => window.clearTimeout(t);
  }, [met]);
  const strong = shown && met;
  // The line, one measure from start to end: grey while the rules are being met (the length a little with each
  // character, each other rule a step), up to 30%. All met: from 40% on it follows how hard the password is to guess.
  // The line glides there; the colour and the word are the destination's straight away (no "fair, good, strong" run
  // when the last rule is met at the end of a long password). A password that meets the rules but would still be
  // refused (a run, a common one...) does not rewind: the line stays grey where the rules put it, and the word says why.
  const lengthPart = Math.min(1, value.length / min);
  const before = 0.3 * (lengthPart + rules.filter((r) => r.id !== 'length' && r.ok).length) / rules.length;
  // three plain bands once the rules are met: fair (amber, 40-62%), good (green, 66-84%) and strong, which fills the
  // line (about 70 bits: a dozen mixed characters or a short phrase)
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const judged = bits >= 70 ? 1 : bits >= 55 ? 0.66 + 0.18 * (bits - 55) / 15 : 0.4 + 0.22 * clamp((bits - 40) / 15);
  const target = !value ? 0 : !strong || problem ? before : judged;
  // Typing on never moves the line back. The estimate itself can dip as characters are added (a run such as "123" or
  // a repeat counts for less than the characters before it), which read as a fault; so while the password only grows,
  // the line holds its place. Deleting or editing in the middle lets it follow the estimate down again.
  const last = useRef({ value: '', fill: 0 });
  const growing = !!last.current.value && value.startsWith(last.current.value);
  const fill = growing ? Math.max(target, last.current.fill) : target;
  useEffect(() => { last.current = { value, fill }; });
  const line = useGlide(fill);
  const grade = fill >= 0.999 ? 4 : fill >= 0.66 ? 3 : 2;
  const level = !strong ? '' : problem ? ' refused' : grade === 4 ? ' strong' : grade === 3 ? ' good' : ' fair';
  const tip = problem ? A.strengthTip[problem] : grade === 4 ? A.strengthTip.strong : grade === 3 ? A.strengthTip.good : A.strengthTip.fair;
  // the strength line keeps the height of the sentence it replaces (the strong rules take two lines on a phone)
  const needs = useRef<HTMLParagraphElement>(null);
  const [tall, setTall] = useState(0);
  useEffect(() => { if (!strong && needs.current) setTall(needs.current.offsetHeight); });
  const spaced = /^\s|\s$/.test(value);
  return (
    <div className={`pw-meter${level}${value && !met ? ' unmet' : ''}`} id={id}>
      <div className="pw-line" aria-hidden="true"><i ref={line} /></div>
      {strong ? (
        <p key="strength" aria-live="polite" style={{ minHeight: tall || undefined }}>
          {!problem && grade === 4 && <svg className="pw-tick" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 6.5" /></svg>}
          <b>{problem ? A.refused : A.strength[grade]}</b> · {typeof tip === 'function' ? tip(0) : tip}
        </p>
      ) : (
        <p key="needs" ref={needs} className="pw-needs">
          <em className="sr-only">{A.rulesLabel}: </em>
          {segs.map((sg, i) => {
            const style = timing[i] ? { '--d': `${timing[i]!.d}ms`, '--t': `${timing[i]!.t}ms` } as React.CSSProperties : undefined;
            if (sg.part.type !== 'element') return <span key={i} className={sg.done ? 'done' : undefined} style={style}>{sg.text}</span>;
            return <span key={i} className={sg.done ? 'part done' : 'part'} style={style}>{sg.text}{sg.done && <span className="sr-only"> ({A.ruleMet})</span>}</span>;
          })}
        </p>
      )}
      {spaced && <p className="pw-space">{A.spaceAtEnd}</p>}
    </div>
  );
}
export const passwordOk = (pw: string, email?: string, name?: string, p: PasswordPolicy = passwordPolicy()) => !passwordCheck(pw, { email, name }, p).problem;

/** The label of a button that sends a form: a small spinner while it is busy, the planner's tick once it went through. */
const Busy = ({ busy, idle, working, done }: { busy: boolean; idle: string; working: string; done?: boolean }) => {
  const A = useA();
  if (done) return <><svg className="done-tick" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 6.5" /></svg>{A.ready}</>;
  return busy ? <><span className="spinner" aria-hidden="true" />{working}</> : <>{idle}</>;
};

/** A form's title: its words rise from behind their own baseline as the form opens. */
const Title = ({ children }: { children: React.ReactNode }) => (
  <h1 className="rise-title"><span className="mask"><span>{children}</span></span></h1>
);

/** Shows the tick for a moment, then goes on (the planner opens with a page load). */
const settle = () => new Promise((ok) => setTimeout(ok, 520));

const ErrorLine = ({ code }: { code: string | null }) => (code ? <p className="auth-error" role="alert">{authError(code)}</p> : null);

function SignIn({ state, onIn }: { state: AuthState; onIn: () => void }) {
  const A = useA();
  const [email, setEmail] = useState(takePrefill);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const s = useSubmit();
  const [done, setDone] = useState(false);

  if (ticket) {
    return (
      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); s.run(async () => { await api.login2fa(ticket, code); setDone(true); await settle(); onIn(); }); }}>
        <Title>{A.twoTitle}</Title>
        <p className="auth-sub">{A.twoSub}</p>
        <Field id="code" label={A.code} hint={A.recoveryHint}>
          <input id="code" className="input code-input" inputMode="numeric" autoComplete="one-time-code" autoFocus
            value={code} onChange={(e) => setCode(e.target.value)} aria-describedby="code-hint" required />
        </Field>
        <ErrorLine code={s.error} />
        <button className="btn primary big" type="submit" disabled={s.busy || code.trim().length < 6}><Busy busy={s.busy} done={done} idle={A.verifyBtn} working={A.signingIn} /></button>
        <button type="button" className="card-link quiet" onClick={() => { setTicket(null); setCode(''); s.setError(null); }}>{A.backToSignIn}</button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={(e) => {
      e.preventDefault();
      s.run(async () => {
        const r = await api.login(email, password, remember);
        if (r.twoFactor && r.ticket) setTicket(r.ticket); else { setDone(true); await settle(); onIn(); }
      });
    }}>
      <Title>{A.signInTitle}</Title>
      <p className="auth-sub">{A.signInSub}</p>
      <Field id="email" label={A.email}>
        <input id="email" className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <div className="field">
        <div className="label-row">
          <label htmlFor="password">{A.password}</label>
          <a className="card-link quiet" href="/forgot" onClick={onLinkClick}>{A.forgot}</a>
        </div>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
      </div>
      <label className="check-line">
        <input type="checkbox" className="check" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {A.remember}
      </label>
      <ErrorLine code={s.error} />
      {s.error === 'unverified' && (
        <button type="button" className="card-link quiet" disabled={resent} onClick={() => api.resend(email).then(() => setResent(true))}>{resent ? A.resent : A.resend}</button>
      )}
      <button className="btn primary big" type="submit" disabled={s.busy || !email || !password}><Busy busy={s.busy} done={done} idle={A.signIn} working={A.signingIn} /></button>
      {passkeysSupported() && (
        <>
          <div className="or-line"><span>{A.or}</span></div>
          <button type="button" className="btn big" disabled={s.busy}
            onClick={() => s.run(async () => {
              try { await signInWithPasskey(); } catch (e) { if (e instanceof DOMException) throw new ApiError(0, 'cancelled', { error: 'cancelled' }); throw e; }
              onIn();
            })}>{A.passkeyBtn}</button>
        </>
      )}
      {state.signups && <p className="auth-alt">{A.noAccount} <a className="card-link" href="/register" onClick={onLinkClick}>{A.createOne}</a></p>}
      {state.invites && <p className="auth-alt">{A.noAccount} <a className="card-link" href="/register" onClick={onLinkClick}>{A.askLink}</a></p>}
    </form>
  );
}

function Register({ state, onIn }: { state: AuthState; onIn: () => void }) {
  const A = useA();
  const invite = new URLSearchParams(location.search).get('invite') || '';
  const [inviteOk, setInviteOk] = useState<boolean | null>(invite ? null : false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [website, setWebsite] = useState(''); // a field people never see; bots fill it in
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [lockedEmail, setLockedEmail] = useState('');
  const s = useSubmit();
  const t = useTouched();
  useEffect(() => {
    if (!invite) return;
    api.checkInvite(invite).then((r) => { setInviteOk(r.valid); if (r.email) { setEmail(r.email); setLockedEmail(r.email); } }, () => setInviteOk(false));
  }, [invite]);
  const emailError = t.touched('email') && email && !looksLikeEmail(email) ? A.errors['invalid-email'] : null;

  if (invite && inviteOk === null) {
    return <div className="auth-form"><Title>{A.registerTitle}</Title><p className="auth-sub">{A.checkingInvite}</p></div>;
  }
  if (!state.signups && !inviteOk && state.invites && !invite) return <AskInvite state={state} />;
  if (!state.signups && !inviteOk) {
    return (
      <div className="auth-form">
        <Title>{A.registerTitle}</Title>
        <p className="auth-sub">{invite ? A.errors['invite-invalid'] : state.invites ? A.invitesOnly : A.signupsClosed}</p>
        <a className="btn big" href="/login" onClick={onLinkClick}>{A.backToSignIn}</a>
      </div>
    );
  }
  if (pending && !sent) {
    return (
      <div className="auth-form">
        <Title>{A.pendingTitle}</Title>
        <p className="auth-sub">{A.pendingBody}</p>
        <a className="btn big" href="/login" onClick={onLinkClick}>{A.backToSignIn}</a>
      </div>
    );
  }
  if (sent) {
    return (
      <div className="auth-form">
        <Title>{A.checkInbox}</Title>
        <p className="auth-sub">{pending ? A.pendingMailBody(email) : A.checkInboxBody(email)}</p>
        <button type="button" className="btn big" disabled={resent} onClick={() => api.resend(email).then(() => setResent(true))}>{resent ? A.resent : A.resend}</button>
        <a className="card-link quiet" href="/login" onClick={onLinkClick}>{A.backToSignIn}</a>
      </div>
    );
  }
  return (
    <form className="auth-form" onSubmit={(e) => {
      e.preventDefault();
      s.run(async () => {
        const send = () => api.register({ email, password, lang: getLang(), invite: invite || undefined, website, form: state.form });
        let r;
        try { r = await send(); } catch (err) {
          // a person who is very quick (or a password manager) is only asked to wait the rest of a moment
          if (!(err instanceof ApiError) || err.code !== 'too-fast') throw err;
          await new Promise((ok) => setTimeout(ok, Number(err.body?.wait || 1000) + 150));
          r = await send();
        }
        if (r.pending) setPending(true);
        if (r.verify) setSent(true);
        else if (!r.pending) { setDone(true); await settle(); onIn(); }
      });
    }}>
      <Title>{A.registerTitle}</Title>
      <p className="auth-sub">{inviteOk ? A.invited : A.registerSub}</p>
      {state.note && <p className="auth-note owner">{state.note}</p>}
      {!inviteOk && state.approval && <p className="auth-note">{A.approvalNote}</p>}
      <Field id="email" label={A.email} error={emailError}
        hint={lockedEmail ? A.inviteFor(lockedEmail) : !inviteOk && state.domains.length ? A.domainsOnly(state.domains.join(', ')) : undefined}>
        <EmailInput value={email} onChange={setEmail} onBlur={t.leave('email')} locked={!!lockedEmail} autoFocus={!lockedEmail} />
      </Field>
      <Field id="password" label={A.password}>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-rules" />
        <PasswordMeter id="password-rules" value={password} email={email} />
      </Field>
      <div className="hp" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {s.error === 'taken' ? (
        <p className="auth-error" role="alert">
          {A.errors.taken} <a className="card-link" href="/login" onClick={goWith('/login', email)}>{A.takenSignIn}</a>
          {' · '}<a className="card-link" href="/forgot" onClick={goWith('/forgot', email)}>{A.takenReset}</a>
        </p>
      ) : <ErrorLine code={s.error} />}
      <button className="btn primary big" type="submit" disabled={s.busy || !looksLikeEmail(email) || !passwordOk(password, email)}><Busy busy={s.busy} done={done} idle={A.register} working={A.registering} /></button>
      <p className="auth-alt">{A.haveAccount} <a className="card-link" href="/login" onClick={onLinkClick}>{A.signIn}</a></p>
    </form>
  );
}

/** With sign-ups by invitation: leave an address and a note, and the owner decides. */
function AskInvite({ state }: { state: AuthState }) {
  const A = useA();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState('');
  const [sent, setSent] = useState<{ mail: boolean } | null>(null);
  const s = useSubmit();
  const t = useTouched();
  if (sent) {
    return (
      <div className="auth-form">
        <Title>{A.askSentTitle}</Title>
        <p className="auth-sub">{sent.mail ? A.askSentMail(email) : A.askSentNoMail}</p>
        <a className="btn big" href="/login" onClick={onLinkClick}>{A.backToSignIn}</a>
      </div>
    );
  }
  return (
    <form className="auth-form" onSubmit={(e) => {
      e.preventDefault();
      s.run(async () => {
        const send = () => api.requestInvite({ email, note, lang: getLang(), website, form: state.form });
        let r;
        try { r = await send(); } catch (err) {
          if (!(err instanceof ApiError) || err.code !== 'too-fast') throw err;
          await new Promise((ok) => setTimeout(ok, Number(err.body?.wait || 1000) + 150));
          r = await send();
        }
        setSent({ mail: r.mail });
      });
    }}>
      <Title>{A.askTitle}</Title>
      <p className="auth-sub">{A.askSub}</p>
      {state.note && <p className="auth-note owner">{state.note}</p>}
      <Field id="email" label={A.email} error={t.touched('email') && email && !looksLikeEmail(email) ? A.errors['invalid-email'] : null}>
        <EmailInput value={email} onChange={setEmail} onBlur={t.leave('email')} autoFocus />
      </Field>
      <Field id="ask-note" label={A.askNote}>
        <input id="ask-note" className="input" maxLength={200} placeholder={A.askNotePh} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="hp" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <ErrorLine code={s.error} />
      <button className="btn primary big" type="submit" disabled={s.busy || !looksLikeEmail(email)}><Busy busy={s.busy} idle={A.askSend} working={A.askSending} /></button>
      <p className="auth-alt">{A.haveAccount} <a className="card-link" href="/login" onClick={onLinkClick}>{A.signIn}</a></p>
    </form>
  );
}

function Setup({ onIn }: { onIn: () => void }) {
  const A = useA();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit();
  const [done, setDone] = useState(false);
  const t = useTouched();
  return (
    <form className="auth-form" onSubmit={(e) => {
      e.preventDefault();
      s.run(async () => { await api.setup({ email, password, lang: getLang() }); setDone(true); await settle(); onIn(); });
    }}>
      <Title>{A.setupTitle}</Title>
      <p className="auth-sub">{A.setupSub}</p>
      <Field id="email" label={A.email} error={t.touched('email') && email && !looksLikeEmail(email) ? A.errors['invalid-email'] : null}>
        <EmailInput value={email} onChange={setEmail} onBlur={t.leave('email')} autoFocus />
      </Field>
      <Field id="password" label={A.password}>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-rules" />
        <PasswordMeter id="password-rules" value={password} email={email} />
      </Field>
      <ErrorLine code={s.error} />
      <button className="btn primary big" type="submit" disabled={s.busy || !looksLikeEmail(email) || !passwordOk(password, email)}><Busy busy={s.busy} done={done} idle={A.setupBtn} working={A.registering} /></button>
    </form>
  );
}

function Forgot() {
  const A = useA();
  const [email, setEmail] = useState(takePrefill);
  const [result, setResult] = useState<{ mail: boolean } | null>(null);
  const s = useSubmit();
  if (result) {
    return (
      <div className="auth-form">
        <Title>{A.forgotTitle}</Title>
        {result.mail ? <p className="auth-sub">{A.linkSent}</p> : (
          <>
            <p className="auth-sub">{A.noMail}</p>
            <pre className="cli"><code>docker compose exec planner node server/src/cli.mjs reset-password {email || '<email>'}</code></pre>
          </>
        )}
        <a className="btn big" href="/login" onClick={onLinkClick}>{A.backToSignIn}</a>
      </div>
    );
  }
  return (
    <form className="auth-form" onSubmit={(e) => { e.preventDefault(); s.run(async () => setResult(await api.forgot(email, getLang()))); }}>
      <Title>{A.forgotTitle}</Title>
      <p className="auth-sub">{A.forgotSub}</p>
      <Field id="email" label={A.email}>
        <input id="email" className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <ErrorLine code={s.error} />
      <button className="btn primary big" type="submit" disabled={s.busy || !email}><Busy busy={s.busy} idle={A.sendLink} working={A.sending} /></button>
      <a className="card-link quiet" href="/login" onClick={onLinkClick}>{A.backToSignIn}</a>
    </form>
  );
}

function Reset({ token }: { token: string }) {
  const A = useA();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const s = useSubmit();
  if (done) {
    return (
      <div className="auth-form">
        <Title>{A.resetTitle}</Title>
        <p className="auth-sub">{A.resetDone}</p>
        <a className="btn primary big" href="/login" onClick={onLinkClick}>{A.signIn}</a>
      </div>
    );
  }
  return (
    <form className="auth-form" onSubmit={(e) => {
      e.preventDefault();
      if (password !== again) { s.setError('mismatch'); return; }
      s.run(async () => { await api.reset(token, password); setDone(true); });
    }}>
      <Title>{A.resetTitle}</Title>
      <Field id="password" label={A.newPassword}>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-rules" autoFocus />
        <PasswordMeter id="password-rules" value={password} />
      </Field>
      <Field id="again" label={A.confirmPassword}>
        <PasswordInput id="again" value={again} onChange={setAgain} autoComplete="new-password" />
      </Field>
      {s.error === 'mismatch' ? <p className="auth-error" role="alert">{A.mismatch}</p> : <ErrorLine code={s.error} />}
      <button className="btn primary big" type="submit" disabled={s.busy || !passwordOk(password) || !again}><Busy busy={s.busy} idle={A.saveBtn} working={A.saving} /></button>
    </form>
  );
}

function Verify({ token, onIn }: { token: string; onIn: () => void }) {
  const A = useA();
  const [state, setState] = useState<'working' | 'done' | 'failed' | 'pending'>('working');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    api.verify(token).then((r) => { if (r.pending) { setState('pending'); return; } setState('done'); setTimeout(onIn, 700); }).catch(() => setState('failed'));
  }, [token, onIn]);
  return (
    <div className="auth-form" aria-live="polite">
      <Title>{state === 'failed' ? A.errors.expired : state === 'done' ? A.verified : state === 'pending' ? A.pendingTitle : A.verifying}</Title>
      {state === 'pending' && <p className="auth-sub">{A.pendingBody}</p>}
      {(state === 'failed' || state === 'pending') && <a className="btn big" href="/login" onClick={onLinkClick}>{A.backToSignIn}</a>}
    </div>
  );
}

/** The name of a sign-up mode, as the setup screen and Settings show it. */
export const modeName = (A: ReturnType<typeof useA>, m: SignupMode) =>
  ({ open: A.modeOpen, approve: A.modeApprove, invite: A.modeInvite, closed: A.modeClosed })[m];

export const goHome = () => navigate('/', true);
