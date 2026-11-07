import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';
import { auditLayout } from '../src/layout-audit.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER;
const browserAvailable = Boolean(browserPath || existsSync(chromium.executablePath()));
const browserOptions = { skip: !browserAvailable && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 30000 };
const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#173c29"/><path d="M20 15h35v30H20z" fill="#e4b54a"/></svg>';

async function fixture(t, contents) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url?.startsWith('/approved.svg') || request.url?.startsWith('/other.svg')) {
      response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(logo); return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="en"><title>Layout audit example</title><style>body{margin:20px;font:16px/20px Arial,sans-serif}*{box-sizing:border-box}</style>${contents}</html>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  t.after(async () => {
    try { if (browser) await browser.close(); }
    finally { await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }); }
  });
  browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const options = {
    scope: { url, viewport: { width: 1000, height: 900 }, colorScheme: 'light', media: 'screen', pixelRatio: 2, browser: { engine: 'chromium', version: browser.version() } },
    pixelRatio: 2,
    throwIfExpired() {},
  };
  return { page, options, requests };
}

test('measures crowded text, overlapping wordmark parts, and unusual word spacing with real previews', browserOptions, async (t) => {
  const { page, options } = await fixture(t, `<style>
    .callout{position:relative;width:300px;height:64px;border:1px solid #173c29;background:#173c29;color:white;margin:10px 0}
    .callout span{position:absolute;left:16px;right:16px;bottom:0;font:18px/22px Arial}
    #comfortable span{bottom:18px}
    .brand{position:relative;width:300px;height:54px;margin:10px 0}
    .brand span{position:absolute;top:8px;font:bold 24px/28px Arial}
    .first{left:0}.overlapping{left:50px}.separated{left:130px}
    #wrong-spacing{word-spacing:8px}#right-spacing{word-spacing:1px}
    </style><main>
    <div id="crowded" class="callout"><span>Short supporting text</span></div>
    <div id="comfortable" class="callout"><span>Short supporting text</span></div>
    <div class="brand"><span id="brand-first" class="first">ALPHA</span><span id="brand-second" class="overlapping">BETA</span></div>
    <div class="brand"><span id="safe-first" class="first">ALPHA</span><span id="safe-second" class="separated">BETA</span></div>
    <p id="wrong-spacing">A short line with unusual word spacing.</p><p id="right-spacing">A short line with usual word spacing.</p>
    </main>`);
  const rules = [
    { id: 'callout-crowding', kind: 'text-inset', selector: '#crowded', min: { bottom: 12 }, source: { file: 'src/Callout.jsx', line: 18 } },
    { id: 'callout-clearance', kind: 'text-inset', selector: '#comfortable', min: { bottom: 12 } },
    { id: 'wordmark-overlap', kind: 'horizontal-gap', selector: '#brand-first', otherSelector: '#brand-second', min: 4 },
    { id: 'wordmark-clearance', kind: 'horizontal-gap', selector: '#safe-first', otherSelector: '#safe-second', min: 4, max: 100 },
    { id: 'word-spacing', kind: 'style', selector: '#wrong-spacing', property: 'wordSpacing', min: 0, max: 2 },
    { id: 'usual-word-spacing', kind: 'style', selector: '#right-spacing', property: 'wordSpacing', min: 0, max: 2 },
  ];
  const result = await auditLayout(page, rules, options);
  const byId = new Map(result.results.map((entry) => [entry.id, entry]));
  assert.equal(result.format, 'ui-sheet/layout-v1');
  assert.equal(result.coverage, 'observed');
  assert.equal(result.counts.rules, 6);
  assert.equal(result.counts.findings, 3);
  assert.equal(result.counts.passed, 3);
  assert.equal(byId.get('callout-crowding').status, 'finding');
  assert.ok(byId.get('callout-crowding').measured.bottom < 12);
  assert.deepEqual(byId.get('callout-crowding').source, { status: 'manual', file: 'src/Callout.jsx', line: 18 });
  assert.equal(byId.get('callout-clearance').status, 'passed');
  assert.ok(byId.get('callout-clearance').measured.bottom >= 12);
  assert.equal(byId.get('wordmark-overlap').status, 'finding');
  assert.ok(byId.get('wordmark-overlap').measured.gap < 0, 'negative signed gap preserves the overlap evidence');
  assert.equal(byId.get('wordmark-clearance').status, 'passed');
  assert.equal(byId.get('word-spacing').measured.px, 8);
  assert.equal(byId.get('usual-word-spacing').status, 'passed');
  const preview = byId.get('callout-crowding').preview;
  assert.match(preview.image, /^data:image\/png;base64,/);
  const png = Buffer.from(preview.image.split(',')[1], 'base64');
  assert.equal(png.readUInt32BE(16), preview.width);
  assert.equal(png.readUInt32BE(20), preview.height);
  assert.equal(preview.pixelRatio, 2);
  assert.ok(preview.width >= 600, 'the actual 300px target has a high-density capture');
  assert.equal(JSON.stringify(result).includes('Short supporting text'), false, 'text content is not exported as measurement data');
});

