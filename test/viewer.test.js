import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// A small DOM stand-in exercises navigation and details without launching a browser.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.classList = { add: (...classes) => { this.className += ` ${classes.join(' ')}`; } };
    this.textContent = '';
    this.className = '';
    this.hidden = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name, event = {}) { this.listeners[name]?.({ target: this, ...event }); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  allText() { return [this.textContent, ...this.children.map((child) => child.allText())].join(' '); }
}

test('viewer filters the sheet, searches source paths, and opens usage details', async () => {
  const ids = ['grid', 'detail-dialog', 'detail-content', 'workspace-name', 'workspace-initial', 'item-count', 'scan-info', 'navigation', 'type-navigation', 'type-filter', 'summary', 'active-filter', 'result-count', 'empty', 'warnings', 'search'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const data = { name: 'Demo', scannedFiles: 2, warnings: [], captureSummary: { url: 'https://example.com/', captured: 2 }, observedPages: [{ url: 'https://example.com/', matchingSourceLocations: 1 }], items: [
    { id: 'button', name: 'Button', kind: 'components', subtype: 'Component', source: 'src/Button.jsx', definitions: [{ file: 'src/Button.jsx', line: 1, detail: '' }], usages: [{ file: 'src/Home.jsx', line: 12, detail: 'variant="primary"' }], pageMatches: [{ file: 'src/Home.jsx', line: 12, detail: '<button id="save"> · https://example.com/' }], captures: [{ image: 'data:image/png;base64,AA==', file: 'src/Home.jsx', line: 12, method: 'unique ID and tag', label: 'Primary' }, { image: 'data:image/png;base64,AQ==', file: 'src/Home.jsx', line: 12, method: 'unique ID and tag', label: 'Secondary' }] },
    { id: 'ink', name: '--ink', kind: 'colors', subtype: 'CSS custom property', source: 'src/colors.css', value: '#123456', definitions: [], usages: [] },
  ] };
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), addEventListener() {} };
  const source = await fs.readFile(new URL('../src/viewer.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { document, window: { __UI_SHEET_DATA__: data }, CSS: { supports: () => true } });
  assert.match(elements.warnings.allText(), /SOURCE-LINKED INVENTORY PREVIEWS/);
  assert.equal(elements.grid.children.length, 2, 'each captured preview is shown as its own tile');
  assert.equal(elements.grid.children[0].children[0].children[0].src, 'data:image/png;base64,AA==');
  assert.equal(elements.grid.children[1].children[0].children[0].src, 'data:image/png;base64,AQ==');
  assert.equal(elements['workspace-name'].textContent, 'Demo');
  assert.equal(elements['active-filter'].textContent, 'CAPTURED ON PAGE');
  elements.navigation.children[0].fire('click'); // All pieces
  assert.equal(elements.grid.children.length, 2);
  elements.navigation.children[1].fire('click'); // Captured on page
  assert.equal(elements.grid.children.length, 2);
  elements.search.fire('input', { target: { value: 'Secondary' } });
  assert.equal(elements.grid.children.length, 1);
  assert.equal(elements.grid.children[0].children[0].children[0].src, 'data:image/png;base64,AQ==');
  elements.search.fire('input', { target: { value: '' } });
  elements.navigation.children[3].fire('click'); // Components
  assert.equal(elements.grid.children.length, 1);
  assert.equal(elements['active-filter'].textContent, 'COMPONENTS');
  elements.search.fire('input', { target: { value: 'Home.jsx' } });
  assert.equal(elements.grid.children.length, 1, 'source locations are searchable');
  elements.grid.children[0].fire('click');
  assert.equal(elements['detail-dialog'].open, true);
  assert.match(elements['detail-content'].allText(), /src\/Home.jsx:12/);
  assert.match(elements['detail-content'].allText(), /variant="primary"/);
  assert.match(elements['detail-content'].allText(), /Possible match in fetched HTML/);
  assert.match(elements['detail-content'].allText(), /Captured examples/);
  assert.match(elements['detail-content'].allText(), /View full-size capture/);
  assert.match(elements['detail-content'].allText(), /possible match/);
  elements['detail-dialog'].close();
  elements.search.fire('input', { target: { value: 'no match' } });
  assert.equal(elements.grid.children.length, 0);
  assert.equal(elements.empty.hidden, false);
});

test('token details show each scoped value instead of suggesting that the first value applies everywhere', async () => {
  const ids = ['grid', 'detail-dialog', 'detail-content', 'workspace-name', 'workspace-initial', 'item-count', 'scan-info', 'navigation', 'type-navigation', 'type-filter', 'summary', 'active-filter', 'result-count', 'empty', 'warnings', 'search'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const data = { name: 'Tokens', scannedFiles: 1, warnings: [], items: [
    { id: 'token:--accent', name: '--accent', kind: 'colors', subtype: 'CSS custom property', source: 'theme.css', value: '#123456', definitions: [], usages: [] },
  ], tokenSource: { format: 'ui-sheet/token-source-v1', files: [{ file: 'theme.css', status: 'scanned' }], declarations: [
    { token: '--accent', file: 'theme.css', line: 1, column: 9, value: '#123456', important: false, context: [{ type: 'rule', selector: ':root' }] },
    { token: '--accent', file: 'theme.css', line: 5, column: 2, value: '#abcdef', important: true, context: [{ type: 'at-rule', name: 'media', params: '(prefers-color-scheme: dark)' }, { type: 'rule', selector: ':root' }] },
  ] } };
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), addEventListener() {} };
  vm.runInNewContext(await fs.readFile(new URL('../src/viewer.js', import.meta.url), 'utf8'), { document, window: { __UI_SHEET_DATA__: data }, CSS: { supports: () => true } });
  elements.navigation.children[4].fire('click'); // Colors
  elements.grid.children[0].fire('click');
  const text = elements['detail-content'].allText();
  assert.match(text, /FIRST DISCOVERED VALUE/);
  assert.match(text, /Scoped CSS declarations/);
  assert.match(text, /theme\.css:5:2/);
  assert.match(text, /@media \(prefers-color-scheme: dark\) → :root: #abcdef !important/);
  assert.match(text, /does not resolve the CSS cascade/);
});

test('source-only reports start in a UI-focused view without discarding other components', async () => {
  const ids = ['grid', 'detail-dialog', 'detail-content', 'workspace-name', 'workspace-initial', 'item-count', 'scan-info', 'navigation', 'type-navigation', 'type-filter', 'summary', 'active-filter', 'result-count', 'empty', 'warnings', 'search'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const base = { kind: 'components', subtype: 'Component', definitions: [], usages: [] };
  const data = { name: 'Demo', scannedFiles: 1, warnings: [], items: [
    { ...base, name: 'PrimaryButton', source: 'src/Button.jsx' },
    { ...base, name: 'ManagerTaskHome', source: 'src/Home.jsx' },
    { name: '--brand', kind: 'colors', subtype: 'CSS custom property', source: 'src/colors.css', definitions: [], usages: [] },
  ] };
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), addEventListener() {} };
  const source = await fs.readFile(new URL('../src/viewer.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { document, window: { __UI_SHEET_DATA__: data }, CSS: { supports: () => true } });
  assert.equal(elements['active-filter'].textContent, 'UI-FOCUSED');
  assert.equal(elements.grid.children.length, 2, 'recognizable UI and design tokens stay visible');
  elements.navigation.children[0].fire('click');
  assert.equal(elements.grid.children.length, 3, 'other application components remain available in All pieces');
});

test('shows a side-by-side consistency finding with source confidence and exact differences', async () => {
  const ids = ['grid', 'detail-dialog', 'detail-content', 'workspace-name', 'workspace-initial', 'item-count', 'scan-info', 'navigation', 'type-navigation', 'type-filter', 'summary', 'active-filter', 'result-count', 'empty', 'warnings', 'search', 'consistency-review'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const data = { name: 'Demo', scannedFiles: 1, warnings: [], items: [], consistency: {
    scope: { url: 'https://example.com/', viewport: { width: 1440, height: 900 }, pixelRatio: 4 },
    counts: { seen: 4, eligible: 3, possiblyBlocked: 1, visibilityUnverified: 1 },
    observations: [{ id: 'button:0', source: { status: 'likely', file: 'src/Button.jsx', line: 3, method: 'unique ID and tag' } }, { id: 'button:2', source: { status: 'unresolved' } }],
    previews: { 'button:0': { image: 'data:image/png;base64,AQ==', width: 200, pixelRatio: 2 }, 'button:2': { image: 'data:image/png;base64,Ag==', width: 200, pixelRatio: 1 } },
    findings: [{ id: '0123456789abcdef', evidence: 'small sample', group: { family: 'actions', variant: 'primary' }, total: 3, common: { count: 2, example: 'button:0' }, outlier: { count: 1, example: 'button:2' }, differences: [{ label: 'Top-left radius', common: '8px', observed: '3px' }] }],
  } };
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), addEventListener() {} };
  const source = await fs.readFile(new URL('../src/viewer.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { document, window: { __UI_SHEET_DATA__: data, devicePixelRatio: 1 }, CSS: { supports: () => true } });
  const review = elements['consistency-review'];
  assert.equal(review.hidden, false);
  assert.match(review.allText(), /Possible button differences/);
  assert.match(review.allText(), /Common appearance · 2 examples/);
  assert.match(review.allText(), /Possible outlier · 1 example/);
  assert.match(review.allText(), /Top-left radius/);
  assert.match(review.allText(), /8px → 3px/);
  assert.match(review.allText(), /Possible source: src\/Button.jsx:3/);
  assert.match(review.allText(), /Source not resolved/);
  assert.match(review.allText(), /1 button possibly blocked and excluded · 1 eligible button not fully checked/);
  assert.match(review.allText(), /Preview fell back to 1× from 4×/);
  assert.match(review.allText(), /not an approved design rule/);
  const comparison = review.children.find((node) => node.className === 'finding-card').children.find((node) => node.className === 'comparison-grid');
  assert.equal(comparison.children[0].children[1].children[0].src, 'data:image/png;base64,AQ==');
  assert.equal(comparison.children[0].children[1].children[0].style.width, '100px');
  assert.equal(comparison.children[1].children[1].children[0].src, 'data:image/png;base64,Ag==');
});

test('UI-type filters classify each captured example independently and allow overlapping groups', async () => {
  const ids = ['grid', 'detail-dialog', 'detail-content', 'workspace-name', 'workspace-initial', 'item-count', 'scan-info', 'navigation', 'type-navigation', 'type-filter', 'summary', 'active-filter', 'result-count', 'empty', 'warnings', 'search'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const captures = [
    { image: 'data:image/png;base64,AQ==', file: 'src/tabs.tsx', line: 1, label: 'Tasks', element: { tag: 'button', role: 'tab' } },
    { image: 'data:image/png;base64,Ag==', file: 'src/form.tsx', line: 2, label: 'Save', element: { tag: 'button' } },
  ];
  const data = { name: 'Demo', scannedFiles: 2, warnings: [], captureSummary: { captured: 5 }, items: [
    { name: '<button>', kind: 'components', subtype: 'HTML element', source: 'HTML', definitions: [], usages: [
      { file: 'src/tabs.tsx', line: 1, detail: '', element: { tag: 'button', role: 'tab' } },
      { file: 'src/form.tsx', line: 2, detail: '', element: { tag: 'button' } },
    ], captures },
    { name: '<select>', kind: 'components', subtype: 'HTML element', source: 'HTML', definitions: [], usages: [], captures: [{ image: 'data:image/png;base64,Aw==', file: 'src/form.tsx', line: 3, element: { tag: 'select' } }] },
    { name: 'DistrictSidebar', kind: 'components', subtype: 'Component', source: 'src/sidebar.tsx', definitions: [], usages: [], captures: [{ image: 'data:image/png;base64,BA==', file: 'src/sidebar.tsx', line: 4, label: 'Collapsed navigation' }] },
    { name: '<a>', kind: 'components', subtype: 'HTML element', source: 'HTML', definitions: [], usages: [{ file: 'src/status.tsx', line: 5, detail: 'label="Status opens in a new tab"', element: { tag: 'a' } }], captures: [{ image: 'data:image/png;base64,BQ==', file: 'src/status.tsx', line: 5, method: 'unique accessible label and tag', label: 'Status opens in a new tab', element: { tag: 'a' } }] },
  ] };
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), addEventListener() {} };
  const source = await fs.readFile(new URL('../src/viewer.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { document, window: { __UI_SHEET_DATA__: data }, CSS: { supports: () => true } });
  const choose = (label) => elements['type-navigation'].children.find((node) => node.children[0].textContent === label).fire('click');
  choose('Tabs');
  assert.equal(elements.grid.children.length, 1);
  assert.match(elements.grid.children[0].allText(), /Tasks/);
  choose('Buttons');
  assert.equal(elements.grid.children.length, 2, 'a tab button is also a button');
  choose('Dropdowns');
  assert.equal(elements.grid.children.length, 1);
  choose('Selectors');
  assert.equal(elements.grid.children.length, 1, 'a select is also a selector');
  choose('Sidebars');
  assert.equal(elements.grid.children.length, 1);
  assert.match(elements.grid.children[0].allText(), /Collapsed navigation/);
  elements.navigation.children[0].fire('click');
  assert.equal(elements['active-filter'].textContent, 'ALL PIECES', 'changing the main view clears the type filter');
  elements.navigation.children[1].fire('click');
  elements.search.fire('input', { target: { value: 'tabs.tsx' } });
  assert.equal(elements.grid.children.length, 1, 'searching a capture source does not return other examples of a grouped tag');
});
