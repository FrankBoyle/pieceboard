import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import Ajv2020 from 'ajv/dist/2020.js';
import { checkReport } from '../src/check.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const exec = promisify(execFile);

test('a signed-in site review finds multiple pages, keeps all findings, and reports a failed page', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 120000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-site-scan-'));
  const out = path.join(root, 'report');
  t.after(async () => {
    for (const file of ['index.html', 'ui-sheet.json', '.ui-sheet-scan.json']) await fs.rm(path.join(out, file), { force: true });
    await fs.rmdir(out).catch(() => {});
    for (const file of ['App.html', 'state.json']) await fs.rm(path.join(root, file), { force: true });
    await fs.rmdir(root);
  });
  const example = await fs.readFile(new URL('../examples/button-review/index.html', import.meta.url), 'utf8');
  await fs.writeFile(path.join(root, 'App.html'), example);
  const state = { cookies: [{ name: 'demo_session', value: 'synthetic-private-cookie', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] };
  await fs.writeFile(path.join(root, 'state.json'), JSON.stringify(state));
  const received = []; let unstable = 0;
  const server = http.createServer((request, response) => {
    received.push({ url: request.url, method: request.method });
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (!(request.headers.cookie || '').includes('demo_session=synthetic-private-cookie')) { response.end('<input type="password">'); return; }
    if (request.url === '/unstable' && ++unstable > 1) { response.writeHead(503); response.end('Unavailable'); return; }
    const links = request.url === '/' ? '<a href="/second?student=private-example">Second</a><a href="/unstable">Unstable</a><a href="/delete">Delete</a><script>fetch("/api/update",{method:"POST"}).catch(()=>{})</script>' : '';
    const overflow = request.url?.startsWith('/second') ? '<div style="width:1600px">Long test content</div>' : '';
    response.end(example.replace('</main>', `${links}${overflow}</main>`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const start = `http://127.0.0.1:${server.address().port}/`;
  const result = await exec(process.execPath, [cli, 'scan', root, '--include', 'App.html', '--site', start, '--site-limit', '10', '--responsive-viewport', '390x844', '--browser', browserPath, '--storage-state', path.join(root, 'state.json'), '--out', out], { timeout: 110000, maxBuffer: 1024 * 1024 });
  assert.match(result.stdout, /Site review: 2 page\(s\) captured, 1 incomplete/);
  const report = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8'));
  const schemaDirectory = new URL('../schemas/', import.meta.url);
  const validator = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  for (const file of await fs.readdir(schemaDirectory)) if (file.endsWith('.schema.json')) validator.addSchema(JSON.parse(await fs.readFile(new URL(file, schemaDirectory), 'utf8')));
  const validReport = validator.getSchema('https://raw.githubusercontent.com/FrankBoyle/pieceboard/main/schemas/report-v1.schema.json');
  assert.equal(validReport(report), true, validator.errorsText(validReport.errors, { separator: '\n' }));
  assert.equal(report.siteScan.captured, 2);
  assert.equal(report.siteScan.incomplete, 1);
  assert.equal(report.siteScan.pages.find(page => page.status === 'incomplete').url.endsWith('/unstable'), true);
  assert.equal(report.siteScan.pages.find(page => page.url.includes('/second')).url.includes('private-example'), false);
  assert.ok(report.siteScan.blockedWrites > 0);
  assert.equal(received.some(request => request.method === 'POST' || request.url === '/delete'), false);
  assert.equal(JSON.stringify(report).includes('synthetic-private-cookie'), false);
  assert.equal(JSON.stringify(report).includes('private-example'), false);
  assert.equal(report.consistency.pages.length, 2);
  assert.ok(report.consistency.pages.every(page => page.findings.length > 0));
  assert.ok(report.responsiveAudit.pages.flatMap(page => page.viewports).some(viewport => viewport.findings.some(finding => finding.kind === 'horizontal-overflow')));
  const checked = await checkReport(out);
  assert.notEqual(checked.coverage, 'observed');
  assert.deepEqual(checked.pageProgress.skipped, [3]);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
    assert.match(await page.locator('#site-review').innerText(), /2 pages inspected/);
    assert.match(await page.locator('#site-review').innerText(), /1 pages could not be inspected/);
    const expectedFindings = report.consistency.pages.reduce((n, item) => n + item.findings.length, 0) + (report.crossPageConsistency?.findings.length || 0) + report.responsiveAudit.pages.flatMap(item => item.viewports).reduce((n, width) => n + width.findings.length, 0);
    assert.equal(await page.locator('#site-review .site-findings li').count(), expectedFindings);
    assert.ok(await page.locator('#choice-review input[type=radio]').count() >= 2);
    const target = await page.locator('#site-review .site-findings a').first().getAttribute('href');
    assert.equal(await page.locator(target).count(), 1);
    await page.getByLabel('Finding category').selectOption('Layout');
    assert.ok(await page.locator('#site-review .site-findings li:visible').count() > 0);
    assert.equal(await page.locator('#site-review .site-findings li:visible .site-category').allTextContents().then(items => items.every(item => item === 'Layout')), true);
    await page.getByLabel('Search findings').fill('no-such-issue-for-this-test');
    assert.equal(await page.locator('#site-review .site-findings li:visible').count(), 0);
    await page.getByLabel('Search findings').fill('');
    await page.getByLabel('Finding category').selectOption('');
    assert.equal(await page.locator('#site-review .site-findings li:visible').count(), expectedFindings);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
