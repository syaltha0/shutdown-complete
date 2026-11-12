import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAccount, useSettings } from '../App';
import { api } from '../lib/api';
import { Mark } from '../components/Icons';
import { clock, longDate, today } from '../lib/dates';
import { getLang, useT } from '../lib/i18n';
import type { MetricDef } from '../lib/model';
import { reducedMotion } from '../lib/theme';
import { navigate } from '../lib/router';
import type { Settings } from '../lib/model';

/**
 * The first thing a new account sees: three short questions (your name and what the planner is for, the hours of
 * your day, what to keep count of), then the guided tour. The answers set things up: the hours, the metrics picked
 * in advance, what the overview shows. Everything else keeps its default and lives in Settings, where the setup can
 * also be run again. On a wide screen a sketch of the day beside the questions fills in as they are answered
 * (`DaySketch`); the answers are kept for the tab (sessionStorage) so a reload does not lose them.
 */
type Preset = Pick<MetricDef, 'id' | 'kind' | 'target'>;
const NUMBERS: Preset[] = [{ id: 'deep', kind: 'number', target: 3 }, { id: 'words', kind: 'number', target: 500 }];
const CHECKS: Preset[] = ['exercise', 'read', 'sleep', 'meditate', 'nophone', 'journal'].map((id) => ({ id, kind: 'check', target: null }));
const PRESET_IDS = new Set([...NUMBERS, ...CHECKS].map((p) => p.id));
export const USES = ['school', 'work', 'personal', 'projects'] as const;
// what an answer brings with it: the activities the overview reads, the metrics picked in advance
const ACTS_FOR: Record<string, string[]> = { school: ['study', 'exams'], work: ['meetings'], personal: ['routines'], projects: ['make'] };
const METRICS_FOR: Record<string, string[]> = { school: ['deep'], work: ['deep'], personal: ['exercise', 'sleep'], projects: ['deep', 'words'] };
// the blocks the sketch draws for an answer: [label key, kind]; the first of each answer comes first
type SketchBlock = [string, 'deep' | 'shallow' | 'meeting' | 'personal'];
const BLOCKS_FOR: Record<string, SketchBlock[]> = {
  school: [['study', 'deep'], ['lecture', 'meeting']], work: [['focus', 'deep'], ['meeting', 'meeting']],
  personal: [['exercise', 'personal'], ['errands', 'shallow']], projects: [['project', 'deep'], ['admin', 'shallow']],
};
// days to start from on the hours step; the ends are then dragged to fit
const DAYS: { id: string; start: number; end: number }[] = [
  { id: 'early', start: 6, end: 14 }, { id: 'school', start: 8, end: 18 }, { id: 'office', start: 9, end: 17 },
  { id: 'late', start: 12, end: 22 }, { id: 'long', start: 7, end: 23 }, { id: 'whole', start: 0, end: 24 },
];
// a name to offer from the address: its first part made of letters (ali.kaya@… -> Ali)
const nameFromEmail = (email: string, lang: string) => {
  const part = email.split('@')[0].split(/[._\-+0-9]+/).find((x) => /^\p{L}{2,}$/u.test(x));
  return part ? part[0].toLocaleUpperCase(lang) + part.slice(1).toLocaleLowerCase(lang) : '';
};
// which part of the sketch each step speaks about (the rest is set back); the first question shapes all of it
const PART = ['all', 'hours', 'metrics'] as const;
// the answers kept for the tab; the name changes when what a draft means changes, so an old one is not read
const DRAFT = 'sc-welcome-2';
type Draft = Partial<{ step: number; reached: number; person: string; start: number; end: number; whole: boolean; picked: string[]; uses: string[] }>;
const readDraft = (): Draft => { try { return JSON.parse(sessionStorage.getItem(DRAFT) || '{}') as Draft; } catch { return {}; } };
const dropDraft = () => { try { sessionStorage.removeItem(DRAFT); } catch { /* private window */ } };

