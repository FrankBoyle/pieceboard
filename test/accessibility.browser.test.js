import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';
import { writeReport } from '../src/report.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const fixture = fileURLToPath(new URL('../examples/button-review/', import.meta.url));
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('source token cards and scoped declaration details pass selected axe rules on desktop and mobile', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-token-accessibility-'));
  t.after(async () => {
    for (const file of ['theme.css', 'index.html', 'ui-sheet.json']) await fs.rm(path.join(root, file), { force: true });
    await fs.rmdir(root);
  });
  await fs.writeFile(path.join(root, 'theme.css'), ':root { --control-radius: 8px; }\n[data-theme="dark"] { --control-radius: 6px; }');
  await writeReport(await scanProject(root), root);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.setContent(await fs.readFile(path.join(root, 'index.html'), 'utf8'));
    await page.getByRole('button', { name: /Other tokens/ }).click();
    const audit = async (state) => {
      const result = await new AxeBuilder({ page }).withTags(tags).analyze();
      const violations = result.violations.map((entry) => ({ id: entry.id, targets: entry.nodes.map((node) => node.target) }));
      assert.deepEqual(violations, [], `${state}: ${JSON.stringify(violations)}`);
    };
    await audit('source token card');
    await page.getByRole('button', { name: /--control-radius/ }).click();
    await page.getByRole('heading', { name: 'Scoped CSS declarations' }).waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /\[data-theme="dark"\]: 6px/);
    await audit('scoped token details');
    await page.setViewportSize({ width: 320, height: 640 });
    await audit('narrow scoped token details');
    const dimensions = await page.getByRole('dialog').evaluate((node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
    assert.equal(dimensions.scrollWidth, dimensions.width, 'token details fit the narrow dialog');
  } finally { await browser.close(); }
});

test('generated report has no axe WCAG A or AA violations in selected states', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-accessibility-'));
  t.after(async () => { await fs.rm(path.join(root, 'index.html'), { force: true }); await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rmdir(root); });
  const html = await fs.readFile(path.join(fixture, 'index.html'));
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const data = await scanProject(fixture);
  await capturePage(data, `http://127.0.0.1:${server.address().port}/`, { browserPath });
  await writeReport(data, root);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.setContent(await fs.readFile(path.join(root, 'index.html'), 'utf8'));
    const audit = async (state) => {
      const result = await new AxeBuilder({ page }).withTags(tags).analyze();
      const violations = result.violations.map((entry) => ({ id: entry.id, targets: entry.nodes.map((node) => node.target) }));
      assert.deepEqual(violations, [], `${state}: ${JSON.stringify(violations)}`);
    };
    assert.match(await page.locator('#scan-info').innerText(), /\d{4}-\d{2}-\d{2} .* UTC/);
    await audit('desktop report');
    await page.locator('.review-form > summary').first().click();
    await page.locator('.appearance-gallery > summary').first().click();
    await audit('expanded review and appearances');
    await page.locator('#grid .card').first().click();
    assert.equal(await page.locator('#detail-dialog').evaluate((element) => element.open), true);
    await audit('details dialog');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await audit('mobile report');
    await page.setViewportSize({ width: 320, height: 640 });
    const fit = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      overflowingLabels: [...document.querySelectorAll('.stat-top, .stat > span')].filter((element) => element.scrollWidth > element.clientWidth).map((element) => element.textContent),
    }));
    assert.equal(fit.document, fit.viewport, 'the narrow report does not require horizontal scrolling');
    assert.deepEqual(fit.overflowingLabels, [], 'summary labels wrap within their cards');
  } finally { await browser.close(); }
});
