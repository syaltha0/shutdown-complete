import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { feedProblem } from '../src/calendar.mjs';
import { guardedFetch, privateAddress } from '../src/safefetch.mjs';

test('IPv6 spellings of private and local addresses are private (the hex form of ::ffff:127.0.0.1 slipped through)', () => {
  for (const ip of ['::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:c0a8:101', '::7f00:1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::', '2002:a00:1::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe81::1', 'febf::1', 'fec0::1', 'ff02::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '0:0:0:0:0:ffff:7f00:1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '0.0.0.0']) assert.equal(privateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:808:808', '::ffff:8.8.8.8', '64:ff9b::808:808']) assert.equal(privateAddress(ip), false, ip);
});

test('a feed address in IPv6 brackets is refused when it names this machine or a private network', async () => {
  const prev = { a: process.env.CALENDAR_ALLOW_PRIVATE, h: process.env.CALENDAR_PRIVATE_HOSTS };
  delete process.env.CALENDAR_ALLOW_PRIVATE; delete process.env.CALENDAR_PRIVATE_HOSTS;
  try {
    for (const u of ['http://[::ffff:127.0.0.1]/a.ics', 'http://[::ffff:7f00:1]/a.ics', 'http://[::1]/a.ics', 'http://[::ffff:a9fe:a9fe]/', 'http://[fd00::1]/', 'http://2130706433/', 'http://0x7f.1/', 'webcal://127.0.0.1/a.ics']) {
      assert.equal(await feedProblem(u), 'private', u);
    }
  } finally {
    if (prev.a !== undefined) process.env.CALENDAR_ALLOW_PRIVATE = prev.a;
    if (prev.h !== undefined) process.env.CALENDAR_PRIVATE_HOSTS = prev.h;
  }
});

test('the address connected to is checked, so a name that turns private after the first look (DNS rebinding) is refused', async () => {
  let asked = 0;
  const rebind = (host, opts, cb) => { asked++; cb(null, [{ address: '127.0.0.1', family: 4 }]); };
  await assert.rejects(guardedFetch('http://calendar.example.test/a.ics', { resolve: rebind }), { code: 'private' });
  assert.equal(asked, 1);
  const mixed = (host, opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
  await assert.rejects(guardedFetch('http://calendar.example.test/a.ics', { resolve: mixed }), { code: 'private' });
  await assert.rejects(guardedFetch('http://[::ffff:7f00:1]:9/'), { code: 'private' });
});

test('with the owner\'s grant a local server is reached; its answer is read with a size cap and compression', async () => {
  const srv = createServer((req, res) => {
    if (req.url === '/big') { res.end('x'.repeat(2000)); return; }
    if (req.url === '/gz') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(gzipSync('BEGIN:VCALENDAR\r\nEND:VCALENDAR')); return; }
    if (req.url === '/bomb') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(gzipSync('y'.repeat(1_000_000))); return; }
    res.writeHead(302, { location: '/gz' }); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${srv.address().port}`;
  try {
    await assert.rejects(guardedFetch(`${base}/gz`), { code: 'private' });
    const ok = await guardedFetch(`${base}/gz`, { allowPrivate: true });
    assert.equal(ok.status, 200);
    assert.match(ok.body.toString(), /BEGIN:VCALENDAR/);
    assert.equal((await guardedFetch(base + '/', { allowPrivate: true })).headers.location, '/gz');
    await assert.rejects(guardedFetch(`${base}/big`, { allowPrivate: true, maxBytes: 1000 }), { code: 'too-big' });
    await assert.rejects(guardedFetch(`${base}/bomb`, { allowPrivate: true, maxBytes: 100_000 }), { code: 'too-big' });
  } finally { srv.close(); srv.closeAllConnections?.(); }
});
