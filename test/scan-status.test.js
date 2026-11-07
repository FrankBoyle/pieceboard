import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beginReportScan, readCheckedReport, writeMarker } from '../src/scan-status.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));

async function tempDir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-scan-status-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-scan-status-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  return root;
}

test('retries a transient Windows status rename without removing the previous marker', async (t) => {
  const root = await tempDir(t);
  const target = path.join(root, '.ui-sheet-scan.json');
  const old = '{"status":"previous"}\n';
  await fs.writeFile(target, old);
  let attempts = 0;
  await writeMarker(root, { status: 'new' }, {
    platform: 'win32', delay: async () => {},
    rename: async (from, to) => {
      attempts++;
      if (attempts < 3) {
        assert.equal(await fs.readFile(to, 'utf8'), old);
        throw Object.assign(new Error('temporary Windows reader lock'), { code: 'EPERM' });
      }
      await fs.rename(from, to);
    },
  });
  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(target, 'utf8'), '{"status":"new"}\n');
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith('.ui-sheet-status-')), false);
});

test('a persistent or changed Windows status still fails closed and cleans the temp file', async (t) => {
  const root = await tempDir(t);
  const target = path.join(root, '.ui-sheet-scan.json');
  const old = '{"status":"previous"}\n';
  await fs.writeFile(target, old);
  let attempts = 0;
  await assert.rejects(writeMarker(root, { status: 'new' }, {
    platform: 'win32', delay: async () => {},
    rename: async () => {
      attempts++;
      throw Object.assign(new Error('persistent Windows reader lock'), { code: 'EPERM' });
    },
  }), /persistent Windows reader lock/);
  assert.equal(attempts, 6);
  assert.equal(await fs.readFile(target, 'utf8'), old);
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith('.ui-sheet-status-')), false);

  await assert.rejects(writeMarker(root, { status: 'new' }, {
    platform: 'win32', delay: async () => {},
    rename: async () => {
      await fs.writeFile(target, '{"status":"external change"}\n');
      throw Object.assign(new Error('temporary Windows reader lock'), { code: 'EPERM' });
    },
  }), /status changed during the run/);
  assert.equal(await fs.readFile(target, 'utf8'), '{"status":"external change"}\n');
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith('.ui-sheet-status-')), false);
});

test('failed CLI scans preserve the previous report but make checks fail until a new scan succeeds', async (t) => {
  const root = await tempDir(t);
  const report = path.join(root, 'report');
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'index.html'), '<button>Save</button>');
  const scan = (include) => exec(process.execPath, [cli, 'scan', root, '--include', include, '--out', report]);
  await scan('src');
  const original = await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8');
  assert.equal((await readCheckedReport(report)).scanStatus, 'completed');
  await assert.rejects(scan('missing-path'));
  assert.equal(await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8'), original);
  await assert.rejects(readCheckedReport(report), /most recent scan did not complete/);
  await assert.rejects(exec(process.execPath, [cli, 'check', report]), (error) => error.code === 2 && /most recent scan did not complete/.test(error.stderr));
  await scan('src');
  const fresh = await readCheckedReport(report);
  assert.equal(fresh.scanStatus, 'completed');
  assert.notEqual(fresh.data.scanRunId, JSON.parse(original).scanRunId);
});

test('rejects concurrent or interrupted scans and mismatched report records', async (t) => {
  const root = await tempDir(t);
  const first = await beginReportScan(root);
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ scanRunId: first.runId }));
  await assert.rejects(readCheckedReport(root), /in progress or was interrupted/);
  await assert.rejects(beginReportScan(root), /in progress or was interrupted/);
  await first.finish('completed');
  assert.equal((await readCheckedReport(root)).scanStatus, 'completed');
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ scanRunId: 'different-run' }));
  await assert.rejects(readCheckedReport(root), /report and scan status do not match/);
});

test('does not replace an unrelated status file or an existing lock', async (t) => {
  const root = await tempDir(t);
  const marker = path.join(root, '.ui-sheet-scan.json');
  await fs.writeFile(marker, 'do not overwrite');
  await assert.rejects(beginReportScan(root), /status file is invalid/);
  assert.equal(await fs.readFile(marker, 'utf8'), 'do not overwrite');
  await fs.writeFile(path.join(root, '.ui-sheet-scan.lock'), 'do not overwrite');
  await assert.rejects(beginReportScan(root), /in progress or was interrupted/);
  assert.equal(await fs.readFile(path.join(root, '.ui-sheet-scan.lock'), 'utf8'), 'do not overwrite');
});

