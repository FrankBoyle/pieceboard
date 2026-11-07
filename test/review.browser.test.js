import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { writeReport } from '../src/report.js';
import { applyDecisions } from '../src/decisions.js';

const bundled = chromium.executablePath();
const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(bundled) ? bundled : '');

test('reviews, imports, and exports decisions in the offline report', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-review-'));
  t.after(async () => { await fs.rm(path.join(dir, 'index.html'), { force: true }); await fs.rm(path.join(dir, 'ui-sheet.json'), { force: true }); await fs.rmdir(dir); });
  const finding = (id, outlier, review) => ({ id, kind: 'button-style-outlier', evidence: 'small sample', group: { family: 'actions', variant: 'primary' }, total: 3, common: { count: 2, example: 'button:0' }, outlier: { count: 1, example: outlier }, differences: [{ property: 'fontSize', label: 'Font size', common: '16px', observed: '20px' }], decisionAnchor: { file: 'src/App.jsx', line: 3 }, ...(review ? { review } : {}) });
  const data = { format: 'ui-sheet/v1', name: 'Synthetic', scannedFiles: 1, warnings: [], items: [], consistency: {
    scope: { url: 'https://example.test/', viewport: { width: 1440, height: 900 } }, counts: { seen: 3, eligible: 3 },
    observations: [{ id: 'button:0' }, { id: 'button:1' }, { id: 'button:2' }], previews: {},
    findings: [finding('1111111111111111', 'button:1', { status: 'intentional', reason: 'Old review.' }), finding('2222222222222222', 'button:2')],
  } };
  await writeReport(data, dir);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage();
    await page.setContent(await fs.readFile(path.join(dir, 'index.html'), 'utf8'));
    await page.locator('.review-tools > summary').click();
    const input = page.locator('.review-import input');
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await page.getByText('Decision file is not valid JSON. Any previous import remains available.').waitFor();
    const existing = { format: 'ui-sheet/decisions-v1', decisions: [
      { findingId: '1111111111111111', status: 'deferred', reason: 'Changed in imported file.' },
      { findingId: 'aaaaaaaaaaaaaaaa', status: 'intentional', reason: 'Preserve this stale decision.' },
    ] };
    await input.setInputFiles({ name: 'existing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(existing)) });
    await page.getByText('2 existing decisions ready to preserve in the download.').waitFor();
    await page.getByText('Imported as deferred: Changed in imported file.').waitFor();
    const form = page.locator('.finding-card').nth(1).locator('.review-form');
    await form.locator('summary').click();
    await form.getByLabel('Decision').selectOption('needs-fix');
    await form.getByLabel('Reason').fill('Fix this control.');
    await form.getByRole('button', { name: 'Queue decision' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download review decisions' }).click()]);
    const file = await download.path();
    const exported = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(exported.decisions.length, 3);
    assert.equal(exported.decisions.find((entry) => entry.findingId === '1111111111111111').status, 'deferred');
    assert.ok(exported.decisions.some((entry) => entry.findingId === 'aaaaaaaaaaaaaaaa'));
    assert.deepEqual(await applyDecisions(data, file), { applied: 2, stale: 1 });
    assert.equal(data.consistency.findings[1].review.reason, 'Fix this control.');
    data.consistency.findings[1].id = data.consistency.findings[0].id;
    await writeReport(data, dir);
    await page.setContent(await fs.readFile(path.join(dir, 'index.html'), 'utf8'));
    assert.equal(await page.locator('.review-form').count(), 0, 'ambiguous IDs cannot receive a saved decision');
  } finally { await browser.close(); }
});
