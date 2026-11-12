import { useId } from 'react';
import { useSettings } from '../App';
import { settingsFocus } from '../lib/focus';
import { useT } from '../lib/i18n';

export function FocusConfig() {
  const T = useT();
  const { settings, update } = useSettings();
  const f = settingsFocus(settings);
  const id = useId();
  return <div className="focus-config">{([
    ['focusMin', T.focusLen, 5, 120], ['shortMin', T.shortLen, 1, 30],
    ['longMin', T.longLen, 5, 60], ['longEvery', T.longEveryLabel, 2, 8],
  ] as const).map(([key, label, min, max]) => <div className="field" key={key}>
    <label htmlFor={`${id}-${key}`}>{label}<output className="num">{f[key]} {key === 'longEvery' ? T.sessionsWord : T.minutesUnit}</output></label>
    <input id={`${id}-${key}`} type="range" min={min} max={max} step={1} value={f[key]} onChange={(e) => { const value = Number(e.target.value); update((s) => ({ ...s, focus: { ...settingsFocus(s), [key]: value } })); }} />
  </div>)}</div>;
}
