// Pieces the board screens share: the personal boards document, board templates, pop-overs, faces, a ticking clock.
import { useEffect, useState } from 'react';
import { useT } from '../../lib/i18n';
import { emptyBoards, uid, type BoardsDoc, type BoardTemplate } from '../../lib/model';
import { insertAt } from '../../lib/undo';
import { useDoc } from '../../lib/useDoc';
import { personalProjects } from '../../lib/boards';
export { Pop } from '../../components/Pop';

/** The personal boards document, its old single list moved into a first project the first time it is opened. */
export function usePersonal() {
  const T = useT();
  const d = useDoc<BoardsDoc>('boards', emptyBoards);
  const doc = d.value;
  useEffect(() => {
    if (doc && !doc.projects) {
      d.update((x) => (x.projects ? x : { favorites: x.favorites, templates: x.templates, projects: personalProjects(x, T).map((p) => ({ ...p, id: p.id === 'first' ? uid() : p.id })) }));
    }
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...d, projects: personalProjects(doc, T) };
}

/** Re-render once a second while something on screen is timing. */
export function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => set((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

/** Round initials for the people in a team project. */
export function Faces({ members, max = 4 }: { members: { id: string; name: string }[]; max?: number }) {
  return (
    <span className="kb-faces" aria-hidden="true">
      {members.slice(0, max).map((m) => <i key={m.id} title={m.name}>{(m.name.trim()[0] ?? '?').toLocaleUpperCase()}</i>)}
      {members.length > max && <i className="more">+{members.length - max}</i>}
    </span>
  );
}

/** The account's board templates and how to keep them. */
export function useBoardTemplates() {
  const { value: doc, update } = usePersonal();
  const templates = doc?.templates ?? [];
  const save = (t: BoardTemplate) => update((d) => ({ ...d, templates: (d.templates ?? []).some((x) => x.id === t.id) ? (d.templates ?? []).map((x) => (x.id === t.id ? t : x)) : [...(d.templates ?? []), t] }));
  const remove = (id: string) => update((d) => ({ ...d, templates: (d.templates ?? []).filter((x) => x.id !== id) }));
  const restore = (t: BoardTemplate, at: number) => update((d) => ({ ...d, templates: insertAt(d.templates ?? [], at, t) }));
  return { templates, save, remove, restore, loaded: !!doc };
}
