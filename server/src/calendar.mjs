// Calendars to plan around: an account can link the read-only subscription (ICS) address of a Google, Outlook or iCloud
// calendar, and the day's grid shows its events so the plan is drawn around them (fixed appointments first).
// The server fetches the feed (a browser cannot, across sites), reads it, unrolls repeating events, and hands back the
// events of a few days in the person's own time zone, as minutes of each day. Nothing is ever written to a calendar.
//
// A feed address comes from a user, so the fetch is careful: http(s) only, no addresses on this machine or its private
// network (the planner must not become a way to reach them), a short timeout, a size cap, a few redirects at most.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const TIMEOUT = 10_000, MAX_BYTES = 5 * 1024 * 1024, CACHE_MS = 10 * 60_000, MAX_DAYS = 62;

// ---------------- fetching, safely ----------------
function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Why a feed address cannot be used ('url', 'private'), or null. */
export async function feedProblem(raw) {
  let u;
  try { u = new URL(String(raw).trim().replace(/^webcals?:\/\//i, 'https://')); } catch { return 'url'; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return 'url';
  if (process.env.CALENDAR_ALLOW_PRIVATE === 'on') return null; // for the tools' local test feeds only
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'private';
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return 'private';
  } catch { return 'unreachable'; }
  return null;
}

async function fetchFeed(raw) {
  let url = String(raw).trim().replace(/^webcals?:\/\//i, 'https://');
  for (let hop = 0; hop < 4; hop++) {
    const problem = await feedProblem(url);
    if (problem) throw Object.assign(new Error(problem), { code: problem });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1', 'user-agent': 'ShutdownComplete-calendar/1' } });
    } catch { clearTimeout(timer); throw Object.assign(new Error('unreachable'), { code: 'unreachable' }); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), url).href;
      continue;
    }
    if (!res.ok) { clearTimeout(timer); throw Object.assign(new Error('unreachable'), { code: res.status === 401 || res.status === 403 || res.status === 404 ? 'denied' : 'unreachable' }); }
    // read at most MAX_BYTES
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { ctl.abort(); throw Object.assign(new Error('too-big'), { code: 'too-big' }); }
        chunks.push(value);
      }
    } finally { clearTimeout(timer); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw Object.assign(new Error('not-calendar'), { code: 'not-calendar' });
    return text;
  }
  throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
}

// ---------------- reading the feed ----------------
const unescape = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

/** The lines of a feed, unfolded, as { name, params, value }. */
function* lines(text) {
  const raw = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  for (const line of raw) {
    const i = line.search(/[:]/);
    if (i < 0) continue;
    const head = line.slice(0, i), value = line.slice(i + 1);
    const [name, ...ps] = head.split(';');
    const params = {};
    for (const p of ps) { const [k, v = ''] = p.split('='); params[k.toUpperCase()] = v.replace(/^"|"$/g, ''); }
    yield { name: name.toUpperCase(), params, value };
  }
}

// Outlook and Exchange name zones the Windows way
const WINDOWS_ZONES = {
  'turkey standard time': 'Europe/Istanbul', 'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik',
  'w. europe standard time': 'Europe/Berlin', 'central europe standard time': 'Europe/Budapest', 'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris', 'e. europe standard time': 'Europe/Chisinau', 'fle standard time': 'Europe/Kiev',
  'gtb standard time': 'Europe/Bucharest', 'russian standard time': 'Europe/Moscow', 'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago', 'mountain standard time': 'America/Denver', 'pacific standard time': 'America/Los_Angeles',
  'india standard time': 'Asia/Kolkata', 'china standard time': 'Asia/Shanghai', 'tokyo standard time': 'Asia/Tokyo',
  'aus eastern standard time': 'Australia/Sydney', 'arabian standard time': 'Asia/Dubai', 'arab standard time': 'Asia/Riyadh',
  'israel standard time': 'Asia/Jerusalem', 'egypt standard time': 'Africa/Cairo', 'south africa standard time': 'Africa/Johannesburg',
  'utc': 'UTC', 'coordinated universal time': 'UTC',
};
function zone(tzid) {
  if (!tzid) return null;
  const t = tzid.replace(/^\/[^/]*\/[^/]*\//, ''); // "/mozilla.org/20050126_1/Europe/Istanbul" style prefixes
  const name = WINDOWS_ZONES[t.toLowerCase()] || t;
  try { new Intl.DateTimeFormat('en', { timeZone: name }); return name; } catch { return null; }
}

/** Wall-clock parts of an instant in a zone. */
function partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
/** The instant of a wall-clock time in a zone. */
function zonedToUtc(w, tz) {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s || 0);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(t, tz);
    const asIf = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    t = guess - (asIf - t);
  }
  return t;
}

