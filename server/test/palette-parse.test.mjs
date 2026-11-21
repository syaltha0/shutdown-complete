import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGo, parseBlock, parseTaskCommand, parsePalette } from '../../client/src/lib/paletteParse.ts';

const BASE = '2026-11-20'; // a Friday
const go = (s) => { const r = parseGo(s, BASE); return r && r.path; };
const block = (s) => { const r = parseBlock(s, BASE); return r && { date: r.date, start: r.start, end: r.end, kind: r.kind, label: r.label }; };
const at = (h, m = 0) => h * 60 + m;

test('go to a day: dates in Turkish and English', () => {
  assert.equal(go('12 Kasım'), '/day/2026-11-12');
  assert.equal(go('12 kasim'), '/day/2026-11-12');
  assert.equal(go('12 Nov'), '/day/2026-11-12');
  assert.equal(go('nov 12'), '/day/2026-11-12');
  assert.equal(go('12.11'), '/day/2026-11-12');
  assert.equal(go('12.11.2027'), '/day/2027-11-12');
  assert.equal(go('3 Mart 2027'), '/day/2027-03-03');
  assert.equal(go('2026-12-01'), '/day/2026-12-01');
  assert.equal(go('go to 12 Nov'), '/day/2026-11-12');
  assert.equal(go('git 12 Kasım'), '/day/2026-11-12');
});

test('go to a day: relative words and weekdays', () => {
  assert.equal(go('yarın'), '/day/2026-11-21');
  assert.equal(go('tomorrow'), '/day/2026-11-21');
  assert.equal(go('dün'), '/day/2026-11-19');
  assert.equal(go('Yesterday'), '/day/2026-11-19');
  assert.equal(go('bugün'), '/day/2026-11-20');
  assert.equal(go('today'), '/day/2026-11-20');
  assert.equal(go('pazartesi'), '/day/2026-11-23');
  assert.equal(go('monday'), '/day/2026-11-23');
  assert.equal(go('cuma'), '/day/2026-11-27'); // today is Friday: the next one
  assert.equal(go('next friday'), '/day/2026-11-27');
  assert.equal(go('gelecek salı'), '/day/2026-11-24');
  assert.equal(go('cumartesi'), '/day/2026-11-21');
});

test('go to a week, month, quarter or year', () => {
  assert.equal(go('gelecek hafta'), '/week/2026-W48');
  assert.equal(go('next week'), '/week/2026-W48');
  assert.equal(go('bu hafta'), '/week/2026-W47');
  assert.equal(go('geçen hafta'), '/week/2026-W46');
  assert.equal(go('hafta 47'), '/week/2026-W47');
  assert.equal(go('week 47'), '/week/2026-W47');
  assert.equal(go('47. hafta'), '/week/2026-W47');
  assert.equal(go('w5'), '/week/2026-W05');
  assert.equal(go('2026-W47'), '/week/2026-W47');
  assert.equal(go('week 3 2027'), '/week/2027-W03');
  assert.equal(go('Aralık'), '/month/2026-12');
  assert.equal(go('December'), '/month/2026-12');
  assert.equal(go('dec 2027'), '/month/2027-12');
  assert.equal(go('2026-11'), '/month/2026-11');
  assert.equal(go('gelecek ay'), '/month/2026-12');
  assert.equal(go('next month'), '/month/2026-12');
  assert.equal(go('last month'), '/month/2026-10');
  assert.equal(go('Q1'), '/quarter/2026-Q1');
  assert.equal(go('q4 2027'), '/quarter/2027-Q4');
  assert.equal(go('çeyrek 2'), '/quarter/2026-Q2');
  assert.equal(go('3. çeyrek'), '/quarter/2026-Q3');
  assert.equal(go('next quarter'), '/quarter/2027-Q1');
  assert.equal(go('2026'), '/year/2026');
  assert.equal(go('2027'), '/year/2027');
  assert.equal(go('next year'), '/year/2027');
  assert.equal(go('gelecek yıl'), '/year/2027');
});

