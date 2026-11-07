import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { capturePage } from '../src/capture.js';
import { runWithCaptureDeadline } from '../src/capture-deadline.js';
import { readElementBaselines, setElementBaseline } from '../src/element-baselines.js';
import { scanProject } from '../src/scan.js';
import { writeReport } from '../src/report.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const MAX_BYTES = 2 * 1024 * 1024;
async function bounded(promise, timeoutMs = 10000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Download did not complete in time.')), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

test('exports configured UI approvals separately and preserves existing rules and restrictions', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 150000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-element-export-'));
  t.after(async () => {
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp); assert.ok(path.basename(actual).startsWith('ui-sheet-element-export-'));
    await fs.rm(actual, { recursive: true, force: true });
  });
  const html = '<!doctype html><html lang="en"><title>UI approval sample</title><style>body{padding:24px}.field{font:16px Arial;padding:8px;border:1px solid blue;border-radius:8px;background:white;color:blue;margin:4px}.wrong{border-radius:2px}</style><main>\n' +
    Array.from({ length: 4 }, (_, index) => `<input id="field-${index}" class="field regular${index === 3 ? ' wrong' : ''}" aria-label="Field ${index}">`).join('\n') +
    '\n<select id="choice" class="field compact" aria-label="Choice"><option>Compact choice</option></select></main></html>';
  await fs.writeFile(path.join(root, 'index.html'), html);
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const elementGroups = [{ selector: '.regular', family: 'project fields', type: 'inputs', variant: 'regular' }, { selector: '.compact', family: 'compact choices', type: 'dropdowns', variant: 'compact' }];
  const data = await scanProject(root);
  await capturePage(data, url, { browserPath, elementGroups });
  const report = path.join(root, 'report'), existing = path.join(root, 'existing.json');
  await writeReport(data, report);
  await setElementBaseline(report, { file: existing, observationId: 'input:0', crossPage: true, reason: 'Existing cross-page field reference.' });
  const original = await fs.readFile(existing, 'utf8');
  const existingRule = (await readElementBaselines(existing)).rules[0];

  const exported = await runWithCaptureDeadline(async ({ ownBrowser }) => {
    const browser = ownBrowser(await chromium.launch({ headless: true, executablePath: browserPath, timeout: 30000 }));
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    await page.goto(pathToFileURL(path.join(report, 'index.html')).href);
    assert.equal(await page.locator('.baseline-tools').count(), 0, 'native-button export remains separate');
    const tools = page.locator('.element-baseline-tools');
    await tools.locator('summary').click();
    const input = tools.locator('input[type="file"]');
    await tools.getByRole('button', { name: 'Download UI group baseline file' }).click();
    await tools.getByText('Approve a UI appearance or import an element baseline file first.').waitFor();
    await input.setInputFiles(existing);
    await tools.getByText('1 existing UI approval ready to preserve. The next scan validates all imported rules.').waitFor();
    for (const [name, content, message] of [
      ['invalid.json', '{', 'Element baseline file is not valid JSON.'],
      ['old.json', '{"format":"ui-sheet/element-baselines-v1","rules":[]}', 'This element baseline predates opacity and filter measurements. Capture a fresh report and reapprove appearances in a new element baseline file.'],
      ['buttons.json', '{"format":"ui-sheet/baselines-v4","rules":[]}', 'This is not a supported Pieceboard element baseline file.'],
      ['duplicate.json', JSON.stringify({ format: 'ui-sheet/element-baselines-v2', rules: [existingRule, existingRule] }), 'The element baseline file contains an invalid or duplicate entry.'],
      ['too-many.json', JSON.stringify({ format: 'ui-sheet/element-baselines-v2', rules: Array(1001).fill(existingRule) }), 'This is not a supported Pieceboard element baseline file.'],
      ['too-large.json', ' '.repeat(MAX_BYTES + 1), 'Element baseline file is larger than 2 MB.'],
    ]) {
      await input.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });
      await tools.getByText(`${message} Any previous import remains available.`, { exact: true }).waitFor();
    }
    const gallery = page.locator('.element-appearance-gallery');
    await gallery.locator(':scope > summary').click();
    const regular = gallery.locator('.appearance-grid > figure').filter({ hasText: 'project fields · regular' });
    assert.equal(await regular.count(), 2);
    const first = regular.nth(0).locator('.element-baseline-form');
    await first.locator('summary').click();
    await first.getByRole('button', { name: 'Queue UI approval' }).click();
    await first.getByText('Enter a reason of 1–500 characters.').waitFor();
    await first.getByLabel('UI approval reason').evaluate((input) => { input.value = 'x'.repeat(501); });
    await first.getByRole('button', { name: 'Queue UI approval' }).click();
    await first.getByText('Enter a reason of 1–500 characters.').waitFor();
    await first.getByLabel('UI approval reason').fill('First page field reference.');
    await first.getByRole('button', { name: 'Queue UI approval' }).click();
    const second = regular.nth(1).locator('.element-baseline-form');
    await second.locator('summary').click();
    await second.getByLabel('UI approval reason').fill('The outlier is the chosen page field reference.');
    await second.getByRole('button', { name: 'Queue UI approval' }).click();
    await first.getByText('Replaced by a later UI approval for this group and scope.').waitFor();
    const compact = gallery.locator('.appearance-grid > figure').filter({ hasText: 'compact choices · compact' }).locator('.element-baseline-form');
    await compact.locator('summary').click();
    await compact.getByLabel('UI approval scope').selectOption('crossPage');
    await compact.getByLabel('UI approval reason').fill('Approved compact choice across pages.');
    await compact.getByRole('button', { name: 'Queue UI approval' }).click();

    const largeRule = { ...existingRule, retainedNote: '' };
    const largeImport = { format: 'ui-sheet/element-baselines-v2', rules: [largeRule] };
    largeRule.retainedNote = 'x'.repeat(MAX_BYTES - Buffer.byteLength(JSON.stringify(largeImport)) - 100);
    await input.setInputFiles({ name: 'large-valid-shape.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(largeImport)) });
    await tools.getByText('1 existing UI approval ready to preserve. The next scan validates all imported rules.').waitFor();
    await tools.getByRole('button', { name: 'Download UI group baseline file' }).click();
    await tools.getByText('The combined element baseline file would exceed 2 MB.').waitFor();
    await input.setInputFiles(existing);
    await tools.getByText('1 existing UI approval ready to preserve. The next scan validates all imported rules.').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), tools.getByRole('button', { name: 'Download UI group baseline file' }).click()]);
    assert.equal(download.suggestedFilename(), 'ui-sheet.elements.json');
    const result = await readElementBaselines(await bounded(download.path()));
    assert.equal(result.format, 'ui-sheet/element-baselines-v2');
    assert.equal(result.rules.length, 3);
    assert.equal(result.rules.find((rule) => rule.scope.url === '*' && rule.group.variant === 'regular').reason, 'Existing cross-page field reference.');
    assert.equal(result.rules.find((rule) => rule.scope.url === '*' && rule.group.variant === 'compact').reason, 'Approved compact choice across pages.');
    assert.equal(result.rules.find((rule) => rule.scope.url === 'local:/').reason, 'The outlier is the chosen page field reference.');
    assert.equal(result.rules.find((rule) => rule.scope.url === 'local:/').style.borderTopLeftRadius, '2px');
    assert.equal(JSON.stringify(result).includes('data:image'), false);
    assert.equal(await fs.readFile(existing, 'utf8'), original, 'imported file is unchanged');

    for (const [name, change] of [
      ['masked', (copy) => { copy.elementConsistency.pages[0].scope.maskSelectorsConfigured = 1; }],
      ['missing', (copy) => { copy.elementConsistency.pages[0].previews = {}; }],
      ['old-measurements', (copy) => { copy.elementConsistency.pages[0].findingIdentity = 'ui-sheet/element-finding-v1'; }],
      ['duplicate', (copy) => { const other = structuredClone(copy.elementConsistency.pages[0]); other.scope.url = 'http://localhost:9999/?different-query'; copy.elementConsistency.pages.push(other); }],
    ]) {
      const copy = structuredClone(data); change(copy);
      const directory = path.join(root, name); await writeReport(copy, directory);
      await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
      assert.equal(await page.locator('.element-baseline-tools').count(), 0, name);
      assert.equal(await page.locator('.element-baseline-form').count(), 0, name);
    }
    const partial = structuredClone(data); delete partial.elementConsistency.pages[0].previews['input:0'];
    const partialDirectory = path.join(root, 'partial'); await writeReport(partial, partialDirectory);
    await page.goto(pathToFileURL(path.join(partialDirectory, 'index.html')).href);
    assert.equal(await page.locator('.element-baseline-tools').count(), 1, 'other captured appearances remain approvable');
    const unavailable = page.locator('.element-appearance-gallery figure').filter({ hasText: 'Observation: input:0' });
    assert.equal(await unavailable.locator('.element-baseline-form').count(), 0);
    return result;
  }, { timeoutMs: 90000 });
  const later = await scanProject(root);
  await capturePage(later, url, { browserPath, elementGroups, elementBaselines: exported.rules });
  const fieldFinding = later.elementConsistency.pages[0].findings.find((finding) => finding.group.family === 'project fields');
  assert.equal(fieldFinding.reference, 'approved');
  assert.equal(fieldFinding.outlier.count, 3);
});
