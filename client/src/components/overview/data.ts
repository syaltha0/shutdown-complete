import { useEffect } from "react";
import { useSettings } from "../../App";
import { addDays, today } from "../../lib/dates";
import { useT } from "../../lib/i18n";
import { activeColumn, emptyDay, type DayDoc } from "../../lib/model";
import { placeRepeats } from "../../lib/repeat";
import { useDoc, useRange } from "../../lib/useDoc";
import { useNow } from "../../screens/TimeGrid";
export function useOverviewData() {
  const T = useT(),
    { settings } = useSettings(),
    t = today(),
    now = useNow(true);
  const { value: day, update } = useDoc<DayDoc>(`day:${t}`, emptyDay);
  useEffect(() => {
    if (day && placeRepeats(day, t, settings.schedule, settings.exceptions))
      update(
        (d) => placeRepeats(d, t, settings.schedule, settings.exceptions) ?? d,
      );
  }, [day != null, settings.schedule, settings.exceptions]);
  // one request for every card: 90 days back (habits, twelve weeks) to 14 ahead (the coming two weeks)
  const { docs } = useRange<DayDoc>(
    `day:${addDays(t, -90)}`,
    `day:${addDays(t, 14)}`,
  );
  const plan = day
    ? [...activeColumn(day).blocks].sort((a, b) => a.start - b.start)
    : [];
  const tasks = day?.tasks.filter((x) => !x.done && x.text.trim()) ?? [];
  const docOf = (d: string) => (d === t ? day : docs?.get(`day:${d}`));
  const recent = Array.from({ length: 7 }, (_, i) => addDays(t, -i));
  const deep = (d: DayDoc | null | undefined) =>
    (d?.focus?.sessions ?? [])
      .filter((s) => s.kind === "deep")
      .reduce((n, s) => n + s.minutes, 0);
  const B = T.bento;
  const monday = addDays(t, -((new Date(t + "T12:00:00").getDay() + 6) % 7));
  // until today and the range have arrived the cards stay blank, so a reload never flashes "no plan yet"
  const ready = day != null && docs != null;
  return {
    ready,
    T,
    settings,
    t,
    now,
    day,
    update,
    docs,
    plan,
    tasks,
    docOf,
    recent,
    deep,
    B,
    monday,
  };
}
export type OverviewData = ReturnType<typeof useOverviewData>;
