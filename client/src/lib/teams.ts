// Team projects (server/src/teams.mjs): the projects this account shares with friends. One store for the app, loaded
// when something shows them and refreshed every 20 seconds while it does; a project's own document is a planner
// document (key team:<id>) in the shared store (useDoc), fetched again every few seconds while it is open.
import { useEffect, useState } from 'react';
import { api } from './api';
import type { TeamDoc } from './model';

export interface TeamMember { id: string; name: string; role: 'owner' | 'member'; you: boolean }
export interface Team { id: string; role: 'owner' | 'member'; owner: boolean; members: TeamMember[]; value: TeamDoc; version: number; updatedAt: string }

let data: Team[] | null = null;
let failed = false;
const listeners = new Set<() => void>();
let timer = 0, users = 0;

export async function refreshTeams() {
  try { data = await api.teams(); failed = false; } catch { failed = data == null; }
  listeners.forEach((f) => f());
}
function schedule() {
  window.clearTimeout(timer);
  if (users > 0) timer = window.setTimeout(async () => { await refreshTeams(); schedule(); }, 20_000);
}

/** The team projects, or null until they have loaded (an empty list when the server cannot be reached). */
export function useTeams() {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((x) => x + 1);
    listeners.add(on);
    users++;
    refreshTeams();
    schedule();
    return () => { listeners.delete(on); users--; if (!users) window.clearTimeout(timer); };
  }, []);
  return failed ? [] : data;
}
