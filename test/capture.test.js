import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePage, isUICaptureCandidate, matchRenderedElements } from '../src/capture.js';

const source = (file, element) => ({ file, line: 1, detail: '', element });
test('matches visible rendered elements only when source and page evidence is unambiguous', () => {
  const data = { items: [
    { name: 'save', kind: 'components', usages: [source('a.php', { tag: 'button', id: 'save', text: 'Save' })] },
    { name: 'link', kind: 'components', usages: [source('a.php', { tag: 'a', text: 'Explore more' })] },
    { name: 'duplicate', kind: 'components', usages: [source('a.php', { tag: 'button', text: 'Cancel' }), source('b.php', { tag: 'button', text: 'Cancel' })] },
    { name: 'hidden', kind: 'components', usages: [source('a.php', { tag: 'button', id: 'hidden' })] },
    { name: 'wrong-id', kind: 'components', usages: [source('a.php', { tag: 'a', id: 'real', text: 'Wrong ID' })] },
    { name: 'duplicate-id', kind: 'components', usages: [source('a.php', { tag: 'button', id: 'reused', text: 'First label' }), source('b.php', { tag: 'button', id: 'reused', text: 'Second label' })] },
  ] };
  const rendered = [
    { tag: 'button', id: 'save', text: 'Save', index: 0, visible: true },
    { tag: 'a', id: '', text: 'Explore more', index: 0, visible: true },
    { tag: 'button', id: '', text: 'Cancel', index: 1, visible: true },
    { tag: 'button', id: 'hidden', text: '', index: 2, visible: false },
    { tag: 'a', id: 'different', text: 'Wrong ID', index: 1, visible: true },
    { tag: 'button', id: 'reused', text: 'First label', index: 3, visible: true },
  ];
  const matches = matchRenderedElements(data, rendered);
  assert.deepEqual(matches.map((match) => [match.item.name, match.method]), [
    ['save', 'unique ID and tag'], ['link', 'unique text and tag'],
  ]);
});

test('captures a matched element as an embedded image and closes the browser', async () => {
  const data = { scanRunId: 'previous completion', scanProgress: { stale: 'previous progress' }, crossPageConsistency: { stale: 'previous page set' }, elementConsistency: { stale: 'previous capture' }, layoutAudit: { stale: 'previous layout' }, decisionSummary: { stale: 'previous decisions' }, items: [{ name: 'save', kind: 'components', usages: [source('page.php', { tag: 'button', id: 'save', text: 'Save' })] }] };
  let closed = false;
  let evaluations = 0;
  let contextOptions;
  let screenshotOptions;
  const locator = {
    async evaluate() { evaluations++; return evaluations === 1 ? { tag: 'button', id: 'save', text: 'Save' } : true; },
    async scrollIntoViewIfNeeded() {},
    async screenshot(options) { screenshotOptions = options; return Buffer.from('fake-image'); },
  };
  const page = {
    async goto() { return { ok: () => true }; },
    url: () => 'https://example.com/',
    async waitForLoadState() {},
    async evaluate() { return [{ tag: 'button', id: 'save', text: 'Save', index: 0, visible: true }]; },
    locator() { return { nth: () => locator }; },
  };
  const browserType = { async launch() { return { async newContext(options) { contextOptions = options; return { async newPage() { return page; } }; }, async close() { closed = true; } }; } };
  const result = await capturePage(data, 'https://example.com/?session=private', { browserType });
  assert.equal(result.captureSummary.captured, 1);
  assert.equal(result.captureSummary.url, 'https://example.com/');
  assert.match(result.items[0].captures[0].image, /^data:image\/png;base64,/);
  assert.equal(result.items[0].captures[0].file, 'page.php');
  assert.equal(result.items[0].captures[0].label, 'Save');
  assert.equal(contextOptions.storageState, undefined);
  assert.equal(contextOptions.deviceScaleFactor, 2);
  assert.equal(screenshotOptions.scale, 'device');
  assert.equal(result.items[0].captures[0].pixelRatio, 2);
  assert.equal(result.items[0].captures[0].element.tag, 'button');
  assert.equal(closed, true);
  assert.equal(data.elementConsistency, undefined, 'fresh captures clear prior configured-family evidence');
  assert.equal(data.layoutAudit, undefined, 'fresh captures without layout rules clear prior layout evidence');
  assert.equal(data.crossPageConsistency, undefined, 'new captures invalidate derived cross-page evidence');
  assert.equal(data.decisionSummary, undefined, 'new captures invalidate derived review counts');
  assert.equal(data.scanRunId, undefined, 'new evidence cannot retain an old completion identity');
  assert.equal(data.scanProgress, undefined, 'new evidence cannot retain old page progress');
});

