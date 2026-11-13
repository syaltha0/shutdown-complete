import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useState, type ComponentType } from 'react';
import { api, signedOut, type AuthState, type User } from './lib/api';
import { navigate, onLinkClick, usePath } from './lib/router';
import { useDoc, restorePending } from './lib/useDoc';
import { OfflineQueue } from './components/OfflineQueue';
import { ConflictDraft } from './components/ConflictDraft';
import { defaultSettings, type Settings } from './lib/model';
import { dict, getLang, setLang, useT } from './lib/i18n';
import { monthOf, quarterOf, today, weekOf } from './lib/dates';
import {
  IconBoard, IconDay, IconFocus, IconHome, IconHourglass, IconInbox, IconHabits, IconMetrics, IconMonth, IconMore, IconQuarter, IconSettings, IconShutdown, IconWeek, IconX, Mark,
} from './components/Icons';
import { FocusRunner } from './components/FocusTimer';
import { BlockReminders } from './components/Reminders';
import { FriendsWatcher } from './components/Friends';
import { Tour } from './components/Tour';
import { Shortcuts } from './components/Shortcuts';
import { isAuthPath, setPasswordPolicy } from './lib/authRules';
import { Day } from './screens/Day';
import { Home } from './screens/Home';
// These modules already ship with Day/Home through their shared helpers.
import { Tasks } from './screens/Tasks';
import { Countdowns } from './screens/Countdown';
import { emptyInbox, featureOn, type Feature, type InboxDoc } from './lib/model';
import { inView } from './lib/tasks';

// The day and the overview come with the app; every other screen is its own file, fetched the first time it opens
// (and fetched ahead once the app is idle, so the service worker has it for working offline).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const later = <M,>(load: () => Promise<M>, name: keyof M) => { loaders.push(load); return lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> }))); };
const loaders: (() => Promise<unknown>)[] = [];
const Auth = later(() => import('./screens/Auth'), 'Auth');
// a visitor on a sign-in page gets its screen while the session is being checked, not after
if (isAuthPath(location.pathname)) import('./screens/Auth').catch(() => {});
const MustChange = later(() => import('./screens/Auth'), 'MustChange');
const Welcome = later(() => import('./screens/Welcome'), 'Welcome');
const WeekPlan = later(() => import('./screens/WeekPlan'), 'WeekPlan');
const WeekReview = later(() => import('./screens/WeekReview'), 'WeekReview');
const Boards = later(() => import('./screens/boards/Projects'), 'Boards');
const LegacyBoard = later(() => import('./screens/boards/Project'), 'LegacyBoard');
const PersonalProject = later(() => import('./screens/boards/Project'), 'PersonalProject');
const TeamProject = later(() => import('./screens/boards/Project'), 'TeamProject');
const Week = later(() => import('./screens/Week'), 'Week');
const Month = later(() => import('./screens/Month'), 'Month');
const Year = later(() => import('./screens/Year'), 'Year');
const Quarter = later(() => import('./screens/Quarter'), 'Quarter');
const Focus = later(() => import('./screens/Focus'), 'Focus');
const Habits = later(() => import('./screens/Habits'), 'Habits');
const Metrics = later(() => import('./screens/Metrics'), 'Metrics');
const Shutdown = later(() => import('./screens/Shutdown'), 'Shutdown');
const ServerStatus = later(() => import('./screens/ServerStatus'), 'ServerStatus');
const SettingsScreen = later(() => import('./screens/Settings'), 'SettingsScreen');
/** Fetches the screens not opened yet, one at a time, while the browser has nothing else to do. */
function fetchAhead() {
  const idle = (fn: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1200));
  const next = (i: number) => { if (i < loaders.length) idle(() => { loaders[i]().catch(() => {}).finally(() => next(i + 1)); }); };
  window.setTimeout(() => next(0), 2500);
}
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const Agenda = lazy(() => import('./screens/Agenda').then(m => ({default: m.Agenda})));
const Wait = () => <div className="screen-wait" aria-busy="true" />;

/** The screen's blocks rise in one after another (see .canvas [data-anim] in styles/motion.css), once it has arrived. */
function Stagger() {
  useLayoutEffect(() => {
    let n = 0;
    document.querySelectorAll<HTMLElement>('.canvas .title-row, .canvas .panel, .canvas .kpis, .canvas .notice').forEach((el) => {
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', String(Math.min(n++, 8)));
    });
  });
  return null;
}

