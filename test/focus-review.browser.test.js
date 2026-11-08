import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { capturePage } from '../src/capture.js';
import { scanProject } from '../src/scan.js';
import { writeReport } from '../src/report.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');

test('focuses real captured examples and decisions without retaining button labels', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 90000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-focus-'));
  const reportDir = path.join(root, 'report');
  t.after(async () => {
    for (const file of [path.join(reportDir, 'index.html'), path.join(reportDir, 'ui-sheet.json'), path.join(root, 'index.html')]) await fs.rm(file, { force: true });
    await fs.rmdir(reportDir).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(root);
  });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><main></main>');
  const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>
    body { font: 16px Arial; margin: 0 } header { padding: 12px; background: #ddeeff }
    aside { position: relative; width: 300px; padding: 60px 10px 12px; background: #eef4f8 }
    .over { position: absolute; top: 12px; left: 10px }
    button { font: inherit; padding: 8px; margin: 3px; border: 1px solid #174f7a; border-radius: 8px; background: white }
    .different { border-radius: 2px }
  </style><header>Test header</header><aside class="sidebar"><span class="over">First label</span><span class="over">Second label</span>
    <button type="button" class="button">Save profile</button><button type="button" class="button">Save settings</button>
    <button type="button" class="button different">Cancel</button><button type="button" class="button">Escalate SYNTHETIC_PRIVATE_LABEL</button>
    <button type="button" class="button" id="private">Save SYNTHETIC_MASKED_LABEL</button>
    <button type="button" class="button selected">12</button><button type="button" class="button outside-month">13</button>
  </aside>`;
  const server = http.createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const data = await scanProject(root);
  await capturePage(data, `http://127.0.0.1:${server.address().port}/`, { browserPath, pixelRatio: 1, requestedFocus: 'escalate', maskSelectors: ['#private'], responsiveViewports: [{ width: 390, height: 844 }] });
  data.reviewFocus = 'escalate'; data.scanRunId = 'focus-browser-test';
  const observations = data.consistency.observations;
  assert.ok(observations.some((entry) => entry.focus?.actions.includes('save') && entry.focus.regions.includes('sidebar')));
  assert.ok(observations.some((entry) => entry.focus?.actions.includes('cancel')));
  assert.equal(observations.find((entry) => entry.id === 'button:3').focus.requested, true);
  assert.equal(observations.find((entry) => entry.id === 'button:4').focus?.actions.includes('save'), false);
  assert.ok(data.consistency.counts.stateful >= 2, 'selected and outside-month states are not compared as ordinary buttons');
  assert.equal(JSON.stringify(data).includes('SYNTHETIC_PRIVATE_LABEL'), false);
  assert.equal(JSON.stringify(data).includes('SYNTHETIC_MASKED_LABEL'), false);
  const responsive = data.responsiveAudit.pages[0].viewports[0];
  assert.ok(responsive.landmarks.some((entry) => entry.kind === 'sidebar' && entry.previewIndex === 0));
  assert.ok(responsive.findings.some((entry) => entry.kind === 'overlapping-text' && entry.regions?.includes('sidebar') && entry.otherBounds));
  await writeReport(data, reportDir);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const context = await browser.newContext();
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(reportDir, 'index.html')).href);
    assert.equal(await page.getByLabel('Feature or action').inputValue(), 'escalate');
    assert.ok(await page.locator('#focus-review .focus-example').count() > 0, 'custom action has a genuine captured example');
    await page.getByRole('button', { name: 'Sidebars', exact: true }).click();
    assert.ok(await page.locator('#focus-review .focus-region-preview img').count() > 0, 'sidebar is visible in the real screenshot');
    assert.ok(await page.locator('#layout-decisions fieldset').count() > 0, 'sidebar layout issues are filtered in');
    if (process.env.PIECEBOARD_FOCUS_SCREENSHOT) await page.locator('#focus-review').screenshot({ path: process.env.PIECEBOARD_FOCUS_SCREENSHOT });
    const overlap = page.locator('#layout-decisions fieldset').filter({ hasText: 'Overlapping text' }).first();
    assert.match(await overlap.innerText(), /Check whether both are visible at once/);
    assert.equal(await overlap.locator('.responsive-highlight').count(), 2, 'both measured text areas are outlined');
    await page.getByRole('button', { name: 'Save buttons', exact: true }).click();
    assert.ok(await page.locator('#focus-review .focus-example').count() > 0);
    assert.ok(await page.locator('#choice-review fieldset:visible').count() > 0);
    assert.match(await page.locator('#choice-review fieldset:visible').first().innerText(), /may serve different actions/);
    await page.locator('#choice-review fieldset:visible input[value="ignore"]').first().check();
    await page.getByRole('button', { name: 'Headers', exact: true }).click();
    assert.ok(await page.locator('#focus-review .focus-region-preview img').count() > 0, 'header is visible in the real screenshot');
    await page.getByRole('button', { name: 'Save buttons', exact: true }).click();
    assert.equal(await page.locator('#choice-review fieldset:visible input[value="ignore"]').first().isChecked(), true, 'changing focus preserves answers');
    await page.getByLabel('Feature or action').fill('unmatched feature');
    assert.match(await page.locator('#focus-review').innerText(), /No captured examples match/);
    await page.getByRole('button', { name: 'Everything', exact: true }).click();
    const accessibility = await new AxeBuilder({ page }).include('#focus-review').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    assert.deepEqual(accessibility.violations.map((entry) => ({ id: entry.id, targets: entry.nodes.map((node) => node.target) })), []);
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
