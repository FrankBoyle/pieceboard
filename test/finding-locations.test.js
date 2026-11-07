import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeButtonConsistency, baselineRuleId, BUTTON_STYLE_FIELDS } from '../src/consistency.js';
import { analyzeAcrossPages } from '../src/cross-page.js';
import { analyzeElementConsistency } from '../src/element-consistency.js';
import { elementBaselineTemplate } from '../src/element-baselines.js';
import { beginReportScan } from '../src/scan-status.js';
import { findingLocations, listFindingLocations } from '../src/finding-locations.js';

const style = Object.fromEntries(BUTTON_STYLE_FIELDS.map(([key]) => [key,
  key === 'opacity' ? '1' : ['backgroundImage', 'filter', 'boxShadow', 'textTransform', 'textDecorationLine'].includes(key) ? 'none'
    : key === 'fontStyle' ? 'normal' : key === 'fontFamily' ? 'Arial' : key === 'fontWeight' ? '600'
      : key.includes('Style') ? 'solid' : key.endsWith('Color') || key === 'color' ? 'rgb(0, 0, 0)' : '8px']));
const appearance = (radius) => ({ ...style, borderTopLeftRadius: radius });
const browser = { engine: 'chromium', version: '156.0.0.0' };
const source = (index, changes = {}) => ({ status: 'likely', file: `src/Control${index}.jsx`, line: index + 1, method: 'unique ID and tag', ...changes });
const png = 'data:image/png;base64,SYNTHETIC_IMAGE_PAYLOAD';
const scope = (url, changes = {}) => ({ url, viewport: { width: 1440, height: 900 }, theme: 'app:light;browser:light', pixelRatio: 2, ...changes });

function nativePage(url = 'https://example.test/settings', records = [8, 8, 8, 8, 2, 2], changes = {}, baselines = []) {
  const page = analyzeButtonConsistency(records.map((radius, index) => ({ tag: 'button', index, visible: true, visibilityEvidence: 'clear', type: 'button', family: 'save actions', familyEvidence: 'configured group', variant: 'primary', variantEvidence: 'configured variant', style: appearance(`${radius}px`), source: source(index) })), { ...scope(url, changes), baselines });
  page.scope.browser = changes.browser || browser;
  if (changes.actions) page.scope.actions = changes.actions;
  page.previews = { 'button:4': { image: png } };
  return page;
}

function configuredPage({ url = 'https://example.test/fields', baselines = [] } = {}) {
  const elements = [8, 8, 8, 2, 2, 2, 2, 2].map((radius, index) => ({ tag: 'input', nativeType: 'text', index, visible: true, visibilityEvidence: 'clear', state: index < 5 ? 'default' : 'selected', configured: { family: 'account fields', type: 'inputs', variant: 'regular' }, style: appearance(`${radius}px`), source: source(index) }));
  const page = analyzeElementConsistency(elements, { ...scope(url), browser, baselines });
  page.previews = { 'input:3': { image: png } };
  return { page, elements };
}

const nativeData = (pages) => ({ format: 'ui-sheet/v1', consistency: pages.length === 1 ? pages[0] : { format: 'ui-sheet/consistency-v2', pages } });

