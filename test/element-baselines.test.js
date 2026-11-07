import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyzeElementConsistency } from '../src/element-consistency.js';
import { BUTTON_STYLE_FIELDS } from '../src/consistency.js';
import { elementBaselineId, elementBaselineTemplate, readElementBaselines, setElementBaseline } from '../src/element-baselines.js';

const style = Object.fromEntries(BUTTON_STYLE_FIELDS.map(([key]) => [key, key.includes('Color') || key === 'color' ? 'rgb(1, 2, 3)' : ['boxShadow', 'backgroundImage', 'textTransform', 'textDecorationLine', 'filter'].includes(key) ? 'none' : key === 'opacity' ? '1' : key === 'fontStyle' ? 'normal' : '8px']));
const wrong = { ...style, borderTopLeftRadius: '2px' };
const scope = { url: 'http://localhost:8000/settings', theme: 'app:light;browser:light' };
const element = (index, updates = {}) => ({ tag: 'input', nativeType: 'text', index, visible: true, visibilityEvidence: 'clear', state: 'default', configured: { family: 'account field', variant: 'regular', type: 'inputs' }, style: { ...style }, source: { status: 'likely', file: `src/field${index}.tsx`, line: index + 1 }, ...updates });
const sample = () => analyzeElementConsistency([element(0), element(1), element(2, { style: wrong })], scope);

async function report(t, pages = [sample()]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-element-baseline-'));
  const file = path.join(root, 'approved.json');
  t.after(async () => {
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-element-baseline-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const write = (next) => fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ format: 'ui-sheet/v1', elementConsistency: { format: 'ui-sheet/element-pages-v1', pages: next } }));
  await write(pages);
  return { root, file, write };
}

test('approves the observed reference and detects a wrong majority with real group evidence', async (t) => {
  const { root, file } = await report(t);
  const saved = await setElementBaseline(root, { file, observationId: 'input:0', reason: 'Approved account field.' });
  const baseline = await readElementBaselines(file);
  assert.equal(baseline.format, 'ui-sheet/element-baselines-v2');
  assert.equal(baseline.rules[0].id, saved.id);
  assert.equal(baseline.rules[0].scope.url, 'local:/settings');
  assert.equal(baseline.rules[0].group.state, 'default');
  assert.equal(baseline.rules[0].source.file, 'src/field0.tsx');
  assert.equal(JSON.stringify(baseline).includes('data:image'), false);
  const later = analyzeElementConsistency([element(0), element(1, { style: wrong }), element(2, { style: wrong })], { ...scope, baselines: baseline.rules });
  const finding = later.findings[0];
  assert.equal(finding.reference, 'approved');
  assert.equal(finding.common.count, 1);
  assert.equal(finding.outlier.count, 2);
  assert.equal(finding.decisionAnchor, undefined, 'a repeated source cannot receive a singleton decision anchor');
  assert.deepEqual(later.baselinesUsed, [saved.id]);
  assert.equal(later.coverage, 'observed');
});

test('compares a singleton against an approved style absent from the current page', async (t) => {
  const initial = sample();
  const { root, file } = await report(t, [initial]);
  await setElementBaseline(root, { file, observationId: 'input:0', reason: 'Approved.' });
  const rules = (await readElementBaselines(file)).rules;
  const later = analyzeElementConsistency([element(4, { style: wrong })], { ...scope, baselines: rules });
  assert.equal(later.findings[0].common.count, 0);
  assert.equal(later.findings[0].common.example, null);
  assert.deepEqual(later.findings[0].common.style, rules[0].style);
  assert.equal(later.findings[0].outlier.count, 1);
  assert.equal(later.counts.undersampled, 0);
  assert.equal(later.counts.comparable, 1);
  assert.equal(later.coverage, 'observed');
});

