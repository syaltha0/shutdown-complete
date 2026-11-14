import { useEffect, useId, useRef, useState } from 'react';
import { useSettings } from '../App';
import { chime, settingsFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';
import { duration } from '../lib/dates';

// Ranges paint their filled part from --fill (the thumb hides the seam).
export const fill = (v: number, min: number, max: number) => ({ '--fill': `${((v - min) / (max - min)) * 100}%` }) as React.CSSProperties;

/**
 * A slider that glides: while it is dragged the thumb moves freely and only this row redraws; the value is snapped to
 * its step and saved once, when the thumb is let go (saving and redrawing every settings row on each step made the
 * drag stutter). Arrow keys move one step, Page Up/Down five, Home/End to the ends.
 */
function Slider({ id, label, min, max, step, value, format, onCommit, describedBy, discrete }: {
  id: string; label: string; min: number; max: number; step: number; value: number;
  format: (v: number) => string; onCommit: (v: number) => void; describedBy?: string;
  /** a short range of a few choices moves in visible steps instead of gliding */ discrete?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const snap = (v: number) => Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(4))));
  const shown = draft ?? value;
  const commit = useRef<(v: number) => void>(() => {});
  commit.current = (v: number) => { const s = snap(v); setDraft(null); if (s !== value) onCommit(s); };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const done = () => commit.current(Number(el.value)); // the native change event fires once, on release
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const by = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * 5, PageDown: -step * 5 }[e.key];
    const to = e.key === 'Home' ? min : e.key === 'End' ? max : by != null ? snap(shown) + by : null;
    if (to == null) return;
    e.preventDefault(); commit.current(to);
  };
  return <div className="field">
    <label htmlFor={id}>{label}<output className="num">{format(snap(shown))}</output></label>
    <div className="focus-range" style={fill(shown, min, max)}>
      <input ref={ref} id={id} aria-label={label} aria-describedby={describedBy} aria-valuetext={format(snap(shown))} type="range" min={min} max={max} step={discrete ? step : 'any'} value={shown}
        onChange={(e) => setDraft(Number(e.target.value))} onKeyDown={key} />
    </div>
  </div>;
}

