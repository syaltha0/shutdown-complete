import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('client/src/lib/layout.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { layoutBlocks, suggestBlockStart: slot } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const b = (id, start, end) => ({ id, start, end });
test('touching blocks and isolated groups use full width without mutating input', () => {
  const blocks = [b('b', 60, 90), b('a', 0, 60)];
  assert.deepEqual([...layoutBlocks(blocks).values()], [{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }]);
  assert.equal(blocks[0].id, 'b'); assert.equal(layoutBlocks([]).size, 0);
});
test('nested and chained overlaps reuse first free lane and share peak group width', () => {
  const result = layoutBlocks([b('a', 0, 100), b('b', 10, 30), b('c', 20, 40), b('d', 30, 110), b('e', 110, 140)]);
  assert.deepEqual([...result.values()], [{ lane: 0, lanes: 3 }, { lane: 1, lanes: 3 }, { lane: 2, lanes: 3 }, { lane: 1, lanes: 3 }, { lane: 0, lanes: 1 }]);
});
test('equal starts are deterministic and every intersecting pair has different lanes', () => {
  const blocks = [b('c', 0, 90), b('a', 0, 60), b('b', 0, 60), b('d', 60, 120)];
  const result = layoutBlocks(blocks);
  assert.deepEqual(result, layoutBlocks([...blocks].reverse()));
  for (const a of blocks) for (const b of blocks) if (a.id !== b.id && a.start < b.end && a.end > b.start) assert.notEqual(result.get(a.id).lane, result.get(b.id).lane);
});
test('empty day starts at configured start or next quarter hour today', () => {
  assert.deepEqual(slot([], 480, 1080), { start: 480, end: 540 });
  assert.deepEqual(slot([], 480, 1080, 601), { start: 615, end: 675 });
});
test('now inside nested blocks advances past their union and shortens to the free gap', () => {
  assert.deepEqual(slot([b('a', 600, 660), b('b', 630, 690), b('c', 735, 800)], 480, 1080, 640), { start: 690, end: 735 });
  assert.deepEqual(slot([b('a', 510, 600)], 480, 1080), { start: 480, end: 510 });
});
test('full day and end of day fallback stay in day, including planning minutes beyond midnight', () => {
  assert.deepEqual(slot([b('a', 480, 1080)], 480, 1080, 600), { start: 1050, end: 1080, noGap: true });
  assert.deepEqual(slot([], 480, 1080, 1050), { start: 1050, end: 1080 });
  assert.deepEqual(slot([b('a', 480, 1080)], 480, 1080, 1090), { start: 1050, end: 1080, noGap: true });
  assert.deepEqual(slot([b('a', 480, 600)], 480, 1080, 1070), { start: 600, end: 660, noGap: true });
  assert.deepEqual(slot([], 240, 1680, 1560), { start: 1560, end: 1620 });
});