test('keeps state, native type, route, theme, viewport and density approvals separate', async (t) => {
  const { root, file } = await report(t);
  await setElementBaseline(root, { file, observationId: 'input:0', reason: 'Approved.' });
  const rules = (await readElementBaselines(file)).rules;
  for (const change of [{ theme: 'app:dark;browser:dark' }, { viewport: { width: 390, height: 844 } }, { pixelRatio: 4 }, { url: 'http://localhost:8000/other' }]) {
    const next = analyzeElementConsistency([element(0, { style: wrong })], { ...scope, ...change, baselines: rules });
    assert.deepEqual(next.baselinesUsed, [], JSON.stringify(change));
    assert.equal(next.coverage, 'insufficient');
  }
  for (const change of [{ state: 'focused' }, { state: 'aria-selected=true' }, { nativeType: 'search' }, { tag: 'textarea' }, { configured: { family: 'account field', variant: 'compact', type: 'inputs' } }]) {
    const next = analyzeElementConsistency([element(0, { style: wrong, ...change })], { ...scope, baselines: rules });
    assert.deepEqual(next.baselinesUsed, [], JSON.stringify(change));
  }
});

test('honors explicit cross-page references and lets a narrower page approval take precedence', async (t) => {
  const initial = sample();
  const { root, file } = await report(t, [initial]);
  await setElementBaseline(root, { file, observationId: 'input:0', crossPage: true, reason: 'Default across routes.' });
  let rules = (await readElementBaselines(file)).rules;
  assert.equal(rules[0].scope.url, '*');
  const other = analyzeElementConsistency([element(0, { style: wrong })], { ...scope, url: 'http://localhost:9999/other', baselines: rules });
  assert.equal(other.findings[0].reference, 'approved');
  await setElementBaseline(root, { file, observationId: 'input:2', reason: 'This route intentionally differs.' });
  rules = (await readElementBaselines(file)).rules;
  const local = analyzeElementConsistency([element(0, { style: wrong })], { ...scope, baselines: rules });
  assert.equal(local.findings.length, 0);
  assert.deepEqual(local.baselinesUsed, [rules.find((rule) => rule.scope.url === 'local:/settings').id]);
  initial.observations[0].group.variantEvidence = 'unspecified';
  assert.throws(() => elementBaselineTemplate(initial, initial.observations[0], { crossPage: true }), /explicitly configured variant/);
});

test('merges approvals atomically, updates one group, and preserves unrelated and old files', async (t) => {
  const { root, file } = await report(t);
  await setElementBaseline(root, { file, observationId: 'input:0', reason: 'First reference.' });
  await setElementBaseline(root, { file, observationId: 'input:2', reason: 'Changed reference.' });
  const baseline = await readElementBaselines(file);
  assert.equal(baseline.rules.length, 1);
  assert.equal(baseline.rules[0].reason, 'Changed reference.');
  assert.equal(baseline.rules[0].style.borderTopLeftRadius, '2px');
  assert.deepEqual((await fs.readdir(root)).sort(), ['approved.json', 'ui-sheet.json']);
  for (const raw of ['{"private":"unrelated"}', '{"format":"ui-sheet/baselines-v3","rules":[]}', '{"format":"ui-sheet/element-baselines-v0","rules":[]}', '{']) {
    await fs.writeFile(file, raw);
    await assert.rejects(setElementBaseline(root, { file, observationId: 'input:0', reason: 'Review.' }), /unsupported element baseline|not valid JSON/);
    assert.equal(await fs.readFile(file, 'utf8'), raw);
  }
});

