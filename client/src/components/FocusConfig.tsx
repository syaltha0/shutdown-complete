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
    {(['autoBreak', 'autoFocus', 'fullscreenBreak'] as const).map(key => <label key={key}><input type="checkbox" checked={key === 'autoBreak' ? f[key] !== false : !!f[key]} onChange={e => update(s => ({...s, focus: {...settingsFocus(s), [key]: e.target.checked}}))} />{T.focusOptions[key]}</label>)}
  </div>;
}
