// Types for planday.mjs, which the planner imports too.
export const MAX_DAY_START: number;
export function dayStartOf(settings: { dayStart?: unknown } | null | undefined): number;
export function planningParts(date: string, minute: number, dayStart?: number): { date: string; minute: number };
export function planningDay(now?: Date, dayStart?: number): string;
export function planningNow(now?: Date, dayStart?: number): number;
export function onPlanningScale(minute: number, dayStart?: number): number;
