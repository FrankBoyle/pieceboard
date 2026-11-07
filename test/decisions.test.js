import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyDecisions, setDecision } from '../src/decisions.js';
import { writeReport } from '../src/report.js';

const id = '0123456789abcdef';
const finding = (overrides = {}) => ({ id, decisionAnchor: { file: 'src/Button.jsx', line: 42 }, ...overrides });
const report = (findings = [finding()]) => ({ format: 'ui-sheet/v1', name: 'Demo', items: [], consistency: { findings } });

async function temporaryReport(t, data = report()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-decisions-'));
  const directory = path.join(root, 'report');
  const file = path.join(root, 'decisions.json');
  t.after(async () => {
    await fs.rm(path.join(directory, 'index.html'), { force: true });
    await fs.rm(path.join(directory, 'ui-sheet.json'), { force: true });
    await fs.rm(file, { force: true });
    await fs.rmdir(directory);
    await fs.rmdir(root);
  });
  await writeReport(data, directory);
  return { directory, file };
}

test('records and reapplies a narrowly anchored review decision', async (t) => {
  const { directory, file } = await temporaryReport(t);
  await setDecision(directory, { file, findingId: id, status: 'intentional', reason: 'This action is a special case.' });
  let data = JSON.parse(await fs.readFile(path.join(directory, 'ui-sheet.json'), 'utf8'));
  assert.equal(data.consistency.findings[0].review.status, 'intentional');
  assert.equal(data.consistency.findings[0].review.reason, 'This action is a special case.');
  assert.deepEqual(data.decisionSummary, { applied: 1, stale: 0 });
  data = report();
  await applyDecisions(data, file);
  assert.equal(data.consistency.findings[0].review.status, 'intentional');
  await setDecision(directory, { file, findingId: id, status: 'needs-fix', reason: 'Reconsidered.' });
  const decisions = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(decisions.decisions.length, 1);
  assert.equal(decisions.decisions[0].status, 'needs-fix');
});

test('does not apply stale, unresolved, or duplicate finding decisions', async (t) => {
  const { directory, file } = await temporaryReport(t);
  await setDecision(directory, { file, findingId: id, status: 'intentional', reason: 'Approved.' });
  for (const data of [report([finding({ id: 'fedcba9876543210' })]), report([finding({ decisionAnchor: undefined })]), report([finding(), finding()])]) {
    assert.deepEqual(await applyDecisions(data, file), { applied: 0, stale: 1 });
    assert.equal(data.consistency.findings.some((entry) => entry.review), false);
  }
});

test('refuses unanchored findings and unrelated files', async (t) => {
  const { directory, file } = await temporaryReport(t, report([finding({ decisionAnchor: undefined })]));
  await assert.rejects(setDecision(directory, { file, findingId: id, status: 'intentional', reason: 'Approved.' }), /no source anchor/);
  await writeReport(report(), directory);
  await fs.writeFile(file, '{"my":"data"}');
  await assert.rejects(setDecision(directory, { file, findingId: id, status: 'intentional', reason: 'Approved.' }), /not a Pieceboard decision file/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"my":"data"}');
});

test('records decisions for source-anchored cross-page findings', async (t) => {
  const data = report([]);
  data.crossPageConsistency = { findings: [finding()] };
  const { directory, file } = await temporaryReport(t, data);
  await setDecision(directory, { file, findingId: id, status: 'intentional', reason: 'A deliberate cross-page variant.' });
  const updated = JSON.parse(await fs.readFile(path.join(directory, 'ui-sheet.json'), 'utf8'));
  assert.equal(updated.crossPageConsistency.findings[0].review.status, 'intentional');
  assert.deepEqual(updated.decisionSummary, { applied: 1, stale: 0 });
});
