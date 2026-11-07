import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkReport, compareChecks } from '../src/check.js';
import { beginReportScan } from '../src/scan-status.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const exampleFinding = (id, review = null) => ({ id, kind: 'button-style-outlier', evidence: 'small sample', group: { family: 'actions', variant: 'primary' }, common: { count: 2, example: 'button:0' }, outlier: { count: 1, example: 'button:2' }, differences: [{ label: 'Corner radius', common: '8px', observed: '3px' }], ...(review ? { review } : {}) });
const exampleReport = () => ({ format: 'ui-sheet/v1', warnings: [], decisionSummary: { applied: 1, stale: 2 }, consistency: {
  findingIdentity: 'ui-sheet/button-finding-v6',
  scope: { url: 'https://example.test/', viewport: { width: 1440, height: 900 } },
  counts: { seen: 4, eligible: 4, comparable: 3, undersampled: 1, tied: 0, ambiguous: 0, repeatedMinority: 0, missingStyle: 0, possiblyBlocked: 0, visibilityUnverified: 0 },
  previewCoverage: { requested: 2, attempted: 2, captured: 2, unavailable: 0, omitted: 0 },
  observations: [{ id: 'button:2', source: { status: 'likely', file: 'src/Settings.jsx', line: 42 } }],
  findings: [exampleFinding('1111111111111111', { status: 'intentional', reason: 'Approved.' }), exampleFinding('2222222222222222', { status: 'needs-fix', reason: 'Fix later.' }), exampleFinding('3333333333333333')],
  previews: { 'button:0': { image: 'data:image/png;base64,SECRET' } },
} });

async function tempReport(t, data = exampleReport()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-check-'));
  t.after(async () => { await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rm(path.join(root, '.ui-sheet-scan.json'), { force: true }); await fs.rmdir(root); });
  const run = await beginReportScan(root);
  data.scanRunId = run.runId;
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  await run.finish('completed');
  return root;
}

test('JSON check errors retain a machine-readable envelope and exit 2', async (t) => {
  const root = await tempReport(t, { format: 'ui-sheet/v1', items: [], warnings: [] });
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--json']), (error) => {
    assert.equal(error.code, 2);
    const output = JSON.parse(error.stdout);
    assert.equal(output.format, 'ui-sheet/error-v1');
    assert.equal(output.error.code, 'CHECK_FAILED');
    assert.match(output.error.message, /captured scan/);
    assert.equal(error.stderr, '');
    return true;
  });
});

test('summarizes actionable findings without including screenshot data', async (t) => {
  const root = await tempReport(t);
  const result = await checkReport(root);
  assert.equal(result.result, 'findings');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.actionable, 2);
  assert.equal(result.totalFindings, 3);
  assert.equal(result.findings[0].actionable, false);
  assert.equal(result.findings[1].actionable, true);
  assert.equal(result.findings[1].source.file, 'src/Settings.jsx');
  assert.deepEqual(result.decisions, { applied: 1, stale: 2 });
  assert.equal(JSON.stringify(result).includes('data:image'), false);
});

test('reports insufficient evidence instead of claiming a clean result', async (t) => {
  const data = exampleReport();
  data.consistency.findings = [];
  data.consistency.counts.comparable = 0;
  const root = await tempReport(t, data);
  const result = await checkReport(root);
  assert.equal(result.coverage, 'insufficient');
  assert.equal(result.result, 'insufficient-evidence');
});

test('marks older comparison measurements as incomplete even when no findings exist', async (t) => {
  const data = exampleReport();
  data.consistency.findingIdentity = 'ui-sheet/button-finding-v4';
  data.consistency.counts.undersampled = 0;
  data.consistency.findings = [];
  const root = await tempReport(t, data);
  const result = await checkReport(root);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.result, 'insufficient-evidence');
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--strict-coverage']), (error) => error.code === 2);
  data.consistency.findingIdentity = 'ui-sheet/button-finding-v6';
  data.crossPageConsistency = { format: 'ui-sheet/cross-page-v1', findingIdentity: 'ui-sheet/cross-page-finding-v3', coverage: 'observed', counts: {}, findings: [] };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  const olderCrossPage = await checkReport(root);
  assert.equal(olderCrossPage.coverage, 'partial');
  assert.equal(olderCrossPage.crossPage.coverage, 'partial');
});

test('treats a report without a scan completion record as unverified', async (t) => {
  const data = exampleReport();
  data.consistency.counts.undersampled = 0;
  data.consistency.findings = [];
  const root = await tempReport(t, data);
  await fs.rm(path.join(root, '.ui-sheet-scan.json'));
  const result = await checkReport(root);
  assert.equal(result.scanStatus, 'unverified');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.result, 'insufficient-evidence');
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--strict-coverage']), (error) => error.code === 2);
});

