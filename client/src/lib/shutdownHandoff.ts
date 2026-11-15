import { emptyDay, type DayDoc, type Item } from './model';
import { updateKey } from './useDoc';

/** Destination first; retries retain the existing task, including its original due date. */
export async function handoffTasks(from: string, to: string, tasks: Item[], selected: string[]) {
  if (to <= from) return;
  await updateKey<DayDoc>(`day:${to}`, emptyDay, day => ({ ...day,
    tasks: [...day.tasks, ...tasks.filter(t => !day.tasks.some(x => x.id === t.id)).map(t => ({ ...t, since: t.since ?? from }))],
  }));
  await updateKey<DayDoc>(`day:${from}`, emptyDay, day => ({ ...day,
    tasks: day.tasks.filter(t => t.done || !selected.includes(t.id)),
  }));
}
