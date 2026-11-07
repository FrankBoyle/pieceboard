import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { evaluateButtons } from '../evaluation/evaluate.js';
import { browserFixture, scoreBrowserAnalysis, summarizeBrowserScores, validateBrowserCases } from '../evaluation/browser-evaluate.js';

test('scores each reported control against labeled synthetic examples', async () => {
  const data = JSON.parse(await fs.readFile(new URL('../evaluation/button-cases.json', import.meta.url), 'utf8'));
  const result = evaluateButtons(data);
  const radius = result.cases.find((entry) => entry.id === 'single-radius-drift');
  assert.deepEqual(radius.predicted, [2]);
  assert.deepEqual([radius.tp, radius.fp, radius.fn], [1, 0, 0]);
  const approved = result.cases.find((entry) => entry.id === 'approved-reference-beats-majority');
  assert.deepEqual(approved.predicted, [1, 2]);
  assert.deepEqual([approved.tp, approved.fp, approved.fn], [2, 0, 0]);
  const counts = result.cases.reduce((total, entry) => ({ tp: total.tp + entry.tp, fp: total.fp + entry.fp, fn: total.fn + entry.fn }), { tp: 0, fp: 0, fn: 0 });
  assert.deepEqual(result.totals, counts);
});

test('rejects malformed and duplicate labels', () => {
  assert.throws(() => evaluateButtons({ format: 'other', cases: [] }), /Invalid evaluation data/);
  assert.throws(() => evaluateButtons({ format: 'ui-sheet/button-evaluation-v1', cases: [{ id: 'x', buttons: [{}], expected: [1] }] }), /Invalid evaluation case/);
  assert.throws(() => evaluateButtons({ format: 'ui-sheet/button-evaluation-v1', cases: [{ id: 'x', buttons: [{}], expected: [0, 0] }] }), /Invalid evaluation case/);
});

test('browser evaluation counts every reported occurrence and verifies its source line', async () => {
  const data = validateBrowserCases(JSON.parse(await fs.readFile(new URL('../evaluation/browser-holdout.json', import.meta.url), 'utf8')));
  const sample = data.cases.find((entry) => entry.id === 'wrong-majority');
  const fixture = browserFixture(sample);
  assert.equal(fixture.html.split('\n')[fixture.sourceLines[1] - 1].includes('id="evaluation-1"'), true);
  const group = { family: '.button', variant: 'primary', type: 'button' };
  const observations = [0, 1, 2].map((index) => ({ id: `button:${index}`, group, style: { radius: index ? '3px' : '8px' }, source: { status: 'likely', method: 'unique ID and tag', file: 'wrong-majority.html', line: fixture.sourceLines[index] } }));
  const result = scoreBrowserAnalysis(sample, { observations, findings: [{ group, outlier: { example: 'button:1' } }], counts: { seen: 3, eligible: 3 }, previewCoverage: { requested: 1, captured: 1 } }, 'wrong-majority.html', fixture.sourceLines);
  assert.deepEqual(result.predicted, [1, 2]);
  assert.deepEqual([result.tp, result.fp, result.fn, result.sourceMatches], [2, 0, 0, 3]);
  assert.deepEqual(summarizeBrowserScores([result]).totals, { tp: 2, fp: 0, fn: 0 });
  assert.throws(() => validateBrowserCases({ format: 'ui-sheet/browser-evaluation-v1', cases: [{ ...sample, expected: [99] }] }), /Invalid browser evaluation case/);
});

test('recorded browser evaluation matches its frozen labels and totals', async () => {
  const dataset = validateBrowserCases(JSON.parse(await fs.readFile(new URL('../evaluation/browser-holdout.json', import.meta.url), 'utf8')));
  const raw = await fs.readFile(new URL('../evaluation/results/browser-fe560ff.json', import.meta.url), 'utf8');
  const result = JSON.parse(raw);
  assert.equal(result.cases.length, dataset.cases.length);
  for (const [index, sample] of dataset.cases.entries()) {
    assert.equal(result.cases[index].id, sample.id);
    assert.deepEqual(result.cases[index].expected, sample.expected);
  }
  const recomputed = summarizeBrowserScores(result.cases);
  assert.deepEqual(result.totals, recomputed.totals);
  assert.equal(result.precision, recomputed.precision);
  assert.equal(result.recall, recomputed.recall);
  assert.equal(raw.includes('data:image'), false);
});
