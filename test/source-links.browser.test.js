import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { scanProject } from '../src/scan.js';
import { applySourceLinks, capturePage } from '../src/capture.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const exec = promisify(execFile);

test('manual links require one recorded source and a matching tag', () => {
  const usage = { file: 'page.html', line: 2, element: { tag: 'button' } };
  const data = { items: [{ kind: 'components', usages: [usage] }] };
  const rule = { selector: '#save', file: 'page.html', line: 2 };
  const element = { tag: 'button', index: 0, visible: true, sourceLinkIndex: 0 };
  assert.equal(applySourceLinks(data, [element], [], [rule])[0].manualSelector, '#save');
  assert.throws(() => applySourceLinks(data, [], [], [{ ...rule, line: 3 }]), /exactly one recorded element/);
  assert.throws(() => applySourceLinks({ items: [...data.items, ...data.items] }, [], [], [rule]), /exactly one recorded element/);
  assert.throws(() => applySourceLinks(data, [{ ...element, tag: 'input' }], [], [rule]), /different tag/);
});

test('an explicit source link appears in a real comparison and can anchor a review', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-source-links-'));
  const report = path.join(root, 'report');
  t.after(async () => {
    for (const file of [path.join(report, 'index.html'), path.join(report, 'ui-sheet.json'), path.join(report, '.ui-sheet-scan.json'), path.join(root, 'decisions.json'), path.join(root, 'ui-sheet.config.json'), path.join(root, 'index.html')]) await fs.rm(file, { force: true });
    await fs.rmdir(report).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(root);
  });
  const lines = [
    '<!doctype html>', '<html><head><style>button { border-radius: 8px; } .donationbutton { display: inline-block; padding: 8px; background: orange; }</style></head>', '<body><div id="shadow-host"></div>',
    '<button class="button" type="button">Save</button>',
    '<button class="button" type="button">Save</button>',
    '<button class="button" type="button" data-outlier>Save</button>',
    '<div class="donationbutton">Give</div>',
    '<div class="ordinary">Page copy</div>',
    '</body></html>',
  ];
  const source = lines.join('\n');
  await fs.writeFile(path.join(root, 'index.html'), source);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(source.replace('data-outlier>', 'data-outlier style="border-radius:3px">').replace('</body>', '<script>document.querySelector("#shadow-host").attachShadow({mode:"open"}).innerHTML="<button>Shadow</button>";</script></body>'));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const rule = { selector: 'button[data-outlier]', file: 'index.html', line: 6 };
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [url], pixelRatio: 3, sourceLinks: [rule], inventoryClasses: [{ className: 'donationbutton', type: 'buttons' }] }));
  await exec(process.execPath, [cli, 'scan', root, '--capture', '--browser', browserPath, '--pixel-ratio', '4', '--out', report]);
  const data = JSON.parse(await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8'));
  const finding = data.consistency.findings[0];
  const outlier = data.consistency.observations.find((observation) => observation.id === finding.outlier.example);
  assert.deepEqual(outlier.source, { status: 'manual', file: 'index.html', line: 6, method: 'configured selector and source location' });
  assert.deepEqual(finding.decisionAnchor, { file: 'index.html', line: 6 });
  assert.ok(data.consistency.previews[finding.outlier.example]?.image.startsWith('data:image/png;base64,'));
  assert.equal(data.consistency.scope.pixelRatio, 4);
  assert.equal(data.consistency.previews[finding.outlier.example].pixelRatio, 4);
  const custom = data.items.find((item) => item.usages.some((usage) => usage.element?.inventoryTypes));
  assert.equal(custom.captures[0].element.tag, 'div');
  assert.equal(custom.captures[0].classification, 'configured UI class');
  assert.equal(data.items.flatMap((item) => item.usages).some((usage) => usage.element?.text === 'Page copy'), false);
  await exec(process.execPath, [cli, 'decision', report, '--file', path.join(root, 'decisions.json'), '--finding', finding.id, '--status', 'intentional', '--reason', 'Reviewed by a person.']);
  const decisions = JSON.parse(await fs.readFile(path.join(root, 'decisions.json'), 'utf8'));
  assert.equal(decisions.decisions[0].findingId, finding.id);

  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(report, 'index.html')).href);
    assert.match(await page.locator('.comparison-source').allTextContents().then((items) => items.join(' ')), /Manually linked source: index\.html:6.*user-supplied/);
    const details = page.locator('.finding-card .comparison-full').last();
    await details.locator('summary').click();
    const image = details.locator('.capture-full-scroll img');
    await image.evaluate((element) => element.decode());
    const slider = details.locator('input[type="range"]');
    assert.equal(await slider.getAttribute('max'), '2');
    assert.equal(await slider.isDisabled(), false);
    const dimensions = await image.evaluate((element) => ({ natural: element.naturalWidth, rendered: element.getBoundingClientRect().width }));
    assert.ok(Math.abs(dimensions.rendered - dimensions.natural / 2) < 0.1, 'original image pixels are not enlarged beyond the display pixels');
    await slider.evaluate((element) => { element.value = '1'; element.dispatchEvent(new Event('input')); });
    assert.ok(Math.abs(await image.evaluate((element) => element.getBoundingClientRect().width) - dimensions.natural / 4) < 0.1);
    await page.locator('#type-navigation button').filter({ hasText: 'Buttons' }).click();
    const card = page.locator('#grid .card').filter({ hasText: 'Give' });
    assert.equal(await card.count(), 1, 'the configured custom control is sorted with buttons');
    await card.click();
    assert.match(await page.locator('#detail-content').innerText(), /configured UI class/);
    assert.match(await page.locator('#detail-content').innerText(), /UI types supplied by project configuration: buttons/);
  } finally { await browser.close(); }

  const projectData = await scanProject(root);
  await assert.rejects(capturePage(projectData, url, { browserPath, sourceLinks: [{ ...rule, selector: '[' }] }), /valid CSS selectors/);
  await assert.rejects(capturePage(projectData, url, { browserPath, sourceLinks: [rule, rule] }), /source links overlap/);
  await assert.rejects(capturePage(projectData, url, { browserPath, sourceLinks: [{ ...rule, selector: 'button' }] }), /more than one visible element/);
});
