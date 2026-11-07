import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { scanProject } from '../src/scan.js';
import { writeReport } from '../src/report.js';
import { beginReportScan } from '../src/scan-status.js';
import { checkLayout } from '../src/layout-check.js';

const directory = new URL('../schemas/', import.meta.url);
const schemas = new Map();
const validator = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
for (const file of await fs.readdir(directory)) {
  if (!file.endsWith('.schema.json')) continue;
  const schema = JSON.parse(await fs.readFile(new URL(file, directory), 'utf8'));
  schemas.set(file.replace('.schema.json', ''), schema);
  validator.addSchema(schema);
}
function validate(name, value) {
  const check = validator.getSchema(schemas.get(name).$id);
  assert.equal(check(value), true, `${name}: ${validator.errorsText(check.errors)}`);
}
function reject(name, value) {
  const check = validator.getSchema(schemas.get(name).$id);
  assert.equal(check(value), false, `${name} accepted invalid data`);
}

const preview = {
  image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
  pixelRatio: 1, width: 1, height: 1,
};
function pageFixture(media = 'screen') {
  const source = { status: 'manual', file: 'Panel.jsx', line: 5, column: 3 };
  return {
    format: 'ui-sheet/layout-v1',
    scope: { url: 'https://example.test/settings', viewport: { width: 1440, height: 900 }, colorScheme: 'light', media, pixelRatio: 2, browser: { engine: 'chromium', version: 'layout-schema-fixture' } },
    coverage: 'partial', counts: { rules: 4, passed: 2, findings: 1, incomplete: 1 },
    results: [
      { id: 'panel-inset', kind: 'text-inset', selector: '#panel-title', status: 'passed', message: 'Text meets the configured minimum inset.', expected: { min: { top: 8, left: 12 } }, measured: { top: 12, right: 16, bottom: 16, left: 16, textRects: 1, textNodes: 1 }, source, preview: structuredClone(preview) },
      { id: 'field-gap', kind: 'horizontal-gap', selector: '#first-field', otherSelector: '#second-field', status: 'finding', message: 'The measured gap is below the configured minimum.', expected: { min: 8, max: 24 }, measured: { gap: 6, verticalOverlap: 20 }, source },
      { id: 'row-gap', kind: 'style', selector: '#field-grid', status: 'passed', message: 'The computed spacing is in the configured range.', expected: { property: 'rowGap', min: 8, max: 12 }, measured: { property: 'rowGap', value: '8px', px: 8 }, source },
      { id: 'brand-image', kind: 'image', selector: '#brand-image', status: 'incomplete', message: 'The image has not loaded.', expected: { paths: ['/logo.svg'], maxAspectRatioError: 0.02 }, measured: { elementTag: 'img', decoded: false }, source: { status: 'unresolved' } },
    ],
  };
}

test('layout schemas validate screen/print evidence and the image-free check producer', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-layout-schema-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, 'Panel.jsx'), 'export function Panel() { return <h2 id="panel-title">Settings</h2>; }');
  const out = path.join(root, '.ui-sheet');
  const run = await beginReportScan(out);
  const data = await scanProject(root, { outputDir: out });
  data.scanRunId = run.runId;
  data.layoutAudit = { format: 'ui-sheet/layout-pages-v1', pages: [pageFixture(), pageFixture('print')] };
  for (const page of data.layoutAudit.pages) validate('layout-v1', page);
  validate('layout-pages-v1', data.layoutAudit);
  validate('report-v1', data);
  await writeReport(data, out);
  await run.finish('completed');
  const compact = await checkLayout(out);
  validate('layout-check-v1', compact);
  assert.equal(compact.counts.rules, 8);
  assert.equal(compact.pages[1].scope.media, 'print');
  assert.equal(compact.results.filter((entry) => entry.previewAvailable).length, 2);
  assert.equal(JSON.stringify(compact).includes('data:image'), false);
  assert.equal(compact.sourceWarnings, 0);
  reject('layout-check-v1', { ...compact, counts: { ...compact.counts, rules: 1.5 } });
  reject('layout-check-v1', { ...compact, sourceWarnings: -1 });
  reject('layout-check-v1', { ...compact, results: [{ ...compact.results[0], preview }] });
  reject('layout-check-v1', { ...compact, results: [{ ...compact.results[0], measured: {} }] });
  validate('error-v1', { format: 'ui-sheet/error-v1', error: { code: 'LAYOUT_CHECK_FAILED', message: 'Capture layout evidence first.' } });
});

