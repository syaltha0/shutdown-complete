import { clearOfflineData } from './pwa';

export interface Doc<T> {
  key: string;
  value: T | null;
  version: number;
  updatedAt: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  verified: boolean;
  totp: boolean;
  recoveryLeft: number;
  /** a new password before anything else: 1 = the password rules got stricter, 2 = a temporary password */
  mustChange?: 0 | 1 | 2;
}

export type PasswordPolicy = 'basic' | 'strong';

export interface AuthState {
  setup: boolean;
  /** anyone may sign up */
  signups: boolean;
  /** only people with an invite link may sign up */
  invites: boolean;
  /** new accounts wait for the owner's approval */
  approval: boolean;
  /** with open sign-ups, the e-mail domains that may sign up (empty: any) */
  domains: string[];
  /** a few lines from the owner for the sign-up page */
  note?: string;
  /** for the owner: how many accounts wait for approval and people ask for an invite */
  attention?: number;
  /** a signed note of when the sign-up form was handed out (bots send it back too soon) */
  form?: string;
  /** the rules a new password must meet */
  policy?: PasswordPolicy;
  mail: boolean;
  source: string;
  user: User | null;
}

export interface SessionInfo {
  id: string;
  device: string;
  ip: string;
  created: string;
  lastSeen: string;
  remember: boolean;
  current: boolean;
}

export type SignupMode = 'open' | 'approve' | 'invite' | 'closed';
export interface Invite { id: string; created: string; expires: string | null; maxUses: number | null; uses: number; note: string; email: string; live: boolean }
export interface InviteRequest { id: string; email: string; note: string; created: string }
export interface AdminUser { id: string; email: string; name: string; isAdmin: boolean; verified: boolean; totp: boolean; approved: boolean; created: string; mustChange?: boolean }
export interface AdminState {
  signups: boolean;
  mode: SignupMode;
  domains: string[];
  note: string;
  mail: boolean;
  users: AdminUser[];
  requests: InviteRequest[];
  invites: Invite[];
  policy: PasswordPolicy;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
  /** the server's short error code (wrong, too-many, bad-code…) */
  get code(): string { return this.body?.error || 'other'; }
}

// Anything that gets a 401 on a signed-in call tells the app to show the sign-in screen.
export const signedOut = new EventTarget();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new ApiError(0, 'offline', { error: 'other' });
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/account/password') && !path.startsWith('/api/account/totp') && !path.startsWith('/api/account/delete')) {
    signedOut.dispatchEvent(new Event('signedout'));
  }
  if (!res.ok) throw new ApiError(res.status, body?.error || res.statusText, body);
  return body as T;
}

export interface WeekReviewData {
  week: string; from: string; to: string; mail: boolean;
  days: { date: string; planned: number; deep: number; focused: number; sessions: number; shutdown: boolean; tasksDone: number; tasksAll: number; revisions: number }[];
  totals: { planned: number; deep: number; focused: number; sessions: number; shutdowns: number; tasksDone: number; tasksAll: number; listDone: number; revisions: number };
  plan: { done: number; total: number };
  habits: { name: string; days: number }[];
  focusOn: { name: string; minutes: number }[];
  prev: { focused: number; deep: number; shutdowns: number; tasksDone: number };
}
export interface BackupState { list: { name: string; size: number; at: string; kind: 'auto' | 'manual' | 'before-restore' | 'upload' }[]; keep: number; hour: number }
export interface DavInfo { url: string; user: string; passwords: { id: string; name: string; created: string; lastUsed: string | null }[] }
export interface SyncRun { at: string; durationMs: number; ok: boolean; error: string | null; lists: { id: string; name: string; received: number; sent: number; deleted: number; skipped: number }[]; errors: { listId: string | null; title: string; status: number | null; reason: string }[] }
export interface NextcloudLink { history: SyncRun[]; url: string; username: string; lastSync: string | null; error: string | null; lists: number; routes: { id: string; name: string; published: boolean }[] }

const post = <T>(path: string, data: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(data) });