interface SettingsCtx { settings: Settings; update: (fn: (s: Settings) => Settings) => void }
const SettingsContext = createContext<SettingsCtx>({ settings: defaultSettings(), update: () => {} });
export const useSettings = () => useContext(SettingsContext);
const AccountContext = createContext<{ user: User; source: string; attention: number; refresh: () => void } | null>(null);
export const useAccount = () => useContext(AccountContext)!;

export function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const path = usePath();
  useEffect(() => {
    if (/^#together=[a-f0-9]{64}$/.test(location.hash)) {
      sessionStorage.setItem('together', location.hash.slice(10));
      history.replaceState(null, '', location.pathname);
    }
    const follow = () => {
      if (/^#together=[a-f0-9]{64}$/.test(location.hash)) {
        sessionStorage.setItem('together', location.hash.slice(10));
        location.href = '/focus';
      }
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [path]);
  // a server that cannot be reached is said so (and tried again), not mistaken for a signed-out visitor
  const [unreachable, setUnreachable] = useState(false);
  const load = () => api.state().then(async (s) => { if (!state && s.user) await restorePending(s.user.id); setPasswordPolicy(s.policy); setUnreachable(false); setState(s); }).catch(() => setUnreachable(true));
  useEffect(() => {
    load();
    // a session that ends (signed out elsewhere, expired) goes back to the sign-in screen with a clean slate
    const out = () => { location.href = '/login'; };
    signedOut.addEventListener('signedout', out);
    return () => signedOut.removeEventListener('signedout', out);
  }, []);
  useEffect(() => {
    if (!state) return;
    if (state.user && isAuthPath(path)) navigate('/', true);
    if (!state.user && !isAuthPath(path)) navigate('/login', true);
  }, [state, path]);

  if (!state && unreachable) return <Unreachable onRetry={load} />;
  if (!state) return <div className="loading-screen">{useT().loading}</div>;
  // signing in reloads the page, so no document of a previous account stays in memory
  if (!state.user) return <Suspense fallback={<div className="loading-screen" />}><Auth state={state} onIn={() => { location.href = sessionStorage.getItem('together') ? '/focus' : '/'; }} /></Suspense>;
  if (state.user.mustChange) return <Suspense fallback={<div className="loading-screen" />}><MustChange user={state.user} source={state.source} /></Suspense>;
  return (
    <AccountContext.Provider value={{ user: state.user, source: state.source, attention: state.attention ?? 0, refresh: load }}>
      <Planner />
    </AccountContext.Provider>
  );
}

/** The server did not answer (it is down or restarting): say so, and keep trying every few seconds. */
function Unreachable({ onRetry }: { onRetry: () => void }) {
  const T = useT();
  useEffect(() => { const t = window.setInterval(onRetry, 4000); return () => window.clearInterval(t); }, []);
  return (
    <div className="loading-screen" role="alert">
      <div className="unreachable"><p>{T.unreachable}</p><button type="button" className="btn" onClick={onRetry}>{T.retry}</button></div>
    </div>
  );
}

function Planner() {
  const { value, update } = useDoc<Settings>('settings', () => defaultSettings());
  // the planner stopped speaking of work (2026-10-22): a deep-work metric still under its old default name is renamed
  const OLD_DEEP = ['Deep work', 'Derin çalışma'];
  useEffect(() => {
    if (value?.metrics?.some((m) => m.id === 'deep' && OLD_DEEP.includes(m.name))) {
      const name = dict(value.lang ?? getLang()).defaults.metrics.deep.name;
      update((s) => ({ ...s, metrics: s.metrics.map((m) => (m.id === 'deep' && OLD_DEEP.includes(m.name) ? { ...m, name } : m)) }));
    }
  }, [value?.metrics]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!value) return <div className="loading-screen">{useT().loading}</div>;
  // the language stored with the settings wins, so every device shows the same one
  if (value.lang && value.lang !== getLang()) setLang(value.lang);
  return (
    <SettingsContext.Provider value={{ settings: { ...defaultSettings(), ...value }, update }}>
      {/* a new account sets up its workday first; accounts that already took the tour never see this */}
      {!value.setupDone && !value.tourDone ? <Suspense fallback={<div className="loading-screen">{useT().loading}</div>}><Welcome /></Suspense> : <Shell />}
    </SettingsContext.Provider>
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/;

function route(path: string) {
  const [, section, arg] = path.split('/');
  switch (section) {
    case '': return { nav: 'home', el: <Home /> };
    case 'day': if (DATE.test(arg)) return { nav: 'day', el: <Day date={arg} key={arg} /> }; break;
    case 'week': if (/^\d{4}-W\d{2}$/.test(arg)) return { nav: 'week', el: <Week id={arg} key={arg} /> }; break;
    case 'month': if (MONTH.test(arg)) return { nav: 'month', el: <Month id={arg} key={arg} /> }; break;
    case 'year': if (/^[1-9]\d{3}$/.test(arg)) return { nav: 'year', el: <Year id={arg} key={arg} /> }; break;
    case 'quarter': if (/^\d{4}-Q[1-4]$/.test(arg)) return { nav: 'quarter', el: <Quarter id={arg} key={arg} /> }; break;
    case 'plan': if (/^\d{4}-W\d{2}$/.test(arg)) return { nav: 'week', el: <WeekPlan id={arg} key={arg} /> }; break;
    case 'review': if (/^\d{4}-W\d{2}$/.test(arg)) return { nav: 'week', el: <WeekReview id={arg} key={arg} /> }; break;
    case 'focus': return { nav: 'focus', el: <Focus /> };
    // the task lists (the old inbox's address leads there too); the part after it is the list or collection shown
    case 'tasks': case 'inbox': return { nav: 'inbox', el: <Tasks view={arg} /> };
    case 'countdown': return { nav: 'countdown', el: <Countdowns /> };
    case 'boards': return { nav: 'boards', el: <Boards /> };
    case 'board': if (arg) return { nav: 'boards', el: <LegacyBoard id={arg} card={path.split('/')[3] || undefined} key={arg} /> }; break;
    case 'project': if (arg) return { nav: 'boards', el: <PersonalProject pid={arg} bid={path.split('/')[3] || undefined} card={path.split('/')[4] || undefined} key={arg} /> }; break;
    case 'team': if (arg) return { nav: 'boards', el: <TeamProject tid={arg} bid={path.split('/')[3] || undefined} card={path.split('/')[4] || undefined} key={arg} /> }; break;
    case 'habits': {
      const m = MONTH.test(arg) ? arg : monthOf(today());
      return { nav: 'habits', el: <Habits id={m} key={m} /> };
    }
    case 'agenda': return { nav: 'agenda', el: <Agenda date={DATE.test(arg) ? arg : today()} key={arg} /> };
    case 'metrics': return { nav: 'metrics', el: <Metrics /> };
    case 'shutdown': {
      const d = DATE.test(arg) ? arg : today();
      return { nav: 'shutdown', el: <Shutdown date={d} key={d} /> };
    }
    case 'settings': return { nav: 'settings', el: arg === 'status' ? <ServerStatus /> : <SettingsScreen key={arg || 'planner'} /> };
  }
  return null;
}

/** The screens that belong to a part one can turn off. */
const FEATURE_OF: Record<string, Feature | undefined> = { inbox: 'inbox', boards: 'boards', countdown: 'countdown', habits: 'habits', metrics: 'metrics' };

interface NavItem { id: string; href: string; label: string; icon: React.ReactNode; tour?: string }

function Shell() {
  const { attention } = useAccount();
  const path = usePath();
  const r = route(path);
  const T = useT();
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const { settings } = useSettings();
  const on = (id: string) => !(FEATURE_OF[id] && !featureOn(settings, FEATURE_OF[id]!));
  // a part turned off has no screen: its address leads to the overview
  useEffect(() => { if (!r || !on(r.nav)) navigate('/', true); }, [r?.nav, settings.features]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setMore(false), [path]);
  useEffect(fetchAhead, []);
  useEffect(() => {
    const open = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setMore(false); setPalette(v => !v); }
    };
    window.addEventListener('keydown', open);
    return () => window.removeEventListener('keydown', open);
  }, []);
  const t = today();

  const home: NavItem = { id: 'home', href: '/', label: T.nav.home, icon: <IconHome /> };
  const { value: inboxDoc } = useDoc<InboxDoc>('inbox', emptyInbox);
  // the rail counts what is due or started by today
  const inboxCount = inboxDoc?.items.filter((x) => inView(x, 'today')).length ?? 0;
  const inbox: NavItem = { id: 'inbox', href: '/tasks', label: T.nav.inbox, icon: <IconInbox /> };
  const countdown: NavItem = { id: 'countdown', href: '/countdown', label: T.nav.countdown, icon: <IconHourglass /> };
  const boards: NavItem = { id: 'boards', href: '/boards', label: T.nav.boards, icon: <IconBoard /> };
  const plan: NavItem[] = [
    { id: 'day', href: `/day/${t}`, label: T.nav.today, icon: <IconDay /> },
    { id: 'week', href: `/week/${weekOf(t)}`, label: T.nav.week, icon: <IconWeek /> },
    { id: 'month', href: `/month/${monthOf(t)}`, label: T.nav.month, icon: <IconMonth /> },
    { id: 'year', href: `/year/${t.slice(0,4)}`, label: T.nav.year, icon: <IconQuarter /> },
    { id: 'quarter', href: `/quarter/${quarterOf(t)}`, label: T.nav.quarter, icon: <IconQuarter /> },
  ];
  const work: NavItem[] = [
    { id: 'focus', href: '/focus', label: T.nav.focus, icon: <IconFocus />, tour: 'nav-focus' },
    { id: 'habits', href: `/habits/${monthOf(t)}`, label: T.nav.habits, icon: <IconHabits />, tour: 'nav-habits' },
    { id: 'metrics', href: '/metrics', label: T.nav.metrics, icon: <IconMetrics /> },
    { id: 'shutdown', href: `/shutdown/${t}`, label: T.nav.shutdown, icon: <IconShutdown />, tour: 'nav-shutdown' },
  ];
  const settingsItem: NavItem = { id: 'settings', href: '/settings', label: T.nav.settings, icon: <IconSettings /> };

  const link = (it: NavItem, cls = 'rail-item') => (
    <a key={it.id} href={it.href} className={cls} aria-current={r?.nav === it.id ? 'page' : undefined} onClick={onLinkClick} data-tour={it.tour}>
      {it.icon}
      {it.id === 'settings' && attention > 0 && <span className="attn" aria-label={T.needsAttention(attention)} />}
      {it.id === 'inbox' && inboxCount > 0 && <span className="count num" aria-label={T.tkCountLabel(inboxCount)}>{inboxCount > 99 ? '99+' : inboxCount}</span>}
      <span className="label">{it.label}</span>
      <span className="tip" aria-hidden="true">{it.label}</span>
    </a>
  );

  // the phone's bottom bar: four destinations and More
  const phoneMain = [home, plan[0], plan[1], work[0]];
  const agenda: NavItem = {id: 'agenda', href: '/agenda', label: T.calendarViews.agenda, icon: <IconDay />};
  const phoneMore = [agenda, boards, countdown, inbox, plan[2], plan[3], work[1], work[2], work[3], settingsItem].filter((x) => on(x.id));
  const moreActive = phoneMore.some((x) => x.id === r?.nav);

  return (
    <div className="app">
      <nav className="rail" aria-label="Shutdown Complete">
        <a href="/" className="mark" onClick={onLinkClick} title="Shutdown Complete">
          <Mark /><span className="sr-only">Shutdown Complete</span>
        </a>
        <div className="rail-group">{link(home)}{on('inbox') && link(inbox)}</div>
        <div className="rail-group" data-tour="nav-scales">{plan.map((x) => link(x))}</div>
        <span className="sep" aria-hidden="true" />
        <div className="rail-group">{link(work[0])}{on('boards') && link(boards)}{on('countdown') && link(countdown)}{work.slice(1).filter((x) => on(x.id)).map((x) => link(x))}</div>
        <div className="bottom">{link(settingsItem)}</div>
      </nav>

      <nav className="tabbar" aria-label="Shutdown Complete">
        {phoneMain.map((x) => link(x, 'tab-item'))}
        <button type="button" className="tab-item" aria-expanded={more} aria-current={moreActive ? 'page' : undefined} onClick={() => setMore(true)}>
          <IconMore />{attention > 0 && <span className="attn" aria-label={T.needsAttention(attention)} />}<span className="label">{T.nav.more}</span>
        </button>
      </nav>
      {more && (
        <div className="more-sheet" role="dialog" aria-modal="true" aria-label={T.nav.more} onClick={() => setMore(false)}>
          <div className="more-card" onClick={(e) => e.stopPropagation()}>
            <div className="more-head">
              <b>{T.nav.more}</b>
              <button type="button" className="btn ghost icon" aria-label={T.close} onClick={() => setMore(false)}><IconX /></button>
            </div>
            <button className="more-item" onClick={() => { setMore(false); setPalette(true); }}>{T.palette.title}<kbd>Ctrl / Cmd K</kbd></button>
            {phoneMore.map((x) => link(x, 'more-item'))}
          </div>
        </div>
      )}

      <main className="canvas" key={r?.nav}>
        <OfflineQueue />
        <ConflictDraft path={path} />
        <div className="phone-only phone-brand"><Mark />Shutdown Complete</div>
        <Suspense fallback={<Wait />}>{r?.el}<Stagger key={path} /></Suspense>
      </main>
      <FocusRunner />
      <BlockReminders />
      <FriendsWatcher />
      <Shortcuts />
      {palette && <Suspense fallback={null}><CommandPalette onClose={() => setPalette(false)} /></Suspense>}
      {r?.nav === 'day' && <Tour />}
    </div>
  );
}
