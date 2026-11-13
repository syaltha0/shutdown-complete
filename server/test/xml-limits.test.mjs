import test from 'node:test';
import assert from 'node:assert/strict';
import { askedProps } from '../src/caldav.mjs';
import { xmlTag } from '../src/davsync.mjs';

const fast = (fn, ms) => { const t = Date.now(); const r = fn(); assert.ok(Date.now() - t < ms, `took ${Date.now() - t} ms`); return r; };

test('a PROPFIND body of endless unclosed tags is read quickly (the unbounded patterns took minutes)', () => {
  fast(() => askedProps('<prop '.repeat(40_000)), 300);
  fast(() => askedProps('<d:prop>' + '<x '.repeat(80_000)), 300);
  fast(() => askedProps('<d:propfind><d:prop>' + '<d:a '.repeat(50_000) + '</d:prop>'), 300);
});

test('the properties asked for are still found, with their namespaces', () => {
  const xml = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:getetag/><cs:getctag/><d:displayname></d:displayname></d:prop></d:propfind>';
  assert.deepEqual(askedProps(xml), [{ ns: 'DAV:', name: 'getetag' }, { ns: 'http://calendarserver.org/ns/', name: 'getctag' }, { ns: 'DAV:', name: 'displayname' }]);
  assert.equal(askedProps('<d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>'), null);
  assert.equal(askedProps(''), null);
});

test('a reply from a linked server made of endless opening tags is read quickly; ordinary replies are read as before', () => {
  fast(() => xmlTag('<d:status '.repeat(200_000), 'status'), 300);
  fast(() => xmlTag('<d:href>'.repeat(300_000), 'href'), 300);
  assert.equal(xmlTag('<d:response><d:href>/a%20b/</d:href></d:response>', 'href'), '/a%20b/');
  assert.equal(xmlTag('<D:displayname x="1">Tom &amp; Jerry</D:displayname>', 'displayname'), 'Tom & Jerry');
  assert.equal(xmlTag('<d:a>x</d:a>', 'b'), null);
});
