import { onLinkClick } from "../../lib/router";
import { OverviewRing } from "./Ring";
import type { OverviewData } from "./data";
export function TasksToday({ T, t, day, tasks, B }: OverviewData) {
  const link = (href: string, text: string) => (
    <a href={href} onClick={onLinkClick}>
      {text}
    </a>
  );
  const totalTasks = day?.tasks.filter((x) => x.text.trim()).length ?? 0;
  const doneTasks = totalTasks - tasks.length;
  return (
    <section className="panel b-tasks">
      <h2>{B.tasks}</h2>
      <OverviewRing
        value={doneTasks}
        total={totalTasks}
        label={B.tasks}
        text={totalTasks ? `${doneTasks}/${totalTasks}` : "–"}
      />
      <p className="b-truncate">
        {tasks[0]?.text || (totalTasks ? T.overviewNothingOpen : B.noTasks)}
      </p>
      {link(`/day/${t}`, T.openToday)}
    </section>
  );
}
