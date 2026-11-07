import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';

const pageUrl = 'https://microsoftedge.github.io/Demos/devtools-a11y-testing/';
const revision = 'b580fc1ce460a67207f4c0b69292f70d2c84f12a';
const sourceBase = `https://raw.githubusercontent.com/MicrosoftEdge/Demos/${revision}/devtools-a11y-testing/`;
const files = ['index.html', 'css/styles.css', 'css/dark-theme.css', 'css/light-theme.css'];
// These six labels were selected for a small, manual spot check. They are not
// an independent or representative benchmark of source-link accuracy.
const expected = [
  { name: 'amount-50', selector: '.donationbutton', index: 0, count: 3, tag: 'div', text: '50', line: 115 },
  { name: 'amount-100', selector: '.donationbutton', index: 1, count: 3, tag: 'div', text: '100', line: 116 },
  { name: 'amount-200', selector: '.donationbutton', index: 2, count: 3, tag: 'div', text: '200', line: 117 },
  { name: 'other-amount', selector: '#freedonation', index: 0, count: 1, tag: 'input', id: 'freedonation', line: 121 },
  { name: 'donate', selector: '.submitbutton', index: 0, count: 1, tag: 'div', text: 'Donate', line: 124 },
  { name: 'navigation', selector: '#sitenavigation', index: 0, count: 1, tag: 'nav', id: 'sitenavigation', line: 137 },
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Public evaluation request failed with HTTP ${response.status}.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('A public evaluation response exceeded 2 MB.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-public-eval-'));
  let browser;
  try {
    const [live, ...sourceFiles] = await Promise.all([fetchBytes(pageUrl), ...files.map((file) => fetchBytes(sourceBase + file))]);
    await fs.mkdir(path.join(root, 'css'));
    for (const [index, file] of files.entries()) await fs.writeFile(path.join(root, file), sourceFiles[index]);
    await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ inventoryClasses: [{ className: 'donationbutton', type: 'buttons' }, { className: 'submitbutton', type: 'buttons' }] }));
    const data = await scanProject(root, { includePaths: ['index.html', 'css'] });
    await capturePage(data, pageUrl, { browserPath: process.env.UI_SHEET_BROWSER });
    browser = await chromium.launch({ headless: true, ...(process.env.UI_SHEET_BROWSER ? { executablePath: process.env.UI_SHEET_BROWSER } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
    const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response?.ok() || page.url() !== pageUrl) throw new Error('The public demo did not load at its expected URL.');
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await page.evaluate(async () => { if (document.fonts) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]); });
    const observed = await page.evaluate((cases) => cases.map((entry) => {
      const matches = document.querySelectorAll(entry.selector);
      const element = matches[entry.index];
      return Boolean(matches.length === entry.count && element && element.localName === entry.tag && (!entry.id || element.id === entry.id) && (!entry.text || element.innerText.trim().replace(/\s+/g, ' ') === entry.text));
    }), expected);
    const htmlMatches = live.equals(sourceFiles[0]);
    const results = [];
    for (const [index, entry] of expected.entries()) {
      const item = data.items.find((candidate) => candidate.usages.some((usage) => usage.file === 'index.html' && usage.line === entry.line && usage.element?.tag === entry.tag && (!entry.id || usage.element.id === entry.id) && (!entry.text || usage.element.text === entry.text)));
      const preview = item?.captures?.find((capture) => capture.file === 'index.html' && capture.line === entry.line && capture.element?.tag === entry.tag && capture.image?.startsWith('data:image/png;base64,'));
      let identicalPngBytes = null;
      if (preview && observed[index]) {
        try {
          const locator = page.locator(`css=${entry.selector}`).nth(entry.index);
          await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
          if (page.url() !== pageUrl) throw new Error('The public demo navigated away.');
          const fresh = await locator.screenshot({ type: 'png', scale: preview.pixelRatio === 1 ? 'css' : 'device', animations: 'disabled', timeout: 4000 });
          identicalPngBytes = fresh.equals(Buffer.from(preview.image.split(',')[1], 'base64'));
        } catch {
          if (page.url() !== pageUrl) throw new Error('The public demo navigated away during the spot check.');
          // Dynamic or unavailable screenshots remain unverified.
        }
      }
      results.push({ name: entry.name, sourceRecord: Boolean(item), renderedElement: observed[index], sourceLinkedPreview: Boolean(preview), identicalPngBytes, passed: htmlMatches && !data.warnings.length && Boolean(item && observed[index] && preview) });
    }
    const passed = results.filter((entry) => entry.passed).length;
    console.log(JSON.stringify({ format: 'ui-sheet/public-source-spotcheck-v1', checkedAt: new Date().toISOString(), page: pageUrl, pinnedSourceCommit: revision, liveHtmlSha256: digest(live), pinnedHtmlSha256: digest(sourceFiles[0]), htmlMatches, sourceWarnings: data.warnings.length, sourceLinkedPreviews: data.captureSummary.captured, passed, total: results.length, identicalPngBytes: results.filter((entry) => entry.identicalPngBytes === true).length, pngChecks: results.filter((entry) => entry.identicalPngBytes !== null).length, results, limitations: 'Six hand-selected associations on one public demo; HTML equality does not verify deployed CSS, JavaScript, or repository revision. Capture and DOM checks use separate requests and the site can change between them. PNG byte comparisons are diagnostic; different bytes do not necessarily mean different pixels.' }, null, 2));
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-public-eval-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 2; });
