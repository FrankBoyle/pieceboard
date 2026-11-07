import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const bundled = chromium.executablePath();
const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(bundled) ? bundled : '');

test('the agent CLI workflow accepts a consistent addition and reports a seeded regression', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-agent-workflow-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-agent-workflow-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const project = path.join(root, 'project');
  const source = path.join(project, 'src', 'index.html');
  const report = path.join(root, 'report');
  const baseline = path.join(root, 'baselines.json');
  const decisions = path.join(root, 'decisions.json');
  const previous = path.join(root, 'previous');
  await fs.mkdir(path.dirname(source), { recursive: true });
  const button = (id, name) => `<button id="${id}" type="button" class="button" data-ui-sheet-group="save actions" data-ui-sheet-variant="primary">${name}</button>`;
  const initial = `<!doctype html><html><head><style>.button { border: 1px solid blue; border-radius: 8px; background: blue; color: white; padding: 8px 12px; }</style></head><body><section>${button('one', 'Save one')}${button('two', 'Save two')}${button('three', 'Save three')}</section></body></html>`;
  await fs.writeFile(source, initial);
  const server = http.createServer(async (_request, response) => {
    try { const html = await fs.readFile(source); response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); }
    catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const run = (args) => exec(process.execPath, [cli, ...args]);
  const scan = (withBaseline = false, withDecisions = false) => run(['scan', project, '--include', 'src', '--page', url, '--capture', '--browser', browserPath, '--out', report, ...(withBaseline ? ['--baseline', baseline] : []), ...(withDecisions ? ['--decisions', decisions] : [])]);
  await run(['install-skill', '--agent', 'codex', '--project', project]);
  await fs.access(path.join(project, '.agents', 'skills', 'ui-consistency', 'SKILL.md'));
  const firstScan = await scan();
  assert.match(firstScan.stdout, /source-linked inventory preview\(s\)/);
  assert.match(firstScan.stdout, /button appearance preview\(s\) for consistency review/);
  const catalog = JSON.parse((await run(['catalog', report, '--kind', 'components', '--search', 'button'])).stdout);
  assert.ok(catalog.entries.some((entry) => entry.name.startsWith('<button>') && entry.usageCount === 3));
  const appearances = JSON.parse((await run(['appearances', report])).stdout);
  await run(['baseline', report, '--file', baseline, '--observation', appearances.appearances[0].example, '--reason', 'Approved save action.']);

  const matching = initial.replace('</section>', `${button('four', 'Save four')}</section>`);
  await fs.writeFile(source, matching);
  await scan(true);
  const clean = JSON.parse((await run(['check', report, '--json'])).stdout);
  assert.equal(clean.actionable, 0);
  assert.equal(clean.coverage, 'observed');

  const changed = matching.replace('id="three"', 'id="three" style="border-radius:3px"');
  await fs.writeFile(source, changed);
  await scan(true);
  const regression = JSON.parse((await run(['check', report, '--json'])).stdout);
  assert.equal(regression.actionable, 1);
  assert.equal(regression.findings[0].reference, 'approved');
  assert.equal(regression.findings[0].source.file, 'src/index.html');
  assert.equal(regression.findings[0].source.elementId, 'three');
  assert.ok(regression.findings[0].differences.some((entry) => entry.property === 'borderTopLeftRadius' && entry.observed === '3px'));
  await assert.rejects(run(['check', report, '--fail-on-findings']), (error) => error.code === 1);

  await run(['decision', report, '--file', decisions, '--finding', regression.findings[0].id, '--status', 'intentional', '--reason', 'Reviewed for this example.']);
  await fs.mkdir(previous);
  await fs.copyFile(path.join(report, 'ui-sheet.json'), path.join(previous, 'ui-sheet.json'));
  await fs.copyFile(path.join(report, '.ui-sheet-scan.json'), path.join(previous, '.ui-sheet-scan.json'));
  const movedSource = `\n\n${changed}`;
  await fs.writeFile(source, movedSource);
  await scan(true, true);
  const moved = JSON.parse((await run(['check', report, '--previous', previous, '--fail-on-new', '--json'])).stdout);
  assert.equal(moved.findings[0].id, regression.findings[0].id);
  assert.equal(moved.findings[0].source.line, regression.findings[0].source.line + 2);
  assert.equal(moved.findings[0].review.status, 'intentional');
  assert.equal(moved.comparison.status, 'no-new-findings');

  await fs.writeFile(source, movedSource.replace('id="three"', 'id="three-renamed"'));
  await scan(true, true);
  const renamed = JSON.parse((await run(['check', report, '--json'])).stdout);
  assert.notEqual(renamed.findings[0].id, regression.findings[0].id);
  assert.equal(renamed.decisions.stale, 1);
  await assert.rejects(run(['check', report, '--previous', previous, '--fail-on-new']), (error) => error.code === 1);

  const duplicate = movedSource.replace('id="three"', 'id="three-renamed"').replace('<section>', '<div id="three-renamed"></div><script>document.getElementById("three-renamed").remove()</script><section>');
  await fs.writeFile(source, duplicate);
  await scan(true);
  const ambiguous = JSON.parse((await run(['check', report, '--json'])).stdout);
  assert.equal(ambiguous.findings[0].source.method, 'unique ID and tag');
  assert.equal(ambiguous.findings[0].source.elementId, undefined, 'a duplicate static ID on an uncollected wrapper is not treated as stable');

  await fs.writeFile(source, movedSource.replace('id="three"', 'id="three-renamed"'));
  await fs.writeFile(path.join(project, 'src', 'broken.jsx'), 'export const broken = <;');
  await scan(true);
  const warned = JSON.parse((await run(['check', report, '--json'])).stdout);
  assert.equal(warned.findings[0].source.elementId, undefined, 'scan warnings prevent a uniqueness claim');
  assert.equal(warned.sourceWarnings, 1);
  assert.equal(warned.coverage, 'partial');
  await assert.rejects(run(['check', report, '--strict-coverage']), (error) => error.code === 2);
});