test('does not delete or replace run records changed by another process', async (t) => {
  const root = await tempDir(t);
  const lock = path.join(root, '.ui-sheet-scan.lock');
  const run = await beginReportScan(root);
  await fs.writeFile(lock, 'someone else owns this lock');
  await assert.rejects(run.finish('completed'), /lock changed during the run/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'someone else owns this lock');
  await assert.rejects(readCheckedReport(root), /in progress or was interrupted/);

  const other = await tempDir(t);
  const otherRun = await beginReportScan(other);
  const marker = path.join(other, '.ui-sheet-scan.json');
  await fs.writeFile(marker, 'changed status');
  await assert.rejects(otherRun.finish('failed'), /status file is invalid/);
  assert.equal(await fs.readFile(marker, 'utf8'), 'changed status');
});

test('preserves completed pages and identifies a failed second-page phase without storing page data', async (t) => {
  const root = await tempDir(t);
  const run = await beginReportScan(root);
  assert.equal(run.getPageProgress(), null);
  await run.planPages(3);
  await run.startPage(1, 'observe');
  await run.completePage(1, 'observe');
  await run.startPage(1, 'capture');
  await run.completePage(1, 'capture');
  await run.startPage(2, 'observe');
  await run.completePage(2, 'observe');
  await run.startPage(2, 'capture');
  await assert.rejects(readCheckedReport(root), /in progress or was interrupted/);
  await assert.rejects(beginReportScan(root), /in progress or was interrupted/);
  await run.finish('failed');
  const expected = { requested: 3, observed: [1, 2], captured: [1], active: null, failed: { index: 2, phase: 'capture' } };
  assert.deepEqual(run.getPageProgress(), expected);
  const marker = JSON.parse(await fs.readFile(path.join(root, '.ui-sheet-scan.json'), 'utf8'));
  assert.equal(marker.status, 'failed');
  assert.deepEqual(marker.pageProgress, expected);
  assert.deepEqual(Object.keys(marker).sort(), ['format', 'pageProgress', 'runId', 'status']);
  await assert.rejects(readCheckedReport(root), /most recent scan did not complete\. The capture phase did not complete at page 2 of 3/);
  await assert.rejects(run.startPage(3, 'capture'), /already finished/);
});

test('returns successful page progress as a defensive copy and retains old marker support', async (t) => {
  const root = await tempDir(t);
  const run = await beginReportScan(root);
  await run.planPages(2);
  await run.startPage(2, 'capture');
  await run.completePage(2, 'capture');
  await run.startPage(1, 'capture');
  await run.completePage(1, 'capture');
  const copy = run.getPageProgress();
  copy.captured.length = 0;
  copy.requested = 20;
  assert.deepEqual(run.getPageProgress(), { requested: 2, observed: [], captured: [1, 2], active: null, failed: null });
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ scanRunId: run.runId }));
  await run.finish('completed');
  const checked = await readCheckedReport(root);
  assert.equal(checked.scanStatus, 'completed');
  assert.deepEqual(checked.pageProgress, run.getPageProgress());
  checked.pageProgress.captured.length = 0;
  assert.deepEqual((await readCheckedReport(root)).pageProgress.captured, [1, 2]);

  const legacy = await tempDir(t);
  const oldRun = await beginReportScan(legacy);
  await fs.writeFile(path.join(legacy, 'ui-sheet.json'), JSON.stringify({ scanRunId: oldRun.runId }));
  await oldRun.finish('completed');
  assert.equal(Object.hasOwn(await readCheckedReport(legacy), 'pageProgress'), false);
  const unverified = await tempDir(t);
  await fs.writeFile(path.join(unverified, 'ui-sheet.json'), '{}');
  assert.deepEqual(await readCheckedReport(unverified), { data: {}, scanStatus: 'unverified' });
});

