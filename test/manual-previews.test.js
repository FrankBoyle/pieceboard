import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { addPreviews } from '../src/manual-previews.js';
import { writeReport } from '../src/report.js';

test('attaches supplied screenshots only to known source locations and can be rerun', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-preview-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const out = path.join(root, 'report');
  const data = { format: 'ui-sheet/v1', name: 'Example', scannedFiles: 1, warnings: [], items: [{ id: 'component:x#Button', name: 'Button', kind: 'components', subtype: 'Component', source: 'x', definitions: [{ file: 'x.jsx', line: 3, detail: '' }], usages: [] }] };
  data.sourceRevision = { kind: 'git', commit: 'a'.repeat(40) };
  await writeReport(data, out);
  await fs.writeFile(path.join(root, 'preview.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
  const manifest = { previews: [{ item: 'component:x#Button', image: 'preview.png', source: { file: 'x.jsx', line: 3 }, page: 'https://example.com/app?private=value', label: 'Primary', element: { tag: 'button', role: 'checkbox' } }] };
  const manifestPath = path.join(root, 'previews.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  assert.deepEqual(await addPreviews(out, manifestPath), { added: 1, total: 1 });
  const output = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8'));
  assert.match(output.items[0].captures[0].image, /^data:image\/png;base64,/);
  assert.equal(output.items[0].captures[0].page, 'https://example.com/app');
  assert.equal(output.items[0].captures[0].label, 'Primary');
  assert.deepEqual(output.items[0].captures[0].element, { tag: 'button', role: 'checkbox' });
  assert.deepEqual(output.items[0].captures[0].captureMetadata, { role: null, school: null, viewportWidth: null, viewportHeight: null, capturedAt: null, screenshotSha256: createHash('sha256').update(await fs.readFile(path.join(root, 'preview.png'))).digest('hex'), servedSha: null });
  assert.equal(output.sourceRevision.commit, 'a'.repeat(40));
  assert.equal(output.captureSummary.pages[0].captured, 1);
  assert.deepEqual(await addPreviews(out, manifestPath), { added: 0, total: 1 });
  manifest.previews[0].element.role = 'radio';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  assert.deepEqual(await addPreviews(out, manifestPath), { added: 0, total: 1 });
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8')).items[0].captures[0].element.role, 'radio');
  manifest.previews[0].source.line = 4;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(addPreviews(out, manifestPath), /Source location is not present/);
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8')).captureSummary.captured, 1);
});

test('validates and preserves per-image capture metadata without inferring served revision', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-preview-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const out = path.join(root, 'report');
  await writeReport({ format: 'ui-sheet/v1', name: 'Example', scannedFiles: 1, warnings: [], sourceRevision: { kind: 'git', commit: 'b'.repeat(40) }, items: [{ id: 'x', name: 'X', kind: 'components', subtype: 'Component', source: 'x', definitions: [{ file: 'x.jsx', line: 1 }], usages: [] }] }, out);
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(path.join(root, 'preview.png'), imageBytes);
  const manifestPath = path.join(root, 'previews.json');
  const preview = { item: 'x', image: 'preview.png', source: { file: 'x.jsx', line: 1 }, captureMetadata: { role: 'teacher', school: 'North Campus', viewportWidth: 1280, viewportHeight: 800, capturedAt: '2026-11-06T14:05:00Z', screenshotSha256: createHash('sha256').update(imageBytes).digest('hex'), servedSha: 'c'.repeat(40) } };
  await fs.writeFile(manifestPath, JSON.stringify({ previews: [preview] }));
  await addPreviews(out, manifestPath);
  const output = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8'));
  assert.deepEqual(output.items[0].captures[0].captureMetadata, { ...preview.captureMetadata, capturedAt: '2026-11-06T14:05:00.000Z', screenshotSha256: preview.captureMetadata.screenshotSha256 });
  assert.equal(output.sourceRevision.commit, 'b'.repeat(40));
  assert.notEqual(output.items[0].captures[0].captureMetadata.servedSha, output.sourceRevision.commit);

  for (const invalid of [{ role: '' }, { viewportWidth: 0 }, { viewportHeight: 1.5 }, { capturedAt: 'yesterday' }, { screenshotSha256: 'd'.repeat(64) }, { servedSha: '../secret' }, { unknown: true }]) {
    await fs.writeFile(manifestPath, JSON.stringify({ previews: [{ ...preview, captureMetadata: invalid }] }));
    await assert.rejects(addPreviews(out, manifestPath), /metadata/i);
    const unchanged = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8'));
    assert.deepEqual(unchanged.items[0].captures[0].captureMetadata, output.items[0].captures[0].captureMetadata);
  }
});
