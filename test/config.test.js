import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readProjectConfig } from '../src/config.js';
import { scanProject } from '../src/scan.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));

test('initializes a safe configuration and respects its source scope', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-config-'));
  await fs.mkdir(path.join(root, 'src'));
  t.after(async () => {
    await fs.rm(path.join(root, 'src', 'app.jsx'), { force: true });
    await fs.rm(path.join(root, 'outside.jsx'), { force: true });
    await fs.rm(path.join(root, 'ui-sheet.config.json'), { force: true });
    await fs.rmdir(path.join(root, 'src'));
    await fs.rmdir(root);
  });
  await fs.writeFile(path.join(root, 'src', 'app.jsx'), 'export const App = () => <button>Save</button>;');
  await fs.writeFile(path.join(root, 'outside.jsx'), 'export const Outside = () => <button>Outside</button>;');
  await exec(process.execPath, [cli, 'init', root]);
  const config = await readProjectConfig(root);
  assert.deepEqual(config.include, ['src']);
  assert.deepEqual(config.pages, []);
  const data = await scanProject(root);
  assert.equal(data.items.some((item) => item.name === 'Outside'), false);
  const overridden = await scanProject(root, { includePaths: ['outside.jsx'] });
  assert.equal(overridden.items.some((item) => item.name === 'Outside'), true);
  await assert.rejects(exec(process.execPath, [cli, 'init', root]), /Refusing to overwrite/);
  assert.deepEqual(await readProjectConfig(root), config);
});

test('rejects invalid configuration rather than guessing the scan scope', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-config-'));
  t.after(async () => { await fs.rm(path.join(root, 'ui-sheet.config.json'), { force: true }); await fs.rmdir(root); });
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ include: 'src' }));
  await assert.rejects(readProjectConfig(root), /include must be an array/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' }));
  assert.deepEqual(await readProjectConfig(root), { viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ viewport: { width: 9000, height: 844 } }));
  await assert.rejects(readProjectConfig(root), /Viewport must have integer/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ colorScheme: 'sepia' }));
  await assert.rejects(readProjectConfig(root), /Color scheme must be light or dark/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ pixelRatio: 4 }));
  assert.equal((await readProjectConfig(root)).pixelRatio, 4);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ pixelRatio: 5 }));
  await assert.rejects(readProjectConfig(root), /Capture pixel ratio must be an integer/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ maskSelectors: ['.private', '[data-sensitive]'] }));
  assert.deepEqual((await readProjectConfig(root)).maskSelectors, ['.private', '[data-sensitive]']);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ maskSelectors: [''] }));
  await assert.rejects(readProjectConfig(root), /Mask selectors must be an array/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ buttonGroups: [{ selector: '.add', family: 'Add actions', variant: 'Icon' }] }));
  assert.deepEqual((await readProjectConfig(root)).buttonGroups, [{ selector: '.add', family: 'add actions', variant: 'icon' }]);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ buttonGroups: [{ selector: '.add', family: '' }] }));
  await assert.rejects(readProjectConfig(root), /Button groups must be an array/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ sourceLinks: [{ selector: ' #save ', file: 'src/page.jsx', line: 42 }] }));
  assert.deepEqual((await readProjectConfig(root)).sourceLinks, [{ selector: '#save', file: 'src/page.jsx', line: 42 }]);
  for (const file of ['../page.jsx', '/page.jsx', 'C:/page.jsx', 'src\\page.jsx', 'src//page.jsx']) {
    await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ sourceLinks: [{ selector: '#save', file, line: 42 }] }));
    await assert.rejects(readProjectConfig(root), /Source links must be an array/);
  }
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ inventoryClasses: [{ className: 'donationbutton', type: 'buttons' }] }));
  assert.deepEqual((await readProjectConfig(root)).inventoryClasses, [{ className: 'donationbutton', type: 'buttons' }]);
  for (const rule of [{ className: '.donationbutton', type: 'buttons' }, { className: 'donationbutton', type: 'everything' }]) {
    await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ inventoryClasses: [rule] }));
    await assert.rejects(readProjectConfig(root), /Inventory classes must be an array/);
  }
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ inventoryClasses: [{ className: 'x', type: 'buttons' }, { className: 'x', type: 'buttons' }] }));
  await assert.rejects(readProjectConfig(root), /must not contain duplicates/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ instrumentedSources: 'true' }));
  await assert.rejects(readProjectConfig(root), /instrumentedSources must be a boolean/);
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ elementGroups: [{ selector: ' .field ', family: 'Entry Field', type: 'inputs' }], captureTimeoutMs: 60000, pageActions: [{ page: 'http://localhost:5173/', actions: [{ kind: 'focus', selector: '#name' }] }] }));
  assert.deepEqual((await readProjectConfig(root)).elementGroups, [{ selector: '.field', family: 'entry field', type: 'inputs' }]);
  for (const config of [{ elementGroups: [{ selector: 'input', family: 'entry', type: 'unknown' }] }, { captureTimeoutMs: 0 }, { pageActions: [{ page: 'http://localhost:5173/', actions: [{ kind: 'click', selector: '#submit' }] }] }, { pageActions: [{ page: 'https://user:password@example.test/', actions: [] }] }]) {
    await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify(config));
    await assert.rejects(readProjectConfig(root), /Invalid ui-sheet.config/);
  }
  await assert.rejects(exec(process.execPath, [cli, 'scan', root, '--viewport', 'mobile', '--capture']), /WIDTHxHEIGHT/);
  await assert.rejects(exec(process.execPath, [cli, 'scan', root, '--pixel-ratio', '5', '--capture']), /integer from 1 to 4/);
});