test('requires valid plans and matching sequential page transitions', async (t) => {
  const root = await tempDir(t);
  const run = await beginReportScan(root);
  await assert.rejects(run.startPage(1, 'capture'), /Plan the scan pages/);
  for (const count of [-1, 21, 1.5, '2']) await assert.rejects(run.planPages(count), /Page count/);
  await run.planPages(2);
  await assert.rejects(run.planPages(2), /already been planned/);
  for (const [index, phase] of [[0, 'capture'], [3, 'capture'], [1, 'submit'], [1.5, 'capture']]) await assert.rejects(run.startPage(index, phase), /planned page index/);
  await run.startPage(1, 'capture');
  await assert.rejects(run.startPage(2, 'observe'), /Complete the active/);
  await assert.rejects(run.completePage(1, 'observe'), /must match the active/);
  await assert.rejects(run.finish('completed'), /Complete the active/);
  await run.completePage(1, 'capture');
  await assert.rejects(run.startPage(1, 'capture'), /already completed/);
  await assert.rejects(run.finish('completed'), /unvisited pages/);
  const marker = JSON.parse(await fs.readFile(path.join(root, '.ui-sheet-scan.json'), 'utf8'));
  assert.equal(marker.status, 'in-progress');
  assert.deepEqual(marker.pageProgress.captured, [1]);
  await run.startPage(2, 'observe');
  await run.completePage(2, 'observe');
  await run.finish('completed');

  const sourceOnly = await beginReportScan(await tempDir(t));
  await sourceOnly.planPages(0);
  await assert.rejects(sourceOnly.startPage(1, 'capture'), /planned page index/);
  await sourceOnly.finish('completed');
  assert.equal(sourceOnly.getPageProgress().requested, 0);
});

test('rejects malformed persisted page metadata without replacing it', async (t) => {
  const valid = { requested: 2, observed: [1], captured: [], active: null, failed: null };
  const invalid = [
    { ...valid, requested: 21 },
    { ...valid, observed: [1, 1] },
    { ...valid, captured: [3] },
    { ...valid, active: { index: 2, phase: 'submit' } },
    { ...valid, active: { index: 1, phase: 'observe' } },
    { ...valid, active: { index: 2, phase: 'capture', url: 'https://private.invalid/' } },
    { ...valid, url: 'https://private.invalid/' },
  ];
  for (const pageProgress of invalid) {
    const root = await tempDir(t);
    const file = path.join(root, '.ui-sheet-scan.json');
    const original = JSON.stringify({ format: 'ui-sheet/scan-status-v1', status: 'in-progress', runId: '11111111-1111-1111-1111-111111111111', pageProgress });
    await fs.writeFile(file, original);
    await assert.rejects(beginReportScan(root), /invalid page progress/);
    assert.equal(await fs.readFile(file, 'utf8'), original);
  }
});

test('refuses changed page progress and changed locks before writing a status update', async (t) => {
  const root = await tempDir(t);
  const run = await beginReportScan(root);
  await run.planPages(2);
  const file = path.join(root, '.ui-sheet-scan.json');
  const external = JSON.parse(await fs.readFile(file, 'utf8'));
  external.pageProgress.observed.push(1);
  await fs.writeFile(file, JSON.stringify(external));
  await assert.rejects(run.startPage(2, 'capture'), /status changed during the run/);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), external);

  const other = await tempDir(t);
  const otherRun = await beginReportScan(other);
  await otherRun.planPages(2);
  const marker = path.join(other, '.ui-sheet-scan.json');
  const original = await fs.readFile(marker, 'utf8');
  const lock = path.join(other, '.ui-sheet-scan.lock');
  const replacement = JSON.stringify({ format: 'ui-sheet/scan-status-v1', runId: otherRun.runId, changed: true });
  await fs.writeFile(lock, replacement);
  await assert.rejects(otherRun.startPage(1, 'capture'), /lock changed during the run/);
  await assert.rejects(otherRun.finish('failed'), /lock changed during the run/);
  assert.equal(await fs.readFile(marker, 'utf8'), original);
  assert.equal(await fs.readFile(lock, 'utf8'), replacement);
});

test('rejects persisted completed markers containing unvisited planned pages', async (t) => {
  const root = await tempDir(t);
  const marker = {
    format: 'ui-sheet/scan-status-v1', status: 'completed', runId: '11111111-1111-1111-1111-111111111111',
    pageProgress: { requested: 2, observed: [1], captured: [1], active: null, failed: null },
  };
  const file = path.join(root, '.ui-sheet-scan.json');
  const original = JSON.stringify(marker);
  await fs.writeFile(file, original);
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ scanRunId: marker.runId }));
  await assert.rejects(readCheckedReport(root), /invalid page progress/);
  await assert.rejects(beginReportScan(root), /invalid page progress/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});