test('reports missing or untracked comparison previews as partial coverage', async (t) => {
  const data = exampleReport();
  data.consistency.counts.undersampled = 0;
  data.consistency.previewCoverage = { requested: 2, attempted: 2, captured: 1, unavailable: 1, omitted: 0 };
  const root = await tempReport(t, data);
  assert.equal((await checkReport(root)).coverage, 'partial');
  delete data.consistency.previewCoverage;
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  assert.equal((await checkReport(root)).coverage, 'partial');
});

test('source warnings and missing warning metadata make a clean-looking report incomplete', async (t) => {
  const data = exampleReport();
  data.consistency.counts.undersampled = 0;
  data.consistency.findings = [];
  data.warnings = [{ file: 'private.jsx', message: 'Could not parse source.' }];
  const root = await tempReport(t, data);
  const warned = await checkReport(root);
  assert.equal(warned.coverage, 'partial');
  assert.equal(warned.result, 'insufficient-evidence');
  assert.equal(warned.sourceWarnings, 1);
  assert.equal(JSON.stringify(warned).includes('private.jsx'), false);
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--strict-coverage']), (error) => error.code === 2);
  delete data.warnings;
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  const unknown = await checkReport(root);
  assert.equal(unknown.coverage, 'partial');
  assert.equal(unknown.sourceWarnings, null);
  data.warnings = [];
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  assert.equal((await checkReport(root)).result, 'no-findings');
});

test('blocked, unverified, and untracked visibility make coverage incomplete', async (t) => {
  const data = exampleReport();
  data.consistency.counts.undersampled = 0;
  data.consistency.findings = [];
  const root = await tempReport(t, data);
  for (const counts of [{ possiblyBlocked: 1, visibilityUnverified: 0 }, { possiblyBlocked: 0, visibilityUnverified: 1 }, { possiblyBlocked: undefined, visibilityUnverified: undefined }]) {
    Object.assign(data.consistency.counts, counts);
    await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
    const result = await checkReport(root);
    assert.equal(result.coverage, 'partial');
    assert.equal(result.result, 'insufficient-evidence');
  }
});

test('reports incomplete instrumentation when eligible buttons lack valid markers', async (t) => {
  const data = exampleReport();
  data.consistency.counts.undersampled = 0;
  data.consistency.findings = [];
  data.consistency.scope.instrumentedSources = true;
  data.consistency.instrumentation = { eligible: 4, matched: 3, missing: 1, invalidOrOverridden: 0 };
  const root = await tempReport(t, data);
  const partial = await checkReport(root);
  assert.equal(partial.coverage, 'partial');
  assert.equal(partial.pages[0].instrumentation.missing, 1);
  data.consistency.instrumentation = { eligible: 4, matched: 4, missing: 0, invalidOrOverridden: 0 };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  assert.equal((await checkReport(root)).coverage, 'observed');
  delete data.consistency.instrumentation;
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  assert.equal((await checkReport(root)).coverage, 'partial');
});

test('does not compare reports with different source-instrumentation settings', async (t) => {
  const data = exampleReport();
  data.consistency.scope.theme = 'light';
  data.consistency.scope.browser = { engine: 'chromium', version: '120.0' };
  data.consistency.findingIdentity = 'ui-sheet/button-finding-v6';
  const root = await tempReport(t, data);
  const ordinary = await checkReport(root);
  const instrumented = structuredClone(ordinary);
  instrumented.pages[0].instrumentedSources = true;
  assert.throws(() => compareChecks(instrumented, ordinary), /source-instrumentation settings/);
});

test('CLI check can return JSON and use explicit CI exit codes', async (t) => {
  const root = await tempReport(t);
  const output = await exec(process.execPath, [cli, 'check', root, '--json']);
  assert.equal(JSON.parse(output.stdout).actionable, 2);
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--fail-on-findings']), (error) => error.code === 1);
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--strict-coverage']), (error) => error.code === 2);
});