test('does not follow a configured baseline path outside the project', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-config-'));
  const outside = `${root}-outside.json`;
  t.after(async () => { await fs.rm(path.join(root, 'ui-sheet.config.json'), { force: true }); await fs.rm(path.join(root, '.ui-sheet', '.ui-sheet-scan.json'), { force: true }); await fs.rmdir(path.join(root, '.ui-sheet')).catch((error) => { if (error.code !== 'ENOENT') throw error; }); await fs.rm(outside, { force: true }); await fs.rmdir(root); });
  await fs.writeFile(outside, '{}');
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ pages: ['http://127.0.0.1:1/'], baseline: `../${path.basename(outside)}` }));
  await assert.rejects(exec(process.execPath, [cli, 'scan', root, '--capture']), /Configured baseline must be inside the project/);
});

test('loads opt-in layout rules and rejects unsupported media or malformed layout configuration', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-layout-config-'));
  const file = path.join(root, 'ui-sheet.config.json');
  t.after(async () => { await fs.rm(file, { force: true }); await fs.rmdir(root); });
  const layoutChecks = [
    { id: 'callout-padding', kind: 'text-inset', selector: '.callout', min: { bottom: 12, left: 16 } },
    { id: 'word-spacing', kind: 'style', selector: '.summary', property: 'wordSpacing', min: 0, max: 2 },
  ];
  await fs.writeFile(file, JSON.stringify({ layoutChecks, layoutMedia: 'print' }));
  const config = await readProjectConfig(root);
  assert.deepEqual(config.layoutChecks, layoutChecks);
  assert.equal(config.layoutMedia, 'print');
  for (const invalid of [
    { layoutMedia: 'pdf' }, { layoutMedia: true }, { layoutChecks: {} },
    { layoutChecks: [{ id: 'one', kind: 'unknown', selector: '.callout' }] },
    { layoutChecks: [layoutChecks[0], layoutChecks[0]] },
    { layoutChecks: Array.from({ length: 31 }, (_, index) => ({ ...layoutChecks[0], id: `rule-${index}` })) },
  ]) {
    await fs.writeFile(file, JSON.stringify(invalid));
    await assert.rejects(readProjectConfig(root), /Invalid ui-sheet.config.json/);
  }
  await fs.writeFile(file, JSON.stringify({ layoutChecks: [] }));
  assert.deepEqual(await readProjectConfig(root), { layoutChecks: [] }, 'absent layoutMedia does not change existing config defaults');
});