export function Welcome() {
  const T = useT(), W = T.welcome;
  const { user, refresh } = useAccount();
  const { settings, update } = useSettings();
  const names = T.defaults.metrics as Record<string, { name: string; unit: string }>;
  const [d] = useState(readDraft);
  // run again from Settings: the current settings are the answers, nothing is changed by itself, and leaving changes nothing
  const again = !!settings.setupAgain;
  // a sign-up gives only an address; until a name is given, its first part stands in
  const [person, setPerson] = useState(d.person ?? (user.name === user.email.split('@')[0] ? '' : user.name));
  const [step, setStep] = useState(d.step ?? 0);
  const [reached, setReached] = useState(d.reached ?? d.step ?? 0);
  const [dir, setDir] = useState<'next' | 'back'>('next');
  // the first time the day starts as 09:00-17:00 until an answer suggests other hours (run again: the current hours)
  const base = settings.setupAgain ? { start: settings.startHour, end: settings.endHour, whole: !!settings.wholeDay } : { start: 9, end: 17, whole: false };
  const [start, setStart] = useState(d.start ?? base.start);
  const [end, setEnd] = useState(d.end ?? base.end);
  const [whole, setWhole] = useState(d.whole ?? base.whole);
  // the first time nothing is picked until the first question is answered (run again: the current metrics)
  const [picked, setPicked] = useState(() => new Set(d.picked ?? (settings.setupAgain ? settings.metrics.map((m) => m.id) : [])));
  const [uses, setUses] = useState<string[]>(d.uses ?? settings.profile?.uses ?? []);
  useEffect(() => {
    const draft: Draft = { step, reached, person, start, end, whole, picked: [...picked], uses };
    try { sessionStorage.setItem(DRAFT, JSON.stringify(draft)); } catch { /* private window */ }
  }, [step, reached, person, start, end, whole, picked, uses]);
  const acts = [...new Set(uses.flatMap((u) => ACTS_FOR[u] ?? []))];
  const [firstPicked] = useState(picked);
  // the answers to the first question bring their metrics (until the metrics step is reached) and the sketch's
  // blocks; the hours stay 09:00-17:00 until they are set on the hours step (user's wish)
  const chooseUses = (next: string[]) => {
    setUses(next);
    if (reached < 2 && !again) setPicked(next.length ? new Set(next.flatMap((u) => METRICS_FOR[u] ?? [])) : firstPicked);
  };

  const top = useRef<HTMLElement>(null);
  const go = (to: number) => {
    setDir(to < step ? 'back' : 'next');
    setStep(to);
    setReached((r) => Math.max(r, to));
    // a long step on a phone: the next one starts at its top
    if (top.current && top.current.getBoundingClientRect().top < 0) top.current.scrollIntoView({ block: 'start' });
  };
  // a question needs an answer before moving on: a name and what the planner is for, at least one thing to count
  const noName = !person.trim();
  // the metrics may be left empty: some people want nothing to count
  const answered = (k: number) => (k === 0 ? !noName && uses.length > 0 : true);
  const need = step === 0 && noName ? W.needName : W.needOne;
  const [tried, setTried] = useState(false);
  function next() {
    if (!answered(step)) {
      setTried(true);
      if (step === 0 && noName) document.getElementById('w-name')?.focus();
      return;
    }
    setTried(false);
    go(step + 1);
  }
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const flip = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  // finishing: the shutdown box of the sketch is ticked, then the sketch becomes the day (a view transition from the
  // sketch's page to the day's spread), where the tour begins
  const [done, setDone] = useState(false);
  const finish = () => {
    if (done) return;
    if (!answered(step)) { setTried(true); return; }
    const name = person.trim();
    if (name && name !== user.name) api.updateAccount({ name }).then(refresh).catch(() => {});
    setDone(true);
    setTimeout(leave, reducedMotion() ? 250 : 800);
  };
  const leave = () => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    if (!doc.startViewTransition || reducedMotion()) { save(); return; }
    document.documentElement.classList.add('from-setup');
    doc.startViewTransition(() => flushSync(save)).finished.finally(() => document.documentElement.classList.remove('from-setup'));
  };
  // the answers written into the settings
  const settle = (s: Settings): Settings => {
    // metrics of one's own (from Settings, when the setup is run again) are kept
    const metrics = [...[...NUMBERS, ...CHECKS].filter((p) => picked.has(p.id)).map((p) => ({ ...p, name: names[p.id].name, unit: names[p.id].unit })), ...s.metrics.filter((m) => !PRESET_IDS.has(m.id))];
    const focusMetric = metrics.find((m) => m.id === 'deep') ?? metrics.find((m) => m.kind === 'number');
    return {
      // the language is the one the screens are in (the browser's, or one chosen before); Settings can change it
      ...s, lang: getLang(), startHour: start, endHour: end, wholeDay: whole, metrics,
      focus: s.focus ? { ...s.focus, metricId: focusMetric?.id ?? '' } : s.focus,
      profile: { uses, activities: acts, together: s.profile?.together ?? true },
    };
  };
  const save = () => {
    update((s) => ({ ...settle(s), setupDone: true, setupAgain: false }));
    dropDraft();
    // the tour walks through the day, so the setup ends there
    history.pushState(null, '', `/day/${today()}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  // leaving early. Run again from Settings: nothing changes and Settings opens again. The first time: what has been
  // answered so far is kept (the name, and with an answer to the first question the hours and metrics it brought);
  // nothing answered keeps the defaults
  const skip = () => {
    dropDraft();
    if (again) {
      update((s) => ({ ...s, setupDone: true, tourDone: true, setupAgain: false }));
      navigate('/settings', true);
      return;
    }
    const name = person.trim();
    if (name && name !== user.name) api.updateAccount({ name }).then(refresh).catch(() => {});
    update((s) => ({ ...(uses.length ? settle(s) : s), setupDone: true }));
  };

  // the part of the sketch the option under the pointer (or the keyboard) speaks about: `head` (the name), `use:<id>`
  // (its blocks), `hours`, `hours:start|end`, `metric:<id>` (its row); the rest of the sketch is set back meanwhile
  // The pointer and the keyboard are followed apart: a click moves the focus away from the field it was in, which
  // must not take the spot from the option still under the pointer
  const [hovered, setHovered] = useState<string | null>(null);
  const [keyed, setKeyed] = useState<string | null>(null);
  const spot = hovered ?? keyed;
  const spotTimer = useRef(0);
  const hover = (to: string | null) => {
    clearTimeout(spotTimer.current);
    // going from one option to the next passes over the gap between them: the spot waits a moment before it goes
    if (to) setHovered(to); else spotTimer.current = window.setTimeout(() => setHovered(null), 140);
  };
  const spotOf = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-spot]')?.getAttribute('data-spot') ?? null : null);
  useEffect(() => { clearTimeout(spotTimer.current); setHovered(null); setKeyed(null); }, [step]);
  useEffect(() => () => clearTimeout(spotTimer.current), []);
  const steps = PART.length, last = step === steps - 1;
  const chosenMetrics: MetricDef[] = [...NUMBERS, ...CHECKS].filter((p) => picked.has(p.id)).map((p) => ({ ...p, name: names[p.id].name, unit: names[p.id].unit }));
  // Enter moves on from anywhere in the setup: the name field, a ruler's end, a chosen tile (Space still ticks a tile);
  // other buttons and links keep their own Enter
  const onward = useRef(() => {});
  onward.current = () => (last ? finish() : next());
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('a, textarea, select') || (t.closest('button') && !t.closest('.wtile, .hday'))) return;
      e.preventDefault();
      onward.current();
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);
  // a choice as a tile: a box like the paper planner's, the name, a line on what it means
  const tile = (on: boolean, label: string, hint: string, onClick: () => void, key: string, spotAt: string) => (
    <button key={key} type="button" className="wtile" aria-pressed={on} data-spot={spotAt} onClick={() => { onClick(); setTried(false); }}>
      <span className="wtile-box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" pathLength={1} /></svg></span>
      <span className="wtile-name">{label}</span>
      <span className="wtile-hint">{hint}</span>
    </button>
  );
  const metricTile = (p: Preset) => tile(picked.has(p.id), names[p.id].name, W.metricHints[p.id], () => toggle(p.id), p.id, `metric:${p.id}`);
  // greetings use the first name, with a capital even when typed in lower case (the name is saved as typed)
  const word = person.trim().split(/\s+/)[0] ?? '';
  const cap = word && word[0].toLocaleUpperCase(getLang()) + word.slice(1);
  // a very long word would push the greeting off the card: shown cut, saved whole
  const first = [...cap].length > 16 ? `${[...cap].slice(0, 15).join('')}…` : cap;
  const [offer] = useState(() => nameFromEmail(user.email, getLang()));
  const day = whole ? DAYS[5] : DAYS.find((x) => x.start === start && x.end === end);
  const shown = { start: whole ? 0 : start, end: whole ? 24 : end };
  // a metric pointed at but not picked is drawn faintly where it would go
  const ghostId = spot?.startsWith('metric:') ? spot.slice(7) : '';
  const ghostPreset = ghostId && !picked.has(ghostId) ? [...NUMBERS, ...CHECKS].find((p) => p.id === ghostId) : undefined;
  const ghost: MetricDef | undefined = ghostPreset && { ...ghostPreset, name: names[ghostPreset.id].name, unit: names[ghostPreset.id].unit };
  const span = `${clock(shown.start * 60)}–${shown.end === 24 ? '24:00' : clock(shown.end * 60)}`;

  return (
    <div className="welcome">
      <header className="welcome-top">
        <span className="auth-brand"><Mark /><span>Shutdown Complete</span></span>
        <button type="button" className="card-link quiet" onClick={skip}>{again ? W.cancel : W.skip}</button>
      </header>

      <main className="welcome-card" ref={top}>
        <div className="welcome-main">
          {/* one segment per step; any step already seen can be gone to again, one never seen only through Next (none skipped) */}
          <nav className="welcome-progress" aria-label={W.stepN(step + 1, steps)}>
            <ol>
              {W.stepNames.map((label, k) => (
                <li key={k}>
                  <button type="button" className={k < step ? 'done' : k === step ? 'on' : ''} disabled={k === step || k > reached || (k > step && !answered(step))}
                    aria-current={k === step ? 'step' : undefined} aria-label={`${W.stepN(k + 1, steps)} · ${label}`} onClick={() => go(k)}>
                    <i /><span>{label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <section className={`welcome-step ${dir}`} key={step}
            onPointerOver={(e) => hover(spotOf(e.target))} onPointerLeave={() => hover(null)}
            onFocus={(e) => setKeyed(e.target.matches(':focus-visible') ? spotOf(e.target) : null)} onBlur={() => setKeyed(null)}>
            {step === 0 && (
              <>
                {/* the name rises into the greeting once there is one (not on every key) */}
                {again ? <h1>{W.againTitle}</h1>
                  : <h1 className="welcome-hello">{W.helloNoName}{first && <>, <span className="hello-name" key="name">{first}</span></>}</h1>}
                <p className="welcome-body">{again ? W.againBody : W.helloBody}</p>
                <div className="field welcome-name" data-spot="head">
                  <label htmlFor="w-name">{W.nameLabel}</label>
                  <input id="w-name" className="input" autoComplete="given-name" autoFocus required maxLength={80} value={person} placeholder={W.namePh}
                    aria-invalid={tried && noName ? true : undefined} onChange={(e) => { setPerson(e.target.value); setTried(false); }} />
                  {noName && offer && (
                    <button type="button" className="name-offer" onClick={() => { setPerson(offer); setTried(false); document.getElementById('w-name')?.focus(); }}>
                      {W.nameOffer(offer)}
                    </button>
                  )}
                </div>
                <div className="pick-group" role="group" aria-labelledby="w-uses">
                  <span className="label" id="w-uses">{W.useTitle} <span className="muted">{W.pickAny}</span></span>
                  <div className="wtiles uses">{USES.map((u) => tile(uses.includes(u), W.uses[u], W.usesHint[u], () => chooseUses(flip(uses, u)), u, `use:${u}`))}</div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h1>{W.dayTitle}</h1>
                <p className="welcome-body">{W.dayBody}</p>
                <div className="pick-group" role="group" aria-labelledby="w-days">
                  <span className="label" id="w-days">{W.daysLabel}</span>
                  <div className="hdays">
                    {DAYS.map((x) => (
                      <button key={x.id} type="button" className="hday" data-spot="hours" aria-pressed={day?.id === x.id}
                        onClick={() => { setWhole(x.id === 'whole'); if (x.id !== 'whole') { setStart(x.start); setEnd(x.end); } }}>
                        <span className="hday-name">{x.id === 'whole' ? T.wholeDay : W.days[x.id]}</span>
                        <span className="hday-time num">{x.start === 0 && x.end === 24 ? '00–24' : `${clock(x.start * 60).slice(0, 2)}–${clock(x.end * 60).slice(0, 2)}`}</span>
                        <i className="hday-bar" aria-hidden="true"><i style={{ left: `${(x.start / 24) * 100}%`, width: `${((x.end - x.start) / 24) * 100}%` }} /></i>
                      </button>
                    ))}
                  </div>
                </div>
                {/* read like a ticket: the start, the length of the day on the line between, the end; under it the 24 hours */}
                <div className="welcome-hours" data-spot="hours">
                  <div className="wh-ticket" aria-live="polite">
                    <div className="wh-end"><b className="num">{clock(shown.start * 60)}</b><span>{T.startsAt}</span></div>
                    <div className="wh-line"><span className="num">{T.hoursADay(shown.end - shown.start)}</span></div>
                    <div className="wh-end last"><b className="num">{shown.end === 24 ? '24:00' : clock(shown.end * 60)}</b><span>{W.shutdownAt}</span></div>
                  </div>
                  <DaySpan start={shown.start} end={shown.end} fixed={whole} labels={[T.startsAt, W.shutdownAt]}
                    onChange={(a, b) => { setStart(a); setEnd(b); }} />
                  {/* a long day (or the whole day) is allowed, but the method asks for a fixed, reasonable end */}
                  {whole ? <p className="wh-hint long" role="status">{W.wholeHint}</p>
                    : shown.end - shown.start > 12 ? <p className="wh-hint long" role="status">{W.longDay}</p>
                    : <p className="wh-hint">{W.dragHint}</p>}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1>{W.trackTitle}</h1>
                <p className="welcome-body">{W.trackBody}</p>
                <div className="pick-group" role="group" aria-labelledby="w-numbers">
                  <span className="label" id="w-numbers">{W.numbers}</span>
                  <div className="wtiles">{NUMBERS.map(metricTile)}</div>
                </div>
                <div className="pick-group" role="group" aria-labelledby="w-habits">
                  <span className="label" id="w-habits">{W.habits}</span>
                  <div className="wtiles">{CHECKS.map(metricTile)}</div>
                </div>
              </>
            )}
          </section>

          {/* on a phone (no sketch beside): the setup so far in one line, its box ticked at the end */}
          <div className={`welcome-summary${done ? ' done' : ''}`} aria-hidden="true">
            <span className="ws-sq big"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" pathLength={1} /></svg></span>
            <span><b>{first ? W.sketchFor(first) : W.sketchKicker}</b><em className="num">{span} · {T.hoursADay(shown.end - shown.start)} · {W.metricsN(chosenMetrics.length)}</em></span>
          </div>

          <footer className="welcome-foot">
            {step > 0 ? <button type="button" className="btn ghost" onClick={() => go(step - 1)}>{W.back}</button> : <span />}
            <span className="welcome-go">
              {!answered(step) && <span className={`welcome-need${tried ? ' tried' : ''}`} role={tried ? 'alert' : undefined}>{need}</span>}
              <button type="button" className={`btn primary big${done ? ' ready' : ''}`} aria-disabled={!answered(step) || done} onClick={() => (last ? finish() : next())}>
                {done ? <><svg className="ready-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" pathLength={1} /></svg>{W.ready}</>
                  : <>{last ? W.finish : W.next}<span className="enter-key" aria-hidden="true" title={W.enterHint}>↵</span></>}
              </button>
            </span>
          </footer>
        </div>

        <DaySketch done={done} name={first} start={shown.start} end={shown.end} whole={whole} spot={done ? null : spot} ghost={ghost}
          metrics={chosenMetrics} blocks={sketchBlocks(uses, W.sketchBlocks)} />
      </main>
    </div>
  );
}

/** The hours as a span of the 24: the two ends are sliders (drag them, or the arrow keys); fixed for the whole day. */
function DaySpan({ start, end, fixed, labels, onChange }: { start: number; end: number; fixed: boolean; labels: [string, string]; onChange: (a: number, b: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<0 | 1 | null>(null);
  // ends closer than a knob's width move apart, each to its own side of the line
  const [w, setW] = useState(480);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const close = ((end - start) / 24) * w < 26;
  const set = (which: 0 | 1, h: number) => {
    if (which === 0) onChange(Math.max(0, Math.min(h, end - 1)), end);
    else onChange(start, Math.min(24, Math.max(h, start + 1)));
  };
  const hourAt = (x: number) => { const r = bar.current!.getBoundingClientRect(); return Math.round(((x - r.left) / r.width) * 24); };
  const down = (e: React.PointerEvent) => {
    if (fixed) return;
    // the nearer end follows the pointer, so a press anywhere on the bar moves something
    const h = hourAt(e.clientX);
    const which: 0 | 1 = Math.abs(h - start) <= Math.abs(h - end) && !(h > end) ? 0 : 1;
    setHeld(which); set(which, h);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (document.querySelector(`.day-span [data-end="${which}"]`) as HTMLElement | null)?.focus();
  };
  const move = (e: React.PointerEvent) => { if (held != null) set(held, hourAt(e.clientX)); };
  const key = (which: 0 | 1) => (e: React.KeyboardEvent) => {
    const v = which === 0 ? start : end;
    const by = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'PageDown' ? -3 : e.key === 'PageUp' ? 3 : 0;
    if (e.key === 'Home') { e.preventDefault(); set(which, 0); return; }
    if (e.key === 'End') { e.preventDefault(); set(which, 24); return; }
    if (!by) return;
    e.preventDefault(); e.stopPropagation(); set(which, v + by);
  };
  return (
    <div className={`day-span${fixed ? ' fixed' : ''}${held != null ? ' held' : ''}`} ref={bar}
      onPointerDown={down} onPointerMove={move} onPointerUp={() => setHeld(null)} onPointerCancel={() => setHeld(null)}>
      {/* a ruler: the line of the day with the planned part in ink, a notch per hour (longer every six) */}
      {/* the night, faintly */}
      <i className="ds-night" style={{ left: 0, width: `${(6 / 24) * 100}%` }} />
      <i className="ds-night" style={{ left: `${(22 / 24) * 100}%`, width: `${(2 / 24) * 100}%` }} />
      <i className="ds-track" />
      <i className="ds-range" style={{ left: `${(start / 24) * 100}%`, width: `${((end - start) / 24) * 100}%` }} />
      {Array.from({ length: 25 }, (_, h) => (
        <i key={h} className={`ds-tick${h % 6 === 0 ? ' major' : ''}${h >= start && h <= end ? ' in' : ''}`} style={{ left: `${(h / 24) * 100}%` }} />
      ))}
      {!fixed && ([start, end] as number[]).map((h, k) => (
        <b key={k} data-end={k} className={close ? (k ? 'r' : 'l') : undefined} data-spot={k ? 'hours:end' : 'hours:start'} role="slider" tabIndex={0} aria-label={labels[k]} aria-valuemin={k ? start + 1 : 0} aria-valuemax={k ? 24 : end - 1}
          aria-valuenow={h} aria-valuetext={h === 24 ? '24:00' : clock(h * 60)} style={{ left: `${(h / 24) * 100}%` }} onKeyDown={key(k as 0 | 1)} />
      ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <span key={h} className={`num${h >= start && h <= end ? ' in' : ''}`} style={{ left: `${(h / 24) * 100}%` }}>{h === 24 ? '24' : clock(h * 60).slice(0, 2)}</span>
      ))}
    </div>
  );
}

/** The blocks of the sketch: the first of each answer, then the seconds (four at most); none before an answer. */
function sketchBlocks(uses: string[], words: Record<string, string>): { label: string; kind: string }[] {
  if (!uses.length) return [];
  const lists = USES.filter((u) => uses.includes(u)).map((u) => BLOCKS_FOR[u]);
  const out: SketchBlock[] = [];
  for (let k = 0; k < 2; k++) for (const l of lists) if (l[k]) out.push(l[k]);
  return out.slice(0, 4).map(([key, kind]) => ({ label: words[key], kind }));
}

/**
 * The day the answers make, drawn as a small copy of the Day screen: today's date and whose day it is, then its
 * spread: on the left the daily metrics as the Day lists them (ending in the shutdown box, ticked when the setup is
 * finished), the tasks and the notes as they look empty; on the right the time blocks, a few blocks in the planner's
 * own kinds spread over the day and the current time in the hue. Decorative: the form says it all.
 */
function DaySketch({ done, name, start, end, whole, metrics, blocks: wanted, spot, ghost }: {
  done: boolean; name: string; start: number; end: number; whole: boolean; metrics: MetricDef[]; blocks: { label: string; kind: string }[];
  spot: string | null; ghost?: MetricDef;
}) {
  const T = useT(), W = T.welcome;
  // the part the option pointed at speaks about stays as it is; the rest of the sketch fades back
  const [aimed, arg = ''] = spot ? spot.split(':') : [''];
  const dim = (kept: boolean) => (spot && !kept ? ' dim' : '');
  // the hour column fills the height the card gives it
  const grid = useRef<HTMLDivElement>(null);
  const [H, setH] = useState(360);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(Math.max(200, el.clientHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the hours sit inside an 8px inset so the first and last labels, centred on their lines, are not cut
  const PAD = 8, hours = end - start, ph = (H - 2 * PAD) / hours;
  const every = [1, 2, 3, 4, 6].find((e) => ph * e >= 26) ?? 6;
  const y = (h: number) => PAD + (h - start) * ph;
  // a label every `every` hours from the start, and the end's; one that would crowd the end's is left out
  const labelled = (k: number) => k === hours || (k % every === 0 && hours - k >= every);
  // the blocks share the day out evenly (a whole day: its waking part), each up to an hour and a half, on quarter hours
  const q = (h: number) => Math.round(h * 4) / 4;
  const from = whole ? 8 : start, to = whole ? 22 : end, span = to - from;
  const n = Math.max(1, Math.min(wanted.length, Math.floor(span / 1.5)));
  const slot = span / n, len = q(Math.min(1.5, Math.max(0.5, slot - 0.5)));
  // the blocks already drawn keep their order (so none crosses another on its way) and new ones come after them; when
  // the sketch is full an answer swaps a block for another in its very place, as the paper's revision would
  const slots = useRef<string[]>([]);
  let want = wanted.slice(0, n);
  const fresh = want.filter((b) => !slots.current.includes(b.label));
  const at = (l: string) => want.find((b) => b.label === l);
  want = want.length === slots.current.length
    ? slots.current.map((l) => at(l) ?? fresh.shift()!)
    : [...slots.current.flatMap((l) => at(l) ?? []), ...fresh];
  slots.current = want.map((b) => b.label);
  const blocks = want.map((b, k) => ({ ...b, at: q(from + k * slot + (slot - len) / 2), len }));
  // a block that goes is first struck through where it stood, everything else still; then the new day is drawn: the
  // blocks that stay glide to their places and a new one is written in
  type Placed = (typeof blocks)[number];
  const seen = useRef<Placed[]>([]), timer = useRef(0);
  const [held, setHeld] = useState<{ old: Placed[]; out: string[] } | null>(null);
  const [late, setLate] = useState<string[]>([]);
  const names = blocks.map((b) => b.label).join('|');
  useLayoutEffect(() => {
    const now = new Set(blocks.map((b) => b.label)), was = new Set(seen.current.map((b) => b.label));
    const out = seen.current.filter((b) => !now.has(b.label)).map((b) => b.label);
    const came = blocks.filter((b) => !was.has(b.label)).map((b) => b.label);
    const old = seen.current;
    seen.current = blocks;
    clearTimeout(timer.current);
    // a block written in keeps that class while it stays: taking it off would play the usual rise once more
    setLate((l) => l.filter((x) => now.has(x)));
    if (!out.length || reducedMotion()) { setHeld(null); return; }
    setHeld({ old, out });
    setLate((l) => [...l.filter((x) => now.has(x)), ...came]);
    timer.current = window.setTimeout(() => setHeld(null), 400);
  }, [names]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);
  const shown = metrics.slice(0, 4);
  const tick = <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" pathLength={1} /></svg>;
  // a use's blocks (those drawn); none drawn: the whole time blocks page
  const useBlocks = aimed === 'use' ? (BLOCKS_FOR[arg] ?? []).map(([k]) => W.sketchBlocks[k]).filter((l) => blocks.some((b) => b.label === l)) : [];
  const moreKept = aimed === 'metric' && metrics.slice(shown.length).some((m) => m.id === arg);
  // the hours: all of them, or only the end a ruler's knob moves
  const lineKept = (k: number) => aimed !== 'hours' || !arg || (arg === 'start' ? k === 0 : k === hours);
  const blocksPage = aimed === 'use' || aimed === 'hours';
  return (
    <aside className="welcome-sketch" aria-hidden="true">
      <header className={`ws-head${dim(aimed === 'head')}`}>
        <b>{T.todayTitle(longDate(today()))}</b>
        <span>{name ? W.sketchFor(name) : W.sketchKicker}</span>
      </header>
      {/* the Day's spread: the left page (metrics, tasks, notes) beside the right one (the time blocks) */}
      <div className="ws-spread">
        <div className="ws-left">
          <section className={`ws-panel ws-metrics${dim(aimed === 'metric')}`}>
            <span className="ws-label">{T.dailyMetrics}</span>
            {shown.length === 0 && !ghost && <span className="ws-none">{W.sketchNoMetrics}</span>}
            {shown.map((m) => (
              <div key={m.id} className={`ws-row${aimed === 'metric' ? dim(m.id === arg) : ''}`}>
                <span className="ws-name">{m.name}</span>
                {m.kind === 'number' ? <span className="ws-val num"><i>—</i>{m.unit}</span> : <i className="ws-box" />}
              </div>
            ))}
            {ghost && (
              <div key={`ghost-${ghost.id}`} className="ws-row ghost">
                <span className="ws-name">{ghost.name}</span>
                {ghost.kind === 'number' ? <span className="ws-val num"><i>—</i>{ghost.unit}</span> : <i className="ws-box" />}
              </div>
            )}
            {metrics.length > shown.length && <span className={`ws-none num${aimed === 'metric' ? dim(moreKept) : ''}`}>{W.sketchMore(metrics.length - shown.length)}</span>}
            <div className={`ws-row ws-shut${done ? ' done' : ''}${aimed === 'metric' ? dim(false) : ''}`}>
              <span className="ws-name">{T.shutdownComplete}</span>
              <span className="ws-box">{tick}</span>
            </div>
          </section>
          <section className={`ws-panel ws-tasks${dim(false)}`}>
            <span className="ws-label">{T.tasks}</span>
            <span className="ws-ph"><b>+</b>{T.captureTask}</span>
          </section>
          {/* the notes, ruled like the paper's notes column, its empty line on the first rule */}
          <section className={`ws-panel ws-notes${dim(false)}`}>
            <span className="ws-label">{T.notes}</span>
            <div className="ws-ruled"><span className="ws-ph">{T.notesPh}</span></div>
          </section>
        </div>
        <section className={`ws-panel ws-blocks${dim(blocksPage)}`}>
          <span className="ws-label">{T.timeBlocks}</span>
          <div className="ws-grid" ref={grid}>
            {/* a line per hour with its label on it (the end's too), dotted half hours between when there is room */}
            {Array.from({ length: hours + 1 }, (_, k) => (
              <div key={start + k} className={`ws-line${k === 0 || k === hours ? ' edge' : ''}${blocksPage ? dim(lineKept(k)) : ''}`} style={{ top: y(start + k) }}>
                {labelled(k) && <span className="num">{start + k === 24 ? '24:00' : clock((start + k) * 60)}</span>}
              </div>
            ))}
            {ph >= 26 && Array.from({ length: hours }, (_, k) => <i key={`h${start + k}`} className="ws-half" style={{ top: y(start + k + 0.5) }} />)}
            {/* keyed by name: a block stays put (and glides to its new place) when others come or go; only a new one rises */}
            {(held ? held.old : blocks).map((b) => {
              const h = b.len * ph - 3;
              const how = held?.out.includes(b.label) ? ' gone' : late.includes(b.label) ? ' late' : '';
              return (
                <div key={b.label} className={`ws-block k-${b.kind}${h < 34 ? ' short' : ''}${how}${aimed === 'hours' || (aimed === 'use' && useBlocks.length) ? dim(useBlocks.includes(b.label)) : ''}`} style={{ top: y(b.at) + 1, height: h }}>
                  <span>{b.label}</span>
                  <em className="num">{clock(b.at * 60)}–{clock((b.at + b.len) * 60)}</em>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}
