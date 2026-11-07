import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scanProject } from '../src/scan.js';
import { writeReport } from '../src/report.js';

const exec = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(repo, 'examples', 'harbor');

async function tempProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-test-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-test-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  return root;
}

async function file(root, name, contents) {
  const full = path.join(root, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
}

test('example connects component aliases, token uses, image references, and supplied previews', async () => {
  const data = await scanProject(example);
  assert.equal(data.name, 'Harbor Studio');
  assert.deepEqual(data.warnings, []);
  const button = data.items.find((entry) => entry.id === 'component:src/components.jsx#Button');
  assert.ok(button, 'named and aliased imports resolve to the definition');
  assert.equal(button.usages.length, 3);
  assert.equal(button.definitions[0].file, 'src/components.jsx');
  assert.match(button.preview, /^data:image\/svg\+xml;base64,/);
  assert.ok(button.usages.some((usage) => usage.file === 'src/App.jsx' && usage.detail.includes('variant="primary"')));
  const ink = data.items.find((entry) => entry.name === '--color-ink');
  assert.equal(ink.kind, 'colors');
  assert.equal(ink.value, '#203d30');
  assert.equal(ink.usages.length, 3);
  const mark = data.items.find((entry) => entry.name === 'harbor-mark.svg');
  assert.deepEqual(mark.usages.map((usage) => usage.file), ['src/App.jsx', 'src/styles.css']);
  assert.equal(data.items.some((entry) => entry.name === 'button.svg'), false, 'configured preview files are not listed as app assets');
});

test('keeps same-named components from different files separate and reports scan errors', async (t) => {
  const root = await tempProject(t);
  await file(root, 'src/one.jsx', 'export function Button() { return <button />; }\n');
  await file(root, 'src/two.jsx', 'export function Button() { return <button />; }\n');
  await file(root, 'src/App.jsx', [
    "import { Button as First } from './one';",
    "import { Button as Second } from './two';",
    'export const App = () => <><First variant="quiet" /><Second /></>;',
  ].join('\n'));
  await file(root, 'src/broken.jsx', 'export const broken = <;');
  const data = await scanProject(root);
  const first = data.items.find((entry) => entry.id === 'component:src/one.jsx#Button');
  const second = data.items.find((entry) => entry.id === 'component:src/two.jsx#Button');
  assert.equal(first.usages.length, 1);
  assert.equal(second.usages.length, 1);
  assert.equal(first.usages[0].line, 3);
  assert.equal(first.usages[0].detail, 'variant="quiet"');
  assert.ok(data.warnings.some((warning) => warning.file === 'src/broken.jsx'));
});

test('excludes configured and additional source paths even inside included directories', async (t) => {
  const root = await tempProject(t);
  await file(root, 'ui-sheet.config.json', JSON.stringify({ include: ['src'], exclude: ['src/private'] }));
  await file(root, 'src/Public.jsx', 'export function PublicButton() { return <button>Safe</button>; }');
  await file(root, 'src/private/Hidden.jsx', 'export function Hidden() { return <button>SYNTHETIC_PRIVATE_MARKER</button>; }');
  await file(root, 'src/Extra.jsx', 'export function Extra() { return <button>SYNTHETIC_EXTRA_MARKER</button>; }');
  const data = await scanProject(root, { includePaths: ['src'], excludePaths: ['src/Extra.jsx'] });
  assert.equal(data.sourceExclusions, 2);
  assert.ok(data.items.some((item) => item.name === 'PublicButton'));
  assert.equal(JSON.stringify(data).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  assert.equal(JSON.stringify(data).includes('SYNTHETIC_EXTRA_MARKER'), false);
  await exec(process.execPath, [path.join(repo, 'bin', 'ui-sheet.js'), 'scan', root, '--exclude', 'src/Extra.jsx']);
  const report = JSON.parse(await fs.readFile(path.join(root, '.ui-sheet', 'ui-sheet.json'), 'utf8'));
  assert.equal(report.sourceExclusions, 2);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_EXTRA_MARKER'), false);
  await assert.rejects(scanProject(root, { excludePaths: ['../outside'] }), /inside the project/);
  await assert.rejects(scanProject(root, { excludePaths: ['src/misspelled'] }), /does not exist/);
});

test('does not read excluded package manifests for workspace resolution', async (t) => {
  const root = await tempProject(t);
  await file(root, 'package.json', JSON.stringify({ name: '@sample/ui', exports: { '.': './src/Public.jsx' } }));
  await file(root, 'src/Public.jsx', 'export function Public() { return <button>Safe</button>; }');
  await file(root, 'src/App.jsx', "import { Public } from '@sample/ui'; export const App = () => <Public />;");
  const included = await scanProject(root, { includePaths: ['src'] });
  assert.ok(included.items.find((item) => item.id === 'component:src/Public.jsx#Public').usages.length);
  const excluded = await scanProject(root, { includePaths: ['src'], excludePaths: ['package.json'] });
  assert.equal(excluded.items.find((item) => item.id === 'component:src/Public.jsx#Public').usages.length, 0);
});

test('keeps semantic UI structure and control roles without inventorying ordinary paragraphs', async (t) => {
  const root = await tempProject(t);
  await file(root, 'src/app.jsx', 'export function App() { return <><header>Header</header><div role="tablist"><button role="tab">Tasks</button></div><input type="checkbox" /><p>Page copy</p></>; }');
  await file(root, 'page.html', '<aside>Menu</aside><span role="switch">Enabled</span><p>More page copy</p>');
  const data = await scanProject(root);
  const uses = data.items.flatMap((item) => item.usages).filter((usage) => usage.element).map((usage) => usage.element);
  assert.ok(uses.some((element) => element.tag === 'header'));
  assert.ok(uses.some((element) => element.tag === 'aside'));
  assert.ok(uses.some((element) => element.tag === 'div' && element.role === 'tablist'));
  assert.ok(uses.some((element) => element.tag === 'button' && element.role === 'tab'));
  assert.ok(uses.some((element) => element.tag === 'input' && element.type === 'checkbox'));
  assert.ok(uses.some((element) => element.tag === 'span' && element.role === 'switch'));
  assert.equal(uses.some((element) => element.tag === 'p'), false);
});

test('includes only explicitly classified custom classes in static HTML and JSX', async (t) => {
  const root = await tempProject(t);
  await file(root, 'page.html', '<div class="donationbutton">50</div>\n<div class="ordinary">Copy</div>\n');
  await file(root, 'src/app.jsx', 'export const App = () => <><span className="donationbutton">100</span><div className={dynamic}>Dynamic</div></>;');
  const before = await scanProject(root);
  assert.equal(before.items.flatMap((item) => item.usages).some((usage) => usage.element?.classes?.includes('donationbutton')), false);
  await file(root, 'ui-sheet.config.json', JSON.stringify({ inventoryClasses: [{ className: 'donationbutton', type: 'buttons' }, { className: 'donationbutton', type: 'selectors' }] }));
  const after = await scanProject(root);
  const elements = after.items.flatMap((item) => item.usages).filter((usage) => usage.element?.inventoryTypes).map((usage) => usage.element);
  assert.deepEqual(elements.map((element) => element.tag).sort(), ['div', 'span']);
  assert.deepEqual(elements[0].inventoryTypes.map((rule) => rule.type), ['buttons', 'selectors']);
  assert.equal(after.items.flatMap((item) => item.usages).some((usage) => usage.element?.classes?.includes('ordinary')), false);
  assert.equal(after.items.flatMap((item) => item.usages).some((usage) => usage.element?.text === 'Dynamic'), false);
});

test('keeps identical elements on the same source line distinct', async (t) => {
  const root = await tempProject(t);
  await file(root, 'page.html', '<button id="same">Save</button><button id="same">Save</button>');
  const data = await scanProject(root);
  const uses = data.items.find((item) => item.name === '<button>').usages;
  assert.equal(uses.length, 2);
  assert.notEqual(uses[0].column, uses[1].column);
  assert.equal(JSON.stringify(data).includes('_sourceIdCounts'), false);
});

test('links CSS tokens and assets and makes missing preview warnings visible', async (t) => {
  const root = await tempProject(t);
  await file(root, 'ui-sheet.config.json', JSON.stringify({ components: { Button: { preview: 'missing.png' } } }));
  await file(root, 'src/button.tsx', 'export function Button() { return <button style={{ color: "var(--brand)" }} />; }');
  await file(root, 'public/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await file(root, 'src/site.css', ':root { --brand: #abc; }\n.dark { --brand: #123; }\n.mark { color: var(--brand); background: url("../public/logo.svg"); }');
  const data = await scanProject(root);
  const brand = data.items.find((entry) => entry.name === '--brand');
  assert.equal(brand.definitions.length, 2);
  assert.deepEqual(brand.usages.map((usage) => usage.file), ['src/button.tsx', 'src/site.css']);
  assert.equal(data.items.find((entry) => entry.name === 'logo.svg').usages[0].line, 3);
  assert.ok(data.warnings.some((warning) => warning.message.includes('Preview for Button')));
});

test('finds static PHP template elements and related CSS without executing PHP', async (t) => {
  const root = await tempProject(t);
  await file(root, 'page.php', [
    '<?php $code = "<button class=\\"fake\\">not rendered</button>"; ?>',
    '<a class="cta button" href="#pilot">Join the pilot</a>',
    '<?php if ($enabled): ?>',
    '<button class="button" id="save">Save</button>',
    '<?php endif; ?>',
    '<img src="/assets/mark.svg" alt="Logo">',
  ].join('\n'));
  await file(root, 'styles.css', '.button { color: red; }\n.cta:hover { color: blue; }\n.unrelated { color: black; }');
  await file(root, 'public/assets/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await file(root, 'private/ignore.jsx', 'export const Secret = () => <button>Private</button>;');
  const data = await scanProject(root, { includePaths: ['page.php', 'styles.css', 'public/assets'] });
  const link = data.items.find((entry) => entry.name === '<a> · button cta');
  assert.equal(link.usages[0].line, 2);
  assert.match(link.usages[0].detail, /Join the pilot/);
  assert.deepEqual(link.styleReferences.map((location) => location.line), [1, 2]);
  const button = data.items.find((entry) => entry.name === '<button> · button');
  assert.equal(button.usages[0].line, 4);
  assert.equal(button.styleReferences.length, 1);
  assert.equal(data.items.some((entry) => entry.name.includes('fake')), false);
  assert.equal(data.items.some((entry) => entry.name === 'Secret'), false);
  assert.equal(data.items.find((entry) => entry.name === 'mark.svg').usages[0].line, 6);
  assert.deepEqual(data.scanScope, ['page.php', 'styles.css', 'public/assets']);
  assert.deepEqual(data.warnings, []);
  await assert.rejects(scanProject(root, { includePaths: ['../outside'] }), /outside the project/);
});

test('resolves selected workspace package exports to component definitions', async (t) => {
  const root = await tempProject(t);
  await file(root, 'packages/ui/package.json', JSON.stringify({ name: '@example/ui', exports: { '.': './src/index.tsx' } }));
  await file(root, 'packages/ui/src/index.tsx', 'export function Button() { return <button />; }');
  await file(root, 'apps/web/src/App.tsx', 'import { Button as Action } from "@example/ui";\nexport const App = () => <Action />;');
  const data = await scanProject(root, { includePaths: ['packages/ui/src', 'apps/web/src'] });
  const button = data.items.find((entry) => entry.id === 'component:packages/ui/src/index.tsx#Button');
  assert.equal(button.definitions[0].file, 'packages/ui/src/index.tsx');
  assert.equal(button.usages[0].file, 'apps/web/src/App.tsx');
  assert.equal(data.items.some((entry) => entry.id === 'component:package:@example/ui#Button'), false);
});

test('does not guess between same-named packages in separate projects', async (t) => {
  const root = await tempProject(t);
  for (const project of ['one', 'two']) {
    await file(root, `${project}/packages/ui/package.json`, JSON.stringify({ name: '@example/ui', exports: { '.': './src/index.tsx' } }));
    await file(root, `${project}/packages/ui/src/index.tsx`, 'export function Button() { return <button />; }');
  }
  await file(root, 'one/app/App.tsx', 'import { Button } from "@example/ui"; export const App = () => <Button />;');
  const data = await scanProject(root, { includePaths: ['one/packages/ui/src', 'two/packages/ui/src', 'one/app'] });
  assert.equal(data.items.find((item) => item.id === 'component:one/packages/ui/src/index.tsx#Button').usages.length, 0);
  assert.equal(data.items.find((item) => item.id === 'component:two/packages/ui/src/index.tsx#Button').usages.length, 0);
  assert.equal(data.items.find((item) => item.id === 'component:package:@example/ui#Button').usages[0].file, 'one/app/App.tsx');
  assert.ok(data.warnings.some((warning) => warning.message.includes('Multiple selected workspace packages share the name @example/ui')));
});

test('skips data and upload directories unless they are explicitly selected', async (t) => {
  const root = await tempProject(t);
  await file(root, 'src/public.jsx', 'export const Public = () => <button>Public</button>;');
  await file(root, 'uploads/private.html', '<button id="private">Private</button>');
  await file(root, 'data/other.html', '<button id="other">Other</button>');
  const defaultScan = await scanProject(root);
  assert.equal(defaultScan.items.flatMap((entry) => entry.usages).some((entry) => entry.file.startsWith('uploads/')), false);
  assert.equal(defaultScan.items.flatMap((entry) => entry.usages).some((entry) => entry.file.startsWith('data/')), false);
  const selected = await scanProject(root, { includePaths: ['uploads/private.html'] });
  assert.ok(selected.items.flatMap((entry) => entry.usages).some((entry) => entry.file === 'uploads/private.html'));
  assert.equal(selected.items.flatMap((entry) => entry.usages).some((entry) => entry.file.startsWith('src/')), false);
});

test('report escapes project data and refuses to overwrite unrelated files', async (t) => {
  const root = await tempProject(t);
  const data = { format: 'ui-sheet/v1', name: '</script><script>alert(1)</script>', generatedAt: '', scannedFiles: 0, warnings: [], items: [] };
  await writeReport(data, root);
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('\\u003c/script>\\u003cscript>alert(1)'));
  assert.ok(!html.includes(data.name));
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'ui-sheet.json'), 'utf8')).name, data.name);
  await writeReport(data, root); // Regenerating our own report is allowed.
  await fs.writeFile(path.join(root, 'index.html'), 'My own page');
  await assert.rejects(writeReport(data, root), /Refusing to overwrite/);
  assert.equal(await fs.readFile(path.join(root, 'index.html'), 'utf8'), 'My own page');
});

test('CLI can scan another project and create an offline report', async (t) => {
  const root = await tempProject(t);
  await file(root, 'src/app.jsx', 'export function App() { return <button>Go</button>; }');
  await file(root, 'deny-network.mjs', [
    "import net from 'node:net';",
    "import tls from 'node:tls';",
    "import http from 'node:http';",
    "import https from 'node:https';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const denied = () => { throw new Error('Unexpected network access'); };",
    'net.connect = net.createConnection = tls.connect = http.request = http.get = https.request = https.get = denied;',
    'globalThis.fetch = denied;',
    'syncBuiltinESMExports();',
  ].join('\n'));
  const out = path.join(root, 'report');
  const result = await exec(process.execPath, ['--import', pathToFileURL(path.join(root, 'deny-network.mjs')).href, path.join(repo, 'bin', 'ui-sheet.js'), 'scan', root, '--include', 'src', '--out', out], { cwd: root, env: { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' } });
  assert.match(result.stdout, /Found 2 items across 1 source files/);
  const data = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8'));
  assert.ok(data.items.find((entry) => entry.name === '<button>'));
  assert.match(await fs.readFile(path.join(out, 'index.html'), 'utf8'), /Generated by Pieceboard/);
});
