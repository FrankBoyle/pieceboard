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
import Ajv2020 from 'ajv/dist/2020.js';
import { auditResponsive, displayResponsiveRoute, validateResponsiveViewports } from '../src/responsive-audit.js';
import { readProjectConfig } from '../src/config.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const browserPath = process.env.UI_SHEET_TEST_BROWSER;
const available = Boolean(browserPath || existsSync(chromium.executablePath()));
const browserOptions = { skip: !available && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 90000 };
const fixture = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Responsive fixture</title>
<style>
* { box-sizing: border-box; } body { margin: 0; font: 16px/24px Arial,sans-serif; }
#wide { width: 100%; height: 40px; background: #ddd; }
#clip { height: 40px; overflow: visible; }
#first, #second { display: block; } #overlap { height: 60px; position: relative; }
#carousel { width: 200px; overflow-x: auto; } #carousel-inner { width: 600px; height: 30px; }
#secret { width: 100px; height: 30px; background: #f00; } #below { width: 100%; }
@media (max-width: 500px) {
  #wide { width: 700px; } #below { width: 650px; } #clip { height: 10px; overflow: hidden; }
  #first, #second { position: absolute; left: 0; top: 0; }
}
</style></head><body>
<main><div id="wide" role="button">Wide box</div><div id="clip"><span id="clip-text">A clipped label</span></div>
<div id="overlap"><span id="first">Overlapping first</span><span id="second">Overlapping second</span></div>
<div id="carousel"><div id="carousel-inner">Intentional scrolling area</div></div><div id="secret">Private</div>
<div id="js-sized">JavaScript-controlled box</div><div style="height: 1000px"></div><div id="below" role="button">Below the fold</div></main>
<script>
if (innerWidth < 500) document.querySelector('#js-sized').style.width = '650px';
if (location.hash.startsWith('#/settings') && innerWidth < 500) document.querySelector('#wide').style.width = '720px';
if (location.hash.startsWith('#/redirected')) location.hash = '#/other';
</script>
</body></html>`;

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-responsive-'));
  await fs.writeFile(path.join(root, 'index.html'), fixture);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(request.url.startsWith('/frame') ? '<!doctype html><html lang="en"><title>Frame</title><iframe title="Embedded content" srcdoc="&lt;p&gt;Embedded UI&lt;/p&gt;"></iframe></html>' : fixture);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('pieceboard-responsive-')) throw new Error('Unexpected test directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  return { root, url: `http://127.0.0.1:${server.address().port}/` };
}

test('validates responsive viewport selections', () => {
  assert.deepEqual(validateResponsiveViewports([{ width: 390, height: 844 }]), [{ width: 390, height: 844 }]);
  assert.throws(() => validateResponsiveViewports([]), /1 to 8/);
  assert.throws(() => validateResponsiveViewports([{ width: 390, height: 844 }, { width: 390, height: 844 }]), /unique/);
  assert.throws(() => validateResponsiveViewports([{ width: 4096, height: 2000 }], 4), /device-pixel limit/);
});

test('keeps hash-router paths while excluding queries, fragments used as tokens, and encoded parameters', () => {
  const display = (value) => displayResponsiveRoute(new URL(value));
  assert.equal(display('https://example.test/app?outer=private#/settings?token=private'), 'https://example.test/app#/settings');
  assert.equal(display('https://example.test/app#!/profile?token=private'), 'https://example.test/app#!/profile');
  assert.equal(display('https://example.test/app#/settings%3Ftoken%3Dprivate'), 'https://example.test/app#/settings');
  assert.equal(display('https://example.test/app#/settings%253Ftoken%253Dprivate'), 'https://example.test/app#/settings');
  assert.equal(display('https://example.test/app#/settings;token=private'), 'https://example.test/app#/settings');
  assert.equal(display('https://example.test/app#access_token=private'), 'https://example.test/app');
  assert.equal(display('https://example.test/app#ordinary-anchor'), 'https://example.test/app');
});

