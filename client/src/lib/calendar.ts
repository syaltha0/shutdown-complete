import { useEffect, useState } from 'react';
import { useSettings } from '../App';
import { api } from './api';

/** One calendar event on one day, in this device's time zone (minutes since midnight). */
export interface CalEvent { uid?: string; location?: string; description?: string; title: string; start: number; end: number; allDay: boolean; cal: string }

export const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

// one request per range and set of calendars, shared by every screen that asks within a few minutes
const cache = new Map<string, { at: number; p: Promise<{ days: Record<string, CalEvent[]>; errors: { id: string; error: string }[] }> }>();
const FRESH = 5 * 60_000;

/** The linked calendars' events from one date to another (inclusive), by day; null while loading or with none linked. */
export function useCalendar(from: string, to: string, enabled = true) {
  const { settings } = useSettings();
  const cals = settings.calendars ?? [];
  const sig = cals.map((c) => `${c.id}:${c.url}`).join('|');
  const [data, setData] = useState<{ days: Record<string, CalEvent[]>; errors: { id: string; error: string }[] } | null>(null);
  useEffect(() => {
    if (!cals.length || !enabled) { setData(null); return; }
    let live = true;
    const key = `${from}|${to}|${sig}`;
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at > FRESH) {
      hit = { at: Date.now(), p: api.calendar(from, to, viewerZone()) };
      cache.set(key, hit);
      hit.p.catch(() => cache.delete(key));
    }
    hit.p.then((d) => { if (live) setData(d); }, () => { if (live) setData(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, sig, enabled]);
  return data;
}

/** Forget what was fetched, after a calendar is added or removed. */
export const refreshCalendars = () => cache.clear();

export const eventUid = (e: CalEvent) => e.uid || JSON.stringify([e.title, e.start, e.end]);
