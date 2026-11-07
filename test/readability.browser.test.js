import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { writeReport } from '../src/report.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');

test('key report labels and source paths remain readable against their backgrounds', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-readability-'));
  t.after(async () => { await fs.rm(path.join(root, 'index.html'), { force: true }); await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rmdir(root); });
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
  const data = { format: 'ui-sheet/v1', name: 'Readability example', scannedFiles: 1, warnings: [], captureSummary: { url: 'https://example.test/', captured: 1 }, items: [{
    id: 'button', name: '<button>', kind: 'components', subtype: 'HTML element', source: 'src/app.html', definitions: [], usages: [{ file: 'src/app.html', line: 1, detail: 'type="button"', element: { tag: 'button' } }], captures: [{ image, file: 'src/app.html', line: 1, method: 'unique ID and tag', label: 'Save', element: { tag: 'button' } }],
  }], consistency: {
    scope: { url: 'https://example.test/', viewport: { width: 1440, height: 900 } }, counts: { seen: 3, eligible: 3, possiblyBlocked: 0, visibilityUnverified: 1 },
    observations: [{ id: 'button:0', source: { status: 'likely', file: 'src/app.html', line: 1 } }, { id: 'button:2', source: { status: 'unresolved' } }], previews: {},
    findings: [{ id: '0123456789abcdef', evidence: 'small sample', group: { family: 'actions', variant: 'primary' }, total: 3, common: { count: 2, example: 'button:0' }, outlier: { count: 1, example: 'button:2' }, differences: [{ label: 'Radius', common: '8px', observed: '3px' }] }],
  } };
  await writeReport(data, root);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    const audit = (selectors) => page.evaluate((selectors) => {
      const channels = (value) => value.match(/[\d.]+/g)?.map(Number) || [];
      const luminance = (rgb) => {
        const values = rgb.slice(0, 3).map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      return selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, missing: true };
        let parent = element;
        let background = [];
        while (parent) {
          const color = channels(getComputedStyle(parent).backgroundColor);
          if (color.length === 3 || (color.length === 4 && color[3] === 1)) { background = color; break; }
          parent = parent.parentElement;
        }
        const foreground = channels(getComputedStyle(element).color);
        const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
        return { selector, contrast: (a + 0.05) / (b + 0.05), fontSize: parseFloat(getComputedStyle(element).fontSize) };
      });
    }, selectors);
    const results = await audit(['.eyebrow', '.consistency-note', '.finding-note', '.comparison-source', '.card-category', '.card-source', '.card-bottom', '.card-bottom strong', '.library-heading p', '.type-heading span', '.preview-caption']);
    await page.locator('#grid .card').first().click();
    results.push(...await audit(['.detail-intro', '.location-list code', '.location-detail', '.detail-empty', '.detail-note', '.capture-zoom-note']));
    for (const result of results) {
      assert.equal(result.missing, undefined, `${result.selector} should be present`);
      assert.ok(result.contrast >= 4.5, `${result.selector} contrast was ${result.contrast.toFixed(2)}`);
    }
    assert.ok(results.find((entry) => entry.selector === '.card-category').fontSize >= 10);
    assert.ok(results.find((entry) => entry.selector === '.card-source').fontSize >= 12);
  } finally { await browser.close(); }
});