export const api = {
  calendarFeed: () => request<{ timezone: string; tasks: number } | null>('/api/account/calendar-feed'),
  createCalendarFeed: (timezone: string, tasks: boolean) => post<{ path: string }>('/api/account/calendar-feed', { timezone, tasks }),
  disableCalendarFeed: () => request('/api/account/calendar-feed', { method: 'DELETE' }),
  pushInfo: (endpoint = '') => request<{ publicKey: string; subscribed: boolean }>(`/api/push?endpoint=${encodeURIComponent(endpoint)}`),
  pushSubscribe: (subscription: PushSubscription) => post('/api/push', { ...subscription.toJSON(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  pushRemove: (endpoint: string) => request('/api/push', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  // documents
  get: <T>(key: string) => request<Doc<T>>(`/api/doc/${encodeURIComponent(key)}`),
  put: <T>(key: string, value: T, version: number, keepalive = false) =>
    request<Doc<T>>(`/api/doc/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value, version }), keepalive }),
  range: <T>(from: string, to: string) =>
    request<Doc<T>[]>(`/api/docs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  import: (data: unknown) => post<{ ok: true; count: number }>('/api/import', data),

  // focusing together
  teams: () => request<import('./teams').Team[]>('/api/teams'),
  createTeam: (d: { name: string; description: string }) => post<import('./teams').Team>('/api/teams', d),
  addTeamMember: (team: string, id: string) => post<import('./teams').Team>(`/api/teams/${encodeURIComponent(team)}/members`, { id }),
  removeTeamMember: (team: string, id: string) => request<{ ok: true }>(`/api/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteTeam: (team: string) => request<{ ok: true }>(`/api/teams/${encodeURIComponent(team)}`, { method: 'DELETE' }),
  friends: () => request<import('./social').Social>('/api/friends'),
  addFriend: (email: string) => post<{ ok: true }>('/api/friends', { email }),
  acceptFriend: (id: string) => post<{ ok: true }>(`/api/friends/${encodeURIComponent(id)}/accept`),
  removeFriend: (id: string) => request<{ ok: true }>(`/api/friends/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  shareFocus: (d: { online?: boolean; focus?: boolean; label?: boolean }) => request<{ focus: boolean; label: boolean }>('/api/friends/share', { method: 'PUT', body: JSON.stringify(d) }),
  presence: (d: { state: string; label: string; endsAt: string | null; roomId: string | null } | null) =>
    request<{ ok: true }>('/api/presence', { method: 'PUT', body: JSON.stringify(d ?? {}) }),
  createRoom: (minutes: number, invite: string[], label: string) => post<{ id: string; startsAt: string; minutes: number }>('/api/rooms', { minutes, invite, label }),
  roomLink: (id: string) => post<{ path: string }>(`/api/rooms/${encodeURIComponent(id)}/link`),
  inviteOnline: (id: string, userId: string) => post(`/api/rooms/${encodeURIComponent(id)}/invite`, { userId }),
  redeemRoom: (token: string) => post<{ id: string; startsAt: string; minutes: number; label: string }>('/api/room-links/join', { token }),
  joinRoom: (id: string) => post<{ id: string; startsAt: string; minutes: number; label: string }>(`/api/rooms/${encodeURIComponent(id)}/join`),
  declineRoom: (id: string) => request<{ ok: true }>(`/api/rooms/${encodeURIComponent(id)}/invite`, { method: 'DELETE' }),

  // calendars to plan around
  calendar: (from: string, to: string, tz: string) =>
    request<{ days: Record<string, { title: string; start: number; end: number; allDay: boolean; cal: string }[]>; errors: { id: string; error: string }[] }>(
      `/api/calendar?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`),
  checkCalendar: (url: string, tz: string) => post<{ ok: true; upcoming: number }>('/api/calendar/check', { url, tz }),

  // sign-in and sign-up
  state: () => request<AuthState>('/api/auth/state'),
  setup: (d: { name?: string; email: string; password: string; signupMode?: SignupMode; lang: string }) => post<{ ok: true; claimed: number }>('/api/auth/setup', d),
  register: (d: { name?: string; email: string; password: string; lang: string; invite?: string; website: string; form?: string }) =>
    post<{ ok?: true; verify?: true; pending?: true }>('/api/auth/register', d),
  requestInvite: (d: { email: string; note: string; lang: string; website: string; form?: string }) => post<{ ok: true; mail: boolean }>('/api/auth/request-invite', d),
  checkInvite: (token: string) => request<{ valid: boolean; email?: string }>(`/api/auth/invite?token=${encodeURIComponent(token)}`),
  verify: (token: string) => post<{ ok?: true; pending?: true }>('/api/auth/verify', { token }),
  resend: (email: string) => post<{ ok: true }>('/api/auth/resend', { email }),
  login: (email: string, password: string, remember: boolean) => post<{ ok?: true; twoFactor?: true; ticket?: string }>('/api/auth/login', { email, password, remember }),
  login2fa: (ticket: string, code: string) => post<{ ok: true }>('/api/auth/login/2fa', { ticket, code }),
  logout: async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) { await api.pushRemove(sub.endpoint); await sub.unsubscribe(); }
    return post<{ ok: true }>('/api/auth/logout').finally(() => clearOfflineData());
  },
  forgot: (email: string, lang: string) => post<{ ok: true; mail: boolean }>('/api/auth/forgot', { email, lang }),
  reset: (token: string, password: string) => post<{ ok: true }>('/api/auth/reset', { token, password }),

  // the account
  account: () => request<User & { mail: boolean }>('/api/account'),
  updateAccount: (d: { name?: string; lang?: string }) => request<User>('/api/account', { method: 'PATCH', body: JSON.stringify(d) }),
  changePassword: (current: string, password: string) => post<{ ok: true }>('/api/account/password', { current, password }),
  sessions: () => request<SessionInfo[]>('/api/account/sessions'),
  endSession: (id: string) => request<{ ok: true }>(`/api/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  endOtherSessions: () => post<{ ok: true }>('/api/account/sessions/others'),
  totpStart: () => post<{ secret: string; uri: string; qr: string }>('/api/account/totp/start'),
  totpEnable: (code: string) => post<{ ok: true; recoveryCodes: string[] }>('/api/account/totp/enable', { code }),
  totpDisable: (password: string) => post<{ ok: true }>('/api/account/totp/disable', { password }),
  totpRecovery: (password: string) => post<{ recoveryCodes: string[] }>('/api/account/totp/recovery', { password }),
  deleteAccount: (password: string) => post<{ ok: true }>('/api/account/delete', { password }),

  review: (week: string) => request<WeekReviewData>(`/api/review/${encodeURIComponent(week)}`),
  backups: () => request<BackupState>('/api/admin/backups'),
  backupNow: () => post<BackupState>('/api/admin/backups'),
  backupUpload: (file: Blob) => request<BackupState & { name: string }>('/api/admin/backups/upload', { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } }),
  backupRestore: (name: string, password: string) => post<{ ok: true; restarting: boolean }>(`/api/admin/backups/${encodeURIComponent(name)}/restore`, { password }),
  scheduleFromIcs: (ics: string, tz: string) => post<{ slots: { title: string; days: number[]; start: number; end: number }[] }>('/api/schedule/ics', { ics, tz }),
  // task apps over CalDAV, and the link to a Nextcloud
  appPasswords: () => request<DavInfo>('/api/account/app-passwords'),
  appPasswordAdd: (name: string) => post<DavInfo & { password: string }>('/api/account/app-passwords', { name }),
  appPasswordRemove: (id: string) => request<DavInfo>(`/api/account/app-passwords/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  nextcloud: () => request<NextcloudLink | null>('/api/account/nextcloud'),
  nextcloudPublish: (id: string, published: boolean) => request<NextcloudLink>(`/api/account/nextcloud/lists/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ published }) }),
  nextcloudLink: (b: { url: string; username: string; password: string }) => request<NextcloudLink>('/api/account/nextcloud', { method: 'PUT', body: JSON.stringify(b) }),
  nextcloudSync: () => post<NextcloudLink>('/api/account/nextcloud/sync'),
  nextcloudUnlink: () => request<null>('/api/account/nextcloud', { method: 'DELETE' }),
  // passkeys
  passkeys: () => request<{ id: string; name: string; created: string; lastUsed: string | null }[]>('/api/account/passkeys'),
  passkeyCreateOptions: () => post<{
    challenge: string; rp: { name: string; id: string }; user: { id: string; name: string; displayName: string };
    pubKeyCredParams: { type: 'public-key'; alg: number }[]; authenticatorSelection: AuthenticatorSelectionCriteria;
    excludeCredentials: { type: 'public-key'; id: string; transports: AuthenticatorTransport[] }[]; attestation: AttestationConveyancePreference; timeout: number;
  }>('/api/account/passkeys/options'),
  passkeyAdd: (name: string, credential: unknown) => post<{ ok: true }>('/api/account/passkeys', { name, credential }),
  passkeyRemove: (id: string) => request<{ ok: true }>(`/api/account/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  passkeyLoginOptions: () => post<{ challenge: string; rpId: string; timeout: number; userVerification: string }>('/api/auth/passkey/options'),
  passkeyLogin: (credential: unknown) => post<{ ok: true }>('/api/auth/passkey', { credential }),

  // the owner's settings
  adminState: () => request<AdminState>('/api/admin/state'),
  setSignupMode: (mode: SignupMode) => request<{ signups: boolean; mode: SignupMode; domains: string[] }>('/api/admin/state', { method: 'PUT', body: JSON.stringify({ mode }) }),
  setDomains: (domains: string) => request<{ signups: boolean; mode: SignupMode; domains: string[] }>('/api/admin/state', { method: 'PUT', body: JSON.stringify({ domains }) }),
  approveUser: (id: string) => post<{ users: AdminUser[] }>(`/api/admin/users/${encodeURIComponent(id)}/approve`),
  declineUser: (id: string) => request<{ users: AdminUser[] }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createInvite: (d: { uses: number; days: number; note: string; email: string; lang: string }) => post<{ id: string; link: string; sent: boolean; invites: Invite[] }>('/api/admin/invites', d),
  setSignupNote: (note: string) => request<{ note: string }>('/api/admin/state', { method: 'PUT', body: JSON.stringify({ note }) }),
  inviteRequest: (id: string) => post<{ link: string; sent: boolean; email: string; requests: InviteRequest[]; invites: Invite[] }>(`/api/admin/requests/${encodeURIComponent(id)}/invite`),
  declineRequest: (id: string) => request<{ requests: InviteRequest[] }>(`/api/admin/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setPasswordPolicy: (policy: PasswordPolicy, current?: string, password?: string) =>
    request<{ policy: PasswordPolicy; changed?: boolean }>('/api/admin/password-policy', { method: 'PUT', body: JSON.stringify({ policy, current, password }) }),
  revokeInvite: (id: string) => request<{ invites: Invite[] }>(`/api/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
