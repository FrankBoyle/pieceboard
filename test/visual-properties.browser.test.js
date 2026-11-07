import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';
import { checkReport } from '../src/check.js';
import { writeReport } from '../src/report.js';
import { beginReportScan } from '../src/scan-status.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');

test('captures gradient and text differences and excludes image URLs from comparison data', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-visual-properties-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-visual-properties-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const html = '<!doctype html><style>.button{border:1px solid blue;border-radius:8px;background:blue;color:white;padding:8px}/*CASE*/</style><main><button id="one" class="button">One</button><button id="two" class="button">Two</button><button id="three" class="button">Three</button><button id="four" class="button wrong">Four</button></main>';
  await fs.writeFile(path.join(root, 'index.html'), html);
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/asset')) { response.writeHead(404); response.end(); return; }
    const css = request.url === '/gradient' ? '.wrong{background-image:linear-gradient(red,blue);font-style:italic;text-transform:uppercase;text-decoration:underline}' : request.url === '/effects' ? '.wrong{opacity:.35;filter:blur(1.5px)}' : '.wrong{background-image:url("/asset?token=SYNTHETIC_SECRET")}' ;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html.replace('/*CASE*/', css));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const gradient = await scanProject(root, { includePaths: ['index.html'] });
  await capturePage(gradient, `${base}/gradient`, { browserPath });
  assert.equal(gradient.consistency.findings.length, 1);
  const finding = gradient.consistency.findings[0];
  assert.deepEqual(finding.differences.map((entry) => entry.property), ['backgroundImage', 'fontStyle', 'textTransform', 'textDecorationLine']);
  assert.ok(gradient.consistency.previews[finding.outlier.example]?.image, 'the changed button has a real screenshot');

  const effects = await scanProject(root, { includePaths: ['index.html'] });
  await capturePage(effects, `${base}/effects`, { browserPath });
  assert.equal(effects.consistency.findings.length, 1);
  assert.deepEqual(effects.consistency.findings[0].differences.map((entry) => entry.property), ['opacity', 'filter']);
  assert.ok(effects.consistency.previews[effects.consistency.findings[0].outlier.example]?.image);

  const image = await scanProject(root, { includePaths: ['index.html'] });
  await capturePage(image, `${base}/image`, { browserPath });
  assert.equal(image.consistency.counts.missingStyle, 1);
  assert.equal(image.consistency.counts.eligible, 3);
  assert.equal(JSON.stringify(image).includes('SYNTHETIC_SECRET'), false, 'the background URL is not retained in the report data');
  const report = path.join(root, 'report');
  const run = await beginReportScan(report);
  image.scanRunId = run.runId;
  await writeReport(image, report);
  await run.finish('completed');
  assert.equal((await checkReport(report)).coverage, 'partial');
});
