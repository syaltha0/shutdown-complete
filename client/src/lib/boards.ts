// Boards (screens/boards): making a board from a template, the account's projects, cards due, a project's colour,
// stopwatches, when projects were opened. No React here except types.
import type { CSSProperties } from 'react';
import { parseISODate, today } from './dates';
import { uid, type Background, type Board, type BoardBg, type BoardsDoc, type Card, type LabelColor, type BoardTemplate, type Project, type ProjectData } from './model';
import type { Team } from './teams';
import type { Words } from './words/en';

export const COLORS: LabelColor[] = ['grey', 'blue', 'green', 'amber', 'red'];
export const BGS: BoardBg[] = ['ocean', 'forest', 'plum', 'slate', 'rust', 'ink'];
export const daysTo = (d: string) => Math.round((parseISODate(d).getTime() - parseISODate(today()).getTime()) / 86400000);

export type Template = 'flow' | 'study' | 'project' | 'week' | 'empty';
export const TEMPLATES: Template[] = ['flow', 'study', 'project', 'week', 'empty'];
/** A set of lists to start a board with: one of the planner's, or `custom:<id>`, one of the account's own. */
export type Kind = Template | `custom:${string}`;
export type TT = Words;
export const customOf = (kind: Kind, customs: BoardTemplate[]) => (kind.startsWith('custom:') ? customs.find((t) => t.id === kind.slice(7)) ?? null : null);

/** A new board: the lists of its template, and its labels (three to start with, or the template's own) and cards. */
export function makeBoard(name: string, kind: Kind, T: TT, customs: BoardTemplate[] = []): Board {
  const c = customOf(kind, customs);
  if (c) {
    const labels = c.labels.map((l) => ({ id: uid(), name: l.name, color: l.color }));
    const lid = (n: string) => labels.find((l) => l.name === n)?.id;
    return {
      id: uid(), name, created: today(), labels,
      lists: c.lists.map((l) => ({
        id: uid(), name: l.name,
        cards: (l.cards ?? []).map((k) => ({
          id: uid(), title: k.title, description: k.description ?? '', labels: (k.labels ?? []).map(lid).filter(Boolean) as string[],
          checklist: (k.checklist ?? []).map((text) => ({ id: uid(), text, done: false })), created: today(),
        })),
      })),
    };
  }
  kind = (TEMPLATES as string[]).includes(kind) ? kind : 'flow';
  return {
    id: uid(), name, created: today(),
    lists: T.kbTemplates[kind as Template].lists.map((n: string) => ({ id: uid(), name: n, cards: [] as Card[] })),
    labels: [
      { id: uid(), name: T.kbLabelDefaults[0], color: 'red' }, { id: uid(), name: T.kbLabelDefaults[1], color: 'blue' },
      { id: uid(), name: T.kbLabelDefaults[2], color: 'green' },
    ],
  };
}

/** The account's projects; the one list of boards kept before projects existed reads as one project until moved. */
export function personalProjects(doc: BoardsDoc | null, T: TT): Project[] {
  if (!doc) return [];
  if (doc.projects) return doc.projects;
  if (doc.boards?.length) return [{ id: 'first', name: T.kbFirstProject, boards: doc.boards, background: doc.boards[0]?.background, created: doc.boards[0]?.created ?? today() }];
  return [];
}

/** Every card on the boards that are due and not in their board's last list, with where each one is. */
export function cardsDue(personal: Project[], teams: Team[] | null) {
  const all = [
    ...personal.map((p) => ({ p: p as ProjectData, href: `/project/${p.id}` })),
    ...(teams ?? []).map((t) => ({ p: t.value, href: `/team/${t.id}` })),
  ];
  return all.flatMap(({ p, href }) => p.boards.flatMap((b) => b.lists.slice(0, -1).flatMap((l) => l.cards.filter((c) => c.due).map((c) => ({
    c, project: p.name, board: b.name, list: l.name, href: `${href}/${b.id}/${c.id}`,
  }))))).sort((x, y) => x.c.due!.localeCompare(y.c.due!));
}

export const HEX = /^#[0-9a-f]{6}$/i;

/** A colour's luminance (WCAG), `k` darkening it as the dark theme does (mixed with black). */
function luminance(hex: string, k = 1) {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) * k);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The grey with the same luminance as a colour. */
function toGrey(hex: string) {
  const l = luminance(hex), v = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${c}${c}${c}`;
}

/** Dark words read better than white ones on this colour. */
const wantsDarkInk = (hex: string, k = 1) => { const l = luminance(hex, k); return (l + 0.05) / 0.057 > 1.05 / (l + 0.05); };

/**
 * The class and style that put a project's background on an element: one of the tones by its class, a colour of
 * one's own through --kb-bg, with dark words when white would not read on it (worked out for each theme).
 */
export function bgLook(bg?: Background): { className: string; style?: CSSProperties } {
  if (!bg) return { className: '' };
  if (!HEX.test(bg)) return { className: ` has-bg bg-${bg}` };
  // a colour picked before the palette was narrowed shows as the grey of the same lightness (user, 2026-11-17)
  const grey = toGrey(bg);
  return {
    className: ` has-bg bg-own${wantsDarkInk(grey) ? ' ink-l' : ''}${wantsDarkInk(grey, 0.62) ? ' ink-d' : ''}`,
    style: { '--kb-bg': grey } as CSSProperties,
  };
}

/** A stopwatch's seconds, the running part included. */
export const watchSecs = (s: Card['stopwatch'], now = Date.now()) => (s ? s.total + (s.startedAt ? Math.max(0, Math.floor((now - s.startedAt) / 1000)) : 0) : 0);
const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
export const watchText = (sec: number) => `${Math.floor(sec / 3600)}:${two(Math.floor(sec / 60) % 60)}:${two(sec % 60)}`;

/** When each project was last opened on this device (for "recently opened"). */
const OPENED = 'sc-projects-opened';
export function openedAt(): Record<string, number> { try { return JSON.parse(localStorage.getItem(OPENED) || '{}'); } catch { return {}; } }
export function markOpened(id: string) { try { localStorage.setItem(OPENED, JSON.stringify({ ...openedAt(), [id]: Date.now() })); } catch { /* private window */ } }
