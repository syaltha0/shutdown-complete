import { FocusConfig } from '../components/FocusConfig';
import { ExportDownloads } from './Publication';
import { useRef, useState } from 'react';
import { useSettings } from '../App';
import { PushSetting } from '../components/PushSetting';
import { NotificationSettings } from '../components/NotificationSettings';
import { IconCalendar, IconPlus, IconX } from '../components/Icons';
import { api, ApiError } from '../lib/api';
import { refreshCalendars, useCalendar, viewerZone } from '../lib/calendar';
import { clock, today } from '../lib/dates';
import { navigate, onLinkClick, usePath } from '../lib/router';
import { useAccount } from '../App';
import { useA } from '../lib/i18n-auth';
import { AccountSettings, ServerSettings } from './AccountSettings';
import { settingsFocus } from '../lib/focus';
import { getLang, setLang, useT, type Lang } from '../lib/i18n';
import { getMotionPref, getThemePref, setMotionPref, setThemePref, type MotionPref, type ThemePref } from '../lib/theme';
import { isIOS, useInstall } from '../lib/pwa';
import { translateDefaults, uid, type DayTemplate, type FocusSettings, type MetricDef, type Repeat, FEATURES, featureOn } from '../lib/model';
import { DayChips } from './Templates';
import { ScheduleImport } from './ScheduleImport';
import { Segmented } from '../components/Segmented';
import { insertAt, offerUndo } from '../lib/undo';