function layoutCaptureMock({ failAudit = false } = {}) {
  const events = [];
  let media = 'screen';
  let closed = 0;
  const page = {
    async goto() { return { ok: () => true }; },
    url: () => 'https://example.com/',
    async waitForLoadState() {},
    async emulateMedia(options) { media = options.media; events.push(`media:${media}`); },
    async evaluate(fn, argument) {
      if (fn.name === 'measureLayoutInPage') {
        events.push(`layout:${media}`);
        if (failAudit) throw new Error('Synthetic layout measurement failure');
        return argument.rules.map((rule) => ({ id: rule.id, ok: false, message: 'Synthetic selector is missing.', measured: {} }));
      }
      return [{ tag: 'button', id: 'save', text: 'Save', index: 0, visible: true }];
    },
    locator() {
      return { nth() {
        let evaluations = 0;
        return {
          async evaluate() { return ++evaluations === 1 ? { tag: 'button', id: 'save', text: 'Save' } : true; },
          async scrollIntoViewIfNeeded() {},
          async screenshot() { events.push(`ui-shot:${media}`); return Buffer.from('synthetic screenshot'); },
        };
      } };
    },
  };
  const browserType = { async launch() { return {
    version: () => 'mock-layout-browser',
    async newContext() { return { async newPage() { return page; } }; },
    async close() { closed++; },
  }; } };
  return { browserType, events, closed: () => closed };
}

test('layout capture runs after screen UI previews, restores print media, and appends only the fresh page set', async () => {
  const data = { layoutAudit: { format: 'ui-sheet/layout-pages-v1', pages: [{ stale: true }] }, items: [
    { name: 'save', kind: 'components', usages: [source('page.html', { tag: 'button', id: 'save', text: 'Save' })] },
  ] };
  const mocked = layoutCaptureMock();
  const layoutChecks = [{ id: 'word-spacing', kind: 'style', selector: '.summary', property: 'wordSpacing', min: 0, max: 2 }];
  const options = { browserType: mocked.browserType, layoutChecks, layoutMedia: 'print', viewport: { width: 1200, height: 900 } };
  await capturePage(data, 'https://example.com/?private=omitted', options);
  assert.equal(data.layoutAudit.format, 'ui-sheet/layout-pages-v1');
  assert.equal(data.layoutAudit.pages.length, 1, 'fresh capture discards previous layout pages');
  assert.deepEqual(data.layoutAudit.pages[0].scope, {
    url: 'https://example.com/', viewport: { width: 1200, height: 900 }, colorScheme: 'light', media: 'print', pixelRatio: 2,
    browser: { engine: 'chromium', version: 'mock-layout-browser' },
  });
  assert.equal(data.layoutAudit.pages[0].coverage, 'partial');
  assert.equal(mocked.events[0], 'ui-shot:screen');
  assert.ok(mocked.events.indexOf('media:print') > mocked.events.indexOf('ui-shot:screen'));
  assert.ok(mocked.events.includes('layout:print'));
  assert.equal(mocked.events.at(-1), 'media:screen');
  await capturePage(data, 'https://example.com/', { ...options, append: true });
  assert.equal(data.layoutAudit.pages.length, 2, 'explicit append retains current capture pages');
  assert.equal(data.layoutAudit.pages.some((page) => page.stale), false);
  assert.equal(mocked.closed(), 2);
});

test('a failed layout audit restores media and closes its browser without publishing changed UI or layout evidence', async () => {
  const data = { scanRunId: 'prior completion', layoutAudit: { format: 'ui-sheet/layout-pages-v1', pages: [{ prior: true }] }, items: [
    { name: 'save', kind: 'components', usages: [source('page.html', { tag: 'button', id: 'save', text: 'Save' })] },
  ] };
  const before = structuredClone(data);
  const mocked = layoutCaptureMock({ failAudit: true });
  await assert.rejects(capturePage(data, 'https://example.com/', {
    browserType: mocked.browserType, layoutMedia: 'print',
    layoutChecks: [{ id: 'word-spacing', kind: 'style', selector: '.summary', property: 'wordSpacing', min: 0, max: 2 }],
  }), /Synthetic layout measurement failure/);
  assert.deepEqual(data, before);
  assert.equal(mocked.events.at(-1), 'media:screen');
  assert.equal(mocked.closed(), 1);
});

