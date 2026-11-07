import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const crossPage = process.argv.includes('--cross-page');
const zoom = process.argv.includes('--zoom');
const approval = process.argv.includes('--approval');
const elements = process.argv.includes('--elements');
if ([crossPage, zoom, approval, elements].filter(Boolean).length > 1) throw new Error('Choose only one of --cross-page, --zoom, --approval, or --elements.');
const report = path.resolve(elements ? '.ui-sheet-demo-elements/index.html' : crossPage ? '.ui-sheet-demo-cross-page/index.html' : '.ui-sheet-demo-consistency/index.html');
const html = await fs.readFile(report, 'utf8').catch(() => { throw new Error(`Run npm run ${elements ? 'demo:elements' : crossPage ? 'demo:cross-page' : 'demo:consistency'} first.`); });
const output = path.resolve(elements ? 'docs/images/ui-groups.png' : crossPage ? 'docs/images/cross-page.png' : zoom ? 'docs/images/button-zoom.png' : approval ? 'docs/images/approve-appearance.png' : 'docs/images/button-review.png');
await fs.mkdir(path.dirname(output), { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.UI_SHEET_BROWSER ? { executablePath: process.env.UI_SHEET_BROWSER } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  if (zoom) await page.locator('.finding-card .comparison-full summary').last().click();
  else if (!crossPage && !elements) await page.locator('.appearance-gallery > summary').click();
  if (approval) await page.locator('.appearance-grid > figure').first().locator('.baseline-form > summary').click();
  await page.locator('#consistency-review img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page.locator(elements ? '.element-finding' : crossPage ? '.cross-page-review' : zoom ? '.finding-card' : approval ? '.appearance-grid > figure' : '#consistency-review').first().screenshot({ path: output, scale: 'device' });
  console.log(`Wrote ${output}`);
} finally { await browser.close(); }
