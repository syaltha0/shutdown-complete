import { useId } from 'react';
import { useSettings } from '../App';
import { chime, settingsFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';

// Ranges paint their filled part from --fill (the thumb hides the seam).
const fill = (v: number, min: number, max: number) => ({ '--fill': `${((v - min) / (max - min)) * 100}%` }) as React.CSSProperties;

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
  return <div className="focus-config">
    {active && <p id={`${id}-hint`} className="muted focus-config-hint">{T.focusSettingsHint}</p>}
    <section><h3>{T.focusGroups.durations}</h3>
    {([
    ['focusMin', T.focusLen, 5, 120], ['shortMin', T.shortLen, 1, 30],
    ['longMin', T.longLen, 5, 60], ['longEvery', T.longEveryLabel, 2, 8],
  ] as const).map(([key, label, min, max]) => <div className="field" key={key}>
    <label htmlFor={`${id}-${key}`}>{label}<output className="num">{f[key]} {key === 'longEvery' ? T.sessionsWord : T.minutesUnit}</output></label>
    <input id={`${id}-${key}`} aria-describedby={active ? `${id}-hint` : undefined} type="range" min={min} max={max} step={1} value={f[key]} style={fill(f[key], min, max)} onChange={(e) => { const value = Number(e.target.value); update((s) => ({ ...s, focus: { ...settingsFocus(s), [key]: value } })); }} />
  </div>)}
    </section><section><h3>{T.focusGroups.flow}</h3>{(['autoBreak', 'autoFocus', 'fullscreenBreak', 'strict'] as const).map(toggle)}</section>
    <section><h3>{T.focusGroups.audio}</h3>{toggle('sound')}
    <label>{T.focusOptions.bell}<span className="focus-bell-pick"><select className="input" value={f.bell ?? 'classic'} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), bell: e.target.value}}))}>{(['classic','soft','single'] as const).map(x => <option key={x} value={x}>{T.focusOptions[x]}</option>)}</select><button type="button" className="btn" onClick={() => chime({...f, sound: true})}>{T.focusGroups.preview}</button></span></label>
    <div className="field"><label htmlFor={`${id}-volume`}>{T.volume}<output className="num">{Math.round((f.volume ?? 1) * 100)}%</output></label>
    <input id={`${id}-volume`} aria-label={T.volume} type="range" min={0} max={1} step={0.05} value={f.volume ?? 1} style={fill(f.volume ?? 1, 0, 1)} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), volume: Number(e.target.value)}}))} /></div>
    {toggle('voice')}</section><section><h3>{T.focusGroups.breaks}</h3>{toggle('scheduled')}
    {f.scheduled && <div className="focus-special">{!f.breaks?.length && <p className="muted">{T.focusGroups.empty}</p>}{(f.breaks ?? []).map(b => <div className="field" key={b.id}>
      <input className="input" aria-label={T.focusOptions.breakName} maxLength={60} value={b.label} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, label: e.target.value} : x)}}))} />
      <input className="input" aria-label={T.focusOptions.breakTime} type="time" value={b.time} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, time: e.target.value} : x)}}))} />
      <input className="input" aria-label={T.minutesUnit} type="number" min={1} max={240} value={b.minutes} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, minutes: Math.max(1, Math.min(240, Number(e.target.value) || 1))} : x)}}))} />
      <button className="btn" onClick={() => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).filter(x => x.id !== b.id)}}))}>{T.focusOptions.removeBreak}</button>
    </div>)}<button className="btn" disabled={(f.breaks?.length ?? 0) >= 5} onClick={() => update(s => ({...s, focus: {...settingsFocus(s), breaks: [...(s.focus?.breaks ?? []), {id: crypto.randomUUID(), time: '12:30', minutes: 30, label: ''}].slice(0,5)}}))}>{T.focusOptions.addBreak}</button></div>}
  </section></div>;
}