test('returns every repeated outlier source while keeping page scope and bounded output', () => {
  const page = nativePage();
  const other = nativePage('https://example.test/other', [2, 2, 2]);
  const findingId = page.findings[0].id;
  const report = nativeData([page, other]);
  const result = findingLocations(report, { findingId });
  assert.equal(result.format, 'ui-sheet/finding-locations-v1');
  assert.equal(result.total, 2);
  assert.deepEqual(result.locations.map((location) => [location.page, location.observationId, location.source.file]), [[1, 'button:4', 'src/Control4.jsx'], [1, 'button:5', 'src/Control5.jsx']]);
  assert.deepEqual(result.locations.map((location) => location.previewAvailable), [true, false]);
  assert.equal(JSON.stringify(result).includes('data:image'), false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_IMAGE_PAYLOAD'), false);
  const limited = findingLocations(report, { findingId, limit: 1 });
  assert.equal(limited.total, 2);
  assert.equal(limited.locations.length, 1);
  assert.equal(limited.truncated, true);
  assert.equal(findingLocations(report, { findingId, side: 'common' }).total, 4);
});

test('preserves repeated occurrences sharing one source and explicitly unresolved source entries', () => {
  const page = nativePage();
  page.observations[4].source = source(4, { file: 'src/Repeated.jsx', line: 20, extra: png });
  page.observations[5].source = source(4, { file: 'src/Repeated.jsx', line: 20, extra: png });
  const result = findingLocations(nativeData([page]), { findingId: page.findings[0].id });
  assert.equal(result.total, 2);
  assert.equal(new Set(result.locations.map((entry) => entry.source.file)).size, 1);
  assert.deepEqual(result.locations.map((entry) => entry.observationId), ['button:4', 'button:5']);
  assert.equal(JSON.stringify(result).includes('extra'), false);
  page.observations[4].source = { status: 'unresolved', method: 'multiple source candidates', file: 'not-a-source-assertion', extra: png };
  delete page.observations[5].source;
  const unknown = findingLocations(nativeData([page]), { findingId: page.findings[0].id });
  assert.deepEqual(unknown.locations.map((entry) => entry.source), [{ status: 'unresolved', method: 'multiple source candidates' }, { status: 'unresolved' }]);
});

test('configured lookup separates semantic states and native types even for identical styles', () => {
  const { page } = configuredPage();
  const matching = page.observations.find((entry) => entry.id === 'input:3');
  page.observations.push({ ...structuredClone(matching), id: 'input:8', group: { ...matching.group, nativeType: 'search' } });
  const data = { format: 'ui-sheet/v1', elementConsistency: { format: 'ui-sheet/element-pages-v1', pages: [page] } };
  const result = findingLocations(data, { findingId: page.findings[0].id });
  assert.deepEqual(result.locations.map((entry) => entry.observationId), ['input:3', 'input:4']);
  assert.ok(result.locations.every((entry) => entry.group.state === 'default' && entry.group.nativeType === 'text'));
});

test('approved common references without an observed example never invent source locations', () => {
  const first = nativePage();
  const baseline = { id: baselineRuleId(first.scope, first.observations[0].group), style: appearance('12px') };
  const native = nativePage('https://example.test/settings', [2, 2, 2], {}, [baseline]);
  assert.equal(native.findings[0].common.example, null);
  const nativeResult = findingLocations(nativeData([native]), { findingId: native.findings[0].id, side: 'common' });
  assert.equal(nativeResult.total, 0);
  assert.deepEqual(nativeResult.locations, []);

  const { page: initial, elements } = configuredPage();
  const approval = { ...elementBaselineTemplate(initial, initial.observations[0]), style: appearance('12px'), reason: 'A separately approved expected reference.' };
  const configured = analyzeElementConsistency(elements, { ...scope(initial.scope.url), browser, baselines: [approval] });
  const data = { format: 'ui-sheet/v1', elementConsistency: { format: 'ui-sheet/element-pages-v1', pages: [configured] } };
  assert.equal(configured.findings[0].common.example, null);
  assert.equal(findingLocations(data, { findingId: configured.findings[0].id, side: 'common' }).total, 0);
});

test('cross-page lookup returns only explicit groups in the finding rendering and action context', () => {
  const pages = Array.from({ length: 7 }, (_, index) => nativePage(`https://example.test/${index}`, [index < 5 ? 8 : 2]));
  pages.push(nativePage('https://example.test/dark', [2], { theme: 'app:dark;browser:dark' }));
  pages.push(nativePage('https://example.test/focus', [2], { actions: [{ kind: 'focus', selector: '#other' }] }));
  pages.push(nativePage('https://example.test/browser', [2], { browser: { engine: 'chromium', version: '157.0.0.0' } }));
  pages.push(nativePage('https://example.test/density', [2], { pixelRatio: 4 }));
  pages.push(nativePage('https://example.test/mobile', [2], { viewport: { width: 390, height: 844 } }));
  const inferred = nativePage('https://example.test/inferred', [2]);
  inferred.observations[0].group.familyEvidence = 'shared container';
  inferred.observations[0].group.variantEvidence = 'class name';
  pages.push(inferred);
  const cross = analyzeAcrossPages(pages);
  const data = { ...nativeData(pages), crossPageConsistency: cross };
  const result = findingLocations(data, { findingId: cross.findings[0].id });
  assert.equal(result.total, 2);
  assert.deepEqual(result.locations.map((entry) => [entry.page, entry.url]), [[6, 'https://example.test/5'], [7, 'https://example.test/6']]);
  assert.equal(findingLocations(data, { findingId: cross.findings[0].id, side: 'common' }).total, 5);
});

test('an absent approved cross-page reference yields zero observed common locations', () => {
  const pages = [nativePage('https://example.test/a', [2]), nativePage('https://example.test/b', [2])];
  const baseline = { id: baselineRuleId({ ...pages[0].scope, url: '*' }, pages[0].observations[0].group), style: appearance('12px') };
  const cross = analyzeAcrossPages(pages, { baselines: [baseline] });
  const data = { ...nativeData(pages), crossPageConsistency: cross };
  assert.equal(findingLocations(data, { findingId: cross.findings[0].id, side: 'common' }).total, 0);
  assert.equal(findingLocations(data, { findingId: cross.findings[0].id }).total, 2);
});

test('rejects ambiguous IDs, invalid arguments, obsolete styles, and contradictory counts', () => {
  const page = nativePage();
  const data = nativeData([page]);
  const findingId = page.findings[0].id;
  for (const options of [{ findingId: 'bad' }, { findingId, side: 'both' }, { findingId, limit: 0 }, { findingId, limit: 201 }, { findingId, limit: 1.5 }]) assert.throws(() => findingLocations(data, options));
  assert.throws(() => findingLocations(data, { findingId: '0000000000000000' }), /exactly one/);
  page.findings.push(structuredClone(page.findings[0]));
  assert.throws(() => findingLocations(data, { findingId }), /exactly one/);
  page.findings.pop();
  page.findings[0].outlier.count = 1;
  assert.throws(() => findingLocations(data, { findingId }), /counts do not match/);
  page.findings[0].outlier.count = 2;
  page.findingIdentity = 'ui-sheet/button-finding-v5';
  assert.throws(() => findingLocations(data, { findingId }), /Regenerate/);
  page.findingIdentity = 'ui-sheet/button-finding-v6';
  page.scope.actions = false;
  assert.throws(() => findingLocations(data, { findingId }), /Regenerate/);
  delete page.scope.actions;
  delete page.scope.pixelRatio;
  assert.throws(() => findingLocations(data, { findingId }), /Regenerate/);
  page.scope.pixelRatio = 2;
  delete page.observations[0].style.filter;
  assert.throws(() => findingLocations(data, { findingId }), /Regenerate/);
});

test('wrapper reports scan status and rejects failed, interrupted, and mismatched completion records', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-finding-locations-'));
  t.after(async () => {
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('ui-sheet-finding-locations-'));
    await fs.rm(actual, { recursive: true, force: true });
  });
  const page = nativePage(), data = nativeData([page]);
  const options = { findingId: page.findings[0].id };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  assert.equal((await listFindingLocations(root, options)).scanStatus, 'unverified');
  const first = await beginReportScan(root);
  data.scanRunId = first.runId;
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  await assert.rejects(listFindingLocations(root, options), /in progress or was interrupted/);
  await first.finish('completed');
  assert.equal((await listFindingLocations(root, options)).scanStatus, 'completed');
  data.scanRunId = '00000000-0000-0000-0000-000000000000';
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  await assert.rejects(listFindingLocations(root, options), /do not match/);
  const failed = await beginReportScan(root);
  await failed.finish('failed');
  await assert.rejects(listFindingLocations(root, options), /did not complete/);
});
