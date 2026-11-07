import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const bundled = chromium.executablePath();
const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(bundled) ? bundled : '');

test('captures, reviews, and checks an explicitly grouped cross-page difference', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-cross-page-'));
  t.after(async () => {
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('ui-sheet-cross-page-') && !path.isAbsolute(relative) && !relative.startsWith('..')) await fs.rm(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'project');
  const source = path.join(project, 'src', 'index.html');
  const report = path.join(root, 'report');
  const decisions = path.join(root, 'decisions.json');
  const baseline = path.join(root, 'baselines.json');
  await fs.mkdir(path.dirname(source), { recursive: true });
  const button = (id) => `<button id="${id}" type="button" class="button" data-ui-sheet-group="save actions" data-ui-sheet-variant="primary">Save ${id}</button>`;
  await fs.writeFile(source, ['<!doctype html><html><body>', button('a'), button('b'), button('c'), '</body></html>'].join('\n'));
  let allDifferent = false;
  const server = http.createServer((request, response) => {
    const id = request.url?.slice(1);
    if (!['a', 'b', 'c'].includes(id)) { response.writeHead(404); response.end(); return; }
    const radius = allDifferent || id === 'c' ? '3px' : '8px';
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><style>.button{border:1px solid blue;border-radius:${radius};background:blue;color:white;padding:8px 12px}</style>${button(id)}`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (args) => exec(process.execPath, [cli, ...args]);
  await run(['scan', project, '--include', 'src', '--page', `${base}/a`, '--page', `${base}/b`, '--page', `${base}/c`, '--capture', '--cross-page', '--browser', browserPath, '--out', report]);
  let data = JSON.parse(await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8'));
  assert.equal(data.consistency.pages.every((page) => page.findings.length === 0), true);
  assert.equal(data.crossPageConsistency.findings.length, 1);
  const finding = data.crossPageConsistency.findings[0];
  assert.equal(finding.common.pageCount, 2);
  assert.equal(finding.outlier.example.page, 3);
  assert.equal(finding.outlier.example.source.file, 'src/index.html');
  assert.ok(finding.differences.some((difference) => difference.property === 'borderTopLeftRadius' && difference.observed === '3px'));
  const check = JSON.parse((await run(['check', report, '--json'])).stdout);
  assert.equal(check.actionable, 1);
  assert.equal(check.findings[0].kind, 'cross-page-button-style-outlier');
  assert.equal(check.crossPage.coverage, 'observed');
  await run(['decision', report, '--file', decisions, '--finding', finding.id, '--status', 'intentional', '--reason', 'Intentional example.']);
  data = JSON.parse(await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8'));
  assert.equal(data.crossPageConsistency.findings[0].review.status, 'intentional');
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage();
    await page.setContent(await fs.readFile(path.join(report, 'index.html'), 'utf8'));
    assert.equal(await page.locator('.cross-page-finding .comparison-image img').count(), 2);
    assert.equal(await page.locator('.cross-page-finding .review-form').count(), 1);
    assert.match(await page.locator('.cross-page-finding').innerText(), /8px → 3px/);
    assert.match(await page.locator('.cross-page-finding').innerText(), /Page 3: .*\/c/);
    assert.match(await page.locator('.cross-page-finding').innerText(), /Reviewed as intentional/);
    await run(['baseline', report, '--file', baseline, '--observation', 'button:0', '--page', '1', '--cross-page', '--reason', 'Approved save buttons across pages.']);
    allDifferent = true;
    await run(['scan', project, '--include', 'src', '--page', `${base}/a`, '--page', `${base}/b`, '--page', `${base}/c`, '--capture', '--cross-page', '--baseline', baseline, '--browser', browserPath, '--out', report]);
    const changed = JSON.parse(await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8'));
    assert.equal(changed.baselineSummary.applied, 1);
    assert.equal(changed.crossPageConsistency.findings[0].reference, 'approved');
    assert.equal(changed.crossPageConsistency.findings[0].common.example, null);
    assert.equal(changed.crossPageConsistency.findings[0].outlier.pageCount, 3);
    await page.setContent(await fs.readFile(path.join(report, 'index.html'), 'utf8'));
    assert.match(await page.locator('.cross-page-finding').innerText(), /Approved appearance was not observed in this scan/);
    assert.equal(await page.locator('.cross-page-finding .comparison-image img').count(), 1);
  } finally { await browser.close(); }
});
