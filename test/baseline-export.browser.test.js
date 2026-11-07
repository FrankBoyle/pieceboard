import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';
import { readBaselines, setBaseline } from '../src/baselines.js';
import { writeReport } from '../src/report.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const fixture = fileURLToPath(new URL('../examples/button-review/', import.meta.url));

test('exports approved appearances and preserves imported baselines', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-baseline-export-'));
  const report = path.join(root, 'report');
  const maskedReport = path.join(root, 'masked');
  const duplicateReport = path.join(root, 'duplicate');
  const legacyReport = path.join(root, 'legacy');
  const incompleteReport = path.join(root, 'incomplete');
  const existing = path.join(root, 'existing.json');
  t.after(async () => {
    for (const dir of [report, maskedReport, duplicateReport, legacyReport, incompleteReport]) {
      await fs.rm(path.join(dir, 'index.html'), { force: true });
      await fs.rm(path.join(dir, 'ui-sheet.json'), { force: true });
      await fs.rmdir(dir).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    await fs.rm(existing, { force: true });
    await fs.rmdir(root);
  });
  const html = await fs.readFile(path.join(fixture, 'index.html'));
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const data = await scanProject(fixture);
  await capturePage(data, url, { browserPath });
  await writeReport(data, report);
  await setBaseline(report, { file: existing, observationId: 'button:0', crossPage: true, reason: 'Existing cross-page reference.' });
  const original = await fs.readFile(existing, 'utf8');

  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(report, 'index.html')).href);
    await page.locator('.baseline-tools > summary').click();
    const input = page.locator('.baseline-tools input[type="file"]');
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await page.getByText('Baseline file is not valid JSON. Any previous import remains available.').waitFor();
    await input.setInputFiles(existing);
    await page.getByText('1 existing approval ready to preserve. The next scan validates all imported rules.').waitFor();
    await input.setInputFiles({ name: 'old-baselines.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"ui-sheet/baselines-v1","rules":[]}') });
    await page.getByText('This baseline predates four-sided border measurements. Capture a fresh report and reapprove appearances in a new baseline file. Any previous import remains available.').waitFor();
    await input.setInputFiles({ name: 'previous-baselines.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"ui-sheet/baselines-v2","rules":[]}') });
    await page.getByText('This baseline predates gradient and text-style measurements. Capture a fresh report and reapprove appearances in a new baseline file. Any previous import remains available.').waitFor();
    await input.setInputFiles({ name: 'pre-effects-baselines.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"ui-sheet/baselines-v3","rules":[]}') });
    await page.getByText('This baseline predates opacity and filter measurements. Capture a fresh report and reapprove appearances in a new baseline file. Any previous import remains available.').waitFor();
    await input.setInputFiles({ name: 'invalid-again.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await page.getByText('Baseline file is not valid JSON. Any previous import remains available.').waitFor();
    await page.locator('.appearance-gallery > summary').click();
    const primary = page.locator('.appearance-grid > figure').filter({ hasText: 'account actions · primary' });
    assert.equal(await primary.count(), 2);
    const first = primary.nth(0).locator('.baseline-form');
    await first.locator('summary').click();
    await first.getByRole('button', { name: 'Queue approval' }).click();
    await first.getByText('Enter a reason of 1–500 characters.').waitFor();
    await first.getByLabel('Reason').fill('First page reference.');
    await first.getByRole('button', { name: 'Queue approval' }).click();
    const second = primary.nth(1).locator('.baseline-form');
    await second.locator('summary').click();
    await second.getByLabel('Reason').fill('The outlier is the approved page reference.');
    await second.getByRole('button', { name: 'Queue approval' }).click();
    await first.getByText('Replaced by a later approval for this group and scope.').waitFor();
    const danger = page.locator('.appearance-grid > figure').filter({ hasText: 'account actions · danger' }).locator('.baseline-form');
    await danger.locator('summary').click();
    await danger.getByLabel('Approval scope').selectOption('crossPage');
    await danger.getByLabel('Reason').fill('Approved danger style across pages.');
    await danger.getByRole('button', { name: 'Queue approval' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download baseline file' }).click()]);
    const exported = await readBaselines(await download.path());
    assert.equal(exported.rules.length, 3);
    assert.equal(exported.rules.find((rule) => rule.scope.url === '*' && rule.group.variant === 'primary').reason, 'Existing cross-page reference.');
    assert.equal(exported.rules.find((rule) => rule.scope.url === '*' && rule.group.variant === 'danger').reason, 'Approved danger style across pages.');
    assert.equal(exported.rules.find((rule) => rule.scope.url === 'local:/').reason, 'The outlier is the approved page reference.');
    assert.equal(JSON.stringify(exported).includes('data:image'), false);
    assert.equal(await fs.readFile(existing, 'utf8'), original, 'the imported file is not changed');

    const later = await scanProject(fixture);
    await capturePage(later, url, { browserPath, baselines: exported.rules });
    assert.equal(later.consistency.findings[0].reference, 'approved');
    assert.equal(later.consistency.findings[0].outlier.count, 2);

    const masked = structuredClone(data);
    masked.consistency.scope.maskSelectorsConfigured = 1;
    await writeReport(masked, maskedReport);
    await page.goto(pathToFileURL(path.join(maskedReport, 'index.html')).href);
    assert.equal(await page.locator('.baseline-tools').count(), 0, 'masked previews cannot be approved from the visual report');

    const duplicate = structuredClone(data);
    const other = structuredClone(duplicate.consistency);
    other.scope.url = 'http://localhost:9999/?different-query';
    duplicate.consistency = { format: 'ui-sheet/consistency-v2', pages: [duplicate.consistency, other] };
    await writeReport(duplicate, duplicateReport);
    await page.goto(pathToFileURL(path.join(duplicateReport, 'index.html')).href);
    assert.equal(await page.locator('.baseline-tools').count(), 0, 'duplicate route scopes cannot be approved from the visual report');
    const legacy = structuredClone(data);
    legacy.consistency.findingIdentity = 'ui-sheet/button-finding-v5';
    await writeReport(legacy, legacyReport);
    await page.goto(pathToFileURL(path.join(legacyReport, 'index.html')).href);
    assert.equal(await page.locator('.baseline-tools, .baseline-form').count(), 0, 'older native measurements cannot be relabeled as a current approval file');
    const incomplete = structuredClone(data);
    delete incomplete.consistency.observations[0].style.filter;
    await writeReport(incomplete, incompleteReport);
    await page.goto(pathToFileURL(path.join(incompleteReport, 'index.html')).href);
    assert.equal(await page.locator('.baseline-tools, .baseline-form').count(), 0, 'a current identity without current style evidence cannot be approved');
  } finally { await browser.close(); }
});