test('checks approved image placement without fetching assets again or retaining URL queries', browserOptions, async (t) => {
  const { page, options, requests } = await fixture(t, `<style>img{display:block;margin:12px 0}</style><main>
    <img id="approved" src="/approved.svg" width="200" height="60" alt="Synthetic approved logo">
    <img id="different" src="/other.svg?token=SYNTHETIC_BRAND_SECRET" width="200" height="60" alt="Synthetic alternate logo">
    <img id="distorted" src="/approved.svg" width="100" height="60" alt="Distorted synthetic logo">
    <div id="recreated">ALPHA BETA</div></main>`);
  await page.locator('#approved').evaluate((image) => image.decode());
  await page.locator('#different').evaluate((image) => image.decode());
  await page.locator('#distorted').evaluate((image) => image.decode());
  const before = requests.filter((request) => request?.startsWith('/approved.svg') || request?.startsWith('/other.svg')).length;
  const result = await auditLayout(page, [
    { id: 'approved-artwork', kind: 'image', selector: '#approved', paths: ['/approved.svg'] },
    { id: 'wrong-artwork', kind: 'image', selector: '#different', paths: ['/approved.svg'] },
    { id: 'distorted-artwork', kind: 'image', selector: '#distorted', paths: ['/approved.svg'] },
    { id: 'recreated-artwork', kind: 'image', selector: '#recreated', paths: ['/approved.svg'] },
  ], options);
  const [approved, wrong, distorted, recreated] = result.results;
  assert.equal(approved.status, 'passed');
  assert.equal(approved.measured.decoded, true);
  assert.equal(approved.measured.approvedPath, true);
  assert.equal(approved.measured.naturalWidth, 200);
  assert.equal(wrong.status, 'finding');
  assert.equal(wrong.measured.approvedPath, false);
  assert.equal(distorted.status, 'finding');
  assert.ok(distorted.measured.aspectRatioError > 0.02);
  assert.equal(recreated.status, 'finding');
  assert.equal(recreated.measured.elementTag.toLowerCase(), 'div');
  assert.equal(result.coverage, 'observed');
  assert.equal(requests.filter((request) => request?.startsWith('/approved.svg') || request?.startsWith('/other.svg')).length, before, 'the audit reads decoded image metadata rather than fetching image bytes');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_BRAND_SECRET'), false);
});

test('missing, hidden, ambiguous and unsupported layout targets remain incomplete', browserOptions, async (t) => {
  const { page, options } = await fixture(t, `<style>#hidden{display:none}.duplicate{display:block}.transformed{transform:translateX(1px)}</style><main>
    <p id="hidden">Hidden text</p><p class="duplicate">First</p><p class="duplicate">Second</p>
    <div class="transformed"><p id="transformed">Transformed text</p></div>
    <div id="empty"></div><p id="normal-line-height" style="line-height:normal">Normal line height</p>
    </main>`);
  const result = await auditLayout(page, [
    { id: 'absent', kind: 'text-inset', selector: '#not-present', min: { bottom: 4 } },
    { id: 'hidden', kind: 'text-inset', selector: '#hidden', min: { bottom: 4 } },
    { id: 'ambiguous', kind: 'text-inset', selector: '.duplicate', min: { bottom: 4 } },
    { id: 'transformed', kind: 'text-inset', selector: '#transformed', min: { bottom: 4 } },
    { id: 'empty', kind: 'text-inset', selector: '#empty', min: { bottom: 4 } },
    { id: 'normal-line-height', kind: 'style', selector: '#normal-line-height', property: 'lineHeight', min: 16, max: 30 },
  ], options);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.counts.incomplete, 6);
  assert.equal(result.counts.passed, 0);
  assert.equal(result.counts.findings, 0);
  assert.ok(result.results.every((entry) => entry.status === 'incomplete'));
});

test('bounded text traversal refuses partial clearance evidence for an oversized target', browserOptions, async (t) => {
  const { page, options } = await fixture(t, `<main><div id="many" style="padding:16px">${Array.from({ length: 1001 }, () => '<span>word</span>').join('')}</div></main>`);
  const result = await auditLayout(page, [{ id: 'bounded', kind: 'text-inset', selector: '#many', min: { bottom: 8 } }], options);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.results[0].status, 'incomplete');
  assert.equal(result.counts.findings, 0);
  assert.equal(result.counts.passed, 0);
});

test('an actively changing target does not produce a stable clearance claim', browserOptions, async (t) => {
  const { page, options } = await fixture(t, `<style>
    #changing{width:250px;height:70px;padding:12px;animation:grow 2s linear infinite alternate}
    @keyframes grow{from{height:70px}to{height:170px}}
    </style><main><div id="changing">Moving clearance example</div></main>`);
  const result = await auditLayout(page, [{ id: 'changing', kind: 'text-inset', selector: '#changing', min: { bottom: 8 } }], options);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.results[0].status, 'incomplete');
  assert.equal(result.counts.findings, 0);
  assert.equal(result.counts.passed, 0);
});

test('a target that changes while preview evidence is collected becomes incomplete', browserOptions, async (t) => {
  const { page, options } = await fixture(t, '<main><div id="late-change" style="width:250px;height:80px;padding:12px">A short line</div></main>');
  const evaluate = page.evaluate.bind(page);
  let measurements = 0;
  page.evaluate = async (fn, argument) => {
    const result = await evaluate(fn, argument);
    if (Array.isArray(argument?.rules) && ++measurements === 2) {
      // Model an application update after the settled measurement but before
      // preview capture. It has no animation for getAnimations() to identify.
      await evaluate(() => { document.querySelector('#late-change').style.height = '100px'; });
    }
    return result;
  };
  try {
    const result = await auditLayout(page, [{ id: 'late-change', kind: 'text-inset', selector: '#late-change', min: { bottom: 8 } }], options);
    assert.equal(result.results[0].status, 'incomplete');
    assert.equal(result.coverage, 'partial');
    assert.equal(result.counts.passed, 0);
    assert.equal(result.results[0].preview, undefined);
  } finally { page.evaluate = evaluate; }
});
