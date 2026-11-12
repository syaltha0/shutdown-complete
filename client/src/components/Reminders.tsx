import { useEffect, useRef } from 'react';
import { useSettings } from '../App';
import { clock, duration, nowMinutes, today } from '../lib/dates';
import { chime, settingsFocus, startFocus } from '../lib/focus';
import { useT } from '../lib/i18n';
import { activeColumn, emptyDay, emptyInbox, type DayDoc, type InboxDoc } from '../lib/model';
import { addDays } from '../lib/dates';
import { showNotification } from '../lib/pwa';
import { useDoc } from '../lib/useDoc';
import { usePush } from '../lib/push';

/**
 * Lives in the shell: a notification as each block of today begins (or a few minutes before, as chosen in
 * Settings), and, if asked, a focus session started by itself when a deep-focus block begins. It works while the
 * planner is open. Subscribed devices receive block notifications from the server instead.
 */
export function BlockReminders() {
  const push = usePush();
  const T = useT();
  const { settings } = useSettings();
  const r = settings.reminders;
  const { value: day } = useDoc<DayDoc>(`day:${today()}`, emptyDay);
  // what has been announced, so a reload or a second render does not announce it again
  const said = useRef<Set<string>>(new Set(readSaid()));
  const { value: inbox } = useDoc<InboxDoc>('inbox', emptyInbox);
  useEffect(() => {
    if (!r || r.before == null) return;
    const t = today(), tom = addDays(t, 1);
    for (const x of [...(inbox?.items ?? []), ...(day?.tasks ?? [])]) {
      if (!x.due || x.done || (x.due !== t && x.due !== tom)) continue;
      const key = `${t}:due:${x.id}`;
      if (said.current.has(key)) continue;
      said.current.add(key);
      showNotification(x.text, x.due === t ? T.dueToday : T.dueTomorrow, '/tasks/today', 'due');
    }
    writeSaid([...said.current]);
  }, [inbox, day?.tasks, r, T]);

  // a task's own reminder: on its due day, the chosen minutes before its due time (or at it)
  useEffect(() => {
    const items = [...(inbox?.items ?? []), ...(day?.tasks ?? [])].filter((x) => !x.done && x.due && x.dueTime && x.remind != null);
    if (!items.length) return;
    const tick = () => {
      const now = Date.now();
      for (const x of items) {
        const at = new Date(`${x.due}T${x.dueTime}:00`).getTime();
        const key = `${today()}:remind:${x.id}:${x.due}${x.dueTime}`;
        if (now < at - x.remind! * 60000 || now > at + 3600_000 || said.current.has(key)) continue;
        said.current.add(key);
        const left = Math.round((at - now) / 60000);
        showNotification(x.text, left > 0 ? T.tkDueIn(duration(left), x.dueTime!) : T.tkDueNow(x.dueTime!), '/tasks/today', 'due');
        if (settingsFocus(settings).sound) chime();
      }
      writeSaid([...said.current]);
    };
    tick();
    const t = window.setInterval(tick, 20_000);
    return () => window.clearInterval(t);
  }, [inbox, day?.tasks, settings, T]);

  useEffect(() => {
    if (!day || !r || (r.before == null && !r.autoFocus)) return;
    const blocks = activeColumn(day).blocks;
    const tick = () => {
      const now = nowMinutes(), d = today();
      for (const b of blocks) {
        if (r.before != null && push === false) {
          const at = b.start - r.before, key = `${d}:${b.id}:${b.start}:n`;
          if (now >= at && now < b.start + 5 && !said.current.has(key)) {
            said.current.add(key);
            const label = b.label || T.untitledBlock;
            showNotification(label, r.before && now < b.start ? T.startsIn(b.start - now, clock(b.start)) : T.startsNow(clock(b.end)), `/day/${d}`, 'block');
            if (settingsFocus(settings).sound) chime();
          }
        }
        if (r.autoFocus && b.kind === 'deep') {
          const key = `${d}:${b.id}:${b.start}:f`;
          if (now >= b.start && now < Math.min(b.end, b.start + 5) && !said.current.has(key)) {
            said.current.add(key);
            if (!day.focus?.active) startFocus({ blockId: b.id, label: b.label || T.untitledBlock, minutes: settingsFocus(settings).focusMin });
          }
        }
      }
      writeSaid([...said.current]);
    };
    tick();
    const t = window.setInterval(tick, 20_000);
    return () => window.clearInterval(t);
  }, [day, r, settings, T, push]);

  return null;
}

const KEY = 'sc-reminded';
function readSaid(): string[] {
  try { return (JSON.parse(sessionStorage.getItem(KEY) || '[]') as string[]).filter((k) => k.startsWith(today())); } catch { return []; }
}
function writeSaid(v: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(v.slice(-200))); } catch { /* private mode */ }
}
