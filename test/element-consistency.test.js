import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeElementConsistency, ELEMENT_TYPES, MAX_ELEMENT_OBSERVATIONS } from '../src/element-consistency.js';

const style = {
  backgroundColor: 'rgb(255, 255, 255)', backgroundImage: 'none', color: 'rgb(20, 20, 20)', opacity: '1', filter: 'none',
  borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(100, 100, 100)',
  borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: 'rgb(100, 100, 100)',
  borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'rgb(100, 100, 100)',
  borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: 'rgb(100, 100, 100)',
  borderTopLeftRadius: '6px', borderTopRightRadius: '6px', borderBottomRightRadius: '6px', borderBottomLeftRadius: '6px',
  fontFamily: 'Arial, sans-serif', fontSize: '16px', fontWeight: '400', fontStyle: 'normal', lineHeight: '24px', letterSpacing: 'normal', textTransform: 'none', textDecorationLine: 'none',
  paddingTop: '8px', paddingRight: '12px', paddingBottom: '8px', paddingLeft: '12px', boxShadow: 'none',
};
const changed = { ...style, borderTopLeftRadius: '2px' };
const context = { url: 'http://localhost:8123/settings', theme: 'app:light;browser:light' };
const element = (index, updates = {}) => ({ tag: 'input', nativeType: 'text', index, visible: true, visibilityEvidence: 'clear', state: 'default', configured: { family: 'settings field', type: 'inputs', variant: 'regular' }, style: { ...style }, ...updates });
const three = (updates = {}) => [element(0), element(1), element(2, { style: changed, ...updates })];

test('reports an explicitly grouped difference with normalized facts and source evidence', () => {
  const result = analyzeElementConsistency(three({ source: { status: 'likely', file: 'Form.tsx', line: 12 } }), context);
  assert.equal(result.format, 'ui-sheet/elements-v1');
  assert.equal(result.findingIdentity, 'ui-sheet/element-finding-v2');
  assert.equal(result.coverage, 'observed');
  assert.equal(result.counts.comparable, 3);
  assert.deepEqual(result.appearances.map((entry) => entry.count), [2, 1]);
  const finding = result.findings[0];
  assert.equal(finding.group.type, 'inputs');
  assert.equal(finding.group.nativeType, 'text');
  assert.equal(finding.group.state, 'default');
  assert.deepEqual(finding.common, { count: 2, example: 'input:0' });
  assert.deepEqual(finding.outlier, { count: 1, example: 'input:2' });
  assert.deepEqual(finding.differences, [{ property: 'borderTopLeftRadius', label: 'Top-left radius', common: '6px', observed: '2px' }]);
  assert.deepEqual(finding.decisionAnchor, { file: 'Form.tsx', line: 12 });
});

test('supports each configured category without guessing groups from labels or class names', () => {
  for (const type of ELEMENT_TYPES) {
    const input = three().map((entry) => ({ ...entry, configured: { family: 'configured family', type }, text: 'Private content', classes: ['danger'] }));
    const result = analyzeElementConsistency(input, context);
    assert.equal(result.findings.length, 1, type);
    assert.equal(result.findings[0].group.variant, 'unspecified');
    assert.equal(JSON.stringify(result).includes('Private content'), false);
    assert.equal(JSON.stringify(result).includes('danger'), false);
  }
  assert.equal(analyzeElementConsistency(three().map((entry) => ({ ...entry, configured: undefined })), context).counts.seen, 0);
});

test('keeps explicit state, family, variant, UI type, native tag and input type separate', () => {
  for (const updates of [
    { state: '{"selected":true}' },
    { state: 'focused' },
    { state: 'disabled' },
    { configured: { family: 'other field', variant: 'regular', type: 'inputs' } },
    { configured: { family: 'settings field', variant: 'compact', type: 'inputs' } },
    { configured: { family: 'settings field', variant: 'regular', type: 'selectors' } },
    { tag: 'textarea' },
    { nativeType: 'search' },
  ]) {
    const result = analyzeElementConsistency(three(updates), context);
    assert.equal(result.findings.length, 0, JSON.stringify(updates));
    assert.equal(result.counts.undersampled, 3);
    assert.equal(result.coverage, 'insufficient');
  }
});

test('does not imply a baseline for small, tied or nonmajority samples and reports repeated minorities', () => {
  const small = analyzeElementConsistency(three().slice(0, 2), context);
  assert.equal(small.counts.undersampled, 2);
  const tied = analyzeElementConsistency([...three(), element(3, { style: changed })], context);
  assert.equal(tied.counts.tied, 4);
  const nonmajority = analyzeElementConsistency([...three(), element(3, { style: { ...style, fontSize: '18px' } })], context);
  assert.equal(nonmajority.counts.ambiguous, 4);
  const repeated = analyzeElementConsistency([element(0), element(1), element(2), element(3, { style: changed }), element(4, { style: changed })], context);
  assert.equal(repeated.counts.repeatedMinority, 2);
  assert.equal(repeated.coverage, 'observed');
  assert.equal(repeated.findings.length, 1);
  assert.equal(repeated.findings[0].reference, 'inferred');
  assert.equal(repeated.findings[0].common.count, 3);
  assert.equal(repeated.findings[0].outlier.count, 2);
  assert.equal(repeated.findings[0].decisionAnchor, undefined);
  for (const result of [small, tied, nonmajority]) assert.equal(result.findings.length, 0);
});

