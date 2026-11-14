// The planning day: a day may be set to begin after midnight (settings.dayStart, minutes 0..360), so that working past
// midnight still counts as the day before. Shared by the server (reminders) and the planner (see planday.d.mts).

export const MAX_DAY_START = 360;

/** The day start of a settings document, in minutes after midnight: 0 (midnight) unless a whole number up to 06:00. */
export function dayStartOf(settings) {
  const m = settings?.dayStart;
  return Number.isInteger(m) && m > 0 && m <= MAX_DAY_START ? m : 0;
}

const pad = (n) => String(n).padStart(2, '0');
const prevIso = (date) => new Date(Date.parse(`${date}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);

/** A local calendar date and minute as the planning day and the minutes since its midnight (past 24:00 before the day starts). */
export function planningParts(date, minute, dayStart = 0) {
  return dayStart > 0 && minute < dayStart ? { date: prevIso(date), minute: minute + 1440 } : { date, minute };
}

/** The planning day (YYYY-MM-DD, local time) a moment belongs to. */
export function planningDay(now = new Date(), dayStart = 0) {
  const d = new Date(now.getTime());
  if (dayStart > 0 && d.getHours() * 60 + d.getMinutes() < dayStart) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The minutes since the planning day's midnight (1440 and more between midnight and the day start). */
export function planningNow(now = new Date(), dayStart = 0) {
  const m = now.getHours() * 60 + now.getMinutes();
  return dayStart > 0 && m < dayStart ? m + 1440 : m;
}

/** A clock time (minutes after midnight) on the planning day's scale: times before the day start come after 24:00. */
export const onPlanningScale = (minute, dayStart = 0) => (dayStart > 0 && minute < dayStart ? minute + 1440 : minute);
