import { useId } from 'react';
import { useSettings } from '../App';
import { settingsFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';

export function FocusConfig() {
  const T = useT();
  const { settings, update } = useSettings();
  const f = settingsFocus(settings);
  const id = useId();
  const { active } = useFocusDay();
  return <div className="focus-config">
    {active && <p id={`${id}-hint`} className="muted focus-config-hint">{T.focusSettingsHint}</p>}
    {([
    ['focusMin', T.focusLen, 5, 120], ['shortMin', T.shortLen, 1, 30],
    ['longMin', T.longLen, 5, 60], ['longEvery', T.longEveryLabel, 2, 8],
  ] as const).map(([key, label, min, max]) => <div className="field" key={key}>
    <label htmlFor={`${id}-${key}`}>{label}<output className="num">{f[key]} {key === 'longEvery' ? T.sessionsWord : T.minutesUnit}</output></label>
    <input id={`${id}-${key}`} aria-describedby={active ? `${id}-hint` : undefined} type="range" min={min} max={max} step={1} value={f[key]} onChange={(e) => { const value = Number(e.target.value); update((s) => ({ ...s, focus: { ...settingsFocus(s), [key]: value } })); }} />
  </div>)}
    {(['autoBreak', 'autoFocus', 'fullscreenBreak', 'strict', 'scheduled'] as const).map(key => <label key={key}><input type="checkbox" checked={key === 'autoBreak' ? f[key] !== false : !!f[key]} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), [key]: e.target.checked}}))} />{T.focusOptions[key]}</label>)}
    {f.scheduled && <div className="focus-special">{(f.breaks ?? []).map(b => <div className="field" key={b.id}>
      <input className="input" aria-label={T.focusOptions.breakName} maxLength={60} value={b.label} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, label: e.target.value} : x)}}))} />
      <input className="input" aria-label={T.focusOptions.breakTime} type="time" value={b.time} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, time: e.target.value} : x)}}))} />
      <input className="input" aria-label={T.minutesUnit} type="number" min={1} max={240} value={b.minutes} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).map(x => x.id === b.id ? {...x, minutes: Math.max(1, Math.min(240, Number(e.target.value) || 1))} : x)}}))} />
      <button className="btn" onClick={() => update(s => ({...s, focus: {...settingsFocus(s), breaks: (s.focus?.breaks ?? []).filter(x => x.id !== b.id)}}))}>{T.focusOptions.removeBreak}</button>
    </div>)}<button className="btn" disabled={(f.breaks?.length ?? 0) >= 5} onClick={() => update(s => ({...s, focus: {...settingsFocus(s), breaks: [...(s.focus?.breaks ?? []), {id: crypto.randomUUID(), time: '12:30', minutes: 30, label: ''}].slice(0,5)}}))}>{T.focusOptions.addBreak}</button></div>}
  </div>;
}
