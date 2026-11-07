import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { build, createServer } from 'vite';
import { uiSheetSource } from '../vite.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const exec = promisify(execFile);

test('Vite development markers link rendered TSX controls and are absent from production builds', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  // Windows CI can expose the temp directory through an 8.3 alias; Vite's
  // filesystem allowlist must use the same canonical path as the served files.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-vite-browser-')));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-vite-browser-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'src'));
  const source = `const React = { createElement(tag: string, props: Record<string, string> | null, ...children: Array<Node | string>) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'className') element.className = value;
    else element.setAttribute(key, value);
  }
  element.append(...children);
  return element;
} };
const labels = ['Save profile', 'Save email', 'Save alerts'];
document.querySelector('#app')!.append(<main>
  <button type="button" className="button primary">{labels[0]}</button>
  <button type="button" className="button primary">{labels[1]}</button>
  <button type="button" className="button primary different">{labels[2]}</button>
</main>);
`;
  await fs.writeFile(path.join(root, 'src', 'main.tsx'), source);
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><style>.button{border:1px solid blue;border-radius:8px;background:blue;color:white;padding:8px}.different{border-radius:3px}</style></head><body><div id="app"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  const configFile = path.join(root, 'ui-sheet.config.json');
  await fs.writeFile(configFile, JSON.stringify({ instrumentedSources: true }));
  const server = await createServer({ root, configFile: false, cacheDir: path.join(root, '.vite-cache'), logLevel: 'silent', plugins: [uiSheetSource({ projectRoot: root })], server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } });
  t.after(() => server.close());
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const report = path.join(root, 'report');
  const scan = (out) => exec(process.execPath, [cli, 'scan', root, '--include', 'src', '--page', url, '--capture', '--browser', browserPath, '--out', out]);
  await scan(report);
  const data = JSON.parse(await fs.readFile(path.join(report, 'ui-sheet.json'), 'utf8'));
  const analysis = data.consistency;
  assert.deepEqual(analysis.instrumentation, { eligible: 3, matched: 3, missing: 0, invalidOrOverridden: 0 });
  assert.equal(analysis.findings.length, 1);
  const finding = analysis.findings[0];
  const observed = analysis.observations.find((entry) => entry.id === finding.outlier.example);
  assert.equal(observed.source.status, 'instrumented');
  assert.equal(observed.source.file, 'src/main.tsx');
  assert.equal(observed.source.sha256, createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(finding.decisionAnchor, { file: observed.source.file, line: observed.source.line, column: observed.source.column, sha256: observed.source.sha256 });
  assert.ok(analysis.previews[observed.id]?.image, 'the source-linked control has a real preview');
  const checked = JSON.parse((await exec(process.execPath, [cli, 'check', report, '--json'])).stdout);
  assert.equal(checked.pages[0].instrumentation.matched, 3);
  const baselineFile = path.join(root, 'baseline.json');
  await exec(process.execPath, [cli, 'baseline', report, '--file', baselineFile, '--observation', observed.id, '--reason', 'Approved synthetic appearance.']);
  const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
  assert.deepEqual(baseline.rules[0].source, observed.source);
  const decisionsFile = path.join(root, 'decisions.json');
  await exec(process.execPath, [cli, 'decision', report, '--file', decisionsFile, '--finding', finding.id, '--status', 'intentional', '--reason', 'Synthetic example.']);
  assert.equal(JSON.parse(await fs.readFile(decisionsFile, 'utf8')).decisions[0].findingId, finding.id);
  const viewer = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await viewer.newPage();
    await page.setContent(await fs.readFile(path.join(report, 'index.html'), 'utf8'));
    assert.match(await page.locator('#consistency-review').innerText(), /Instrumented sources: 3 of 3 eligible buttons matched/);
    assert.match((await page.locator('.comparison-source').allTextContents()).join(' '), /Instrumented source: src\/main\.tsx:\d+:\d+ · local file hash matched, not verified deployment/);
  } finally { await viewer.close(); }

  await fs.writeFile(configFile, JSON.stringify({ instrumentedSources: false }));
  const uninstrumented = path.join(root, 'without-markers');
  await scan(uninstrumented);
  const ordinary = JSON.parse(await fs.readFile(path.join(uninstrumented, 'ui-sheet.json'), 'utf8')).consistency;
  assert.equal(ordinary.observations.every((entry) => entry.source.status === 'unresolved'), true, 'markers are ignored unless explicitly enabled');

  const result = await build({ root, configFile: false, cacheDir: path.join(root, '.vite-build-cache'), logLevel: 'silent', plugins: [uiSheetSource({ projectRoot: root })], build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output || []);
  assert.equal(outputs.some((entry) => typeof entry.code === 'string' && entry.code.includes('data-ui-sheet-source')), false, 'production output has no instrumentation markers');
});
