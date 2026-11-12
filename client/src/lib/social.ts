// Focusing together (server/src/social.mjs): friends on this server, whether they are focusing now, invitations to a
// shared session. One store for the whole app, refreshed every 30 seconds (every 10 while the Focus screen or the
// room is open), so the shell's invitation note and the Focus screen agree.
import { useEffect, useState } from 'react';
import { api } from './api';

export interface FriendStatus { state: 'focus' | 'short' | 'long' | 'paused'; endsAt: string | null; label: string; roomId: string | null }
export interface Friend { id: string; name: string; status: FriendStatus | null }
export interface RoomInfo { id: string; host: string; minutes: number; startsAt: string; label: string; people: string[] }
export interface Social {
  friends: Friend[];
  incoming: { id: string; name: string; email: string }[];
  outgoing: { id: string; name: string; email: string }[];
  invites: RoomInfo[];
  room: RoomInfo | null;
  share: { focus: boolean; label: boolean };
}

let data: Social | null = null;
const listeners = new Set<() => void>();
let timer = 0, fast = 0;

export async function refreshSocial() {
  try { data = await api.friends(); listeners.forEach((f) => f()); } catch { /* offline or signed out: keep the last */ }
}
function schedule() {
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => { await refreshSocial(); schedule(); }, fast > 0 ? 10_000 : 30_000);
}

/** The shared store; `quick` asks for the faster refresh while the caller is on screen. */
export function useSocial(quick = false) {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((x) => x + 1);
    listeners.add(on);
    if (quick) fast++;
    if (!data) refreshSocial();
    schedule();
    return () => { listeners.delete(on); if (quick) fast--; };
  }, [quick]);
  return data;
}
