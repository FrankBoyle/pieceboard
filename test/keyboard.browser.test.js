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

test('supports keyboard filtering, dialog navigation, visible focus, and reduced motion', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-keyboard-'));
  t.after(async () => { await fs.rm(path.join(root, 'index.html'), { force: true }); await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rmdir(root); });
  const data = { format: 'ui-sheet/v1', name: 'Keyboard example', scannedFiles: 1, warnings: [], items: [
    { id: 'button', name: '<button>', kind: 'components', subtype: 'HTML element', source: 'src/app.html', definitions: [], usages: [{ file: 'src/app.html', line: 1, detail: '', element: { tag: 'button' } }] },
    { id: 'input', name: '<input>', kind: 'components', subtype: 'HTML element', source: 'src/app.html', definitions: [], usages: [{ file: 'src/app.html', line: 2, detail: '', element: { tag: 'input' } }] },
  ] };
  await writeReport(data, root);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to main content');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');

    const components = page.locator('#navigation button').filter({ hasText: 'Components' });
    await components.focus();
    await page.keyboard.press('Enter');
    assert.equal(await components.getAttribute('aria-pressed'), 'true');
    assert.match(await page.evaluate(() => document.activeElement?.textContent), /Components/);

    const buttons = page.locator('#type-navigation button').filter({ hasText: 'Buttons' });
    await buttons.focus();
    await page.keyboard.press('Space');
    assert.equal(await buttons.getAttribute('aria-pressed'), 'true');
    assert.match(await page.evaluate(() => document.activeElement?.textContent), /Buttons/);
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement?.textContent), /Dropdowns/);

    const card = page.locator('#grid .card').first();
    await card.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#detail-dialog').evaluate((element) => element.open), true);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close details');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail-dialog').evaluate((element) => element.open), false);
    assert.equal(await card.evaluate((element) => element === document.activeElement), true);

    await page.locator('#main-content').focus();
    await page.keyboard.press('Control+/');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content', 'modified shortcuts are left alone');
    await page.keyboard.press('/');
    const search = page.locator('#search');
    assert.equal(await search.evaluate((element) => element === document.activeElement), true);
    const outline = await search.evaluate((element) => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }));
    assert.deepEqual(outline, { style: 'solid', width: '3px' });
    await page.keyboard.press('/');
    assert.equal(await search.inputValue(), '/', 'the shortcut does not intercept typing in the search field');
    await search.fill('');
    await card.hover();
    assert.equal(await card.evaluate((element) => getComputedStyle(element).transform), 'none');
  } finally { await browser.close(); }
});
