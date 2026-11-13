// The choices behind the push notifications that arrive while the app is closed. The server reads the same
// choices from the settings document (server/src/push.mjs: notifyChoices), so the defaults here must match it.
import type { NotifyChoices, Settings } from './model';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The shutdown reminder's time when none was chosen: the end of the workday set up in Settings, otherwise 17:30. */
export function closingTime(s: Pick<Settings, 'endHour' | 'wholeDay' | 'setupDone'>): string {
  const h = s.endHour;
  return s.setupDone && !s.wholeDay && Number.isInteger(h) && h >= 12 && h <= 23 ? `${String(h).padStart(2, '0')}:00` : '17:30';
}

export interface NotifyView { focus: boolean; morning: boolean; morningAt: string; evening: boolean; eveningAt: string; weekends: boolean }

export function notifyView(s: Settings): NotifyView {
  const n: NotifyChoices = s.notify ?? {};
  return {
    focus: n.focus !== false, morning: n.morning === true, morningAt: n.morningAt && TIME.test(n.morningAt) ? n.morningAt : '08:30',
    evening: n.evening === true, eveningAt: n.eveningAt && TIME.test(n.eveningAt) ? n.eveningAt : closingTime(s), weekends: n.weekends === true,
  };
}
