import { useState } from 'react';
import { useSettings } from '../App';
import { DocNotice, SaveStamp } from '../components/Common';
import { Ring, useTick } from '../components/FocusTimer';
import { addDays, clock, duration, nowMinutes, shortDate, today } from '../lib/dates';
import { Chart, themeColor } from '../components/Chart';
import {
  cancelFocus, chime, finishPhase, focusMinutes, mmss, pauseFocus, resumeFocus, secondsLeft, settingsFocus, startFocus,
} from '../lib/focus';
import { useT } from '../lib/i18n';
import { activeColumn, emptyDay, emptyInbox, type DayDoc, type InboxDoc, featureOn } from '../lib/model';
import { inView, sortTasks } from '../lib/tasks';
import { onLinkClick } from '../lib/router';
import { useDoc, useRange } from '../lib/useDoc';
import { kindSwatch } from './TimeGrid';
import { FocusRoom } from '../components/FocusRoom';
import { FriendsPanel } from '../components/Friends';

export function Focus() {
  const T = useT();
  const { settings } = useSettings();
  const f = settingsFocus(settings);
  const { value: day, status, error, retry } = useDoc<DayDoc>(`day:${today()}`, emptyDay);
  const a = day?.focus?.active ?? null;
  useTick(!!a && a.pausedLeft == null);
  const blocks = day ? activeColumn(day).blocks : [];
  const now = nowMinutes();
  // the block to focus on: the one running now, unless it is lunch or a walk; then the next deep block
  const running = blocks.find((b) => now >= b.start && now < b.end && b.kind !== 'personal');
  const current = running ?? blocks.find((b) => b.start > now && b.kind === 'deep') ?? blocks.find((b) => b.start > now && b.kind !== 'personal') ?? null;
  const [blockId, setBlockId] = useState<string | null | undefined>(undefined);
  const [len, setLen] = useState<number | null>(null);
  // the task to work on: today's open tasks, then the lists' (due or started by today, or starred, first)
  const { value: lists } = useDoc<InboxDoc>('inbox', emptyInbox);
  const dayTasks = (day?.tasks ?? []).filter((t) => !t.done && t.text.trim());
  const listTasks = sortTasks((lists?.items ?? []).filter((t) => !t.done), 'due').sort((x, y) => Number(inView(y, 'today') || y.priority === 1) - Number(inView(x, 'today') || x.priority === 1)).slice(0, 40);
  const [taskKey, setTaskKey] = useState(() => { try { return sessionStorage.getItem('sc-focus-task') ?? ''; } catch { return ''; } });
  const chooseTask = (k: string) => { setTaskKey(k); try { sessionStorage.setItem('sc-focus-task', k); } catch { /* private window */ } };
  const task = taskKey.startsWith('d:') ? dayTasks.find((t) => t.id === taskKey.slice(2)) : taskKey.startsWith('l:') ? listTasks.find((t) => t.id === taskKey.slice(2)) : undefined;
  const taskRef = task ? { id: task.id, text: task.text, ...(taskKey.startsWith('d:') ? { day: true } : {}) } : undefined;
  const [room, setRoom] = useState(false);
  const openRoom = () => { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ } setRoom(true); };
  const chosen = blockId === undefined ? current?.id ?? null : blockId;
  const chosenBlock = blocks.find((b) => b.id === chosen) ?? null;
  const sessions = day?.focus?.sessions ?? [];
  const total = day ? focusMinutes(day) : 0;
  const deepDef = settings.metrics.find((m) => m.id === f.metricId);
  const untilLong = f.longEvery - (sessions.length % f.longEvery);
  const from28 = addDays(today(), -27);
  const { docs: past } = useRange<DayDoc>(`day:${from28}`, `day:${today()}`);
  const days28 = Array.from({ length: 28 }, (_, i) => addDays(from28, i));
  const workBlocks = blocks.filter((b) => b.kind !== 'personal');
  // a revision gives a block a new id, so a session also counts for a block of the same name
  const byBlock = (b: { id: string; label: string }) => sessions.filter((x) => x.blockId === b.id || (!!b.label && x.label === b.label)).reduce((n, x) => n + x.minutes, 0);
  const lengths = [...new Set([15, 25, 30, 45, 50, 60, 90, f.focusMin])].sort((x, y) => x - y);

  async function finish() {
    const r = await finishPhase(settings, true);
    if (r !== 'none' && f.sound) chime();
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.focusTitle}</h1>
          <p className="sub num">{day ? <>{T.focusSummary(sessions.length, duration(total))} · {T.nextLong(untilLong)}</> : ' '}</p>
        </div>
        <div className="title-actions"><SaveStamp status={status} /></div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />

      <div className="grid">
        <section className={`panel span-7 focus-panel${a ? ` phase-${a.phase}` : ''}`} aria-labelledby="fp-h" data-anim>
          <h2 id="fp-h" className="sr-only">{T.focusRunning}</h2>
          <div className="focus-stage">
            <div className="focus-ring">
              {a ? <Ring a={a} size={248} stroke={10} /> : <svg width={248} height={248} viewBox="0 0 248 248" aria-hidden="true"><circle cx={124} cy={124} r={119} fill="none" stroke="var(--raised)" strokeWidth={10} /></svg>}
              <div className="focus-read">
                <span className="phase-name">{a ? T.phase[a.phase] : T.phase.focus}</span>
                <b className="num" aria-live="off">{a ? mmss(secondsLeft(a)) : mmss((len ?? f.focusMin) * 60)}</b>
                <span className="muted focus-label">{a ? (a.label || T.freeFocus) : chosenBlock ? chosenBlock.label || T.untitledBlock : T.freeFocus}</span>
              </div>
            </div>

            {!a && (
              <div className="focus-setup">
                <div className="field">
                  <label htmlFor="fc-block">{T.blockPick}</label>
                  <select id="fc-block" className="input" value={chosen ?? ''} onChange={(e) => setBlockId(e.target.value || null)}>
                    <option value="">{T.freeFocus}</option>
                    {blocks.map((b) => <option key={b.id} value={b.id}>{clock(b.start)}–{clock(b.end)} · {b.label || T.untitledBlock}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="fc-task">{T.focusTask}</label>
                  <select id="fc-task" className="input" value={task ? taskKey : ''} onChange={(e) => chooseTask(e.target.value)}>
                    <option value="">{T.focusNoTask}</option>
                    {dayTasks.length > 0 && <optgroup label={T.tasks}>{dayTasks.map((t) => <option key={t.id} value={`d:${t.id}`}>{t.text}{t.spent ? ` · ${duration(t.spent)}` : ''}</option>)}</optgroup>}
                    {listTasks.length > 0 && <optgroup label={T.tkTitle}>{listTasks.map((t) => <option key={t.id} value={`l:${t.id}`}>{t.text}{t.spent ? ` · ${duration(t.spent)}` : ''}</option>)}</optgroup>}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="fc-len">{T.lengthLabel}</label>
                  <select id="fc-len" className="input num" value={len ?? f.focusMin} onChange={(e) => setLen(Number(e.target.value))}>
                    {lengths.map((m) => <option key={m} value={m}>{T.minShort(m)}</option>)}
                  </select>
                </div>
                <button type="button" className="btn primary big" disabled={!day}
                  onClick={() => startFocus({ blockId: chosen, label: task?.text || chosenBlock?.label || T.freeFocus, minutes: len ?? f.focusMin, task: taskRef })}>
                  {T.startFocus}
                </button>
                <button type="button" className="btn" onClick={openRoom}>{T.roomOpen}</button>
              </div>
            )}

            {a && (
              <div className="focus-controls">
                {a.pausedLeft == null
                  ? <button type="button" className="btn" onClick={() => pauseFocus()}>{T.pause}</button>
                  : <button type="button" className="btn primary" onClick={() => resumeFocus()}>{T.resume}</button>}
                {a.phase === 'focus'
                  ? <button type="button" className="btn" onClick={finish}>{T.finishNow}</button>
                  : <button type="button" className="btn primary" onClick={finish}>{T.skipBreak}</button>}
                <button type="button" className="btn ghost" onClick={() => cancelFocus()}>{T.stop}</button>
                <button type="button" className="btn" onClick={openRoom}>{T.roomOpen}</button>
              </div>
            )}
            {deepDef && <p className="muted focus-note">{T.addsTo(deepDef.name)}</p>}
          </div>
        </section>

        <div className="stack span-5" style={{ alignContent: 'start' }}>
        {featureOn(settings, 'friends') && <FriendsPanel />}
        <section className="panel" aria-labelledby="fs-h" data-anim>
          <header>
            <h2 id="fs-h">{T.sessionsToday}</h2>
            <a className="card-link" style={{ fontWeight: 400 }} href={`/day/${today()}`} onClick={onLinkClick}>{T.nav.today}</a>
          </header>
          {sessions.length === 0 ? <div className="empty">{T.noSessions}</div> : (
            <div className="sessions">
              {[...sessions].reverse().map((s) => {
                const st = new Date(s.start), en = new Date(s.end);
                return (
                  <div className="session" key={s.id}>
                    <i style={s.kind ? kindSwatch(s.kind) : { background: 'var(--surface)', border: '1px solid var(--control)' }} />
                    <span className="t num">{clock(st.getHours() * 60 + st.getMinutes())}–{clock(en.getHours() * 60 + en.getMinutes())}</span>
                    <span className="l">{s.label || T.freeFocus}</span>
                    <span className="n num">{duration(s.minutes)}</span>
                  </div>
                );
              })}
              <div className="session total"><span /><span /><span className="l">{T.totalCol}</span><span className="n num">{duration(total)}</span></div>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="fb-h" data-anim>
          <header><h2 id="fb-h">{T.focusByBlock}</h2></header>
          {workBlocks.length === 0 ? <div className="empty">{T.noDeepBlocks}</div> : (
            <div className="byblock">
              {workBlocks.map((b) => {
                const got = byBlock(b), len = b.end - b.start;
                return (
                  <div className="bb" key={b.id}>
                    <div className="bb-top"><span className="l"><i className="kind-dot" style={kindSwatch(b.kind)} />{b.label || T.untitledBlock}</span><span className="num muted">{T.focusedOf(duration(got), duration(len))}</span></div>
                    <div className="bb-track"><i style={{ transform: `scaleX(${Math.min(1, got / len)})` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </div>

        {room && <FocusRoom start={{ blockId: chosen, label: task?.text || chosenBlock?.label || T.freeFocus, minutes: len ?? f.focusMin, task: taskRef }} onClose={() => setRoom(false)} />}
        <section className="panel span-12" aria-labelledby="f4-h" data-anim>
          <div className="chart-head">
            <h2 id="f4-h" style={{ fontSize: 16, fontWeight: 500 }}>{T.focusFourWeeks}</h2>
            <span className="meta">{T.todayInBlue}</span>
          </div>
          {past ? (
            <Chart label={T.focusFourWeeks} deps={[past, T.locale, total]} draw={(el, C) => C.bars(el, {
              labels: days28.map((d) => shortDate(d)),
              values: days28.map((d) => (d === today() && day ? focusMinutes(day) : (past.get(`day:${d}`) ? focusMinutes(past.get(`day:${d}`)!) : 0))),
              highlight: 27, colour: themeColor('--hue'), mutedColour: themeColor('--chart-1'), height: 200,
              format: (v: number) => duration(v), tickFormat: (v: number) => T.minShort(v),
              xAt: days28.map((_, i) => (i % (el.clientWidth < 640 ? 14 : 7) === 0 ? i : -1)).filter((i) => i >= 0),
            })} />
          ) : <div className="skeleton" style={{ height: 200 }} />}
        </section>
      </div>
    </>
  );
}