test('layout options are validated before any browser is launched', async () => {
  let launched = false;
  const browserType = { async launch() { launched = true; } };
  await assert.rejects(capturePage({ items: [] }, 'https://example.com/', { browserType, layoutMedia: 'pdf' }), /Layout media must be screen or print/);
  await assert.rejects(capturePage({ items: [] }, 'https://example.com/', { browserType, layoutMedia: null }), /Layout media must be screen or print/);
  await assert.rejects(capturePage({ items: [] }, 'https://example.com/', { browserType, layoutChecks: [{ id: 'unknown', kind: 'unknown', selector: '.summary' }] }), /layout|Layout/);
  assert.equal(launched, false);
});

test('capture candidates favor controls and branding over ordinary content', () => {
  const candidate = (rendered) => isUICaptureCandidate({ rendered, usage: { element: {} } });
  assert.equal(candidate({ tag: 'button' }), true);
  assert.equal(candidate({ tag: 'div', role: 'tab' }), true);
  assert.equal(candidate({ tag: 'input', type: 'hidden' }), false);
  assert.equal(candidate({ tag: 'p' }), false);
  assert.equal(candidate({ tag: 'a', classes: [] }), false);
  assert.equal(candidate({ tag: 'a', classes: ['button'] }), true);
  assert.equal(candidate({ tag: 'a', classes: ['text-link'], hasMedia: true }), false);
  assert.equal(candidate({ tag: 'img', src: '/story-photo.jpg' }), false);
  assert.equal(candidate({ tag: 'img', src: '/company-logo.png' }), true);
  assert.equal(candidate({ tag: 'button', width: 900, height: 500 }), false);
  const custom = { rendered: { tag: 'div', classes: ['donationbutton'] }, usage: { element: { inventoryTypes: [{ className: 'donationbutton', type: 'buttons' }] } } };
  assert.equal(isUICaptureCandidate(custom), true);
  assert.equal(isUICaptureCandidate({ ...custom, rendered: { tag: 'div', classes: ['different'] } }), false);
});

test('limits the device-pixel cost before launching the browser', async () => {
  let launched = false;
  const browserType = { async launch() { launched = true; } };
  await assert.rejects(capturePage({ items: [] }, 'https://example.com/', { browserType, viewport: { width: 3840, height: 2160 }, pixelRatio: 4 }), /device-pixel limit/);
  assert.equal(launched, false);
});