export function FocusConfig() {
  const T = useT();
  const { settings, update } = useSettings();
  const f = settingsFocus(settings);
  const id = useId();
  const { active } = useFocusDay();
  const toggle = (key: 'autoBreak' | 'autoFocus' | 'fullscreenBreak' | 'strict' | 'scheduled' | 'voice' | 'sound') => <label className="focus-switch-row" key={key}>
    <span>{T.focusOptions[key]}{key in T.focusGroups && <small>{T.focusGroups[key as 'autoBreak' | 'autoFocus' | 'fullscreenBreak' | 'strict']}</small>}</span>
    <input type="checkbox" role="switch" checked={key === 'autoBreak' ? f[key] !== false : !!f[key]} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), [key]: e.target.checked}}))} />
  </label>;
  // the sections, as tabs that stay at the top while the settings scroll; the one in view is marked
  const sections = [['durations', T.focusGroups.durations], ['flow', T.focusGroups.flow], ['audio', T.focusGroups.audio], ['breaks', T.focusGroups.breaks]] as const;
  const [current, setCurrent] = useState<string>('durations');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = root.current?.closest<HTMLElement>('.focus-settings-view');
    if (!view) return;
    const spy = () => {
      const nav = root.current?.querySelector<HTMLElement>('.fc-nav');
      const line = view.getBoundingClientRect().top + (nav?.offsetHeight ?? 0) + view.clientHeight / 3;
      let on = 'durations';
      for (const [key] of sections) { const el = document.getElementById(`${id}-${key}`); if (el && el.getBoundingClientRect().top <= line) on = key; }
      // at the very end the last section counts as in view even when it is short
      if (view.scrollTop + view.clientHeight >= view.scrollHeight - 2) on = sections.at(-1)![0];
      setCurrent(on);
    };
    view.addEventListener('scroll', spy, { passive: true });
    return () => view.removeEventListener('scroll', spy);
  }, [id]);
  const go = (key: string) => {
    const view = root.current?.closest<HTMLElement>('.focus-settings-view'), el = document.getElementById(`${id}-${key}`), nav = root.current?.querySelector<HTMLElement>('.fc-nav');
    if (!view || !el) return;
    view.scrollTo({ top: el.offsetTop - (nav?.offsetHeight ?? 0) - 16, behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth' });
    setCurrent(key);
  };
  // one cycle of rounds, drawn to scale: focus, short breaks between, the long break at the end
  const cycle = Array.from({ length: f.longEvery }, (_, i) => [['focus', f.focusMin], [i === f.longEvery - 1 ? 'long' : 'short', i === f.longEvery - 1 ? f.longMin : f.shortMin]] as const).flat();
  const cycleMin = cycle.reduce((n, [, m]) => n + m, 0);
  return <div className="focus-config" ref={root}>
    <nav className="fc-nav" aria-label={T.focusSettings}>{sections.map(([key, label]) => <button key={key} type="button" className={current === key ? 'on' : undefined} aria-current={current === key ? 'true' : undefined} onClick={() => go(key)}>{label}</button>)}</nav>
    {active && <p id={`${id}-hint`} className="muted focus-config-hint">{T.focusSettingsHint}</p>}
    <section id={`${id}-durations`}><h3>{T.focusGroups.durations}</h3>
    <div className="fc-cycle">
      <div className="fc-cycle-bar" aria-hidden="true">{cycle.map(([phase, m], i) => <i key={i} className={`phase-${phase}`} style={{ flexGrow: m }} />)}</div>
      <p className="muted">{T.focusCycle(f.longEvery, duration(cycleMin))}</p>
    </div>
    {([
    ['focusMin', T.focusLen, 5, 120], ['shortMin', T.shortLen, 1, 30],
    ['longMin', T.longLen, 5, 60], ['longEvery', T.longEveryLabel, 2, 8],
  ] as const).map(([key, label, min, max]) => <Slider key={key} id={`${id}-${key}`} label={label} min={min} max={max} step={1} value={f[key]} discrete={key === 'longEvery'}
    describedBy={active ? `${id}-hint` : undefined} format={(v) => `${v} ${key === 'longEvery' ? T.sessionsWord : T.minutesUnit}`}
    onCommit={(value) => update((s) => ({ ...s, focus: { ...settingsFocus(s), [key]: value } }))} />)}
    </section><section id={`${id}-flow`}><h3>{T.focusGroups.flow}</h3>{(['autoBreak', 'autoFocus', 'fullscreenBreak', 'strict'] as const).map(toggle)}</section>
    <section id={`${id}-audio`}><h3>{T.focusGroups.audio}</h3>{toggle('sound')}
    <div className="focus-bell-row"><label htmlFor={`${id}-bell`}>{T.focusOptions.bell}</label><span className="focus-bell-pick"><select id={`${id}-bell`} className="input" value={f.bell ?? 'classic'} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), bell: e.target.value}}))}>{(['classic','soft','single'] as const).map(x => <option key={x} value={x}>{T.focusOptions[x]}</option>)}</select><button type="button" className="btn" onClick={() => chime({...f, sound: true})}>{T.focusGroups.preview}</button></span></div>
    <Slider id={`${id}-volume`} label={T.volume} min={0} max={1} step={0.05} value={f.volume ?? 1} format={(v) => `${Math.round(v * 100)}%`}
      onCommit={(value) => update(s => ({...s, focus: {...settingsFocus(s), volume: value}}))} />
    {toggle('voice')}</section><section id={`${id}-breaks`}><h3>{T.focusGroups.breaks}</h3>{toggle('scheduled')}
    {f.scheduled && <div className="focus-special">{!f.breaks?.length && <p className="muted">{T.focusGroups.empty}</p>}{(f.breaks ?? []).map(b => <div className="field" key={b.id}>
      <input className="input" aria-label={T.focusOptions.breakName} maxLength={60} value={b.label} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, label: e.target.value} : x)}}))} />
      <input className="input" aria-label={T.focusOptions.breakTime} type="time" value={b.time} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, time: e.target.value} : x)}}))} />
      <input className="input" aria-label={T.minutesUnit} type="number" min={1} max={240} value={b.minutes} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, minutes: Math.max(1, Math.min(240, Number(e.target.value) || 1))} : x)}}))} />
      <button className="btn" onClick={() => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).filter(x => x.id !== b.id)}}))}>{T.focusOptions.removeBreak}</button>
    </div>)}<button className="btn" disabled={(f.breaks?.length ?? 0) >= 5} onClick={() => update(s => ({...s, focus: {...settingsFocus(s), breaks: [...(s.focus?.breaks ?? []), {id: crypto.randomUUID(), time: '12:30', minutes: 30, label: ''}].slice(0,5)}}))}>{T.focusOptions.addBreak}</button></div>}
  </section></div>;
}
