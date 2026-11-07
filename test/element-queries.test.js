import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyzeElementConsistency, ELEMENT_TYPES } from '../src/element-consistency.js';
import { BUTTON_STYLE_FIELDS } from '../src/consistency.js';
import { listElementAppearances, locateElements } from '../src/element-queries.js';
import { beginReportScan } from '../src/scan-status.js';

const style = Object.fromEntries(BUTTON_STYLE_FIELDS.map(([key]) => [key, key.includes('Color') || key === 'color' ? 'rgb(1, 2, 3)' : ['boxShadow', 'backgroundImage', 'textTransform', 'textDecorationLine', 'filter'].includes(key) ? 'none' : key === 'opacity' ? '1' : key === 'fontStyle' ? 'normal' : '8px']));
const element = (index, extra = {}) => ({ tag: 'input', index, nativeType: 'text', visible: true, state: 'default', visibilityEvidence: 'clear', configured: { family: 'account field', variant: 'regular', type: 'inputs' }, style, ...extra });
const context = { url: 'https://example.test/settings', theme: 'app:light;browser:light', browser: { engine: 'chromium', version: '123.0' } };

async function fixture(t, pages) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-element-queries-'));
  t.after(async () => {
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-element-queries-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const data = { format: 'ui-sheet/v1', elementConsistency: { format: 'ui-sheet/element-pages-v1', pages } };
  const save = () => fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  await save();
  return { root, data, save };
}

test('recomputes real appearance counts and state boundaries without images or approval templates', async (t) => {
  const page = analyzeElementConsistency([
    element(0, { source: { status: 'likely', file: 'src/Account.tsx', line: 8, image: 'data:image/png;base64,SOURCE_PAYLOAD' } }),
    element(1), element(2, { style: { ...style, fontSize: '18px' } }), element(3, { state: 'focused' }),
  ], context);
  page.previews = { 'input:0': { image: 'data:image/png;base64,PREVIEW_PAYLOAD' } };
  page.scope.elementGroups = [{ image: 'data:image/png;base64,SCOPE_PAYLOAD' }];
  page.appearances = [{ count: 9999, approval: { image: 'data:image/png;base64,APPROVAL_PAYLOAD' } }];
  page.observations[0].group.image = 'data:image/png;base64,GROUP_PAYLOAD';
  const { root } = await fixture(t, [page]);
  const result = await listElementAppearances(root, { limit: 2 });
  assert.equal(result.format, 'ui-sheet/element-appearances-v1');
  assert.equal(result.scanStatus, 'unverified');
  assert.equal(result.pageCount, 1);
  assert.equal(result.totalAppearances, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.appearances[0].count, 2);
  assert.equal(result.appearances[0].example, 'input:0');
  assert.equal(result.appearances[0].previewAvailable, true);
  assert.equal(result.appearances[0].source.file, 'src/Account.tsx');
  assert.equal(result.appearances[1].previewAvailable, false);
  assert.equal(JSON.stringify(result).includes('data:image'), false);
  assert.equal(JSON.stringify(result).includes('approval'), false);
  assert.equal(JSON.stringify(result).includes('9999'), false);
});

test('lists separate observed occurrences across visited scopes and supports family, variant and type filters', async (t) => {
  const first = analyzeElementConsistency([element(0), element(1, { state: 'readonly' }), element(2, { configured: { family: 'account field', variant: 'compact', type: 'inputs' } })], context);
  const second = analyzeElementConsistency([element(0, { tag: 'select', nativeType: 'single', configured: { family: 'account field', variant: 'regular', type: 'dropdowns' }, source: { status: 'manual', file: 'src/Other.tsx', line: 9, method: 'configured selector and source location' } })], { ...context, url: 'https://example.test/other' });
  const third = analyzeElementConsistency([element(0, { configured: { family: 'unrelated field', type: 'inputs' } })], { ...context, url: 'https://example.test/unrelated' });
  second.previews = { 'select:0': { image: 'data:image/png;base64,PREVIEW_PAYLOAD' } };
  const { root } = await fixture(t, [first, second, third]);
  const all = await locateElements(root, { family: ' ACCOUNT FIELD ', limit: 2 });
  assert.equal(all.total, 4);
  assert.equal(all.pagesVisited, 3);
  assert.equal(all.matchingPages, 2);
  assert.equal(all.scopes.length, 3, 'all visited scopes remain visible even when filtered');
  assert.equal(all.truncated, true);
  assert.deepEqual(all.occurrences.map((entry) => entry.observationId), ['input:0', 'input:1']);
  assert.equal(all.occurrences[1].group.state, 'readonly');
  assert.equal(all.occurrences[0].source.status, 'unresolved');
  const onlySelect = await locateElements(root, { family: 'account field', variant: 'REGULAR', type: 'dropdowns' });
  assert.equal(onlySelect.total, 1);
  assert.equal(onlySelect.occurrences[0].page, 2);
  assert.equal(onlySelect.occurrences[0].scope.url, 'https://example.test/other');
  assert.equal(onlySelect.occurrences[0].source.status, 'manual');
  assert.equal(onlySelect.occurrences[0].previewAvailable, true);
  assert.equal(JSON.stringify(onlySelect).includes('PREVIEW_PAYLOAD'), false);
  const missing = await locateElements(root, { family: 'unvisited family' });
  assert.equal(missing.total, 0);
  assert.equal(missing.matchingPages, 0);
  assert.deepEqual(missing.occurrences, []);
});

test('supports all configured categories and distinguishes native types and states in appearances', async (t) => {
  const observations = ELEMENT_TYPES.map((type, index) => element(index, { configured: { family: 'same family', type, variant: 'same' } }));
  observations.push(element(30, { configured: { family: 'same family', type: 'inputs', variant: 'same' }, nativeType: 'search' }));
  observations.push(element(31, { configured: { family: 'same family', type: 'inputs', variant: 'same' }, state: 'focused' }));
  const page = analyzeElementConsistency(observations, context);
  const { root } = await fixture(t, [page]);
  assert.equal((await listElementAppearances(root)).totalAppearances, ELEMENT_TYPES.length + 2);
  for (const type of ELEMENT_TYPES) {
    const result = await locateElements(root, { family: 'same family', type });
    assert.equal(result.total, type === 'inputs' ? 3 : 1);
    assert.equal(result.occurrences.every((entry) => entry.group.type === type), true);
  }
});

test('groups equivalent named variants by identity rather than the evidence label', async (t) => {
  const page = analyzeElementConsistency([
    element(0, { configured: { family: 'same family', type: 'inputs' } }),
    element(1, { configured: { family: 'same family', type: 'inputs', variant: 'unspecified' } }),
  ], context);
  const { root } = await fixture(t, [page]);
  const result = await listElementAppearances(root);
  assert.equal(result.totalAppearances, 1);
  assert.equal(result.appearances[0].count, 2);
});

test('rejects unsafe arguments and out-of-range selection without performing a query', async (t) => {
  const { root } = await fixture(t, [analyzeElementConsistency([element(0)], context)]);
  for (const page of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(listElementAppearances(root, { page }), /Page must/);
  for (const limit of [0, -1, 201, 1.5, '2', Infinity]) {
    await assert.rejects(listElementAppearances(root, { limit }), /Limit must/);
    await assert.rejects(locateElements(root, { family: 'account field', limit }), /Limit must/);
  }
  for (const family of [undefined, '', ' ', 'x'.repeat(81), 'account\nfield', {}, 'data:image/png']) await assert.rejects(locateElements(root, { family }), /family/);
  await assert.rejects(locateElements(root, { family: 'account field', variant: '' }), /Variant/);
  await assert.rejects(locateElements(root, { family: 'account field', type: 'buttons' }), /Type must/);
  await assert.rejects(listElementAppearances(root, { page: 2 }), /not present/);
});

test('rejects old, inconsistent or malformed observation metadata instead of guessing sources and counts', async (t) => {
  const page = analyzeElementConsistency([element(0)], context);
  const { root, data, save } = await fixture(t, [page]);
  const original = structuredClone(page);
  const changes = [
    (entry) => { entry.findingIdentity = 'ui-sheet/element-finding-v1'; },
    (entry) => { entry.counts.eligible++; },
    (entry) => { entry.observations.push(structuredClone(entry.observations[0])); entry.counts.eligible++; entry.counts.seen++; },
    (entry) => { delete entry.observations[0].style.opacity; },
    (entry) => { entry.observations[0].source = { status: 'instrumented', file: 'src/X.tsx', line: 1 }; },
    (entry) => { entry.observations[0].group.state = ''; },
    (entry) => { entry.observations[0].id = 'textarea:0'; },
    (entry) => { entry.scope.url = 'https://person:password@example.test/'; },
  ];
  for (const change of changes) {
    data.elementConsistency.pages[0] = structuredClone(original);
    change(data.elementConsistency.pages[0]);
    await save();
    await assert.rejects(listElementAppearances(root), /incomplete or unsupported.*Regenerate/);
    await assert.rejects(locateElements(root, { family: 'account field' }), /incomplete or unsupported.*Regenerate/);
  }
});

test('keeps completion status explicit and rejects interrupted or failed scan records', async (t) => {
  const page = analyzeElementConsistency([element(0)], context);
  const { root, data, save } = await fixture(t, [page]);
  const run = await beginReportScan(root);
  data.scanRunId = run.runId;
  await save();
  await assert.rejects(listElementAppearances(root), /in progress or was interrupted/);
  await run.finish('completed');
  assert.equal((await listElementAppearances(root)).scanStatus, 'completed');
  assert.equal((await locateElements(root, { family: 'account field' })).scanStatus, 'completed');
  const failed = await beginReportScan(root);
  await failed.finish('failed');
  await assert.rejects(listElementAppearances(root), /did not complete/);
});