/** A DTSTART/DTEND/EXDATE value as { wall, tz, utc, allDay } (floating times take the viewer's zone later). */
function when(value, params) {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const wall = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  if (!m[4] || params.VALUE === 'DATE') return { wall, allDay: true };
  if (m[7]) return { wall, tz: 'UTC', allDay: false };
  return { wall, tz: zone(params.TZID), allDay: false };
}

/** The events of a feed: { uid, title, start, end, rrule, exdates, recurrenceId, cancelled } */
export function parseFeed(text) {
  const events = [];
  let ev = null;
  for (const { name, params, value } of lines(text)) {
    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') { ev = { exdates: [] }; continue; }
    if (name === 'END' && value.toUpperCase() === 'VEVENT') { if (ev && ev.start) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    if (name === 'UID') ev.uid = value.trim();
    else if (name === 'SUMMARY') ev.title = unescape(value);
    else if (name === 'DTSTART') ev.start = when(value, params);
    else if (name === 'DTEND') ev.end = when(value, params);
    else if (name === 'DURATION') ev.duration = value.trim();
    else if (name === 'RRULE') ev.rrule = Object.fromEntries(value.split(';').map((kv) => { const [k, v] = kv.split('='); return [k.toUpperCase(), v]; }));
    else if (name === 'EXDATE') for (const x of value.split(',')) { const w = when(x, params); if (w) ev.exdates.push(w); }
    else if (name === 'RECURRENCE-ID') ev.recurrenceId = when(value, params);
    else if (name === 'STATUS') ev.cancelled = value.trim().toUpperCase() === 'CANCELLED';
    else if (name === 'TRANSP') ev.free = value.trim().toUpperCase() === 'TRANSPARENT';
  }
  return events;
}

// ---------------- unrolling repeats ----------------
const DAY = 86_400_000;
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const wallMs = (w) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s || 0); // a wall time read as if it were UTC, for stepping
const fromWallMs = (ms) => { const d = new Date(ms); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }; };
function parseDuration(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || '').trim());
  if (!m) return null;
  return ((+(m[2] || 0) * 7 + +(m[3] || 0)) * 86400 + +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
}

/** The wall-clock starts of an event's occurrences that may touch [fromWall, toWall] (wall ms, in the event's zone). */
function occurrences(ev, fromWall, toWall) {
  const first = wallMs(ev.start.wall);
  if (!ev.rrule) return [first];
  const r = ev.rrule, freq = r.FREQ, interval = Math.max(1, +(r.INTERVAL || 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  let until = Infinity;
  if (r.UNTIL) { const u = when(r.UNTIL, {}); if (u) until = u.tz === 'UTC' && ev.start.tz && ev.start.tz !== 'UTC' ? wallMs(partsIn(wallMs(u.wall), ev.start.tz)) : wallMs(u.wall) + (u.allDay ? DAY - 1 : 0); }
  const byDay = r.BYDAY ? r.BYDAY.split(',').map((x) => { const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x); return m ? { n: m[1] ? +m[1] : 0, dow: DOW.indexOf(m[2]) } : null; }).filter(Boolean) : null;
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const out = [];
  let n = 0;
  const take = (t) => { if (t < first || t > until || n >= count) return false; n++; if (t <= toWall) out.push(t); return true; };
  const start = new Date(first);
  const hms = first % DAY;
  for (let step = 0, guard = 0; guard < 5000; step += interval, guard++) {
    let cands = [];
    if (freq === 'DAILY') cands = [first + step * DAY];
    else if (freq === 'WEEKLY') {
      const weekStart = first - ((start.getUTCDay() + 6) % 7) * DAY + step * 7 * DAY; // Monday of that week
      cands = (byDay ? byDay.map((b) => (b.dow + 6) % 7) : [(start.getUTCDay() + 6) % 7]).sort((a, b) => a - b).map((k) => weekStart + k * DAY);
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const y0 = start.getUTCFullYear(), m0 = start.getUTCMonth();
      const months = freq === 'MONTHLY' ? [m0 + step] : (r.BYMONTH ? r.BYMONTH.split(',').map((x) => +x - 1 + (step) * 12 - 0) : [m0 + step * 12]);
      for (const mm of months) {
        const y = y0 + Math.floor(mm / 12), mo = ((mm % 12) + 12) % 12;
        const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        const base = Date.UTC(y, mo, 1) + hms;
        if (byDay) {
          for (const b of byDay) {
            const days = [];
            for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, mo, d)).getUTCDay() === b.dow) days.push(d);
            const pick = b.n === 0 ? days : [b.n > 0 ? days[b.n - 1] : days[days.length + b.n]].filter(Boolean);
            for (const d of pick) cands.push(base + (d - 1) * DAY);
          }
        } else {
          for (const md of byMonthDay || [start.getUTCDate()]) { const d = md < 0 ? dim + md + 1 : md; if (d >= 1 && d <= dim) cands.push(base + (d - 1) * DAY); }
        }
      }
      cands.sort((a, b) => a - b);
    } else return [first];
    let any = false;
    for (const c of cands) if (c >= first) { any = true; if (!take(c) && (c > until || n >= count)) return out; }
    if (cands.length && Math.min(...cands) > toWall) break;
    if (!any && step > 3660) break;
  }
  return out.filter((t) => t >= fromWall - 2 * DAY);
}

