import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInstrumentedSources } from '../src/instrumented-sources.js';

test('uses only matching source markers and does not fall back when markers are invalid', () => {
  const hash = 'a'.repeat(64);
  const usage = { file: 'src/App.tsx', line: 3, column: 12, element: { tag: 'button' } };
  const item = { kind: 'components', usages: [usage] };
  const data = { items: [item], _sourceHashes: new Map([['src/App.tsx', hash]]) };
  const marker = (changes = {}) => JSON.stringify({ v: 1, file: usage.file, line: usage.line, column: usage.column, sha256: hash, ...changes });
  const element = (index, sourceMarker) => ({ tag: 'button', index, visible: true, ...(sourceMarker === undefined ? {} : { sourceMarker }) });
  const rendered = [element(0, marker()), element(1, marker({ sha256: 'b'.repeat(64) })), element(2, marker({ column: 13 })), element(3, '{'), element(4)];
  const guessed = rendered.slice(1).map((entry) => ({ item, usage, rendered: entry, method: 'unique text and tag' }));
  const matches = applyInstrumentedSources(data, rendered, guessed);
  assert.deepEqual(matches.map((entry) => entry.rendered.index).sort(), [0, 4]);
  assert.equal(matches.find((entry) => entry.rendered.index === 0).instrumentedHash, hash);
  assert.equal(matches.find((entry) => entry.rendered.index === 4).method, 'unique text and tag');
  assert.deepEqual(applyInstrumentedSources({ ...data, items: [item, item] }, [rendered[0]], []).length, 0, 'ambiguous source records are not selected');
  assert.deepEqual(applyInstrumentedSources(data, [{ ...rendered[0], tag: 'input' }], []).length, 0, 'tags must agree');
});
