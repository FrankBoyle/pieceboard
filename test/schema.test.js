import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { scanProject } from '../src/scan.js';
import { analyzeButtonConsistency, BUTTON_STYLE_FIELDS, FILTER_PATTERN } from '../src/consistency.js';
import { analyzeAcrossPages } from '../src/cross-page.js';
import { summarizeAppearances, listAppearances } from '../src/appearances.js';
import { writeReport } from '../src/report.js';
import { beginReportScan } from '../src/scan-status.js';
import { checkReport, compareChecks } from '../src/check.js';
import { setBaseline, readBaselines } from '../src/baselines.js';
import { setDecision } from '../src/decisions.js';
import { catalogReport } from '../src/catalog.js';
import { locateButtons } from '../src/locations.js';
import { analyzeElementConsistency } from '../src/element-consistency.js';
import { elementBaselineTemplate, readElementBaselines, setElementBaseline } from '../src/element-baselines.js';
import { listElementAppearances, locateElements } from '../src/element-queries.js';
import { listFindingLocations } from '../src/finding-locations.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));

const schemaDirectory = new URL('../schemas/', import.meta.url);
const schemas = new Map();
for (const file of await fs.readdir(schemaDirectory)) {
  if (file.endsWith('.schema.json')) schemas.set(file, JSON.parse(await fs.readFile(new URL(file, schemaDirectory), 'utf8')));
}
const validator = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
for (const schema of schemas.values()) validator.addSchema(schema);
const validate = (name, value) => {
  const schema = schemas.get(`${name}.schema.json`);
  assert.ok(schema, `Unknown schema: ${name}`);
  const check = validator.getSchema(schema.$id);
  assert.equal(check(value), true, `${name}: ${validator.errorsText(check.errors, { separator: '\n' })}`);
};
const reject = (name, value) => {
  const check = validator.getSchema(schemas.get(`${name}.schema.json`).$id);
  assert.equal(check(value), false, `${name} accepted an invalid fixture`);
};

const style = Object.fromEntries(BUTTON_STYLE_FIELDS.map(([key]) => [key,
  key.includes('Color') || key === 'color' ? 'rgb(0, 0, 255)'
    : ['backgroundImage', 'boxShadow', 'textTransform', 'textDecorationLine', 'filter'].includes(key) ? 'none'
      : key === 'fontStyle' ? 'normal' : key === 'opacity' ? '1' : '8px',
]));
function measuredPage(route, changed = false) {
  const analysis = analyzeButtonConsistency([0, 1, 2].map((index) => ({
    tag: 'button', index, visible: true, type: 'button', visibilityEvidence: 'clear',
    family: 'account actions', familyEvidence: 'configured group',
    variant: 'primary', variantEvidence: 'configured variant',
    style: changed && index === 2 ? { ...style, borderTopLeftRadius: '3px' } : style,
    source: { status: 'likely', file: 'App.jsx', line: index + 1, method: 'unique ID and tag', elementId: `action-${index}` },
  })), { url: `http://localhost:3210/${route}`, theme: 'app:light;browser:light' });
  analysis.scope.browser = { engine: 'chromium', version: 'schema-fixture' };
  analysis.scope.instrumentedSources = false;
  analysis.appearances = summarizeAppearances(analysis.observations);
  return analysis;
}