/**
 * The events between two dates (inclusive), in the viewer's zone, split by day:
 * { 'YYYY-MM-DD': [{ title, start, end, allDay }] } with start/end in minutes of that day.
 */
export function eventsBetween(feed, from, to, viewerTz) {
  const out = {};
  const put = (date, e) => { (out[date] ||= []).push(e); };
  const iso = (p) => `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  const fromMs = Date.parse(`${from}T00:00:00Z`) - DAY, toMs = Date.parse(`${to}T23:59:59Z`) + DAY;
  const overrides = new Map(); // uid -> Set of recurrence-id wall ms
  for (const ev of feed) if (ev.recurrenceId && ev.uid) { if (!overrides.has(ev.uid)) overrides.set(ev.uid, new Set()); overrides.get(ev.uid).add(wallMs(ev.recurrenceId.wall)); }

  for (const ev of feed) {
    if (ev.cancelled || ev.free) continue;
    const tz = ev.start.allDay ? null : ev.start.tz || viewerTz;
    const lengthMs = ev.end ? Math.max(0, wallMs(ev.end.wall) - wallMs(ev.start.wall)) : parseDuration(ev.duration) ?? (ev.start.allDay ? DAY : 0);
    const skip = new Set(ev.exdates.map((x) => wallMs(x.wall)));
    const moved = !ev.recurrenceId && ev.uid ? overrides.get(ev.uid) : null;
    for (const t of occurrences(ev, fromMs, toMs)) {
      if (skip.has(t) || (moved && moved.has(t))) continue;
      if (ev.start.allDay) {
        for (let d = t; d < t + Math.max(DAY, lengthMs); d += DAY) {
          const date = new Date(d).toISOString().slice(0, 10);
          if (date >= from && date <= to) put(date, { title: ev.title || '', start: 0, end: 1440, allDay: true });
        }
        continue;
      }
      // timed: the instant, then the viewer's wall clock, cut at midnights
      const s = zonedToUtc(fromWallMs(t), tz), e = s + lengthMs;
      for (let cur = s; cur < Math.max(e, s + 1);) {
        const p = partsIn(cur, viewerTz), date = iso(p);
        const startMin = p.h * 60 + p.mi;
        const dayEnd = cur + (1440 - startMin) * 60_000 - p.s * 1000;
        const endMs = Math.min(e, dayEnd);
        const endMin = endMs >= dayEnd ? 1440 : startMin + Math.round((endMs - cur) / 60_000);
        if (date >= from && date <= to) put(date, { title: ev.title || '', start: startMin, end: Math.max(endMin, startMin), allDay: false });
        if (e <= dayEnd) break;
        cur = dayEnd;
      }
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start || b.end - a.end);
  return out;
}

// ---------------- the feeds of an account, cached ----------------
const cache = new Map(); // url -> { at, feed?, error? }

export async function loadFeed(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) { if (hit.error) throw Object.assign(new Error(hit.error), { code: hit.error }); return hit.feed; }
  try {
    const feed = parseFeed(await fetchFeed(url));
    cache.set(url, { at: Date.now(), feed });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return feed;
  } catch (e) {
    const code = e.code || 'unreachable';
    cache.set(url, { at: Date.now() - CACHE_MS + 60_000, error: code }); // try a failing feed again after a minute
    throw Object.assign(new Error(code), { code });
  }
}
export const forgetFeed = (url) => cache.delete(url);
export const RANGE_DAYS = MAX_DAYS;

export { zonedToUtc };