test('go: unclear or impossible input gives nothing', () => {
  for (const s of ['', '   ', '12', '1', 'foo', 'ayarlar', 'settings', 'pause focus', 'resume focus', 'start focus', 'week', 'hafta', 'month', 'ara', 'sub', 'q5', 'q0',
    '31 şubat', '32 Nov', '0 Nov', '13.13', '31.04', 'hafta 0', 'hafta 54', 'week 53 2027', '1899', '12345', 'next', 'gelecek', 'go', 'git', 'constructor', 'next constructor', 'toString']) {
    assert.equal(go(s), null, `"${s}"`);
  }
});

test('go: a leap day exists only in a leap year', () => {
  assert.equal(go('29 Şubat 2028'), '/day/2028-02-29');
  assert.equal(go('29 Şubat 2027'), null);
  assert.equal(go('week 53 2026'), '/week/2026-W53');
});

test('block: time, length, kind and name in Turkish and English', () => {
  assert.deepEqual(block('blok 15:00 1s derin Bölüm taslağı'), { date: BASE, start: at(15), end: at(16), kind: 'deep', label: 'Bölüm taslağı' });
  assert.deepEqual(block('block 3pm 1h deep Chapter draft'), { date: BASE, start: at(15), end: at(16), kind: 'deep', label: 'Chapter draft' });
  assert.deepEqual(block('Add block 15:00 Deep 1h'), { date: BASE, start: at(15), end: at(16), kind: 'deep', label: '' });
  assert.deepEqual(block('blok ekle 9:30 45dk sığ E-postalar'), { date: BASE, start: at(9, 30), end: at(10, 15), kind: 'shallow', label: 'E-postalar' });
  assert.deepEqual(block('block 10am 30m meeting Standup'), { date: BASE, start: at(10), end: at(10, 30), kind: 'meeting', label: 'Standup' });
  assert.deepEqual(block('blok 19:00 2 saat kişisel Yürüyüş'), { date: BASE, start: at(19), end: at(21), kind: 'personal', label: 'Yürüyüş' });
  assert.deepEqual(block('block 8:15 personal Run'), { date: BASE, start: at(8, 15), end: at(9, 15), kind: 'personal', label: 'Run' });
  assert.deepEqual(block('blok 14:00 toplantı Ekip'), { date: BASE, start: at(14), end: at(15), kind: 'meeting', label: 'Ekip' });
});

test('block: lengths in every spelling', () => {
  const len = (s) => { const b = block(`block 10:00 ${s} X`); return b && b.end - b.start; };
  assert.equal(len('30dk'), 30);
  assert.equal(len('30 dk'), 30);
  assert.equal(len('1s'), 60);
  assert.equal(len('1.5h'), 90);
  assert.equal(len('1,5s'), 90);
  assert.equal(len('90m'), 90);
  assert.equal(len('45 min'), 45);
  assert.equal(len('2 hours'), 120);
  assert.equal(len('1h30'), 90);
  assert.equal(len('1s30dk'), 90);
  assert.equal(len('1h30m'), 90);
  assert.equal(len('2sa'), 120);
  assert.equal(block('block 10:00 X').end, at(11)); // no length given: an hour
});

test('block: clock forms, ranges and midnight', () => {
  assert.equal(block('block 3:30pm X').start, at(15, 30));
  assert.equal(block('block 3 pm X').start, at(15));
  assert.equal(block('block at 3pm X').start, at(15));
  assert.equal(block('blok saat 15 X').start, at(15));
  assert.equal(block('block 12am X').start, 0);
  assert.equal(block('block 12pm X').start, at(12));
  assert.deepEqual(block('blok 15:00-16:30 Rapor'), { date: BASE, start: at(15), end: at(16, 30), kind: 'deep', label: 'Rapor' });
  assert.deepEqual(block('blok 15:00 - 16:30 Rapor'), { date: BASE, start: at(15), end: at(16, 30), kind: 'deep', label: 'Rapor' });
  assert.deepEqual(block('block 3pm-4pm Report'), { date: BASE, start: at(15), end: at(16), kind: 'deep', label: 'Report' });
  assert.equal(block('block 23:30 2h X').end, 1440); // stops at midnight
});

