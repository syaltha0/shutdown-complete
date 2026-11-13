import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTodo, upsert, taskIcs, stepIcs } from '../src/vtodo.mjs';

// Real Tasks.org export (calendar envelope added): https://github.com/tasks/tasks/issues/2158
const fixture = readFileSync(new URL('./fixtures/tasks-org.ics', import.meta.url), 'utf8');
const unfold = s => s.replace(/\r\n /g, '').replace(/\r/g, '');
test('Tasks.org export preserves extensions, COUNT=0 and VALARM after title edit', () => {
  const t = upsert({ items: [] }, 'inbox', 'task.ics', fixture, '2026-11-13').doc.items[0];
  const out = unfold(taskIcs({ ...t, text: 'Changed' }));
  for (const l of fixture.split('\n').filter(l => l && !l.startsWith('SUMMARY:'))) assert.ok(out.includes(l), l);
  assert.ok(out.includes('SUMMARY:Changed'));
  assert.ok(!out.includes('SUMMARY:Weekly'));
});
const wrap = body => `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VTODO\nUID:opaque\nSUMMARY:Original\n${body}\nEND:VTODO\nEND:VCALENDAR\n`;
test('opaque properties, recurrence exceptions, attachments and multiple alarms survive edits', () => {
  const raw = wrap('RRULE:FREQ=MONTHLY;COUNT=10;BYDAY=MO;BYSETPOS=-1\nEXDATE;TZID=Europe/Berlin:20261130T140000\nDUE;TZID=Europe/Berlin:20261113T140000\nDTSTART;TZID=Europe/Berlin:20261113T130000\nGEO:48.1;11.5\nURL:https://example.org/task\nATTACH;FMTTYPE=text/plain:https://example.org/a\nCLASS:PRIVATE\nX-TASKS-TEST:opaque\nBEGIN:VALARM\nACTION:AUDIO\nTRIGGER:-PT5M\nEND:VALARM\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nEND:VALARM');
  const t = upsert({ items: [] }, 'inbox', 'opaque.ics', raw, '2026-11-13').doc.items[0];
  const out = unfold(taskIcs({ ...t, text: 'Edited', notes: 'Note' }));
  for (const line of raw.split('\n').filter(l => l && !l.startsWith('SUMMARY:'))) assert.ok(out.includes(line), line);
  assert.equal((out.match(/BEGIN:VALARM/g) ?? []).length, 2);
});
test('TZID and UTC describe the same instant; new timed dates have a UTC suffix', () => {
  const a = parseTodo(wrap('DUE;TZID=America/Los_Angeles:20261113T090000'));
  const b = parseTodo(wrap('DUE:20261113T170000Z'));
  assert.equal(a.due, b.due); assert.equal(a.dueTime, b.dueTime);
  const out = taskIcs({ id: 'new', text: 'Timed', due: a.due, dueTime: a.dueTime });
  assert.match(out, /DUE:20261113T170000Z/);
});
test('subtask opaque data survives title edit', () => {
  const p = { id: 'parent', text: 'Parent' };
  const raw = wrap('RELATED-TO;RELTYPE=PARENT:parent\nX-APPLE-SORT-ORDER:42\nURL:https://example.org');
  const s = upsert({ items: [p] }, 'inbox', 'child.ics', raw, '2026-11-13').doc.items[0].steps[0];
  const out = stepIcs({ ...s, text: 'Edited' }, p);
  assert.match(out, /X-APPLE-SORT-ORDER:42/); assert.match(out, /RELATED-TO;RELTYPE=PARENT:parent/);
});
test('unsupported recurrence completion preserves its set instead of rolling to a wrong day', () => {
  const raw = wrap('DUE;VALUE=DATE:20261130\nRRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1;COUNT=8\nEXDATE;VALUE=DATE:20261228\nSTATUS:COMPLETED');
  const t = upsert({ items: [] }, 'inbox', 'opaque.ics', raw, '2026-11-13').doc.items[0];
  assert.equal(t.done, true); assert.equal(t.due, '2026-11-30');
  assert.equal(t.repeat, undefined, 'the UI must not calculate a lossy recurrence approximation');
  assert.match(taskIcs(t), /BYSETPOS=-1;COUNT=8/);
});
test('editing representable recurrence fields retains opaque RRULE parts', () => {
  const raw = wrap('RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO');
  const t = upsert({ items: [] }, 'inbox', 'opaque.ics', raw, '2026-11-13').doc.items[0];
  assert.match(taskIcs({ ...t, repeat: { ...parseTodo(raw).repeat, every: 2 } }), /BYSETPOS=-1/);
});
test('recurrence interval edit preserves timed UNTIL and ordinal BYDAY exactly', () => {
  const raw = wrap('RRULE:FREQ=MONTHLY;BYDAY=-1MO;UNTIL=20271231T230000Z');
  const t = upsert({ items: [] }, 'inbox', 'opaque.ics', raw, '2026-11-13').doc.items[0];
  const out = taskIcs({ ...t, repeat: { ...parseTodo(raw).repeat, every: 2 } });
  assert.match(out, /UNTIL=20271231T230000Z/); assert.match(out, /BYDAY=-1MO/); assert.match(out, /INTERVAL=2/);
});
test('editing a supported reminder changes its trigger without losing alarm extensions', () => {
  const raw = wrap('DUE:20261113T140000Z\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER;RELATED=END:-PT15M\nX-ALARM-TEST:keep\nEND:VALARM');
  const t = upsert({ items: [] }, 'inbox', 'opaque.ics', raw, '2026-11-13').doc.items[0];
  const out = taskIcs({ ...t, remind: 30 });
  assert.match(out, /TRIGGER;RELATED=END:-PT30M/); assert.match(out, /X-ALARM-TEST:keep/);
  assert.equal((out.match(/BEGIN:VALARM/g) ?? []).length, 1);
});
