import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../App';
import { api, ApiError } from '../lib/api';
import { duration } from '../lib/dates';
import { settingsFocus, startFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';
import { showNotification } from '../lib/pwa';
import { navigate, usePath } from '../lib/router';
import { refreshSocial, useSocial, type RoomInfo } from '../lib/social';
import { IconX } from './Icons';

const minutesLeft = (r: { startsAt: string; minutes: number }) => Math.max(0, Math.ceil((Date.parse(r.startsAt) + r.minutes * 60_000 - Date.now()) / 60_000));

/** Join a shared session: this person's timer starts at the room's start, so everyone's ends together. */
export async function joinRoom(r: RoomInfo, fallback: string) {
  const room = await api.joinRoom(r.id);
  await startFocus({ blockId: null, label: room.label || fallback, minutes: room.minutes, startedAt: room.startsAt, roomId: room.id });
  refreshSocial();
}

/**
 * Focusing together, on the Focus screen: invitations to join, friends and whether they focus right now, a shared
 * session to start with some of them, adding a friend by e-mail address, and what this person lets friends see.
 */
export function FriendsPanel() {
  const T = useT();
  const S = useSocial(true);
  const { settings } = useSettings();
  const running = !!useFocusDay().active;
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  // the options (sharing, team friends): folded unless left open on this device; incoming requests stay in view either way
  const [optOpen, setOptOpenRaw] = useState(() => { try { return localStorage.getItem('sc-friends-options') === 'open'; } catch { return false; } });
  const setOptOpen = (v: boolean) => { setOptOpenRaw(v); try { localStorage.setItem('sc-friends-options', v ? 'open' : 'closed'); } catch { /* private window */ } };

  const [email, setEmail] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [len, setLen] = useState(settingsFocus(settings).focusMin);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((x) => x + 1), 30_000); return () => window.clearInterval(t); }, []);
  if (!S) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api.addFriend(email.trim()); setNote(T.friendAsked); setEmail(''); refreshSocial(); }
    catch (err) { setNote(err instanceof ApiError && err.code === 'self' ? T.friendSelf : T.friendFailed); }
  }
  async function ensureRoom() {
    if (S?.room?.isHost) return S.room.id;
    if (running) throw new Error();
    const room = await api.createRoom(len, chosen, '');
    await startFocus({ blockId: null, label: T.togetherLabel, minutes: room.minutes, startedAt: room.startsAt, roomId: room.id });
    setPicking(false); setChosen([]);
    await refreshSocial();
    return room.id;
  }
  async function together(userId?: string) {
    setBusy(true); setNote(null);
    try {
      const id = await ensureRoom();
      if (userId) { await api.inviteOnline(id, userId); setNote(T.togetherSent); }
      else setLink(location.origin + (await api.roomLink(id)).path);
      await refreshSocial();
    } catch { setNote(T.friendFailed); }
    finally { setBusy(false); }
  }
  const status = (f: (typeof S.friends)[number]) => {
    if (!f.status) return T.friendIdle;
    const left = f.status.endsAt ? Math.max(0, Math.ceil((Date.parse(f.status.endsAt) - Date.now()) / 60_000)) : null;
    const what = f.status.state === 'paused' ? T.friendPaused : f.status.state === 'focus' ? T.friendFocusing : T.friendBreak;
    return [what, left != null ? T.minutesLeft(duration(left)) : '', f.status.label, S.room && f.status.roomId === S.room.id ? T.sameRoom : ''].filter(Boolean).join(' · ');
  };

  return (
    <section className="panel friends" aria-labelledby="fr-h" data-anim>
      <header>
        <h2 id="fr-h">{T.together}</h2>
        <button type="button" className="friends-opt" aria-expanded={optOpen} aria-controls="fr-options" onClick={() => setOptOpen(!optOpen)}>
          {T.friendsOptions}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
      </header>
      <div className="together-form">
        <label className="sr-only" htmlFor="together-length">{T.lengthLabel}</label>
        <select id="together-length" className="input num" value={len} disabled={running} onChange={(e) => setLen(Number(e.target.value))}>
          {[15,25,30,45,50,60,90].map((m) => <option key={m} value={m}>{T.minShort(m)}</option>)}
        </select>
        <button type="button" className="btn" disabled={busy || (running && !S.room?.isHost)} onClick={() => together()}>{T.togetherLink}</button>
      </div>
      {link && <label className="together-link">{T.togetherLinkHint}<input className="input" readOnly value={link} onFocus={(e) => e.target.select()} /></label>}
      <div className={`friends-online${S.online.length ? '' : ' is-empty'}`}>
        <h3>{T.onlinePeople}</h3>
        {S.online.length ? <ul className="friend-list">{S.online.map((u) => <li key={u.id}><i className="dot" aria-hidden="true" /><b>{u.name}</b><button className="btn" disabled={busy || (running && !S.room?.isHost)} onClick={() => together(u.id)}>{T.inviteFriend(u.name)}</button></li>)}</ul> : <p className="muted friends-empty">{T.onlineNone}</p>}
      </div>
      {S.invites.map((r) => (
        <div className="invite-row" key={r.id}>
          <span><b>{T.roomInvite(r.host, r.minutes)}</b><small className="muted">{T.roomLeft(duration(minutesLeft(r)))}{r.people.length > 1 ? ` · ${T.roomWith(r.people.join(', '))}` : ''}</small></span>
          <span className="row-actions">
            <button type="button" className="btn primary" disabled={running} onClick={() => joinRoom(r, T.togetherLabel)}>{T.join}</button>
            <button type="button" className="btn ghost" onClick={() => api.declineRoom(r.id).then(refreshSocial)}>{T.decline}</button>
          </span>
        </div>
      ))}
      {S.incoming.length > 0 && (
        <div className="requests">
          {S.incoming.map((r) => (
            <div className="invite-row" key={r.id}>
              <span><b>{r.name}</b><small className="muted">{T.wantsFriend(r.email)}</small></span>
              <span className="row-actions">
                <button type="button" className="btn primary" onClick={() => api.acceptFriend(r.id).then(refreshSocial)}>{T.accept}</button>
                <button type="button" className="btn ghost" onClick={() => api.removeFriend(r.id).then(refreshSocial)}>{T.decline}</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {optOpen && <div className="friends-options" id="fr-options">
        <div className="share-opts">
          <label className="switch-row"><input type="checkbox" className="switch" checked={S.share.online} onChange={(e) => api.shareFocus({ online: e.target.checked }).then(refreshSocial)} />{T.showOnline}</label>
          <label className="switch-row"><input type="checkbox" className="switch" checked={S.share.focus} onChange={(e) => api.shareFocus({ focus: e.target.checked }).then(refreshSocial)} />{T.shareFocus}</label>
          <label className="switch-row"><input type="checkbox" className="switch" checked={S.share.label} disabled={!S.share.focus} aria-describedby={S.share.focus ? undefined : 'fr-label-off'} onChange={(e) => api.shareFocus({ label: e.target.checked }).then(refreshSocial)} />{T.shareLabel}</label>
          {!S.share.focus && <small className="muted share-why" id="fr-label-off">{T.shareLabelOff}</small>}
        </div>

        <h3>{T.teamFriends}</h3>
        {S.friends.length === 0 ? <p className="muted friends-empty">{T.friendsNone}</p> : (
          <ul className="friend-list">
            {S.friends.map((f) => (
              <li key={f.id} className={f.status && f.status.state === 'focus' ? 'on' : undefined}>
                <i className="dot" aria-hidden="true" />
                <span className="who"><b>{f.name}</b><small className="muted">{status(f)}</small></span>
                {picking && (
                  <label className="pick"><input type="checkbox" className="check" checked={chosen.includes(f.id)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, f.id] : c.filter((x) => x !== f.id)))} /><span className="sr-only">{T.inviteFriend(f.name)}</span></label>
                )}
              </li>
            ))}
          </ul>
        )}

        {S.friends.length > 0 && !running && (picking ? (
          <div className="together-form">
            <label htmlFor="tg-len" className="sr-only">{T.lengthLabel}</label>
            <select id="tg-len" className="input num" value={len} onChange={(e) => setLen(Number(e.target.value))}>
              {[15, 25, 30, 45, 50, 60, 90].map((m) => <option key={m} value={m}>{T.minShort(m)}</option>)}
            </select>
            <button type="button" className="btn primary" disabled={!chosen.length} onClick={() => together()}>{T.startTogether}</button>
            <button type="button" className="btn ghost" onClick={() => { setPicking(false); setChosen([]); }}>{T.cancel}</button>
          </div>
        ) : <button type="button" className="btn" onClick={() => setPicking(true)}>{T.focusTogether}</button>)}

        {S.outgoing.length > 0 && (
          <div className="requests">
            {S.outgoing.map((r) => (
              <div className="invite-row" key={r.id}>
                <span><b>{r.email}</b><small className="muted">{T.friendWaiting}</small></span>
                <button type="button" className="btn ghost icon" aria-label={T.cancelRequest(r.email)} onClick={() => api.removeFriend(r.id).then(refreshSocial)}><IconX /></button>
              </div>
            ))}
          </div>
        )}

        <form className="friend-add" onSubmit={add}>
          <label htmlFor="fr-email" className="sr-only">{T.addFriend}</label>
          <input id="fr-email" className="input" type="email" placeholder={T.friendEmailPh} value={email} onChange={(e) => { setEmail(e.target.value); setNote(null); }} />
          <button type="submit" className="btn" disabled={!email.includes('@')}>{T.addFriend}</button>
        </form>
        {note && <p className="muted friend-note-line" role="status">{note}</p>}
      </div>}
    </section>
  );
}

/**
 * In the shell: an invitation to a shared session shows as a note at the foot of any screen (and a notification
 * when the planner is in the background), so a friend's call is not missed while planning elsewhere.
 */
export function FriendsWatcher() {
  const T = useT();
  const S = useSocial(false);
  const path = usePath();
  const focusing = !!useFocusDay().active;
  const seen = useRef(new Set<string>());
  const [gone, setGone] = useState<string[]>([]);
  const [linkError, setLinkError] = useState(false);
  const attempted = useRef(false);
  useEffect(() => {
    const token = sessionStorage.getItem('together');
    if (!token || attempted.current || focusing) return;
    attempted.current = true;
    api.redeemRoom(token).then(async (r) => {
      sessionStorage.removeItem('together');
      await startFocus({ blockId: null, label: r.label || T.togetherLabel, minutes: r.minutes, startedAt: r.startsAt, roomId: r.id });
      refreshSocial(); navigate('/focus');
    }).catch(() => { sessionStorage.removeItem('together'); setLinkError(true); });
  }, [focusing, T.togetherLabel]);
  const invite = S?.invites.find((r) => !gone.includes(r.id)) ?? null;
  useEffect(() => {
    for (const r of S?.invites ?? []) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      showNotification(T.roomInvite(r.host, r.minutes), T.roomLeft(duration(minutesLeft(r))), '/focus', 'room');
    }
  }, [S?.invites]); // eslint-disable-line react-hooks/exhaustive-deps
  if (linkError) return <div className="friend-note" role="alert">{T.togetherGone}<button className="btn" onClick={() => setLinkError(false)}>{T.close}</button></div>;
  if (!invite || path.startsWith('/focus') || focusing) return null;
  return (
    <div className="friend-note" role="status">
      <span>{T.roomInvite(invite.host, invite.minutes)}</span>
      <button type="button" className="btn primary" onClick={() => joinRoom(invite, T.togetherLabel).then(() => navigate('/focus'))}>{T.join}</button>
      <button type="button" className="btn ghost" onClick={() => api.declineRoom(invite.id).then(() => { setGone((g) => [...g, invite.id]); refreshSocial(); })}>{T.decline}</button>
    </div>
  );
}
