import type { DayDoc, InboxDoc, Settings, WeekDoc, MonthDoc } from './model';
import type { Words } from './words/en';
type ExportDoc = { key: string; value: unknown };
const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
// Quote every field and neutralise spreadsheet formulas, including after leading whitespace.
const csv = (rows: unknown[][]) => '\uFEFF' + rows.map((r) => r.map((v) => {
  const s = String(v ?? '');
  return '"' + (/^\s*[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
}).join(',')).join('\r\n') + '\r\n';
const md = (s: string) => s.replaceAll('\\', '\\\\').replace(/([\[\]*_`<>#])/g, '\\$1');
export function exportText(docs: ExportDoc[], format: 'markdown' | 'blocks' | 'metrics', T: Words) {
  const P = T.publication;
  const settings = docs.find((d) => d.key === 'settings')?.value as Settings | undefined;
  const names = new Map(settings?.metrics?.map((m) => [m.id, m.name]));
  const blocks: unknown[][] = [[P.date, P.start, P.end, P.kind, P.label, P.subject]];
  const metrics: unknown[][] = [[P.date, P.name, P.value]];
  const out = ['# Shutdown Complete', ''];
  for (const { key, value } of [...docs].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!value) continue;
    if (key.startsWith('day:')) {
      const d = value as DayDoc, date = key.slice(4);
      out.push(`## ${date}`, '');
      for (const b of d.columns?.findLast((c) => c.closedAt == null)?.blocks ?? []) {
        blocks.push([date, time(b.start), time(b.end), b.kind, b.label, b.subject]);
        out.push(`- ${time(b.start)}–${time(b.end)} ${md(b.label)} (${b.kind})${b.subject ? ' — ' + md(b.subject) : ''}`);
        if (b.note) out.push(`  ${md(b.note)}`);
      }
      for (const t of d.tasks ?? []) out.push(`- [${t.done ? 'x' : ' '}] ${md(t.text)}`);
      if (d.notes) out.push(`### ${P.notes}`, '', d.notes);
      for (const [id, v] of Object.entries(d.metrics ?? {})) {
        if (v == null) continue;
        metrics.push([date, names.get(id) ?? id, v]);
        out.push(`- ${md(names.get(id) ?? id)}: ${v}`);
      }
      out.push('');
    } else if (/^(week|month|quarter):/.test(key) || key === 'inbox') {
      const d = value as MonthDoc & WeekDoc & InboxDoc;
      out.push(`## ${key}`, '');
      for (const t of d.goals ?? d.items ?? []) out.push(`- [${t.done ? 'x' : ' '}] ${md(t.text)}`);
      if (d.notes) out.push(d.notes);
      out.push('');
    }
  }
  return format === 'markdown' ? out.join('\n') : csv(format === 'blocks' ? blocks : metrics);
}