test('compares new anchored findings only when scan contexts agree', async (t) => {
  const previous = exampleReport();
  previous.consistency.findingIdentity = 'ui-sheet/button-finding-v6';
  previous.consistency.scope.theme = 'app:light;browser:light';
  previous.consistency.scope.browser = { engine: 'chromium', version: '120.0' };
  previous.consistency.counts.undersampled = 0;
  for (const finding of previous.consistency.findings) finding.decisionAnchor = { file: 'src/Settings.jsx', line: 42 };
  previous.consistency.findings.pop();
  const current = structuredClone(previous);
  current.consistency.findings.push({ ...exampleFinding('3333333333333333'), decisionAnchor: { file: 'src/Settings.jsx', line: 43 } });
  const priorDir = await tempReport(t, previous);
  const currentDir = await tempReport(t, current);
  const comparison = compareChecks(await checkReport(currentDir), await checkReport(priorDir));
  assert.equal(comparison.status, 'new-findings');
  assert.deepEqual(comparison.newFindingIds, ['3333333333333333']);
  await assert.rejects(exec(process.execPath, [cli, 'check', currentDir, '--previous', priorDir, '--fail-on-new']), (error) => error.code === 1);

  current.consistency.findings.at(-1).review = { status: 'intentional', reason: 'Reviewed.' };
  await fs.writeFile(path.join(currentDir, 'ui-sheet.json'), JSON.stringify(current));
  const accepted = JSON.parse((await exec(process.execPath, [cli, 'check', currentDir, '--previous', priorDir, '--fail-on-new', '--json'])).stdout);
  assert.equal(accepted.comparison.status, 'no-new-findings');
  current.consistency.scope.theme = 'app:dark;browser:dark';
  await fs.writeFile(path.join(currentDir, 'ui-sheet.json'), JSON.stringify(current));
  await assert.rejects(exec(process.execPath, [cli, 'check', currentDir, '--previous', priorDir]), /different pages, viewports, themes, capture pixel ratios, browser versions/);
  current.consistency.scope.theme = 'app:light;browser:light';
  current.consistency.scope.pixelRatio = 4;
  await fs.writeFile(path.join(currentDir, 'ui-sheet.json'), JSON.stringify(current));
  await assert.rejects(exec(process.execPath, [cli, 'check', currentDir, '--previous', priorDir]), /capture pixel ratios/);
  current.consistency.scope.pixelRatio = 2;
  current.consistency.findingIdentity = 'ui-sheet/button-finding-v2';
  await fs.writeFile(path.join(currentDir, 'ui-sheet.json'), JSON.stringify(current));
  await assert.rejects(exec(process.execPath, [cli, 'check', currentDir, '--previous', priorDir]), /current finding identity context/);
});

test('marks partial coverage and unanchored findings as incomplete comparisons', async (t) => {
  const report = exampleReport();
  report.consistency.findingIdentity = 'ui-sheet/button-finding-v6';
  report.consistency.scope.theme = 'app:light;browser:light';
  report.consistency.scope.browser = { engine: 'chromium', version: '120.0' };
  const root = await tempReport(t, report);
  const checked = await checkReport(root);
  const compared = compareChecks(checked, checked);
  assert.equal(compared.status, 'incomplete');
  assert.equal(compared.unverifiable, 2);
  assert.equal(compared.unverifiablePrevious, 3);
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--previous', root, '--fail-on-new']), (error) => error.code === 2);
});

test('includes cross-page findings and their coverage in the check', async (t) => {
  const data = exampleReport();
  data.consistency.counts.undersampled = 0;
  data.consistency.findingIdentity = 'ui-sheet/button-finding-v6';
  data.consistency.scope.theme = 'app:light;browser:light';
  data.consistency.scope.browser = { engine: 'chromium', version: '120.0' };
  data.crossPageConsistency = { format: 'ui-sheet/cross-page-v1', findingIdentity: 'ui-sheet/cross-page-finding-v5', coverage: 'observed', counts: { comparableGroups: 1 }, findings: [{
    id: '4444444444444444', kind: 'cross-page-button-style-outlier', group: { family: 'actions', variant: 'primary' }, evidence: 'cross-page frequency', reference: 'inferred',
    common: { count: 2, pageCount: 2 }, outlier: { count: 1, pageCount: 1, example: { url: 'https://example.test/other', source: { status: 'likely', file: 'src/Other.jsx', line: 8 } } },
    decisionAnchor: { file: 'src/Other.jsx', line: 8 }, differences: [],
  }] };
  const root = await tempReport(t, data);
  const result = await checkReport(root);
  assert.equal(result.totalFindings, 4);
  assert.equal(result.crossPage.coverage, 'observed');
  assert.equal(result.findings.at(-1).source.file, 'src/Other.jsx');
  assert.equal(result.findings.at(-1).commonPageCount, 2);
  const withoutCross = { ...result, crossPage: undefined };
  assert.throws(() => compareChecks(result, withoutCross), /cross-page analysis settings/);
});