test('a timed-out capture closes its browser and never publishes partial or late evidence', async () => {
  const data = { items: [{ name: 'save', kind: 'components', usages: [source('page.php', { tag: 'button', id: 'save', text: 'Save' })], captures: [{ image: 'previous evidence' }] }] };
  const original = structuredClone(data);
  let finishImage, closed = false;
  const image = new Promise((resolve) => { finishImage = resolve; });
  let evaluations = 0;
  const locator = { async evaluate() { return ++evaluations === 1 ? { tag: 'button', id: 'save', text: 'Save' } : true; }, async scrollIntoViewIfNeeded() {}, screenshot() { return image; } };
  const page = { async goto() { return { ok: () => true }; }, url: () => 'https://example.com/', async waitForLoadState() {}, async evaluate() { return [{ tag: 'button', id: 'save', text: 'Save', index: 0, visible: true }]; }, locator() { return { nth: () => locator }; } };
  const browserType = { async launch() { return { async newContext() { return { async newPage() { return page; } }; }, async close() { closed = true; } }; } };
  await assert.rejects(capturePage(data, 'https://example.com/', { browserType, captureTimeoutMs: 20 }), (error) => error.code === 'UI_SHEET_CAPTURE_TIMEOUT');
  assert.equal(closed, true);
  assert.deepEqual(data, original);
  finishImage(Buffer.from('late screenshot'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(data, original);
});

test('falls back to a 1x screenshot when the 2x image exceeds the report limit', async () => {
  const data = { items: [{ name: 'save', kind: 'components', usages: [source('page.php', { tag: 'button', id: 'save', text: 'Save' })] }] };
  const scales = [];
  let evaluations = 0;
  const locator = {
    async evaluate() { evaluations++; return evaluations === 1 ? { tag: 'button', id: 'save', text: 'Save' } : true; },
    async scrollIntoViewIfNeeded() {},
    async screenshot(options) { scales.push(options.scale); return options.scale === 'device' ? Buffer.alloc(1024 * 1024 + 1) : Buffer.from('smaller'); },
  };
  const page = { async goto() { return { ok: () => true }; }, url: () => 'https://example.com/', async waitForLoadState() {}, async evaluate() { return [{ tag: 'button', id: 'save', text: 'Save', index: 0, visible: true }]; }, locator() { return { nth: () => locator }; } };
  const browserType = { async launch() { return { async newContext() { return { async newPage() { return page; } }; }, async close() {} }; } };
  await capturePage(data, 'https://example.com/', { browserType });
  assert.deepEqual(scales, ['device', 'css']);
  assert.equal(data.items[0].captures[0].pixelRatio, 1);
});

test('keeps one example of a repeated text style while preserving different styles', async () => {
  const data = { items: [{ name: 'heading', kind: 'components', usages: [
    source('page.php', { tag: 'h2', text: 'First' }),
    source('page.php', { tag: 'h2', text: 'Second' }),
    source('page.php', { tag: 'h2', text: 'Different' }),
  ] }] };
  const rendered = ['First', 'Second', 'Different'].map((text, index) => ({ tag: 'h2', text, index, visible: true, styleKey: index === 2 ? 'large' : 'standard', classes: [] }));
  const page = {
    async goto() { return { ok: () => true }; }, url: () => 'https://example.com/', async waitForLoadState() {},
    async evaluate() { return rendered; },
    locator() { return { nth(index) { let evaluations = 0; return {
      async evaluate() { evaluations++; return evaluations === 1 ? { tag: 'h2', id: '', text: rendered[index].text } : true; },
      async scrollIntoViewIfNeeded() {}, async screenshot() { return Buffer.from(`image-${index}`); },
    }; } }; },
  };
  const browserType = { async launch() { return { async newContext() { return { async newPage() { return page; } }; }, async close() {} }; } };
  await capturePage(data, 'https://example.com/', { browserType });
  assert.deepEqual(data.items[0].captures.map((capture) => capture.label), ['First', 'Different']);
  assert.equal(data.items[0].usages.length, 3, 'deduplicating previews does not discard source locations');
});

test('matches a unique image and labels repeated text and class matches as an ambiguous group', () => {
  const data = { items: [
    { name: 'logo', kind: 'components', usages: [source('page.php', { tag: 'img', src: '/logo.png?v=1' })] },
    { name: 'brand', kind: 'components', usages: [source('header.php', { tag: 'a', text: 'Brand', classes: ['brand'] }), source('footer.php', { tag: 'a', text: 'Brand', classes: ['brand'] })] },
  ] };
  const rendered = [
    { tag: 'img', src: '/logo.png?v=2', index: 0, visible: true },
    { tag: 'a', text: 'Brand', classes: ['brand'], index: 0, visible: true },
    { tag: 'a', text: 'Brand', classes: ['brand'], index: 1, visible: true },
  ];
  const matches = matchRenderedElements(data, rendered, 'https://example.com/');
  assert.equal(matches[0].method, 'unique image source');
  assert.equal(matches.filter((match) => match.method.includes('source location ambiguous')).length, 2);
  assert.equal(matches[1].usage.file, 'Multiple possible source locations');
  assert.equal(matches[1].usage.line, undefined);
});

test('finds unique form placeholders and accessible labels without requiring visible text', () => {
  const data = { items: [
    { kind: 'components', usages: [source('login.tsx', { tag: 'input', placeholder: 'Work email' })] },
    { kind: 'components', usages: [source('nav.tsx', { tag: 'button', ariaLabel: 'Open menu' })] },
  ] };
  const rendered = [
    { tag: 'input', placeholder: 'Work email', index: 0, visible: true },
    { tag: 'button', ariaLabel: 'Open menu', index: 0, visible: true },
  ];
  assert.deepEqual(matchRenderedElements(data, rendered).map((match) => match.method), ['unique placeholder and tag', 'unique accessible label and tag']);
});

test('matches an explicitly configured class despite an ambiguous parent wrapper', () => {
  const configured = { tag: 'div', text: 'Donate', classes: ['submitbutton'], inventoryTypes: [{ className: 'submitbutton', type: 'buttons' }] };
  const data = { items: [{ kind: 'components', usages: [source('page.html', configured)] }] };
  const rendered = [{ tag: 'div', index: 0, visible: true, text: 'Donate', classes: ['donationrow'] }, { tag: 'div', index: 1, visible: true, text: 'Donate', classes: ['submitbutton'] }];
  const matches = matchRenderedElements(data, rendered);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rendered.index, 1);
  assert.equal(matches[0].method, 'unique configured class and tag');
  assert.equal(matchRenderedElements(data, [...rendered, { ...rendered[1], index: 2 }]).length, 0, 'a reused class is not a unique source match');
  const competing = { items: [
    { kind: 'components', usages: [source('a.html', { tag: 'div', inventoryTypes: [{ className: 'one', type: 'buttons' }] })] },
    { kind: 'components', usages: [source('b.html', { tag: 'div', inventoryTypes: [{ className: 'two', type: 'buttons' }] })] },
  ] };
  assert.equal(matchRenderedElements(competing, [{ tag: 'div', index: 0, visible: true, classes: ['one', 'two'] }]).length, 0, 'conflicting configured matches are not guessed');
});