test('loads project viewport settings and rejects incomplete CLI requests', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-responsive-config-'));
  t.after(async () => {
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('pieceboard-responsive-config-')) throw new Error('Unexpected test directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const config = path.join(root, 'ui-sheet.config.json');
  const sizes = [{ width: 375, height: 812 }, { width: 1440, height: 900 }];
  await fs.writeFile(config, JSON.stringify({ responsiveViewports: sizes }));
  assert.deepEqual((await readProjectConfig(root)).responsiveViewports, sizes);
  await assert.rejects(exec(process.execPath, [cli, 'scan', root, '--out', path.join(root, 'one'), '--responsive']), /--responsive requires --capture/);
  await assert.rejects(exec(process.execPath, [cli, 'scan', root, '--out', path.join(root, 'two'), '--capture', '--page', 'http://127.0.0.1/', '--responsive-viewport', '390x844']), /--responsive-viewport requires --responsive/);
  await fs.writeFile(config, JSON.stringify({ responsiveViewports: [sizes[0], sizes[0]] }));
  await assert.rejects(readProjectConfig(root), /must be unique/);
});

test('inspects real page geometry at each width and ignores intentional scrolling containers', browserOptions, async (t) => {
  const { url } = await setup(t);
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  t.after(() => browser.close());
  const result = await auditResponsive(browser, { items: [] }, `${url}?private=query`, {
    viewports: [{ width: 390, height: 844 }, { width: 1024, height: 768 }], colorScheme: 'light', pixelRatio: 1,
    maskSelectors: ['#secret'], actions: [], browserVersion: browser.version(), throwIfExpired() {},
  });
  assert.equal(result.url, url, 'query strings are not recorded');
  const [mobile, desktop] = result.viewports;
  assert.equal(mobile.coverage, 'observed');
  assert.equal(desktop.coverage, 'observed');
  assert.ok(mobile.findings.some((finding) => finding.kind === 'horizontal-overflow' && finding.selector === '#wide'));
  assert.ok(mobile.findings.some((finding) => finding.kind === 'horizontal-overflow' && finding.selector === '#js-sized'), 'JavaScript sees the mobile width during page load');
  assert.ok(mobile.findings.some((finding) => finding.kind === 'clipped-text' && finding.selector === '#clip-text'));
  assert.ok(mobile.findings.some((finding) => finding.kind === 'overlapping-text' && [finding.selector, finding.otherSelector].includes('#first')));
  const below = mobile.findings.find((finding) => finding.selector === '#below');
  assert.ok(below && below.previewIndex > 0, 'a below-the-fold finding gets a scrolled browser capture');
  assert.ok(mobile.previews[below.previewIndex].scroll.y > 0);
  assert.equal(mobile.findings.some((finding) => finding.selector === '#carousel-inner'), false);
  assert.equal(desktop.findings.length, 0);
  assert.equal(mobile.findings.find((finding) => finding.selector === '#wide').computedStyle.width, '700px');
  assert.match(mobile.previews[0].image, /^data:image\/png;base64,/);
  assert.match(mobile.findings.find((finding) => finding.selector === '#wide').recommendation.css, /#wide[\s\S]*max-width: 100%/);
  assert.match(mobile.findings.find((finding) => finding.kind === 'clipped-text').recommendation.css, /#clip[\s\S]*height: auto/);
  assert.match(mobile.findings.find((finding) => finding.kind === 'overlapping-text').recommendation.css, /#overlap[\s\S]*flex-wrap: wrap/);
  assert.equal(JSON.stringify(result).includes('A clipped label'), false, 'measurement data does not include rendered copy');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(url);
    for (const kind of ['horizontal-overflow', 'clipped-text', 'overlapping-text']) {
      const finding = mobile.findings.find((entry) => entry.kind === kind);
      await page.addStyleTag({ content: finding.recommendation.css });
    }
    const fixed = await page.evaluate(() => {
      const wide = document.querySelector('#wide').getBoundingClientRect();
      const container = document.querySelector('#clip').getBoundingClientRect();
      const text = document.querySelector('#clip-text').getBoundingClientRect();
      const first = document.querySelector('#first').getBoundingClientRect(), second = document.querySelector('#second').getBoundingClientRect();
      return { wide: wide.width, textBottom: text.bottom, containerBottom: container.bottom, horizontalOverlap: Math.min(first.right, second.right) - Math.max(first.left, second.left), verticalOverlap: Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) };
    });
    assert.ok(fixed.wide <= 390, 'the suggested flexible width fixes the observed wide element');
    assert.ok(fixed.textBottom <= fixed.containerBottom + 2, 'the suggested expanding container reveals the clipped text');
    assert.ok(fixed.horizontalOverlap <= 0 || fixed.verticalOverlap <= 0, 'the suggested flowing layout separates the overlapping text');
  } finally { await context.close(); }
  const incomplete = await auditResponsive(browser, { items: [] }, url, {
    viewports: [{ width: 390, height: 844 }], colorScheme: 'light', pixelRatio: 1,
    maskSelectors: [], actions: [{ kind: 'focus', selector: '#missing' }], browserVersion: browser.version(), throwIfExpired() {},
  });
  assert.equal(incomplete.viewports[0].coverage, 'incomplete');
  assert.match(incomplete.viewports[0].reason, /configured page action/);
  const framed = await auditResponsive(browser, { items: [] }, `${url}frame`, {
    viewports: [{ width: 390, height: 844 }], colorScheme: 'light', pixelRatio: 1,
    maskSelectors: [], actions: [], browserVersion: browser.version(), throwIfExpired() {},
  });
  assert.equal(framed.viewports[0].coverage, 'partial');
  assert.equal(framed.viewports[0].inspected.uninspected, 1, 'visible iframe contents are not treated as inspected');
  const redirected = await auditResponsive(browser, { items: [] }, `${url}#/redirected?token=private`, {
    viewports: [{ width: 390, height: 844 }], colorScheme: 'light', pixelRatio: 1,
    maskSelectors: [], actions: [], browserVersion: browser.version(), throwIfExpired() {},
  });
  assert.equal(redirected.viewports[0].coverage, 'incomplete', 'navigation to a different hash route cannot be labeled as the requested route');
  assert.match(redirected.viewports[0].reason, /navigated away/);
});

test('CLI puts responsive findings and masked captures into the offline report', browserOptions, async (t) => {
  const { root, url } = await setup(t);
  const out = path.join(root, 'report');
  const hashUrl = `${url}?outer=outer-private-value#/settings?token=inner-private-value`;
  const command = [cli, 'scan', root, '--out', out, '--page', hashUrl, '--capture', '--responsive', '--responsive-viewport', '390x844', '--responsive-viewport', '1024x768', '--mask-selector', '#secret', ...(browserPath ? ['--browser', browserPath] : [])];
  const { stdout } = await exec(process.execPath, command, { timeout: 75000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  assert.match(stdout, /Inspected 2 page\/viewport combination/);
  const report = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8'));
  const schemas = new Map();
  const schemaDirectory = new URL('../schemas/', import.meta.url);
  for (const file of await fs.readdir(schemaDirectory)) if (file.endsWith('.schema.json')) schemas.set(file, JSON.parse(await fs.readFile(new URL(file, schemaDirectory), 'utf8')));
  const validator = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  for (const schema of schemas.values()) validator.addSchema(schema);
  const validateReport = validator.getSchema(schemas.get('report-v1.schema.json').$id);
  assert.equal(validateReport(report), true, validator.errorsText(validateReport.errors));
  const invalid = structuredClone(report);
  invalid.responsiveAudit.pages[0].viewports[0].findings[0].viewportWidth = -1;
  assert.equal(validateReport(invalid), false, 'invalid responsive evidence fails the shipped report schema');
  const [mobile, desktop] = report.responsiveAudit.pages[0].viewports;
  assert.equal(report.responsiveAudit.pages[0].url, `${url}#/settings`, 'the report identifies the captured hash route without its query');
  assert.equal(JSON.stringify(report).includes('outer-private-value'), false);
  assert.equal(JSON.stringify(report).includes('inner-private-value'), false);
  assert.ok(mobile.findings.some((finding) => finding.selector === '#wide'));
  assert.equal(mobile.findings.find((finding) => finding.selector === '#wide').computedStyle.width, '720px', 'the capture rendered the hash-specific view');
  assert.equal(desktop.findings.length, 0);
  assert.ok(mobile.findings.find((finding) => finding.selector === '#wide').source?.file === 'index.html');
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(await fs.readFile(path.join(out, 'index.html'), 'utf8'));
    await page.getByRole('heading', { name: 'Layout across screen widths' }).waitFor();
    const section = page.locator('#responsive-review');
    assert.match(await section.innerText(), /390 × 844/);
    assert.match(await section.innerText(), /#\/settings/);
    assert.match(await section.innerText(), /Horizontal overflow/);
    assert.match(await section.innerText(), /#wide/);
    assert.ok(await section.locator('.responsive-preview').count() >= 2);
    assert.ok(await section.locator('.responsive-highlight').count() > 0, 'the report highlights measured areas over actual captures');
    assert.match(await section.innerText(), /Possible improvement/);
    assert.match(await section.innerText(), /max-width: 100%/);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const result = await new AxeBuilder({ page }).include('#responsive-review').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      assert.deepEqual(result.violations.map((entry) => entry.id), []);
      const fit = await section.evaluate((node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
      assert.equal(fit.scrollWidth, fit.width, 'responsive report itself fits the viewport');
    }
    const image = mobile.previews[0].image;
    const maskedPixel = await page.evaluate(async (source) => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(10, 150, 1, 1).data);
    }, image);
    assert.deepEqual(maskedPixel, [32, 32, 32, 255], 'responsive screenshots honor configured masks');
  } finally { await browser.close(); }
});
