import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/scan.js';
import { beginReportScan } from '../src/scan-status.js';
import { checkTokens, listTokens, setTokenBaseline } from '../src/token-baselines.js';

async function project(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-token-source-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temporary || !path.basename(actual).startsWith('ui-sheet-token-source-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}

async function storeScan(root, report) {
  const directory = path.join(root, '.ui-sheet');
  const scan = await beginReportScan(directory);
  await fs.writeFile(path.join(directory, 'ui-sheet.json'), JSON.stringify({ ...report, scanRunId: scan.runId }));
  await scan.finish('completed');
  return directory;
}

test('records every token declaration without merging themes, importance, or duplicates', async (t) => {
  const root = await project(t, { 'styles.css': [
    ':root {',
    '  --brand: #abc;',
    '  --brand: #abc;',
    '}',
    '[data-theme="dark"] { --brand: #123 !important; --space: calc(2 * 4px); }',
  ].join('\n') });
  const report = await scanProject(root);
  assert.deepEqual(report.tokenSource, {
    format: 'ui-sheet/token-source-v1',
    files: [{ file: 'styles.css', status: 'scanned' }],
    declarations: [
      { token: '--brand', value: '#abc', important: false, file: 'styles.css', line: 2, column: 3, context: [{ type: 'rule', selector: ':root' }] },
      { token: '--brand', value: '#abc', important: false, file: 'styles.css', line: 3, column: 3, context: [{ type: 'rule', selector: ':root' }] },
      { token: '--brand', value: '#123', important: true, file: 'styles.css', line: 5, column: 23, context: [{ type: 'rule', selector: '[data-theme="dark"]' }] },
      { token: '--space', value: 'calc(2 * 4px)', important: false, file: 'styles.css', line: 5, column: 49, context: [{ type: 'rule', selector: '[data-theme="dark"]' }] },
    ],
  });
  const brand = report.items.find((entry) => entry.id === 'token:--brand');
  assert.equal(brand.kind, 'colors');
  assert.equal(brand.value, '#abc', 'existing inventory keeps its first displayed value');
  assert.equal(brand.definitions.length, 3, 'existing source references remain available');
});

test('preserves full outer-to-inner nesting independently of source line positions', async (t) => {
  const css = [
    '@layer components {',
    '  @media (min-width: 40rem) {',
    '    .panel {',
    '      --gap: 12px;',
    '      @supports (display: grid) {',
    '        &:hover { --gap: 16px !IMPORTANT; }',
    '      }',
    '    }',
    '  }',
    '}',
    '@font-face { --font-meta: "local sample"; }',
  ].join('\n');
  const root = await project(t, { 'nested.css': css });
  const initial = await scanProject(root);
  assert.deepEqual(initial.tokenSource.declarations.map(({ token, value, important, context }) => ({ token, value, important, context })), [
    { token: '--gap', value: '12px', important: false, context: [
      { type: 'at-rule', name: 'layer', params: 'components' },
      { type: 'at-rule', name: 'media', params: '(min-width: 40rem)' },
      { type: 'rule', selector: '.panel' },
    ] },
    { token: '--gap', value: '16px', important: true, context: [
      { type: 'at-rule', name: 'layer', params: 'components' },
      { type: 'at-rule', name: 'media', params: '(min-width: 40rem)' },
      { type: 'rule', selector: '.panel' },
      { type: 'at-rule', name: 'supports', params: '(display: grid)' },
      { type: 'rule', selector: '&:hover' },
    ] },
    { token: '--font-meta', value: '"local sample"', important: false, context: [{ type: 'at-rule', name: 'font-face', params: '' }] },
  ]);
  await fs.writeFile(path.join(root, 'nested.css'), `\n\n${css}`);
  const moved = await scanProject(root);
  assert.deepEqual(moved.tokenSource.declarations.map(({ line, ...declaration }) => declaration), initial.tokenSource.declarations.map(({ line, ...declaration }) => declaration));
  assert.deepEqual(moved.tokenSource.declarations.map(({ line }) => line), initial.tokenSource.declarations.map(({ line }) => line + 2));
});

test('distinguishes scanned CSS without tokens from excluded and non-CSS files', async (t) => {
  const root = await project(t, {
    'src/plain.css': '@import "https://example.invalid/not-fetched.css"; .button { color: red; }',
    'src/empty.css': '',
    'src/app.js': 'throw new Error("source must never execute"); const color = "var(--from-js)";',
    'src/private.css': ':root { --private: secret; }',
    'outside.css': ':root { --outside: secret; }',
  });
  const report = await scanProject(root, { includePaths: ['src'], excludePaths: ['src/private.css'] });
  assert.deepEqual(report.tokenSource, {
    format: 'ui-sheet/token-source-v1',
    files: [{ file: 'src/empty.css', status: 'scanned' }, { file: 'src/plain.css', status: 'scanned' }],
    declarations: [],
  });
  assert.ok(report.items.some((entry) => entry.id === 'token:--from-js'), 'existing JavaScript usage inventory is unchanged');
  assert.deepEqual(report.warnings, []);
});

test('failed CSS parse and size limits produce failed file evidence without partial declarations', async (t) => {
  const root = await project(t, {
    'broken.css': ':root { --before-error: 1px; }\n.broken { --after-error: 2px;',
    'good.css': ':root { --safe: 8px; }',
    'large.css': `/*${'x'.repeat(2 * 1024 * 1024)}*/`,
  });
  const report = await scanProject(root);
  assert.deepEqual(report.tokenSource.files, [
    { file: 'broken.css', status: 'failed' },
    { file: 'good.css', status: 'scanned' },
    { file: 'large.css', status: 'failed' },
  ]);
  assert.deepEqual(report.tokenSource.declarations.map(({ token, file }) => ({ token, file })), [{ token: '--safe', file: 'good.css' }]);
  assert.deepEqual(report.warnings.map(({ file }) => file), ['broken.css', 'large.css']);
  assert.match(report.warnings.find(({ file }) => file === 'large.css').message, /2 MB source limit/);
  assert.equal(report.items.some((entry) => entry.id === 'token:--before-error'), false);
});

test('records an unreadable CSS file as failed while retaining successful sibling evidence', async (t) => {
  const root = await project(t, { 'blocked.css': ':root { --hidden: 1px; }', 'good.css': ':root { --safe: 8px; }' });
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (file, ...args) => {
    if (file === path.join(root, 'blocked.css')) throw Object.assign(new Error('Synthetic unreadable CSS file'), { code: 'EACCES' });
    return readFile(file, ...args);
  });
  const report = await scanProject(root);
  assert.deepEqual(report.tokenSource.files, [{ file: 'blocked.css', status: 'failed' }, { file: 'good.css', status: 'scanned' }]);
  assert.deepEqual(report.tokenSource.declarations.map(({ token }) => token), ['--safe']);
  assert.deepEqual(report.warnings, [{ file: 'blocked.css', message: 'Synthetic unreadable CSS file' }]);
});

test('oversized token values invalidate their file evidence without breaking consumer queries or hiding unscanned approvals', async (t) => {
  const css = (length) => `:root{--large:${'a'.repeat(length)};--small:8px;}`;
  const root = await project(t, { 'styles.css': css(131072) });
  const initial = await scanProject(root);
  assert.deepEqual(initial.warnings, []);
  assert.equal(initial.tokenSource.declarations.find(({ token }) => token === '--large').value.length, 131072, 'the maximum supported value remains usable');
  const directory = await storeScan(root, initial);
  const selected = (await listTokens(directory)).entries.find(({ token }) => token === '--small');
  const baseline = path.join(root, 'approved.json');
  await setTokenBaseline(directory, { file: baseline, declarationId: selected.id, reason: 'Keep the small spacing declaration.' });

  await fs.writeFile(path.join(root, 'styles.css'), css(131073));
  const oversized = await scanProject(root);
  assert.deepEqual(oversized.tokenSource.files, [{ file: 'styles.css', status: 'failed' }]);
  assert.deepEqual(oversized.tokenSource.declarations, [], 'a supported sibling declaration is not published as partial success');
  assert.match(oversized.warnings[0].message, /Token source evidence at line 1.*exceeds declaration\/context limits/);
  assert.equal(oversized.items.find(({ id }) => id === 'token:--small').value, '8px', 'static inventory remains useful');
  await storeScan(root, oversized);
  const listed = await listTokens(directory);
  assert.equal(listed.sourceStatus, 'available');
  assert.deepEqual(listed.entries, []);
  const checked = await checkTokens(directory, { file: baseline });
  assert.equal(checked.unscanned, 1);
  assert.equal(checked.missing, 0);
  assert.equal(checked.matched, 0);
  assert.equal(checked.coverage, 'partial');
});

test('context and selector bounds fail only their token files while preserving static inventory', async (t) => {
  const nested = (count) => `${'@media screen {'.repeat(count)}:root { --nested: 8px; }${'}'.repeat(count)}`;
  const root = await project(t, {
    'deep.css': nested(128),
    'selector.css': `.${'a'.repeat(16384)} { --wide: 12px; }`,
    'supported.css': nested(127),
  });
  const report = await scanProject(root);
  assert.deepEqual(report.tokenSource.files, [
    { file: 'deep.css', status: 'failed' },
    { file: 'selector.css', status: 'failed' },
    { file: 'supported.css', status: 'scanned' },
  ]);
  assert.deepEqual(report.tokenSource.declarations.map(({ file, context }) => [file, context.length]), [['supported.css', 128]]);
  assert.deepEqual(report.warnings.map(({ file }) => file), ['deep.css', 'selector.css']);
  assert.ok(report.warnings.every(({ message }) => /declaration\/context limits/.test(message)));
  assert.ok(report.items.find(({ id }) => id === 'token:--wide'), 'unsupported token context does not discard static inventory');
  const directory = await storeScan(root, report);
  assert.equal((await listTokens(directory)).total, 1, 'bounded sibling evidence remains consumable');
});

test('omits unrepresentable token file paths with a clear warning without invalidating supported evidence', async (t) => {
  const root = await project(t, { 'good.css': ':root { --safe: 8px; }' });
  // POSIX permits colons in a filename. Model that directory entry through the
  // filesystem boundary so the same producer-path check also runs on Windows
  // without creating an alternate data stream or an unsupported native path.
  const unusual = path.join(root, 'theme:legacy.css');
  const readDirectory = fs.readdir;
  const readFile = fs.readFile;
  const stat = fs.stat;
  t.mock.method(fs, 'readdir', async (directory, ...args) => {
    const entries = await readDirectory(directory, ...args);
    return directory === root ? [...entries, { name: 'theme:legacy.css', isDirectory: () => false, isFile: () => true }] : entries;
  });
  t.mock.method(fs, 'readFile', async (file, ...args) => file === unusual ? ':root { --legacy: 12px; }' : readFile(file, ...args));
  t.mock.method(fs, 'stat', async (file, ...args) => file === unusual ? { size: 26 } : stat(file, ...args));
  const report = await scanProject(root);
  assert.deepEqual(report.tokenSource.files, [{ file: 'good.css', status: 'scanned' }]);
  assert.deepEqual(report.tokenSource.declarations.map(({ token }) => token), ['--safe']);
  assert.deepEqual(report.warnings, [{ file: 'theme:legacy.css', message: 'Token source evidence cannot represent this CSS file path; its token scopes remain unscanned.' }]);
  assert.ok(report.items.some(({ id }) => id === 'token:--legacy'), 'the source inventory retains its existing path support');
  const directory = await storeScan(root, report);
  assert.equal((await listTokens(directory)).total, 1);
});
