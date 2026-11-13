import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, eventsBetween, feedProblem } from '../src/calendar.mjs';

test('private-host exception is exact and never permits credentials or other schemes', async () => {
  const prev = process.env.CALENDAR_PRIVATE_HOSTS;
  const all = process.env.CALENDAR_ALLOW_PRIVATE;
  delete process.env.CALENDAR_ALLOW_PRIVATE;
  process.env.CALENDAR_PRIVATE_HOSTS = 'cloud.internal';
  try {
    assert.equal(await feedProblem('https://cloud.internal/a.ics'), null);
    assert.equal(await feedProblem('https://other.internal/a.ics'), 'private');
    assert.equal(await feedProblem('https://cloud.internal.evil.internal/a.ics'), 'private');
    assert.equal(await feedProblem('https://user:pw@cloud.internal/a.ics'), 'url');
    assert.equal(await feedProblem('file://cloud.internal/a.ics'), 'url');
  } finally {
    if (prev === undefined) delete process.env.CALENDAR_PRIVATE_HOSTS; else process.env.CALENDAR_PRIVATE_HOSTS = prev;
    if (all === undefined) delete process.env.CALENDAR_ALLOW_PRIVATE; else process.env.CALENDAR_ALLOW_PRIVATE = all;
  }
});

const feed = (...events) => parseFeed(['BEGIN:VCALENDAR', ...events.flatMap(lines => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n'));
test('RRULE excludes EXDATE and replaces a moved RECURRENCE-ID occurrence', () => {
  const parsed = feed([
    'UID:series', 'SUMMARY:Original', 'DTSTART;TZID=Europe/Istanbul:20261109T090000', 'DURATION:PT1H',
    'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE;TZID=Europe/Istanbul:20261110T090000',
  ], [
    'UID:series', 'SUMMARY:Moved', 'RECURRENCE-ID;TZID=Europe/Istanbul:20261111T090000',
    'DTSTART;TZID=Europe/Istanbul:20261111T110000', 'DURATION:PT1H',
  ]);
  const days = eventsBetween(parsed, '2026-11-09', '2026-11-12', 'Europe/Istanbul');
  assert.deepEqual(Object.keys(days).sort(), ['2026-11-09', '2026-11-11', '2026-11-12']);
  assert.deepEqual(days['2026-11-11'], [{ uid: 'series', location: undefined, description: undefined, title: 'Moved', start: 660, end: 720, allDay: false }]);
  assert.equal(days['2026-11-09'][0].start, 540);
});
test('Windows TZID maps to IANA and converts to the viewer zone', () => {
  const parsed = feed(['UID:windows', 'DTSTART;TZID="Turkey Standard Time":20261112T090000', 'DTEND;TZID="Turkey Standard Time":20261112T100000']);
  assert.equal(parsed[0].start.tz, 'Europe/Istanbul');
  assert.deepEqual(eventsBetween(parsed, '2026-11-12', '2026-11-12', 'UTC')['2026-11-12'], [{ uid: 'windows', location: undefined, description: undefined, title: '', start: 360, end: 420, allDay: false }]);
});
test('weekly RRULE respects BYDAY, interval and inclusive UNTIL', () => {
  const parsed = feed(['UID:weekly', 'DTSTART;VALUE=DATE:20261109', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;UNTIL=20261123']);
  assert.deepEqual(Object.keys(eventsBetween(parsed, '2026-11-09', '2026-11-30', 'UTC')).sort(), ['2026-11-09', '2026-11-13', '2026-11-23']);
});
