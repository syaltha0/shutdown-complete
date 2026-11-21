import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('client/src/lib/blockDrag.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { dragBlock: drag } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const b = { start: 600, end: 660 };
test('move snaps both directions without changing duration or source', () => {
  assert.deepEqual(drag(b, 'move', 13, 540, 1020), { start: 615, end: 675 });
  assert.deepEqual(drag(b, 'move', -13, 540, 1020), { start: 585, end: 645 });
  assert.deepEqual(b, { start: 600, end: 660 });
});
test('either edge snaps, fixes the opposite edge and enforces 15 minutes', () => {
  assert.deepEqual(drag(b, 'start', -13, 540, 1020), { start: 585, end: 660 });
  assert.deepEqual(drag(b, 'end', 13, 540, 1020), { start: 600, end: 675 });
  assert.deepEqual(drag(b, 'start', 100, 540, 1020), { start: 645, end: 660 });
  assert.deepEqual(drag(b, 'end', -100, 540, 1020), { start: 600, end: 615 });
});
test('move and edges stop at day/revision limits', () => {
  assert.deepEqual(drag(b, 'move', -999, 540, 1020), { start: 540, end: 600 });
  assert.deepEqual(drag(b, 'move', 999, 540, 1020), { start: 960, end: 1020 });
  assert.deepEqual(drag(b, 'start', -999, 540, 1020), { start: 540, end: 660 });
  assert.deepEqual(drag(b, 'end', 999, 540, 1020), { start: 600, end: 1020 });
  assert.deepEqual(drag(b, 'move', 5, 620, 650), b);
});
