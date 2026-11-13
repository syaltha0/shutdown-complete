import test from 'node:test';
import assert from 'node:assert/strict';
import { countSyncOperation, finishSyncRun, newSyncRun } from '../src/sync-log.mjs';
test('counts completed operations independently', () => {
  const list = { received: 0, sent: 0, deleted: 0, skipped: 0 };
  for (const op of ['received', 'sent', 'sent', 'deleted', 'skipped']) countSyncOperation(list, op);
  assert.deepEqual(list, { received: 1, sent: 2, deleted: 1, skipped: 1 });
});
test('retains ten summaries and no transport secrets', () => {
  let history = [];
  for (let i = 0; i < 15; i++) {
    const run = newSyncRun(); run.errors.push({ title: 'Password SECRET https://host/private', reason: 'https://user:secret@host', status: 412 });
    history = finishSyncRun(history, run, i, ['SECRET']);
  }
  assert.equal(history.length, 10);
  assert.equal(history[0].durationMs, 14);
  assert.equal(history[0].errors[0].reason, 'failed');
  assert.equal(history[0].errors[0].status, 412);
  assert.ok(!JSON.stringify(history).includes('https://'));
  assert.ok(!JSON.stringify(history).includes('SECRET'));
});
