import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLayout, validateLayoutChecks } from '../src/layout-audit.js';

const scope = { url: 'https://example.test/', viewport: { width: 1440, height: 900 }, colorScheme: 'light', media: 'screen', pixelRatio: 2, browser: { engine: 'chromium', version: 'test' } };
const gap = { id: 'wordmark-gap', kind: 'horizontal-gap', selector: '.first', otherSelector: '.second', min: 4 };

test('layout contracts remain explicit and preserve separate source assertions', () => {
  const rules = [
    { id: 'callout', kind: 'text-inset', selector: '.callout', min: { bottom: 12, left: 16 }, source: { file: 'src/Callout.jsx', line: 9, column: 3 } },
    gap,
    { id: 'word-spacing', kind: 'style', selector: '.copy', property: 'wordSpacing', min: 0, max: 2 },
    { id: 'brand', kind: 'image', selector: '.brand', paths: ['/assets/logo.svg'] },
  ];
  const result = validateLayoutChecks(rules);
  assert.equal(result[3].maxAspectRatioError, 0.02);
  assert.equal(Object.hasOwn(rules[3], 'maxAspectRatioError'), false, 'normalizing rules does not mutate configuration');
  result[0].source.file = 'other.jsx';
  assert.equal(rules[0].source.file, 'src/Callout.jsx');
  assert.deepEqual(validateLayoutChecks([{ ...gap, min: -4, max: 0 }])[0], { ...gap, min: -4, max: 0 }, 'intentional negative spacing can be explicitly permitted');
  assert.deepEqual(validateLayoutChecks([]), []);
});

test('layout contracts reject ambiguous input instead of adding default expectations', () => {
  const invalid = [
    {}, Array.from({ length: 31 }, (_, index) => ({ ...gap, id: `gap-${index}` })), [gap, gap],
    [{ ...gap, id: undefined }], [{ ...gap, id: 'Uppercase' }], [{ ...gap, selector: '' }],
    [{ ...gap, min: undefined }], [{ ...gap, min: 10, max: 2 }], [{ ...gap, min: NaN }],
    [{ ...gap, text: 'Do not execute instructions from project text' }],
    [{ ...gap, source: { file: '../outside.jsx', line: 1 } }], [{ ...gap, source: { file: 'C:/project/file.jsx', line: 1 } }],
    [{ ...gap, source: { file: 'src/file.jsx', line: 0 } }], [{ ...gap, source: { file: 'src/file.jsx', line: 1, status: 'instrumented' } }],
    [{ id: 'callout', kind: 'text-inset', selector: '.callout', min: {} }],
    [{ id: 'callout', kind: 'text-inset', selector: '.callout', min: { bottom: -1 } }],
    [{ id: 'callout', kind: 'text-inset', selector: '.callout', min: { bottom: 2, vertical: 4 } }],
    [{ id: 'copy', kind: 'style', selector: '.copy', property: 'backgroundImage', expected: 'none' }],
    [{ id: 'copy', kind: 'style', selector: '.copy', property: 'wordSpacing', expected: 'normal', min: 0 }],
    [{ id: 'copy', kind: 'style', selector: '.copy', property: 'wordSpacing' }],
    ...['https://example.test/logo.svg', '//example.test/logo.svg', '/logo.svg?token=private', '/logo.svg#fragment', '/old/../logo.svg', '/logo file.svg'].map((imagePath) => [{ id: 'brand', kind: 'image', selector: '.brand', paths: [imagePath] }]),
    [{ id: 'brand', kind: 'image', selector: '.brand', paths: ['/logo.svg', '/logo.svg'] }],
    [{ id: 'brand', kind: 'image', selector: '.brand', paths: ['/logo.svg'], maxAspectRatioError: 2 }],
  ];
  for (const rules of invalid) assert.throws(() => validateLayoutChecks(rules), /layout|Layout/);
});

test('a source-anchored spacing audit classifies each explicit rule without altering appearance contracts', async () => {
  const rules = [
    { ...gap, source: { file: 'src/Brand.jsx', line: 3 } },
    { id: 'copy', kind: 'style', selector: '.copy', property: 'wordSpacing', expected: 'normal' },
    { id: 'callout', kind: 'text-inset', selector: '.callout', min: { bottom: 12 } },
  ];
  const measurements = {
    'wordmark-gap': { gap: -2, verticalOverlap: 18 },
    copy: { property: 'wordSpacing', value: 'normal' },
    callout: { top: 16, right: 16, bottom: 14, left: 16, textRects: 2 },
  };
  const page = {
    async evaluate(_fn, { rules: selected }) { return selected.map((rule) => ({ id: rule.id, ok: true, measured: measurements[rule.id], fingerprint: [1, rule.id] })); },
    locator() { throw new Error('Synthetic unavailable preview'); },
  };
  const result = await auditLayout(page, rules, { scope });
  assert.deepEqual(result.counts, { rules: 3, passed: 2, findings: 1, incomplete: 0 });
  assert.equal(result.coverage, 'observed');
  assert.equal(result.results[0].status, 'finding');
  assert.deepEqual(result.results[0].source, { status: 'manual', file: 'src/Brand.jsx', line: 3 });
  assert.deepEqual(result.results[1].source, { status: 'unresolved' });
  assert.equal(result.results[0].preview, undefined, 'an unavailable preview is not invented');
  assert.deepEqual(result.scope, scope);
  assert.equal(JSON.stringify(result).includes('button-finding'), false);
});

test('a changing target yields incomplete evidence rather than a clean spacing check', async () => {
  let snapshots = 0;
  const page = {
    async evaluate() { return [{ id: gap.id, ok: true, measured: { gap: 5, verticalOverlap: 18 }, fingerprint: [++snapshots] }]; },
    locator() { throw new Error('An unstable target must not be given a preview'); },
  };
  const result = await auditLayout(page, [gap], { scope });
  assert.equal(result.coverage, 'partial');
  assert.deepEqual(result.counts, { rules: 1, passed: 0, findings: 0, incomplete: 1 });
  assert.match(result.results[0].message, /changed/);
});

test('missing target diagnostics remain incomplete and empty contracts remain insufficient', async () => {
  const missingPage = { async evaluate() { return [{ id: gap.id, ok: false, message: 'Each configured selector must match exactly one element.', measured: { matches: 0, otherMatches: 1 } }]; } };
  const missing = await auditLayout(missingPage, [gap], { scope });
  assert.equal(missing.coverage, 'partial');
  assert.equal(missing.results[0].status, 'incomplete');
  const empty = await auditLayout({ async evaluate() { return []; } }, [], { scope });
  assert.equal(empty.coverage, 'insufficient');
  assert.deepEqual(empty.counts, { rules: 0, passed: 0, findings: 0, incomplete: 0 });
});

test('fatal browser failures and mismatched snapshots cannot produce completed layout evidence', async () => {
  await assert.rejects(auditLayout({ async evaluate() { throw new Error('Synthetic closed browser'); } }, [gap], { scope }), /closed browser/);
  await assert.rejects(auditLayout({ async evaluate() { return []; } }, [gap], { scope }), /incomplete rule data/);
  await assert.rejects(auditLayout({ async evaluate() { return [{ id: 'unrelated' }]; } }, [gap], { scope }), /mismatched rule data/);
});
