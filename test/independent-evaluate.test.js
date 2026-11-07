import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import { frozenIndependentArtifacts, independentBrowserFixture, independentCaptureOptions, scoreIndependentCase, summarizeIndependentScores, validateIndependentCases } from '../evaluation/independent-evaluate.js';

const normalGroup = { family: 'editor', variant: 'primary', type: 'button' };
const sourceLines = [6, 7, 8, 9, 10];
const options = { viewport: { width: 1280, height: 900 }, colorScheme: 'light', pixelRatio: 2, actions: [] };
const sample = {
  id: 'known-defect', description: 'Authored requirement.', scoring: 'scored', css: '',
  buttons: Array.from({ length: 5 }, () => ({ group: 'editor', variant: 'primary' })), expected: [1, 2],
};
const defaults = { viewport: { width: 1280, height: 900 }, colorScheme: 'light', pixelRatio: 2 };
const dataFor = (cases) => ({ format: 'ui-sheet/browser-evaluation-v1', setId: 'unit-fixtures', captureDefaults: defaults, cases });

function syntheticAnalysis() {
  return {
    counts: { seen: 5, eligible: 5 },
    observations: [0, 1, 2, 3, 4].map((index) => ({
      id: `button:${index}`,
      group: index === 4 ? { ...normalGroup, family: 'another-family' } : normalGroup,
      style: { radius: index >= 2 ? 20 : 8 },
      source: { status: 'likely', method: 'unique ID and tag', file: 'case.html', line: sourceLines[index] },
    })),
    findings: [{ group: normalGroup, outlier: { example: 'button:2' } }],
    previewCoverage: { requested: 2, captured: 2 },
    scope: { browser: { version: 'synthetic-no-browser-run' } },
  };
}

test('independent fixture retains comparison hints, false toggle state, and source lines', () => {
  const fixture = independentBrowserFixture({
    ...sample,
    css: '.one{color:red}\n.two{color:blue}',
    buttons: [
      { label: 'Save &\nreview', group: 'editor "group"\ncontinued', variant: 'toggle', pressed: false },
      { label: '<Delete>', group: 'editor', variant: 'toggle', pressed: true, disabled: true },
    ],
  });
  const lines = fixture.html.split('\n');
  assert.equal(fixture.sourceLines.length, 2);
  assert.match(lines[fixture.sourceLines[0] - 1], /data-ui-sheet-group="editor &quot;group&quot;&#10;continued"/);
  assert.match(lines[fixture.sourceLines[0] - 1], /aria-pressed="false"/);
  assert.match(lines[fixture.sourceLines[0] - 1], /Save &amp;&#10;review/);
  assert.match(lines[fixture.sourceLines[1] - 1], /aria-pressed="true".*&lt;Delete&gt;/);
  assert.ok(lines[fixture.sourceLines[0] - 1].startsWith('<button id="evaluation-0"'));
  assert.ok(lines[fixture.sourceLines[1] - 1].startsWith('<button id="evaluation-1"'));
});

test('independent capture options apply viewport/theme overrides and indexed state actions', () => {
  assert.deepEqual(independentCaptureOptions(dataFor([sample]), sample), options);
  assert.deepEqual(independentCaptureOptions(dataFor([sample]), {
    ...sample, viewport: { width: 390, height: 844 }, colorScheme: 'dark', interactions: [{ type: 'focus', button: 3 }, { type: 'hover', button: 4 }],
  }), {
    viewport: { width: 390, height: 844 }, colorScheme: 'dark', pixelRatio: 2,
    actions: [{ kind: 'focus', selector: '#evaluation-3' }, { kind: 'hover', selector: '#evaluation-4' }],
  });
});

test('independent validation refuses ambiguous scoring flags and invalid state setup', () => {
  assert.equal(validateIndependentCases(dataFor([sample])).cases[0], sample);
  assert.throws(() => validateIndependentCases(dataFor([{ ...sample, scoring: undefined }])), /scoring policy/);
  assert.throws(() => validateIndependentCases(dataFor([{ ...sample, scoring: 'unscorable', unscorableReason: 'Unknown intent.' }])), /scoring policy/);
  assert.throws(() => validateIndependentCases(dataFor([{ ...sample, interactions: [{ type: 'click', button: 1 }] }])), /interaction/);
  assert.throws(() => validateIndependentCases(dataFor([{ ...sample, interactions: [{ type: 'hover', button: 5 }] }])), /interaction/);
});

test('independent scorer expands all occurrences within a family and records complete errors', () => {
  const analysis = syntheticAnalysis();
  analysis.observations[1].source.line = 100;
  const result = scoreIndependentCase(sample, analysis, 'case.html', sourceLines, options);
  assert.deepEqual(result.predicted, [2, 3]);
  assert.deepEqual(result.metrics, { tp: 1, fp: 1, fn: 1, truePositiveIndexes: [2], falsePositiveIndexes: [3], falseNegativeIndexes: [1] });
  assert.equal(result.sourceMatches, 4);
  assert.equal(result.sourceChecks[1].matched, false);
  assert.equal(result.sourceChecks[1].expectedLine, 7);
  assert.equal(result.sourceChecks[1].actual.line, 100);
});

test('unscorable predictions remain visible and cannot enter accuracy totals', () => {
  const scored = scoreIndependentCase(sample, syntheticAnalysis(), 'case.html', sourceLines, options);
  const diagnostic = scoreIndependentCase({ ...sample, id: 'unknown-intent', scoring: 'unscorable', expected: [], unscorableReason: 'No approved intent.' }, syntheticAnalysis(), 'case.html', sourceLines, options);
  assert.deepEqual(diagnostic.predicted, [2, 3]);
  assert.equal(diagnostic.expected, null);
  assert.equal(diagnostic.metrics, null);
  const summary = summarizeIndependentScores([scored, diagnostic]);
  assert.deepEqual(summary.totals, { tp: 1, fp: 1, fn: 1 });
  assert.equal(summary.scoredCases, 1);
  assert.equal(summary.unscorableCases, 1);
  assert.equal(summary.scoredFixtureControls, 5);
  assert.equal(summary.labeledPositiveControls, 2);
  assert.equal(summary.precision, .5);
  assert.equal(summary.recall, .5);
});

test('missing verified capture actions are harness errors rather than false negatives', () => {
  const focusOptions = { ...options, actions: [{ kind: 'focus', selector: '#evaluation-4' }] };
  const analysis = syntheticAnalysis();
  assert.throws(() => scoreIndependentCase(sample, analysis, 'case.html', sourceLines, focusOptions), /did not verify/);
  analysis.scope.actions = focusOptions.actions;
  assert.doesNotThrow(() => scoreIndependentCase(sample, analysis, 'case.html', sourceLines, focusOptions));
});

test('frozen label artifacts match the pre-score hashes and declared set counts', async () => {
  for (const [file, expected] of Object.entries(frozenIndependentArtifacts.files)) {
    const bytes = await fs.readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
  const data = validateIndependentCases(JSON.parse(await fs.readFile(new URL('../evaluation/independent-button-cases.json', import.meta.url), 'utf8')));
  const scored = data.cases.filter((entry) => entry.scoring === 'scored');
  assert.equal(data.cases.length, 47);
  assert.equal(scored.length, 40);
  assert.equal(scored.reduce((sum, entry) => sum + entry.expected.length, 0), 28);
  assert.equal(scored.reduce((sum, entry) => sum + entry.buttons.length, 0), 208);
});