test('refuses duplicate, malformed, oversized and concurrently locked files', async (t) => {
  const { root, file } = await report(t);
  await setElementBaseline(root, { file, observationId: 'input:0', reason: 'Approved.' });
  const baseline = await readElementBaselines(file);
  const valid = baseline.rules[0];
  const invalids = [
    { ...baseline, rules: [valid, valid] },
    { ...baseline, rules: [{ ...valid, id: '0'.repeat(16) }] },
    { ...baseline, rules: [{ ...valid, scope: { ...valid.scope, pixelRatio: undefined } }] },
    { ...baseline, rules: [{ ...valid, style: { ...valid.style, backgroundImage: 'url(secret)' } }] },
    { ...baseline, rules: [{ ...valid, group: { ...valid.group, state: '' } }] },
    { ...baseline, rules: Array(1001).fill(valid) },
  ];
  for (const invalid of invalids) {
    const raw = JSON.stringify(invalid);
    await fs.writeFile(file, raw);
    await assert.rejects(readElementBaselines(file), /invalid or duplicate|unsupported element baseline/);
    assert.equal(await fs.readFile(file, 'utf8'), raw);
  }
  await fs.writeFile(file, ' '.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(readElementBaselines(file), /at most 2 MB/);
  await fs.writeFile(`${file}.ui-sheet.lock`, 'unrelated lock');
  await assert.rejects(setElementBaseline(root, { file, observationId: 'input:0', reason: 'Review.' }), /being changed or a previous update was interrupted/);
  assert.equal(await fs.readFile(`${file}.ui-sheet.lock`, 'utf8'), 'unrelated lock');
});

test('rejects prior element baseline measurements without changing the old file or inventing effects', async (t) => {
  const { root, file } = await report(t);
  await setElementBaseline(root, { file, observationId: 'input:0', reason: 'Approved.' });
  const current = await readElementBaselines(file);
  const old = structuredClone(current);
  old.format = 'ui-sheet/element-baselines-v1';
  delete old.rules[0].style.opacity;
  delete old.rules[0].style.filter;
  const raw = JSON.stringify(old);
  await fs.writeFile(file, raw);
  await assert.rejects(readElementBaselines(file), /predates opacity and filter measurements.*reapprove appearances/);
  await assert.rejects(setElementBaseline(root, { file, observationId: 'input:0', reason: 'Replace.' }), /predates opacity and filter measurements/);
  assert.equal(await fs.readFile(file, 'utf8'), raw);
  const missing = structuredClone(current);
  delete missing.rules[0].style.opacity;
  delete missing.rules[0].style.filter;
  await fs.writeFile(file, JSON.stringify(missing));
  await assert.rejects(readElementBaselines(file), /invalid or duplicate rule/);
});

test('refuses unknown or stale report measurements and duplicate route scopes', async (t) => {
  const initial = sample();
  const { root, file, write } = await report(t, [initial]);
  assert.throws(() => elementBaselineTemplate({ ...initial, findingIdentity: 'old' }, initial.observations[0]), /current element measurements/);
  assert.throws(() => elementBaselineTemplate({ ...initial, scope: { ...initial.scope, pixelRatio: undefined } }, initial.observations[0]), /incomplete scope/);
  assert.throws(() => elementBaselineTemplate({ ...initial, scope: { ...initial.scope, theme: 'unknown' } }, initial.observations[0]), /incomplete scope/);
  await write([initial, { ...initial, scope: { ...initial.scope, url: 'http://127.0.0.1:9000/settings?tab=other' } }]);
  await assert.rejects(setElementBaseline(root, { file, observationId: 'input:0', reason: 'Review.' }), /duplicate route/);
});

test('IDs bind every explicit group field and approvals change finding authority', async (t) => {
  const initial = sample();
  const first = initial.observations[0];
  const template = elementBaselineTemplate(initial, first);
  assert.equal(template.id, elementBaselineId(template.scope, template.group));
  for (const key of ['family', 'variant', 'type', 'tag', 'nativeType', 'state']) assert.notEqual(elementBaselineId(template.scope, { ...template.group, [key]: `${template.group[key]} other` }), template.id);
  const { root, file } = await report(t, [initial]);
  await setElementBaseline(root, { file, observationId: 'input:0', reason: 'Approved.' });
  const rules = (await readElementBaselines(file)).rules;
  const next = analyzeElementConsistency([element(0), element(1), element(2, { style: wrong })], { ...scope, baselines: rules });
  assert.notEqual(next.findings[0].id, initial.findings[0].id, 'approving the common style changes the authority of the finding');
});