test('block: a day in the text moves the block there', () => {
  assert.deepEqual(block('blok yarın 09:00 1s derin Planlama'), { date: '2026-11-21', start: at(9), end: at(10), kind: 'deep', label: 'Planlama' });
  assert.deepEqual(block('block 3pm tomorrow 1h Draft'), { date: '2026-11-21', start: at(15), end: at(16), kind: 'deep', label: 'Draft' });
  assert.deepEqual(block('blok 12 Kasım 10:00 30dk Not'), { date: '2026-11-12', start: at(10), end: at(10, 30), kind: 'deep', label: 'Not' });
  assert.deepEqual(block('block monday 9:00 deep Write'), { date: '2026-11-23', start: at(9), end: at(10), kind: 'deep', label: 'Write' });
  assert.equal(parseBlock('block 3pm X', BASE).dateGiven, false);
  assert.equal(parseBlock('block tomorrow 3pm X', BASE).dateGiven, true);
});

test('block: words of the name stay in the name', () => {
  assert.equal(block('block 3pm Deep work notes').label, 'work notes'); // a leading kind word is the kind
  assert.equal(block('block 3pm 1h Write the deep dive').label, 'Write the deep dive');
  assert.equal(block('blok 15:00 Cuma namazı').date, '2026-11-27'); // a weekday before the name begins is a date
  assert.equal(block('blok 15:00 Rapor cuma').label, 'Rapor cuma');
  assert.equal(block('blok 15:00 Bölüm 2 taslağı').label, 'Bölüm 2 taslağı');
});

test('block: unclear input gives nothing', () => {
  for (const s of ['blok', 'block', 'add block', 'blok Bölüm taslağı', 'block Chapter draft', 'block 15 Report', 'block 25:00 X', 'block 13pm X',
    'block 0pm X', 'block 10:00-9:00 X', 'block 10:60 X', 'blokaj 15:00', 'task 15:00 X', 'my block 3pm', 'block 24:00 X']) {
    assert.equal(block(s), null, `"${s}"`);
  }
});

test('task: the words after the keyword', () => {
  assert.equal(parseTaskCommand('task Report tomorrow 10am'), 'Report tomorrow 10am');
  assert.equal(parseTaskCommand('Görev Rapor yarın 9 #iş !1'), 'Rapor yarın 9 #iş !1');
  assert.equal(parseTaskCommand('görev ekle Rapor'), 'Rapor');
  assert.equal(parseTaskCommand('gorev ekle Rapor'), 'Rapor');
  assert.equal(parseTaskCommand('add task Pay rent'), 'Pay rent');
  assert.equal(parseTaskCommand('  task   Two   spaces '), 'Two   spaces');
  for (const s of ['', 'task', 'görev', 'add task', 'görev ekle', 'tasks Report', 'taskforce', 'task: Report', 'capture Idea', 'add Report']) {
    assert.equal(parseTaskCommand(s), null, `"${s}"`);
  }
});

test('one line, one reading: block, task, go or nothing', () => {
  assert.equal(parsePalette('blok 15:00 1s derin Bölüm taslağı', BASE).type, 'block');
  assert.equal(parsePalette('task Report', BASE).type, 'task');
  assert.equal(parsePalette('12 Nov', BASE).type, 'go');
  assert.equal(parsePalette('Task: Report', BASE), null); // the "Task: …" form with a colon is the palette's own
  assert.equal(parsePalette('settings', BASE), null);
  assert.equal(parsePalette('block', BASE), null);
});

test('block: separated meridiem applies to colon times', () => {
  assert.equal(block('block 3:30 pm 30m Draft').start, at(15, 30));
  assert.equal(block('block 12:30 am 30m Draft').start, at(0, 30));
});
