import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/layout-review/', import.meta.url));
const browserPath = process.env.UI_SHEET_TEST_BROWSER;
const available = Boolean(browserPath || existsSync(chromium.executablePath()));

test('configured CLI captures real layout findings and the report remains accessible on desktop and mobile', { skip: !available && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 90000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-layout-cli-'));
  const html = await fs.readFile(path.join(fixture, 'index.html'));
  const logo = await fs.readFile(path.join(fixture, 'approved-mark.svg'));
  const server = http.createServer((request, response) => {
    const image = request.url === '/approved-mark.svg';
    response.writeHead(200, { 'content-type': image ? 'image/svg+xml' : 'text/html; charset=utf-8' });
    response.end(image ? logo : html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-layout-cli-')) throw new Error('Unexpected layout test directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  await exec(process.execPath, [cli, 'scan', fixture, '--out', root, '--page', `http://127.0.0.1:${server.address().port}/`, '--capture', ...(browserPath ? ['--browser', browserPath] : [])], { timeout: 70000 });
  await assert.rejects(exec(process.execPath, [cli, 'check-layout', root, '--json', '--fail-on-findings', '--strict-coverage']), (error) => {
    assert.equal(error.code, 1);
    const result = JSON.parse(error.stdout);
    assert.equal(result.coverage, 'observed');
    assert.equal(result.counts.findings, 4);
    assert.equal(result.counts.passed, 1);
    assert.equal(result.counts.incomplete, 0);
    assert.equal(result.results.find((entry) => entry.id === 'callout-clearance').measured.bottom, 1);
    assert.equal(result.results.find((entry) => entry.id === 'wordmark-gap').measured.gap, -8);
    assert.equal(result.results.every((entry) => entry.previewAvailable), true);
    assert.equal(error.stdout.includes('data:image'), false);
    return true;
  });
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.setContent(await fs.readFile(path.join(root, 'index.html'), 'utf8'));
    await page.getByRole('heading', { name: 'Spacing, clearance, and approved logos' }).waitFor();
    assert.match(await page.locator('#layout-review').innerText(), /recreated markup/);
    assert.equal(await page.locator('#layout-review .layout-preview').count(), 5);
    const density = await page.locator('#layout-review .layout-preview').first().evaluate((image) => ({ natural: image.naturalWidth, rendered: image.getBoundingClientRect().width }));
    assert.equal(density.natural / density.rendered, 2, '2× screenshots display at their captured CSS width rather than stretching');
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const result = await new AxeBuilder({ page }).include('#layout-review').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      assert.deepEqual(result.violations.map((entry) => ({ id: entry.id, targets: entry.nodes.map((node) => node.target) })), []);
      const fit = await page.locator('#layout-review').evaluate((node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
      assert.equal(fit.scrollWidth, fit.width, 'layout findings do not require horizontal scrolling');
    }
  } finally { await browser.close(); }
});