test('layout schemas reject malformed measurements, expectations and bounds', () => {
  const change = (mutate) => {
    const page = pageFixture();
    mutate(page);
    reject('layout-v1', page);
  };
  change((page) => { page.scope.media = 'all'; });
  change((page) => { page.scope.pixelRatio = 5; });
  change((page) => { page.counts.findings = -1; });
  change((page) => { page.results[0].source.column = 0; });
  change((page) => { page.results[0].source.file = '../Panel.jsx'; });
  change((page) => { page.results[0].id = 'Panel inset'; });
  change((page) => { page.results[0].measured.box = { top: 12 }; });
  change((page) => { page.results[0].measured = {}; });
  change((page) => { delete page.results[0].measured.bottom; });
  change((page) => { page.results[0].measured.textRects = 0; });
  change((page) => { page.results[0].measured.textRects = 2001; });
  change((page) => { page.results[0].expected.min.left = -1; });
  change((page) => { page.results[0].expected.min.top = 1001; });
  change((page) => { delete page.results[1].otherSelector; });
  change((page) => { delete page.results[1].measured.verticalOverlap; });
  change((page) => { page.results[1].measured.verticalOverlap = 0; });
  change((page) => { page.results[1].expected = {}; });
  change((page) => { page.results[2].expected.property = 'backgroundImage'; });
  change((page) => { page.results[2].expected.expected = '8px'; });
  change((page) => { delete page.results[2].measured.px; });
  change((page) => { page.results[2].measured.value = ''; });
  change((page) => { page.results[3].expected.paths = ['https://example.test/logo.svg']; });
  change((page) => { page.results[3].expected.paths = ['/logo.svg', '/logo.svg']; });
  change((page) => { page.results[3].expected.maxAspectRatioError = 2; });
  change((page) => { page.results[0].preview.image = 'https://example.test/image.png'; });
  change((page) => { page.results = Array.from({ length: 31 }, () => structuredClone(page.results[0])); });
  reject('layout-pages-v1', { format: 'ui-sheet/layout-pages-v1', pages: [] });
});

test('complete image evidence requires decoded dimensions while unsupported targets remain findings', () => {
  const page = pageFixture();
  const image = page.results[3];
  image.status = 'passed';
  image.measured = { elementTag: 'img', decoded: true, sameOrigin: true, approvedPath: true, naturalWidth: 100, naturalHeight: 100, renderedWidth: 50, renderedHeight: 50, aspectRatioError: 0 };
  validate('layout-v1', page);
  for (const field of ['naturalWidth', 'naturalHeight', 'renderedWidth', 'renderedHeight', 'sameOrigin', 'approvedPath', 'aspectRatioError']) {
    const malformed = structuredClone(page);
    delete malformed.results[3].measured[field];
    reject('layout-v1', malformed);
  }
  for (const measured of [
    { ...image.measured, decoded: false },
    { ...image.measured, naturalWidth: 0 },
    { ...image.measured, renderedHeight: 0 },
    { ...image.measured, sameOrigin: false },
    { ...image.measured, approvedPath: false },
    { elementTag: 'div', decoded: false },
  ]) reject('layout-v1', { ...page, results: [{ ...image, measured }] });
  const wrongAsset = { ...image, status: 'finding', measured: { ...image.measured, approvedPath: false } };
  validate('layout-v1', { ...page, results: [wrongAsset] });
  validate('layout-v1', { ...page, results: [{ ...image, status: 'finding', measured: { elementTag: 'div', decoded: false } }] });
  reject('layout-v1', { ...page, results: [{ ...image, status: 'finding', measured: { elementTag: 'img', decoded: false } }] });
  validate('layout-v1', { ...page, results: [{ ...image, status: 'incomplete', measured: {} }] });
});
