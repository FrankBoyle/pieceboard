import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeButtonConsistency, BUTTON_STYLE_FIELDS } from '../src/consistency.js';
import { readBaselines, setBaseline } from '../src/baselines.js';

const base = Object.fromEntries(BUTTON_STYLE_FIELDS.map(([key]) => [key, key.includes('Color') || key === 'color' ? 'rgb(1, 2, 3)' : ['boxShadow', 'backgroundImage', 'textTransform', 'textDecorationLine', 'filter'].includes(key) ? 'none' : key === 'opacity' ? '1' : key === 'fontStyle' ? 'normal' : '8px']));
const button = (index, style = base) => ({ tag: 'button', index, visible: true, type: 'button', classes: ['button', 'primary'], style, source: { status: 'likely', file: `src/page${index}.jsx`, line: index + 1 } });
const scope = { url: 'http://127.0.0.1:3000/settings', viewport: { width: 1440, height: 900 }, theme: 'app:light;browser:light' };

async function tempReport(t, analysis) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-baseline-'));
  const file = path.join(root, 'baseline.json');
  t.after(async () => { await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rm(file, { force: true }); await fs.rmdir(root); });
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ format: 'ui-sheet/v1', consistency: analysis }));
  return { root, file };
}

test('records an approved appearance and applies it even when it is no longer the majority', async (t) => {
  const wrong = { ...base, borderTopLeftRadius: '3px' };
  const initial = analyzeButtonConsistency([button(0), button(1), button(2, wrong)], scope);
  const { root, file } = await tempReport(t, initial);
  const created = await setBaseline(root, { file, findingId: initial.findings[0].id, example: 'common', reason: 'Approved primary button.' });
  const baseline = await readBaselines(file);
  assert.equal(baseline.rules.length, 1);
  assert.equal(baseline.rules[0].id, created.id);
  assert.equal(baseline.rules[0].scope.url, 'local:/settings');
  assert.equal(JSON.stringify(baseline).includes('data:image'), false);
  const later = analyzeButtonConsistency([button(0), button(1, wrong), button(2, wrong)], { ...scope, url: 'http://localhost:4000/settings', baselines: baseline.rules });
  assert.equal(later.findings[0].reference, 'approved');
  assert.equal(later.findings[0].common.count, 1);
  assert.equal(later.findings[0].outlier.count, 2);
  assert.equal(later.findings[0].differences[0].observed, '3px');
});

test('refuses unstable groups, unknown theme, and unrelated baseline files', async (t) => {
  const wrong = { ...base, borderTopLeftRadius: '3px' };
  const initial = analyzeButtonConsistency([button(0), button(1), button(2, wrong)], scope);
  const { root, file } = await tempReport(t, initial);
  await fs.writeFile(file, '{"other":"data"}');
  await assert.rejects(setBaseline(root, { file, findingId: initial.findings[0].id, example: 'common', reason: 'Approved.' }), /not a Pieceboard baseline file/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"other":"data"}');
  await fs.rm(file);
  initial.findings[0].group.familyEvidence = 'shared container';
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ format: 'ui-sheet/v1', consistency: initial }));
  await assert.rejects(setBaseline(root, { file, findingId: initial.findings[0].id, example: 'common', reason: 'Approved.' }), /stable explicit group/);
  initial.findings[0].group.familyEvidence = 'component class';
  initial.scope.theme = 'unknown';
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ format: 'ui-sheet/v1', consistency: initial }));
  await assert.rejects(setBaseline(root, { file, findingId: initial.findings[0].id, example: 'common', reason: 'Approved.' }), /no theme context/);
});

test('does not silently upgrade old baselines that lack current measurements', async (t) => {
  const initial = analyzeButtonConsistency([button(0), button(1), button(2)], scope);
  const { root, file } = await tempReport(t, initial);
  const old = JSON.stringify({ format: 'ui-sheet/baselines-v1', rules: [] });
  await fs.writeFile(file, old);
  await assert.rejects(readBaselines(file), /predates four-sided border measurements.*reapprove appearances/);
  assert.equal(await fs.readFile(file, 'utf8'), old);
  const previous = JSON.stringify({ format: 'ui-sheet/baselines-v2', rules: [] });
  await fs.writeFile(file, previous);
  await assert.rejects(readBaselines(file), /predates gradient and text-style measurements.*reapprove appearances/);
  assert.equal(await fs.readFile(file, 'utf8'), previous);
  const effectsMissing = JSON.stringify({ format: 'ui-sheet/baselines-v3', rules: [] });
  await fs.writeFile(file, effectsMissing);
  await assert.rejects(readBaselines(file), /predates opacity and filter measurements.*reapprove appearances/);
  await assert.rejects(setBaseline(root, { file, observationId: 'button:0', reason: 'Review.' }), /predates opacity and filter measurements/);
  assert.equal(await fs.readFile(file, 'utf8'), effectsMissing);
});