test('counts hidden, blocked, missing state, unsupported styles and uncertain visibility', () => {
  const input = [...three(), element(3, { visible: false }), element(4, { visibilityEvidence: 'possibly-blocked' }), element(5, { state: undefined }), element(6, { style: { ...style, backgroundImage: 'url("https://example.invalid/?secret=yes")' } }), element(7, { visibilityEvidence: undefined })];
  const result = analyzeElementConsistency(input, context);
  assert.equal(result.counts.seen, 8);
  assert.equal(result.counts.eligible, 4);
  assert.equal(result.counts.hidden, 1);
  assert.equal(result.counts.possiblyBlocked, 1);
  assert.equal(result.counts.missingState, 1);
  assert.equal(result.counts.missingStyle, 1);
  assert.equal(result.counts.visibilityUnverified, 1);
  assert.equal(result.coverage, 'partial');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('compares supported visual effects and excludes missing or URL-based effects without retaining URLs', () => {
  const result = analyzeElementConsistency(three({ style: { ...style, opacity: '0.6', filter: 'blur(1px)' } }), context);
  assert.deepEqual(result.findings[0].differences.map((entry) => entry.property).sort(), ['filter', 'opacity']);
  assert.equal(result.findings[0].reference, 'inferred');
  for (const changes of [{ opacity: undefined }, { filter: undefined }, { filter: 'url("https://example.invalid/?secret=yes")' }]) {
    const incomplete = analyzeElementConsistency([...three(), element(3, { style: { ...style, ...changes } })], context);
    assert.equal(incomplete.counts.missingStyle, 1);
    assert.equal(incomplete.coverage, 'partial');
    assert.equal(JSON.stringify(incomplete).includes('secret'), false);
  }
});

test('keeps a unique source-ID finding stable across line and DOM moves while scoping context changes', () => {
  const source = { status: 'likely', file: 'Form.tsx', line: 12, method: 'unique ID and tag', elementId: 'name-field' };
  const first = analyzeElementConsistency(three({ source }), context).findings[0];
  const moved = three({ source: { ...source, line: 30 } });
  moved[2].index = 20;
  assert.equal(analyzeElementConsistency(moved, { ...context, url: 'http://127.0.0.1:9123/settings' }).findings[0].id, first.id);
  for (const updates of [{ url: 'https://example.test/settings' }, { url: 'http://localhost:8123/other' }, { theme: 'app:dark;browser:dark' }, { pixelRatio: 4 }, { viewport: { width: 800, height: 600 } }, { browser: { engine: 'chromium', version: '999.0' } }]) {
    assert.notEqual(analyzeElementConsistency(three({ source }), { ...context, ...updates }).findings[0].id, first.id);
  }
});

test('instrumented anchors require their column and fingerprint and expire when the file changes', () => {
  const source = { status: 'instrumented', file: 'Form.tsx', line: 12, column: 8, sha256: 'a'.repeat(64) };
  const first = analyzeElementConsistency(three({ source }), context).findings[0];
  assert.equal(first.decisionAnchor.sha256, source.sha256);
  assert.notEqual(analyzeElementConsistency(three({ source: { ...source, sha256: 'b'.repeat(64) } }), context).findings[0].id, first.id);
  assert.equal(analyzeElementConsistency(three({ source: { ...source, column: undefined } }), context).findings[0].decisionAnchor, undefined);
});

test('bounds retained observations and marks omissions incomplete', () => {
  const result = analyzeElementConsistency(Array.from({ length: MAX_ELEMENT_OBSERVATIONS + 1 }, (_, index) => element(index)), context);
  assert.equal(result.counts.seen, MAX_ELEMENT_OBSERVATIONS + 1);
  assert.equal(result.counts.eligible, MAX_ELEMENT_OBSERVATIONS);
  assert.equal(result.counts.omitted, 1);
  assert.equal(result.observations.length, MAX_ELEMENT_OBSERVATIONS);
  assert.equal(result.coverage, 'partial');
});

test('rejects invalid configuration, duplicate indices and incompatible baselines without mutating inputs', () => {
  assert.throws(() => analyzeElementConsistency(three(), { ...context, baselines: [{}] }), /invalid or duplicate rule/);
  assert.throws(() => analyzeElementConsistency(three({ configured: { family: 'x', type: 'buttons' } }), context), /supported UI type/);
  assert.throws(() => analyzeElementConsistency([element(0), element(0)], context), /duplicate/);
  const input = three();
  const original = structuredClone(input);
  analyzeElementConsistency(input, context);
  assert.deepEqual(input, original);
});
