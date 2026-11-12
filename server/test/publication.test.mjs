import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerIcs } from '../src/publication.mjs';
const now = new Date('2026-11-12T23:00:00Z');
const day = (blocks) => ({ columns: [{ closedAt: null, blocks }], tasks: [] });
const block = { id: 'one', label: 'Türkçe,;\\\n' + 'ş'.repeat(100), start: 540, end: 600, kind: 'deep' };
test('RFC 5545 escaping, UTF-8 octet folding, CRLF and account timezone', () => {
  const s = plannerIcs([{ key: 'day:2026-11-13', value: day([block]) }], 'Europe/Istanbul', false, now);
  for (const line of s.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.ok(!s.replaceAll('\r\n', '').includes('\n'));
  const unfolded = s.replaceAll('\r\n ', '');
  assert.ok(unfolded.includes('SUMMARY:Türkçe\\,\\;\\\\\\n' + 'ş'.repeat(100)));
  assert.ok(s.includes('DTSTART:20261113T060000Z'));
  assert.ok(s.includes('CATEGORIES:deep'));
});
test('only active column, inclusive date bounds and optional top-level tasks', () => {
  const d = day([block]); d.columns.unshift({ closedAt: 600, blocks: [{ ...block, label: 'old' }] });
  d.tasks = [{ id: 't', text: 'task', due: '2026-11-13', steps: [{ id: 's', text: 'subtask', due: '2026-11-13' }] }];
  const docs = ['2026-11-05', '2026-11-06', '2026-12-13', '2026-12-14'].map((x) => ({ key: 'day:' + x, value: d }));
  const s = plannerIcs(docs, 'Europe/Istanbul', true, now);
  assert.equal((s.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.ok(!s.includes('SUMMARY:old')); assert.ok(!s.includes('subtask'));
  assert.ok(s.includes('DTEND;VALUE=DATE:20261114'));
  assert.ok(!plannerIcs(docs, 'Europe/Istanbul', false, now).includes('SUMMARY:task'));
});

test('bare CR cannot inject calendar properties and next-midnight ends roll over', () => {
  const s = plannerIcs([{ key: 'day:2026-11-13', value: day([{ ...block, label: 'safe\rATTACH:bad', start: 1380, end: 1440 }]) }], 'UTC', false, now);
  assert.ok(s.includes('SUMMARY:safe\\nATTACH:bad'));
  assert.ok(s.includes('DTEND:20261114T000000Z'));
});
test('daylight saving conversion follows the selected account zone', () => {
  const s = plannerIcs(['2026-03-28', '2026-03-29'].map((d) => ({ key: 'day:' + d, value: day([block]) })), 'Europe/Berlin', false, new Date('2026-03-28T12:00:00Z'));
  assert.ok(s.includes('DTSTART:20260328T080000Z'));
  assert.ok(s.includes('DTSTART:20260329T070000Z'));
});
