import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkLayout } from '../src/layout-check.js';
import { beginReportScan } from '../src/scan-status.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
function report({ incomplete = false } = {}) {
  return { format: 'ui-sheet/v1', warnings: [], items: [], layoutAudit: { format: 'ui-sheet/layout-pages-v1', pages: [{
    format: 'ui-sheet/layout-v1',
    scope: { url: 'http://example.test/demo', viewport: { width: 1440, height: 900 }, colorScheme: 'light', media: 'screen', pixelRatio: 2, browser: { engine: 'chromium', version: 'test' } },
    coverage: incomplete ? 'partial' : 'observed', counts: { rules: 1, passed: 0, findings: incomplete ? 0 : 1, incomplete: incomplete ? 1 : 0 },
    results: [{ id: 'callout-clearance', kind: 'text-inset', selector: '.callout', status: incomplete ? 'incomplete' : 'finding',
      message: incomplete ? 'Target missing.' : 'Bottom text clearance is below the configured minimum.',
      expected: { min: { bottom: 12 } }, measured: incomplete ? { matches: 0 } : { top: 16, right: 16, bottom: 1, left: 16, textRects: 2 },
      source: { status: 'manual', file: 'src/Callout.jsx', line: 8 },
      preview: { image: 'data:image/png;base64,PRIVATE_SCREENSHOT', pixelRatio: 2, width: 600, height: 100 },
    }],
  }] } };
}
async function fixture(t, data = report(), { verified = true, failed = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-layout-check-'));
  t.after(async () => {
    for (const file of ['ui-sheet.json', '.ui-sheet-scan.json']) await fs.rm(path.join(root, file), { force: true });
    await fs.rmdir(root);
  });
  if (verified) {
    const run = await beginReportScan(root);
    data.scanRunId = run.runId;
    await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
    await run.finish(failed ? 'failed' : 'completed');
  } else await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  return root;
}

test('layout checks expose measured evidence without screenshot payloads and honor CI policy exits', async (t) => {
  const root = await fixture(t);
  const output = await checkLayout(root);
  assert.equal(output.coverage, 'observed');
  assert.equal(output.counts.findings, 1);
  assert.equal(output.results[0].measured.bottom, 1);
  assert.equal(output.results[0].source.file, 'src/Callout.jsx');
  assert.equal(output.results[0].previewAvailable, true);
  assert.equal(JSON.stringify(output).includes('PRIVATE_SCREENSHOT'), false);
  assert.equal(JSON.stringify(output).includes('data:image'), false);
  const command = await exec(process.execPath, [cli, 'check-layout', root, '--json']);
  assert.equal(JSON.parse(command.stdout).format, 'ui-sheet/layout-check-v1');
  await assert.rejects(exec(process.execPath, [cli, 'check-layout', root, '--json', '--fail-on-findings']), (error) => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).counts.findings, 1);
    return true;
  });
});

test('incomplete targets, unverified scans, and source warnings cannot produce complete layout coverage', async (t) => {
  const root = await fixture(t, report({ incomplete: true }));
  await assert.rejects(exec(process.execPath, [cli, 'check-layout', root, '--json', '--strict-coverage']), (error) => {
    assert.equal(error.code, 2);
    assert.equal(JSON.parse(error.stdout).coverage, 'partial');
    return true;
  });
  const unverified = await fixture(t, report(), { verified: false });
  assert.equal((await checkLayout(unverified)).coverage, 'partial');
  const warning = report(); warning.warnings.push({ file: 'src/Callout.jsx', message: 'Could not parse.' });
  assert.equal((await checkLayout(await fixture(t, warning))).coverage, 'partial');
  const failed = await fixture(t, report(), { failed: true });
  await assert.rejects(checkLayout(failed), /did not complete/);
});

test('layout checks reject contradictory counts and nested unexpected payloads instead of returning clean evidence', async (t) => {
  for (const change of [
    (data) => { data.layoutAudit.pages[0].counts.findings = 0; },
    (data) => { data.layoutAudit.pages[0].results[0].expected.preview = { image: 'data:image/png;base64,SECRET' }; },
    (data) => { data.layoutAudit.pages[0].results[0].measured.image = 'data:image/png;base64,SECRET'; },
    (data) => { data.layoutAudit.pages[0].coverage = 'partial'; },
    (data) => { data.layoutAudit.pages[0].results[0].measured = {}; },
    (data) => { data.layoutAudit.pages[0].results[0].status = 'passed'; data.layoutAudit.pages[0].counts = { rules: 1, passed: 1, findings: 0, incomplete: 0 }; },
  ]) {
    const data = report(); change(data);
    await assert.rejects(checkLayout(await fixture(t, data)), /incomplete or unsupported/);
  }
  const data = report();
  data.layoutAudit.pages[0].scope.image = 'PRIVATE_SCOPE_IMAGE';
  data.layoutAudit.pages[0].results[0].source.image = 'PRIVATE_SOURCE_IMAGE';
  const output = await checkLayout(await fixture(t, data));
  assert.equal(JSON.stringify(output).includes('PRIVATE_'), false, 'unrecognized scope/source fields are not copied');
});

test('missing layout evidence has a structured JSON error with exit 2', async (t) => {
  const data = report(); delete data.layoutAudit;
  const root = await fixture(t, data);
  await assert.rejects(exec(process.execPath, [cli, 'check-layout', root, '--json']), (error) => {
    assert.equal(error.code, 2);
    assert.equal(JSON.parse(error.stdout).error.code, 'LAYOUT_CHECK_FAILED');
    return true;
  });
});

test('zero-pixel style values align with the producer and contradictory numeric facts are rejected', async (t) => {
  const data = report();
  const page = data.layoutAudit.pages[0];
  page.counts = { rules: 1, passed: 1, findings: 0, incomplete: 0 };
  Object.assign(page.results[0], { kind: 'style', status: 'passed', expected: { property: 'wordSpacing', min: 0, max: 2 }, measured: { property: 'wordSpacing', value: '0', px: 0 } });
  assert.equal((await checkLayout(await fixture(t, data))).counts.passed, 1);
  page.results[0].measured.px = 1;
  await assert.rejects(checkLayout(await fixture(t, data)), /incomplete or unsupported/);
});
