import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, eventsBetween } from '../src/calendar.mjs';

const feed = (events) => `BEGIN:VCALENDAR\r\n${events}END:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\nUID:${Math.random()}\r\nSUMMARY:x\r\n${lines}END:VEVENT\r\n`;
const timed = async (fn) => { const t = Date.now(); const r = fn(); return { r, ms: Date.now() - t }; };

test('an event that lasts thousands of years is not walked day by day (a 5 MB file could stall the server for minutes)', async () => {
  const allDay = parseFeed(feed(ev('DTSTART;VALUE=DATE:00010101\r\nDTEND;VALUE=DATE:99991231\r\n')));
  const a = await timed(() => eventsBetween(allDay, '2026-11-01', '2026-11-30', 'UTC'));
  assert.ok(a.ms < 300, `all-day took ${a.ms} ms`);
  assert.equal(Object.keys(a.r).length, 30);
  const hours = parseFeed(feed(ev('DTSTART:00010101T000000Z\r\nDTEND:99991231T000000Z\r\n')));
  const b = await timed(() => eventsBetween(hours, '2026-11-01', '2026-11-30', 'Europe/Istanbul'));
  assert.ok(b.ms < 300, `timed took ${b.ms} ms`);
  assert.equal(Object.keys(b.r).length, 30);
});

test('a day-spanning event still shows on each day of the window, cut at midnight', () => {
  const out = eventsBetween(parseFeed(feed(ev('DTSTART:20261129T220000Z\r\nDTEND:20261202T080000Z\r\n'))), '2026-11-01', '2026-12-05', 'UTC');
  assert.deepEqual(Object.keys(out), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual([out['2026-11-29'][0].start, out['2026-11-29'][0].end], [1320, 1440]);
});

test('thousands of repeating events cannot hold the server for more than a moment', async () => {
  const many = parseFeed(feed(Array.from({ length: 10_000 }, () => ev('DTSTART:20200101T100000Z\r\nDTEND:20200101T110000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\n')).join('')));
  const r = await timed(() => eventsBetween(many, '2026-11-01', '2026-11-30', 'Europe/Istanbul'));
  assert.ok(r.ms < 2500, `took ${r.ms} ms`);
});

test('a feed is read up to a number of events, and an old daily event still reaches the window', () => {
  const huge = parseFeed(feed(ev('DTSTART:20200101T100000Z\r\n').repeat(25_000)));
  assert.equal(huge.length, 20_000);
  const out = eventsBetween(parseFeed(feed(ev('DTSTART:20100101T100000Z\r\nDTEND:20100101T110000Z\r\nRRULE:FREQ=DAILY\r\n'))), '2026-11-01', '2026-11-30', 'UTC');
  assert.equal(Object.keys(out).length, 30);
});