export function SettingsScreen() {
  const T = useT();
  const { settings, update } = useSettings();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [motion, setMotion] = useState<MotionPref>(getMotionPref());
  const inst = useInstall();
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const file = useRef<HTMLInputElement>(null);
  const hours = Array.from({ length: 25 }, (_, h) => h);
  const focus = settingsFocus(settings);
  const numberMetrics = settings.metrics.filter((m) => m.kind === 'number');

  const setMetric = (id: string, patch: Partial<MetricDef>) =>
    update((s) => ({ ...s, metrics: s.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const setFocus = (patch: Partial<FocusSettings>) => update((s) => ({ ...s, focus: { ...settingsFocus(s), ...patch } }));

  function switchLang(to: Lang) {
    const from = getLang();
    if (from === to) return;
    setLang(to);
    update((s) => translateDefaults(s, from, to));
  }

  async function doImport(f: File) {
    setImported(null);
    try {
      const data = JSON.parse(await f.text());
      const res = await api.import(data);
      setImported(T.imported(res.count));
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      setImported(T.importFailed(e instanceof Error ? e.message : '?'));
    }
  }



  const A = useA();
  const { user, source } = useAccount();
  const path = usePath();
  const tab = path === '/settings/account' ? 'account' : path === '/settings/server' && user.isAdmin ? 'server' : 'planner';
  const tabs = [
    { id: 'planner', href: '/settings', label: A.tabPlanner },
    { id: 'account', href: '/settings/account', label: A.tabAccount },
    ...(user.isAdmin ? [{ id: 'server', href: '/settings/server', label: A.tabServer }] : []),
  ];

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.settingsTitle}</h1>
          <p className="sub">{tab === 'planner' ? T.savesAsYouGo : `${user.name} · ${user.email}`}</p>
        </div>
      </div>
      {user.isAdmin && <p><a href="/settings/status" onClick={onLinkClick}>{T.serverStatus.title}</a></p>}
      <nav className="tabs" aria-label={T.settingsTitle}>
        {tabs.map((x) => <a key={x.id} href={x.href} onClick={onLinkClick} aria-current={tab === x.id ? 'page' : undefined} aria-selected={tab === x.id}>{x.label}</a>)}
      </nav>

      {tab === 'account' ? <AccountSettings /> : tab === 'server' ? <ServerSettings /> : (
      <div className="settings">
        <section className="set-row" aria-labelledby="s-lang">
          <div className="about">
            <h2 id="s-lang">{T.language}</h2>
            <p>{T.languageAbout}</p>
          </div>
          <div className="set-panel">
            <Segmented role="group" aria-labelledby="s-lang">
              <button type="button" lang="en" aria-pressed={getLang() === 'en'} onClick={() => switchLang('en')}>English</button>
              <button type="button" lang="tr" aria-pressed={getLang() === 'tr'} onClick={() => switchLang('tr')}>Türkçe</button>
            </Segmented>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-features">
          <div className="about">
            <h2 id="s-features">{T.featuresTitle}</h2>
            <p>{T.featuresAbout}</p>
          </div>
          <div className="set-panel features">
            {FEATURES.map((f) => (
              <label key={f} className="switch-row feature-row">
                <input type="checkbox" className="switch" checked={featureOn(settings, f)}
                  onChange={(e) => update((s) => ({ ...s, features: { ...s.features, [f]: e.target.checked } }))} />
                <span><b>{T.featureNames[f][0]}</b><small className="muted">{T.featureNames[f][1]}</small></span>
              </label>
            ))}
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-theme">
          <div className="about">
            <h2 id="s-theme">{T.appearance}</h2>
            <p>{T.appearanceAbout}</p>
          </div>
          <div className="set-panel">
            <div className="field">
              <span className="label" id="s-colour">{T.themeLabel}</span>
              <Segmented role="group" aria-labelledby="s-colour">
                {(['light', 'dark', 'system'] as ThemePref[]).map((p) => (
                  <button key={p} type="button" aria-pressed={theme === p} onClick={() => { setThemePref(p); setTheme(p); }}>
                    {p === 'light' ? T.themeLight : p === 'dark' ? T.themeDark : T.themeSystem}
                  </button>
                ))}
              </Segmented>
            </div>
            <div className="field">
              <span className="label" id="s-motion">{T.motionLabel}</span>
              <Segmented role="group" aria-labelledby="s-motion">
                {(['system', 'full', 'reduce'] as MotionPref[]).map((p) => (
                  <button key={p} type="button" aria-pressed={motion === p} onClick={() => { setMotionPref(p); setMotion(p); }}>
                    {p === 'full' ? T.motionFull : p === 'reduce' ? T.motionReduce : T.themeSystem}
                  </button>
                ))}
              </Segmented>
              <p className="hint">{T.motionAbout}</p>
            </div>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-install">
          <div className="about">
            <h2 id="s-install">{T.installTitle}</h2>
            <p>{T.installAbout}</p>
          </div>
          <div className="set-panel">
            {inst.installed ? <p>{T.installedNote}</p>
              : inst.canPrompt ? <div><button type="button" className="btn primary" onClick={() => inst.install()}>{T.installBtn}</button></div>
              : <p className="muted">{isIOS() ? T.iosHint : T.otherHint}</p>}
            {'Notification' in window && (
              perm === 'granted' ? <p className="muted">{T.notifyOn}</p>
                : perm === 'denied' ? <p className="muted">{T.notifyBlocked}</p>
                : <div><button type="button" className="btn" onClick={() => Notification.requestPermission().then(setPerm)}>{T.notifyBtn}</button></div>
            )}
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-hours">
          <div className="about">
            <h2 id="s-hours">{T.workday}</h2>
            <p>{T.workdayAbout}</p>
          </div>
          <div className="set-panel">
            <Segmented role="group" aria-labelledby="s-hours">
              <button type="button" aria-pressed={!settings.wholeDay} onClick={() => update((s) => ({ ...s, wholeDay: false }))}>{T.setHours}</button>
              <button type="button" aria-pressed={!!settings.wholeDay} onClick={() => update((s) => ({ ...s, wholeDay: true }))}>{T.wholeDay}</button>
            </Segmented>
            {settings.wholeDay ? <p className="muted">{T.wholeDayAbout}</p> : (
            <div className="hours-row">
              <div className="field">
                <label htmlFor="s-start">{T.startsAt}</label>
                <select id="s-start" className="input num" value={settings.startHour}
                  onChange={(e) => update((s) => ({ ...s, startHour: Number(e.target.value), endHour: Math.max(s.endHour, Number(e.target.value) + 1) }))}>
                  {hours.slice(0, 24).map((h) => <option key={h} value={h}>{clock(h * 60)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="s-end">{T.endsAt}</label>
                <select id="s-end" className="input num" value={settings.endHour} onChange={(e) => update((s) => ({ ...s, endHour: Number(e.target.value) }))}>
                  {hours.filter((h) => h > settings.startHour).map((h) => <option key={h} value={h}>{clock(h * 60)}</option>)}
                </select>
              </div>
              <span className="muted" style={{ paddingBottom: 9 }}>{T.hoursADay(settings.endHour - settings.startHour)}</span>
            </div>
            )}
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-sched">
          <div className="about">
            <h2 id="s-sched">{T.scheduleTitle}</h2>
            <p>{T.scheduleAbout}</p>
          </div>
          <div className="set-panel">
            {(settings.schedule ?? []).length === 0 && <div className="empty">{T.scheduleNone}</div>}
            <div><button type="button" className="btn" onClick={() => setImporting(true)}>{T.schedImport.open}</button></div>
            <ScheduleImport open={importing} onClose={() => setImporting(false)} onAdd={(add) => {
              update((s) => ({ ...s, schedule: [...(s.schedule ?? []), ...add] }));
              offerUndo(T.schedImport.added(add.length), () => update((s) => ({ ...s, schedule: (s.schedule ?? []).filter((x) => !add.some((a) => a.id === x.id)) })));
            }} />
            {[...(settings.schedule ?? [])].sort((a, b) => a.start - b.start).map((r) => {
              const setRep = (patch: Partial<Repeat>) => update((s) => ({ ...s, schedule: (s.schedule ?? []).map((x) => (x.id === r.id ? { ...x, ...patch } : x)) }));
              return (
                <div className="tpl-set" key={r.id}>
                  <div className="tpl-set-top">
                    <input className="input" aria-label={T.whatFor} value={r.label} placeholder={T.untitledBlock} onChange={(e) => setRep({ label: e.target.value })} />
                    <span className="muted num">{clock(r.start)}–{clock(r.end)} · {r.subject ? `${r.subject} · ` : ''}{T.kinds[r.kind].name}{(r.every ?? 1) > 1 ? ` · ${T.everyOtherWeek}` : ''}</span>
                    <button type="button" className="btn ghost icon" aria-label={T.scheduleRemove(r.label || T.untitledBlock)}
                      onClick={() => {
                        const at = (settings.schedule ?? []).findIndex((x) => x.id === r.id);
                        update((s) => ({ ...s, schedule: (s.schedule ?? []).filter((x) => x.id !== r.id) }));
                        offerUndo(T.deleted(r.label || T.untitledBlock), () => update((s) => ({ ...s, schedule: insertAt(s.schedule ?? [], at, r) })));
                      }}><IconX /></button>
                  </div>
                  <DayChips days={r.days} onChange={(days) => (days.length ? setRep({ days }) : undefined)} label={T.repeatWeekly} />
                </div>
              );
            })}
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-carry">
          <div className="about">
            <h2 id="s-carry">{T.carryTitle}</h2>
            <p>{T.carryAbout}</p>
          </div>
          <div className="set-panel">
            <Segmented role="group" aria-labelledby="s-carry">
              <button type="button" aria-pressed={(settings.carryTasks ?? 'ask') === 'ask'} onClick={() => update((s) => ({ ...s, carryTasks: 'ask' }))}>{T.carryAsk}</button>
              <button type="button" aria-pressed={settings.carryTasks === 'auto'} onClick={() => update((s) => ({ ...s, carryTasks: 'auto' }))}>{T.carryAuto}</button>
            </Segmented>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-metrics">
          <div className="about">
            <h2 id="s-metrics">{T.dailyMetrics}</h2>
            <p>{T.metricsAbout}</p>
          </div>
          <div className="set-panel">
            {settings.metrics.length === 0 && <div className="empty">{T.noMetricsAddBelow}</div>}
            {settings.metrics.map((m) => (
              <div className="def-row" key={m.id}>
                <div className="field"><label htmlFor={`n-${m.id}`}>{T.nameCol}</label>
                  <input id={`n-${m.id}`} className="input" value={m.name} onChange={(e) => setMetric(m.id, { name: e.target.value })} /></div>
                <div className="field"><label htmlFor={`k-${m.id}`}>{T.kind}</label>
                  <select id={`k-${m.id}`} className="input" value={m.kind}
                    onChange={(e) => setMetric(m.id, e.target.value === 'check' ? { kind: 'check', unit: '', target: null } : { kind: 'number' })}>
                    <option value="number">{T.aNumber}</option><option value="check">{T.yesNo}</option>
                  </select></div>
                <div className="field"><label htmlFor={`u-${m.id}`}>{T.unitCol}</label>
                  <input id={`u-${m.id}`} className="input" value={m.unit} disabled={m.kind === 'check'} placeholder={m.kind === 'check' ? '—' : T.unitPh}
                    onChange={(e) => setMetric(m.id, { unit: e.target.value })} /></div>
                <div className="field"><label htmlFor={`t-${m.id}`}>{T.dailyTarget}</label>
                  <input id={`t-${m.id}`} className="input num" type="number" min={0} step="any" disabled={m.kind === 'check'} placeholder="—"
                    value={m.target ?? ''} onChange={(e) => setMetric(m.id, { target: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                <button type="button" className="btn ghost icon" aria-label={T.remove(m.name)}
                  onClick={() => {
                    const at = settings.metrics.findIndex((x) => x.id === m.id);
                    update((s) => ({ ...s, metrics: s.metrics.filter((x) => x.id !== m.id) }));
                    offerUndo(T.deleted(m.name || T.metricWord), () => update((s) => ({ ...s, metrics: insertAt(s.metrics, at, m) })));
                  }}><IconX /></button>
              </div>
            ))}
            <div>
              <button type="button" className="btn" onClick={() => update((s) => ({ ...s, metrics: [...s.metrics, { id: uid(), name: T.newMetric, kind: 'number', unit: '', target: null }] }))}>
                <IconPlus />{T.addMetric}
              </button>
            </div>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-focus">
          <div className="about">
            <h2 id="s-focus">{T.focusSettings}</h2>
            <p>{T.focusAbout}</p>
          </div>
          <div className="set-panel">
            <FocusConfig />
            <div className="field">
              <label htmlFor="f-metric">{T.metricFor}</label>
              <select id="f-metric" className="input" style={{ maxWidth: 320 }} value={focus.metricId ?? ''}
                onChange={(e) => setFocus({ metricId: e.target.value || null })}>
                <option value="">{T.noneOpt}</option>
                {numberMetrics.map((m) => <option key={m.id} value={m.id}>{m.name}{m.unit ? ` (${m.unit})` : ''}</option>)}
              </select>
            </div>
            <label className="switch-row">
              <input type="checkbox" className="switch" checked={focus.sound} onChange={(e) => setFocus({ sound: e.target.checked })} />
              {T.soundLabel}
            </label>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-remind">
          <div className="about">
            <h2 id="s-remind">{T.remindTitle}</h2>
            <p>{T.remindAbout}</p>
          </div>
          <div className="set-panel">
            <Segmented role="group" aria-labelledby="s-remind">
              {([null, 0, 5, 10] as (number | null)[]).map((v) => (
                <button key={String(v)} type="button" aria-pressed={(settings.reminders?.before ?? null) === v}
                  onClick={() => {
                    update((s) => ({ ...s, reminders: { autoFocus: s.reminders?.autoFocus ?? false, before: v } }));
                    if (v != null && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(setPerm);
                  }}>
                  {v == null ? T.remindOff : v === 0 ? T.remindAt : T.remindBefore(v)}
                </button>
              ))}
            </Segmented>
            <PushSetting />
            <label className="switch-row">
              <input type="checkbox" className="switch" checked={settings.reminders?.autoFocus ?? false}
                onChange={(e) => update((s) => ({ ...s, reminders: { before: s.reminders?.before ?? null, autoFocus: e.target.checked } }))} />
              {T.autoFocusLbl}
            </label>
            {settings.reminders?.before != null && 'Notification' in window && perm !== 'granted' && (
              <p className="muted">{perm === 'denied' ? T.notifyBlocked : <button type="button" className="btn" onClick={() => Notification.requestPermission().then(setPerm)}>{T.notifyBtn}</button>}</p>
            )}
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-notif">
          <div className="about">
            <h2 id="s-notif">{T.notif.title}</h2>
            <p>{T.notif.about}</p>
          </div>
          <div className="set-panel">
            <NotificationSettings />
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-tpl">
          <div className="about">
            <h2 id="s-tpl">{T.tplSettings}</h2>
            <p>{T.tplSettingsAbout}</p>
          </div>
          <div className="set-panel">
            {(settings.templates ?? []).length === 0 && <div className="empty">{T.tplNone}</div>}
            {(settings.templates ?? []).map((t) => {
              const setTpl = (patch: Partial<DayTemplate>) => update((s) => ({ ...s, templates: (s.templates ?? []).map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }));
              return (
                <div className="tpl-set" key={t.id}>
                  <div className="tpl-set-top">
                    <input className="input" aria-label={T.tplName} value={t.name} onChange={(e) => setTpl({ name: e.target.value })} />
                    <span className="muted num">{T.tplBlocks(t.blocks.length)}</span>
                    <button type="button" className="btn ghost icon" aria-label={T.tplDelete(t.name)}
                      onClick={() => {
                        const at = (settings.templates ?? []).findIndex((x) => x.id === t.id);
                        update((s) => ({ ...s, templates: (s.templates ?? []).filter((x) => x.id !== t.id) }));
                        offerUndo(T.deleted(t.name), () => update((s) => ({ ...s, templates: insertAt(s.templates ?? [], at, t) })));
                      }}><IconX /></button>
                  </div>
                  <DayChips days={t.days} onChange={(days) => setTpl({ days })} label={T.tplDays} />
                </div>
              );
            })}
          </div>
        </section>

        <Calendars />

        <section className="set-row" aria-labelledby="s-ritual">
          <div className="about">
            <h2 id="s-ritual">{T.shutdownRitual}</h2>
            <p>{T.ritualAbout}</p>
          </div>
          <div className="set-panel">
            {settings.ritual.map((r, i) => (
              <div className="ritual-row" key={r.id}>
                <span className="idx">{i + 1}.</span>
                <input className="input" aria-label={T.stepN(i + 1)} value={r.text}
                  onChange={(e) => update((s) => ({ ...s, ritual: s.ritual.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)) }))} />
                <button type="button" className="btn ghost icon" aria-label={T.removeStep(i + 1)}
                  onClick={() => {
                    update((s) => ({ ...s, ritual: s.ritual.filter((x) => x.id !== r.id) }));
                    offerUndo(T.deleted(r.text || T.stepN(i + 1)), () => update((s) => ({ ...s, ritual: insertAt(s.ritual, i, r) })));
                  }}><IconX /></button>
              </div>
            ))}
            <div>
              <button type="button" className="btn" onClick={() => update((s) => ({ ...s, ritual: [...s.ritual, { id: uid(), text: '' }] }))}>
                <IconPlus />{T.addStep}
              </button>
            </div>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-tour">
          <div className="about">
            <h2 id="s-tour">{T.tourSettings}</h2>
            <p>{T.tourAbout}</p>
          </div>
          <div className="set-panel">
            <div><button type="button" className="btn" onClick={() => { update((s) => ({ ...s, tourDone: false })); navigate(`/day/${today()}`); }}>{T.showTour}</button>
              <button type="button" className="btn" onClick={() => update((x) => ({ ...x, setupDone: false, tourDone: false, setupAgain: true }))}>{T.runSetup}</button></div>
            <p className="hint">{T.keysHint}</p>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-about">
          <div className="about">
            <h2 id="s-about">{A.source}</h2>
            <p>{A.sourceAbout}</p>
          </div>
          <div className="set-panel">
            <div><a className="btn" href={source} target="_blank" rel="noreferrer">{A.source}</a></div>
          </div>
        </section>

        <section className="set-row" aria-labelledby="s-data">
          <div className="about">
            <h2 id="s-data">{T.yourData}</h2>
            <p>{T.dataAbout}</p>
          </div>
          <div className="set-panel">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="btn" href="/api/export" download>{T.download}</a>
              <ExportDownloads />
              <button type="button" className="btn" onClick={() => file.current?.click()}>{T.importBackup}</button>
              <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
            </div>
            {imported && <span className="muted" role="status">{imported}</span>}
          </div>
        </section>

      </div>
      )}
    </>
  );
}

/** Calendars to plan around: read-only feeds, checked before they are kept. */
function Calendars() {
  const T = useT();
  const { settings, update } = useSettings();
  const cals = settings.calendars ?? [];
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [state, setState] = useState<{ busy?: boolean; error?: string; added?: number } | null>(null);
  const failing = useCalendarErrors();
  const add = async () => {
    setState({ busy: true });
    try {
      const r = await api.checkCalendar(url.trim(), viewerZone());
      update((s) => ({ ...s, calendars: [...(s.calendars ?? []), { id: uid(), name: name.trim() || new URL(url.trim().replace(/^webcals?:/i, 'https:')).hostname, url: url.trim() }] }));
      refreshCalendars();
      setName(''); setUrl(''); setState({ added: r.upcoming });
    } catch (e) {
      const code = e instanceof ApiError ? e.code.replace(/^cal-/, '') : 'unreachable';
      setState({ error: T.calErrors[code] ?? T.calErrors.unreachable });
    }
  };
  return (
    <section className="set-row" aria-labelledby="s-cal">
      <div className="about">
        <h2 id="s-cal">{T.calTitle}</h2>
        <p>{T.calAbout}</p>
      </div>
      <div className="set-panel">
        {cals.length === 0 ? <p className="muted">{T.calNone}</p> : (
          <div className="cal-list">
            {cals.map((c) => (
              <div className="cal-row" key={c.id}>
                <IconCalendar />
                <div><b>{c.name}</b><small>{failing.has(c.id) ? T.calFailing : hostOf(c.url)}</small></div>
                <button type="button" className="btn ghost icon" aria-label={T.calRemove(c.name)}
                  onClick={() => {
                    const at = cals.findIndex((x) => x.id === c.id);
                    update((s) => ({ ...s, calendars: (s.calendars ?? []).filter((x) => x.id !== c.id) }));
                    refreshCalendars();
                    offerUndo(T.deleted(c.name), () => { update((s) => ({ ...s, calendars: insertAt(s.calendars ?? [], at, c) })); refreshCalendars(); });
                  }}><IconX /></button>
              </div>
            ))}
          </div>
        )}
        <form className="cal-form" onSubmit={(e) => { e.preventDefault(); if (!state?.busy) add(); }}>
          <div className="field">
            <label htmlFor="cal-name">{T.calName}</label>
            <input id="cal-name" className="input" maxLength={40} placeholder={T.calNamePh} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="cal-url">{T.calUrl}</label>
            <input id="cal-url" className="input" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              value={url} onChange={(e) => { setUrl(e.target.value); setState(null); }} />
          </div>
          <button type="submit" className="btn" disabled={!url.trim() || state?.busy}>{state?.busy ? T.calChecking : T.calAdd}</button>
        </form>
        {state?.error && <p className="err-line" role="alert">{state.error}</p>}
        {state?.added != null && <p className="ok-line" role="status">{T.calAdded(state.added)}</p>}
        <p className="hint">{T.calHowTo}</p>
      </div>
    </section>
  );
}

const hostOf = (u: string) => { try { return new URL(u.replace(/^webcals?:/i, 'https:')).hostname; } catch { return u; } };

/** Which linked calendars failed to load today (to say so beside them). */
function useCalendarErrors() {
  const d = today();
  const data = useCalendar(d, d);
  return new Set((data?.errors ?? []).map((e) => e.id));
}
