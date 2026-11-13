import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, isProxyPeer } from '../src/net.mjs';

const ctx = (peer, xff) => ({ env: { incoming: { socket: { remoteAddress: peer } } }, req: { header: (n) => (n === 'x-forwarded-for' ? xff : undefined) } });

test('only a proxy next to the app is believed', () => {
  for (const ok of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.1.5', 'fd00::1', 'fe80::1']) assert.equal(isProxyPeer(ok), true, ok);
  for (const no of ['8.8.8.8', '172.32.0.1', '2001:db8::1', '::ffff:8.8.8.8', '', undefined]) assert.equal(isProxyPeer(no), false, String(no));
});

test('a direct client cannot choose its own address with X-Forwarded-For', () => {
  assert.equal(clientIp(ctx('203.0.113.9', '1.2.3.4')), '203.0.113.9');
  assert.equal(clientIp(ctx('203.0.113.9', undefined)), '203.0.113.9');
});

test('behind a proxy the entry the proxy appended counts, not what the client wrote first', () => {
  assert.equal(clientIp(ctx('127.0.0.1', '6.6.6.6, 198.51.100.7')), '198.51.100.7');
  assert.equal(clientIp(ctx('172.18.0.1', '198.51.100.7')), '198.51.100.7');
  assert.equal(clientIp(ctx('127.0.0.1', 'not an address')), '127.0.0.1');
  assert.equal(clientIp(ctx('127.0.0.1', undefined)), '127.0.0.1');
});