test('refuses a finding whose selected appearance belongs to a different group', async (t) => {
  const wrong = { ...base, borderTopLeftRadius: '3px' };
  const initial = analyzeButtonConsistency([button(0), button(1), button(2, wrong)], scope);
  initial.findings[0].group = { ...initial.findings[0].group, family: 'unrelated' };
  const { root, file } = await tempReport(t, initial);
  await assert.rejects(setBaseline(root, { file, findingId: initial.findings[0].id, example: 'outlier', reason: 'Review.' }), /does not belong to this group/);
});

test('can approve an observed appearance even when no finding exists', async (t) => {
  const consistent = analyzeButtonConsistency([button(0), button(1), button(2)], scope);
  assert.equal(consistent.findings.length, 0);
  const { root, file } = await tempReport(t, consistent);
  await setBaseline(root, { file, observationId: 'button:0', reason: 'Approved default.' });
  assert.equal((await readBaselines(file)).rules.length, 1);
  const other = { ...consistent, scope: { ...consistent.scope, url: 'http://localhost:3000/other' } };
  const multi = { format: 'ui-sheet/v1', consistency: { format: 'ui-sheet/consistency-v2', pages: [consistent, other] } };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(multi));
  await assert.rejects(setBaseline(root, { file, observationId: 'button:0', reason: 'Approved.' }), /Specify --page/);
  await setBaseline(root, { file, observationId: 'button:0', pageIndex: 1, reason: 'Approved again.' });
  assert.equal((await readBaselines(file)).rules[0].reason, 'Approved again.');
  multi.consistency.pages[1].scope = { ...consistent.scope, url: 'http://localhost:4000/settings?view=other' };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(multi));
  await assert.rejects(setBaseline(root, { file, observationId: 'button:0', pageIndex: 1, reason: 'Approved.' }), /same route, viewport, and theme/);
});

test('retains a manually linked source on an approved appearance', async (t) => {
  const entry = button(0);
  entry.source = { status: 'manual', file: 'src/page.jsx', line: 9, method: 'configured selector and source location' };
  const observed = analyzeButtonConsistency([entry], scope);
  const { root, file } = await tempReport(t, observed);
  await setBaseline(root, { file, observationId: 'button:0', reason: 'Approved by a reviewer.' });
  assert.deepEqual((await readBaselines(file)).rules[0].source, entry.source);
});

test('keeps approved baselines separate when capture pixel ratio changes', async (t) => {
  const wrong = { ...base, borderTopLeftRadius: '3px' };
  const initial = analyzeButtonConsistency([button(0), button(1), button(2, wrong)], scope);
  const { root, file } = await tempReport(t, initial);
  await setBaseline(root, { file, observationId: 'button:0', reason: 'Approved at 2x.' });
  const rules = (await readBaselines(file)).rules;
  const later = analyzeButtonConsistency([button(0), button(1, wrong), button(2, wrong)], { ...scope, pixelRatio: 4, baselines: rules });
  assert.equal(later.findings[0].reference, 'inferred');
  assert.notEqual(later.findings[0].id, initial.findings[0].id);
  assert.deepEqual(later.baselinesUsed, []);
  const backAtTwo = analyzeButtonConsistency([button(0), button(1, wrong), button(2, wrong)], { ...scope, pixelRatio: 2, baselines: rules });
  assert.equal(backAtTwo.findings[0].reference, 'approved');
});

test('records a cross-page baseline only for an explicitly named group and variant', async (t) => {
  const observed = analyzeButtonConsistency([button(0), button(1), button(2)].map((entry) => ({ ...entry, family: 'save actions', variant: 'primary' })), scope);
  const { root, file } = await tempReport(t, observed);
  await setBaseline(root, { file, observationId: 'button:0', crossPage: true, reason: 'Approved across pages.' });
  assert.equal((await readBaselines(file)).rules[0].scope.url, '*');
  observed.observations[0].group.variantEvidence = 'class name';
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ format: 'ui-sheet/v1', consistency: observed }));
  await assert.rejects(setBaseline(root, { file, observationId: 'button:0', crossPage: true, reason: 'Approved.' }), /explicitly named group and variant/);
});