function measuredElements({ baselines = [], allChanged = false } = {}) {
  const analysis = analyzeElementConsistency([0, 1, 2].map((index) => ({
    tag: 'input', index, nativeType: 'text', visible: true, visibilityEvidence: 'clear', state: 'default',
    configured: { family: 'profile field', type: 'inputs', variant: 'regular' },
    style: allChanged || index === 2 ? { ...style, fontSize: '12px' } : style,
    source: { status: 'likely', file: 'Form.jsx', line: index + 1 },
  })), { url: 'http://localhost:3210/one', theme: 'app:light;browser:light', browser: { engine: 'chromium', version: 'schema-fixture' }, baselines });
  analysis.scope.actions = [{ kind: 'focus', selector: '#dialog-trigger' }];
  analysis.scope.elementGroups = [{ selector: '.field', family: 'profile field', type: 'inputs', variant: 'regular' }];
  analysis.scope.instrumentedSources = true;
  analysis.instrumentation = { eligible: 3, matched: 0 };
  analysis.previews = { 'input:0': { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', pixelRatio: 1, width: 1, height: 1 } };
  analysis.previewCoverage = { requested: 2, attempted: 1, captured: 1, unavailable: 0, omitted: 1 };
  return analysis;
}

test('all shipped schemas compile and share the complete current comparison fields', () => {
  for (const schema of schemas.values()) assert.equal(typeof validator.getSchema(schema.$id), 'function');
  const currentStyle = schemas.get('common-v1.schema.json').$defs.style;
  assert.deepEqual([...currentStyle.required].sort(), BUTTON_STYLE_FIELDS.map(([key]) => key).sort());
  assert.deepEqual(Object.keys(currentStyle.properties), currentStyle.required);
  assert.equal(currentStyle.properties.filter.anyOf[1].pattern, FILTER_PATTERN);
});

test('schemas validate generated reports, compact outputs and saved review files', { timeout: 15000 }, async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-schema-'));
  t.after(async () => {
    const actual = await fs.realpath(temporary);
    const tempRoot = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== tempRoot || !path.basename(actual).startsWith('ui-sheet-schema-')) throw new Error('Unexpected schema test directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(temporary, 'App.jsx'), 'export function App(){return <button id="save">Save</button>}');
  await fs.writeFile(path.join(temporary, 'ui-sheet.config.json'), JSON.stringify({ components: { '<button>': { docs: 'https://example.test/button' } } }));
  const data = await scanProject(temporary);
  validate('report-v1', JSON.parse(JSON.stringify(data)));
  const docsItem = data.items.find((item) => item.docs);
  assert.equal(typeof docsItem?.docs, 'string', 'the report contract covers configured documentation links');
  const first = measuredPage('one', true);
  data.consistency = first;
  validate('report-v1', data);
  const pages = [first, measuredPage('two'), measuredPage('three')];
  data.consistency = { format: 'ui-sheet/consistency-v2', pages };
  data.crossPageConsistency = analyzeAcrossPages(pages);
  const configured = measuredElements();
  configured.appearances[0].approval = {
    page: elementBaselineTemplate(configured, configured.observations[0]),
    crossPage: elementBaselineTemplate(configured, configured.observations[0], { crossPage: true }),
  };
  validate('elements-v1', configured);
  data.elementConsistency = { format: 'ui-sheet/element-pages-v1', pages: [configured] };
  validate('element-pages-v1', data.elementConsistency);
  data.sourceRevision = { kind: 'git', commit: 'a'.repeat(40), dirty: null, trackedSourceFiles: 1, scannedSourceFiles: 1, recordedAt: new Date().toISOString() };
  validate('report-v1', data);
  const report = path.join(temporary, 'report');
  const run = await beginReportScan(report);
  await run.planPages(3);
  for (const index of [1, 2, 3]) {
    await run.startPage(index, 'capture');
    validate('scan-status-v1', JSON.parse(await fs.readFile(path.join(report, '.ui-sheet-scan.json'), 'utf8')));
    await run.completePage(index, 'capture');
  }
  data.scanProgress = run.getPageProgress();
  data.scanRunId = run.runId;
  await writeReport(data, report);
  await run.finish('completed');
  validate('scan-status-v1', JSON.parse(await fs.readFile(path.join(report, '.ui-sheet-scan.json'), 'utf8')));
  const check = await checkReport(report);
  validate('check-v1', check);
  validate('check-v1', { ...check, pageProgress: run.getPageProgress() });
  reject('check-v1', { ...check, scanStatus: 'unverified', pageProgress: run.getPageProgress() });
  const invalidCheckProgress = { ...check, pageProgress: { ...run.getPageProgress(), active: { index: 1, phase: 'capture' } } };
  reject('check-v1', invalidCheckProgress);
  validate('check-v1', { ...check, elementBaselines: { applied: 0, unmatched: 1 } });
  reject('check-v1', { ...check, elementBaselines: { applied: -1, unmatched: 0 } });
  assert.equal(check.elementPages.length, 1);
  assert.equal(check.findings.some((finding) => finding.kind === 'configured-element-style-outlier'), true);
  const invalidElementCheck = structuredClone(check);
  invalidElementCheck.elementPages[0].counts.missingState = -1;
  reject('check-v1', invalidElementCheck);
  const invalidGroupCheck = structuredClone(check);
  delete invalidGroupCheck.findings.find((finding) => finding.kind === 'configured-element-style-outlier').group.state;
  reject('check-v1', invalidGroupCheck);
  validate('check-v1', { ...check, comparison: compareChecks(check, check) });
  validate('catalog-v1', await catalogReport(report));
  validate('appearances-v1', await listAppearances(report));
  validate('locations-v1', await locateButtons(report, { family: 'account actions' }));
  const nativeLocations = await listFindingLocations(report, { findingId: first.findings[0].id, side: 'common', limit: 1 });
  validate('finding-locations-v1', nativeLocations);
  assert.equal(nativeLocations.total, 2);
  assert.equal(nativeLocations.truncated, true);
  assert.equal(nativeLocations.locations.length, 1);
  const configuredLocations = await listFindingLocations(report, { findingId: configured.findings[0].id });
  validate('finding-locations-v1', configuredLocations);
  assert.equal(configuredLocations.locations[0].observationId, 'input:2');
  const crossLocations = await listFindingLocations(report, { findingId: data.crossPageConsistency.findings[0].id });
  validate('finding-locations-v1', crossLocations);
  assert.equal(crossLocations.total, 1);
  const invalidFindingLocations = structuredClone(configuredLocations);
  delete invalidFindingLocations.locations[0].group.state;
  reject('finding-locations-v1', invalidFindingLocations);
  const invalidFindingSide = { ...nativeLocations, side: 'all' };
  reject('finding-locations-v1', invalidFindingSide);
  const elementAppearances = await listElementAppearances(report, { limit: 1 });
  validate('element-appearances-v1', elementAppearances);
  assert.equal(elementAppearances.scanStatus, 'completed');
  assert.equal(elementAppearances.truncated, true);
  assert.equal(elementAppearances.appearances.length, 1);
  assert.equal(elementAppearances.appearances[0].previewAvailable, true);
  assert.equal(JSON.stringify(elementAppearances).includes('data:image'), false);
  assert.equal('approval' in elementAppearances.appearances[0], false);
  assert.equal('actions' in elementAppearances.scope, false);
  assert.equal('elementGroups' in elementAppearances.scope, false);
  const invalidElementAppearance = structuredClone(elementAppearances);
  invalidElementAppearance.appearances[0].previewAvailable = 'yes';
  reject('element-appearances-v1', invalidElementAppearance);
  const elementLocations = await locateElements(report, { family: 'profile field', variant: 'regular', type: 'inputs', limit: 2 });
  validate('element-locations-v1', elementLocations);
  assert.equal(elementLocations.total, 3);
  assert.equal(elementLocations.truncated, true);
  assert.equal(elementLocations.occurrences.length, 2);
  assert.equal(elementLocations.scopes.length, 1);
  const invalidElementLocation = structuredClone(elementLocations);
  delete invalidElementLocation.occurrences[0].group.state;
  reject('element-locations-v1', invalidElementLocation);
  const invalidQueryScope = structuredClone(elementLocations);
  delete invalidQueryScope.scopes[0].scope.pixelRatio;
  reject('element-locations-v1', invalidQueryScope);
  const emptyElementLocations = await locateElements(report, { family: 'unobserved family' });
  validate('element-locations-v1', emptyElementLocations);
  assert.equal(emptyElementLocations.total, 0);
  assert.deepEqual(emptyElementLocations.occurrences, []);
  const statusFile = path.join(report, '.ui-sheet-scan.json');
  const savedStatus = await fs.readFile(statusFile);
  await fs.rm(statusFile);
  try {
    const unverifiedAppearances = await listElementAppearances(report);
    const unverifiedLocations = await locateElements(report, { family: 'profile field' });
    const unverifiedFinding = await listFindingLocations(report, { findingId: first.findings[0].id });
    validate('element-appearances-v1', unverifiedAppearances);
    validate('element-locations-v1', unverifiedLocations);
    validate('finding-locations-v1', unverifiedFinding);
    assert.equal(unverifiedAppearances.scanStatus, 'unverified');
    assert.equal(unverifiedLocations.scanStatus, 'unverified');
    assert.equal(unverifiedFinding.scanStatus, 'unverified');
  } finally { await fs.writeFile(statusFile, savedStatus); }
  const baselineFile = path.join(temporary, 'baseline.json');
  await setBaseline(report, { file: baselineFile, observationId: 'button:0', pageIndex: 1, reason: 'Approved for the schema fixture.' });
  const buttonBaselines = await readBaselines(baselineFile);
  validate('baselines-v4', buttonBaselines);
  const archivedButtonBaselines = structuredClone(buttonBaselines);
  archivedButtonBaselines.format = 'ui-sheet/baselines-v3';
  delete archivedButtonBaselines.rules[0].style.opacity;
  delete archivedButtonBaselines.rules[0].style.filter;
  validate('baselines-v3', archivedButtonBaselines);
  reject('baselines-v4', archivedButtonBaselines);
  const elementBaselineFile = path.join(temporary, 'element-baseline.json');
  await setElementBaseline(report, { file: elementBaselineFile, observationId: 'input:0', reason: 'Approved configured field for the schema fixture.' });
  const elementBaselines = await readElementBaselines(elementBaselineFile);
  validate('element-baselines-v2', elementBaselines);
  const archivedElementBaselines = structuredClone(elementBaselines);
  archivedElementBaselines.format = 'ui-sheet/element-baselines-v1';
  delete archivedElementBaselines.rules[0].style.opacity;
  delete archivedElementBaselines.rules[0].style.filter;
  validate('element-baselines-v1', archivedElementBaselines);
  reject('element-baselines-v2', archivedElementBaselines);
  const approved = measuredElements({ baselines: elementBaselines.rules, allChanged: true });
  assert.equal(approved.findings[0].reference, 'approved');
  assert.equal(approved.findings[0].common.example, null);
  assert.equal(approved.findings[0].outlier.count, 3);
  validate('elements-v1', approved);
  const approvedData = structuredClone(data);
  approvedData.elementConsistency.pages = [approved];
  const approvedReport = path.join(temporary, 'approved-report');
  await writeReport(approvedData, approvedReport);
  const absentReferenceLocations = await listFindingLocations(approvedReport, { findingId: approved.findings[0].id, side: 'common' });
  validate('finding-locations-v1', absentReferenceLocations);
  assert.equal(absentReferenceLocations.total, 0);
  assert.deepEqual(absentReferenceLocations.locations, []);
  const invalidBaseline = structuredClone(elementBaselines);
  delete invalidBaseline.rules[0].group.state;
  reject('element-baselines-v2', invalidBaseline);
  reject('element-baselines-v2', { format: 'ui-sheet/baselines-v4', rules: [] });
  const decisionsFile = path.join(temporary, 'decisions.json');
  await setDecision(report, { file: decisionsFile, findingId: first.findings[0].id, status: 'needs-fix', reason: 'A known fixture difference.' });
  validate('decisions-v1', JSON.parse(await fs.readFile(decisionsFile, 'utf8')));
  validate('report-v1', JSON.parse(await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8')));
  const failedReport = path.join(temporary, 'failed-progress');
  const failedRun = await beginReportScan(failedReport);
  await failedRun.planPages(1);
  await failedRun.startPage(1, 'observe');
  await failedRun.finish('failed');
  const failedMarker = JSON.parse(await fs.readFile(path.join(failedReport, '.ui-sheet-scan.json'), 'utf8'));
  validate('scan-status-v1', failedMarker);
  assert.deepEqual(failedMarker.pageProgress.failed, { index: 1, phase: 'observe' });
});

test('schemas reject incompatible measurements and versions and malformed evidence', () => {
  const page = measuredPage('one', true);
  const report = { format: 'ui-sheet/v1', name: 'fixture', generatedAt: new Date().toISOString(), scannedFiles: 1, scanScope: [], sourceExclusions: 0, warnings: [], items: [], consistency: page };
  const missing = structuredClone(report);
  delete missing.consistency.observations[0].style.backgroundImage;
  reject('report-v1', missing);
  for (const property of ['opacity', 'filter']) {
    const missingEffect = structuredClone(report);
    delete missingEffect.consistency.observations[0].style[property];
    reject('report-v1', missingEffect);
  }
  for (const opacity of ['-0.1', '1.1', '100%', 'NaN', '2e-1']) {
    const malformedOpacity = structuredClone(report);
    malformedOpacity.consistency.observations[0].style.opacity = opacity;
    reject('report-v1', malformedOpacity);
  }
  for (const opacity of ['0', '0.25', '1', '1e-7']) {
    const canonicalOpacity = structuredClone(report);
    canonicalOpacity.consistency.observations[0].style.opacity = opacity;
    validate('report-v1', canonicalOpacity);
  }
  for (const filter of ['url(/private)', 'blur(2px) url(/private)', 'paint(private)', 'unknown(1)', 'blur(-1px)', 'hue-rotate(5)', 'drop-shadow(red blue 0px 0px)']) {
    const unsupportedFilter = structuredClone(report);
    unsupportedFilter.consistency.observations[0].style.filter = filter;
    reject('report-v1', unsupportedFilter);
  }
  for (const filter of ['none', 'blur(2px) brightness(0.5)', 'drop-shadow(rgb(0,0,0) 1px 2px 3px)']) {
    const comparableFilter = structuredClone(report);
    comparableFilter.consistency.observations[0].style.filter = filter;
    validate('report-v1', comparableFilter);
  }
  const previous = structuredClone(report);
  previous.consistency.findingIdentity = 'ui-sheet/button-finding-v4';
  reject('report-v1', previous);
  const missingMajorityCount = structuredClone(report);
  delete missingMajorityCount.consistency.counts.ambiguous;
  reject('report-v1', missingMajorityCount);
  const unsafe = structuredClone(report);
  unsafe.consistency.observations[0].style.backgroundImage = 'linear-gradient(red,blue),url(/private)';
  reject('report-v1', unsafe);
  const source = structuredClone(report);
  source.consistency.observations[0].source = { status: 'instrumented', file: 'App.jsx', line: 1 };
  reject('report-v1', source);
  reject('baselines-v4', { format: 'ui-sheet/baselines-v2', rules: [] });
  reject('decisions-v1', { format: 'ui-sheet/decisions-v1', decisions: [{ findingId: 'a'.repeat(16), status: 'approved', reason: 'Invalid status.' }] });
  reject('scan-status-v1', { format: 'ui-sheet/scan-status-v1', status: 'complete', runId: 'a'.repeat(36) });
  const completedMarker = { format: 'ui-sheet/scan-status-v1', status: 'completed', runId: 'a'.repeat(36), pageProgress: { requested: 1, observed: [], captured: [1], active: null, failed: null } };
  validate('scan-status-v1', completedMarker);
  reject('scan-status-v1', { ...completedMarker, pageProgress: { ...completedMarker.pageProgress, requested: 501 } });
  reject('scan-status-v1', { ...completedMarker, pageProgress: { ...completedMarker.pageProgress, captured: [1, 1] } });
  reject('scan-status-v1', { ...completedMarker, pageProgress: { ...completedMarker.pageProgress, active: { index: 1, phase: 'capture' } } });
  reject('scan-status-v1', { ...completedMarker, status: 'in-progress', pageProgress: { ...completedMarker.pageProgress, failed: { index: 1, phase: 'observe' } } });
  reject('scan-status-v1', { ...completedMarker, status: 'failed', pageProgress: { ...completedMarker.pageProgress, active: { index: 1, phase: 'observe' } } });
  reject('scan-status-v1', { ...completedMarker, status: 'in-progress', pageProgress: { ...completedMarker.pageProgress, active: { index: 1, phase: 'capture', url: 'https://example.test/private' } } });
  const configured = { format: 'ui-sheet/element-pages-v1', pages: [measuredElements()] };
  const configuredReport = { ...report, elementConsistency: configured, elementBaselineSummary: { applied: 0, unmatched: 1 } };
  validate('report-v1', configuredReport);
  reject('report-v1', { ...configuredReport, elementBaselineSummary: { applied: 0, unmatched: -1 } });
  const invalidElementState = structuredClone(configured);
  delete invalidElementState.pages[0].observations[0].group.state;
  reject('element-pages-v1', invalidElementState);
  const invalidAction = structuredClone(configured);
  invalidAction.pages[0].scope.actions[0].kind = 'click';
  reject('element-pages-v1', invalidAction);
  const invalidSelector = structuredClone(configured);
  invalidSelector.pages[0].scope.elementGroups[0].selector = '';
  reject('element-pages-v1', invalidSelector);
  const invalidId = structuredClone(configured);
  invalidId.pages[0].observations[0].id = 'input:negative';
  reject('element-pages-v1', invalidId);
});

test('the CLI emits a versioned error contract when JSON checking fails', { timeout: 10000 }, async () => {
  await assert.rejects(exec(process.execPath, [cli, 'check', path.join(os.tmpdir(), 'ui-sheet-schema-missing-report'), '--json'], { timeout: 5000, windowsHide: true }), (error) => {
    assert.equal(error.code, 2);
    const output = JSON.parse(error.stdout);
    validate('error-v1', output);
    assert.equal(output.error.code, 'CHECK_FAILED');
    assert.equal(typeof output.error.message, 'string');
    return true;
  });
  reject('error-v1', { format: 'ui-sheet/error-v1', error: { code: 'UNKNOWN', message: 'Wrong contract.' } });
});
