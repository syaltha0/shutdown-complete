// Types for recur.mjs, which the planner imports too.
export interface RecurRule { every: number; unit: 'day' | 'week' | 'month' | 'year'; days?: number[]; after?: boolean; monthDay?: number; count?: number; until?: string }
interface Rollable { repeat?: RecurRule; due?: string; start?: string; steps?: { id: string; text: string; done: boolean }[]; doneCount?: number }
export function todayIso(): string;
export function addDaysIso(s: string, n: number): string;
export function weekdayOf(s: string): number;
export function nextDate(r: RecurRule, from: string): string;
export function onRuleDay(r: RecurRule, s: string): string;
export function rollOn<T extends Rollable>(t: T, now?: string): Partial<T> & { repeat: RecurRule; lastDone: string; doneCount: number; done?: boolean; doneAt?: string };
