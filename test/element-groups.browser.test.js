import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';
import { writeReport } from '../src/report.js';
import { checkReport, compareChecks } from '../src/check.js';
import { beginReportScan } from '../src/scan-status.js';
import { setDecision } from '../src/decisions.js';
import { readElementBaselines } from '../src/element-baselines.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const types = ['inputs', 'dropdowns', 'selectors', 'tabs', 'headers', 'sidebars', 'navigation', 'headings', 'text'];
const tagFor = { inputs: 'input', dropdowns: 'select', selectors: 'button', tabs: 'button', headers: 'header', sidebars: 'aside', navigation: 'nav', headings: 'h2', text: 'span' };

test('captures explicit UI families with state separation, source evidence, decisions, and CI findings', { skip: !browserPath, timeout: 120000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-element-groups-'));
  t.after(async () => {
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp); assert.ok(path.basename(actual).startsWith('ui-sheet-element-groups-'));
    await fs.rm(actual, { recursive: true, force: true });
  });
  const rows = types.map((type) => `<section>${Array.from({ length: 4 }, (_, index) => {
    const tag = tagFor[type], attr = type === 'tabs' ? ' role="tab" aria-selected="false"' : type === 'selectors' ? ' role="checkbox" aria-checked="false"' : type === 'inputs' ? ' type="text"' : '';
    const start = `<${tag} id="${type}-${index}" class="field ${type}${index === 3 ? ' wrong' : ''}"${attr}>`;
    return tag === 'input' ? start : `${start}${tag === 'select' ? '<option>Choose</option>' : type}</${tag}>`;
  }).join('')}</section>`).join('\n');
  const html = `<!doctype html><html lang="en"><title>Configured UI sample</title><style>body{margin:24px}section{display:flex;gap:8px;height:70px}.field{box-sizing:border-box;display:inline-block;width:140px;height:40px;margin:0;padding:8px;border:1px solid #333;border-radius:8px;background:white;color:#222;font:16px/22px Arial,sans-serif}.wrong{border-radius:2px}</style><main>${rows}</main></html>`;
  await fs.writeFile(path.join(root, 'index.html'), html);
  let currentHtml = html;
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(currentHtml); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const elementGroups = types.map((type) => ({ selector: `.${type}`, family: type, type }));
  await fs.writeFile(path.join(root, 'ui-sheet.config.json'), JSON.stringify({ elementGroups }));
  const data = await scanProject(root);
  await capturePage(data, url, { browserPath, elementGroups });
  const analysis = data.elementConsistency.pages[0];
  assert.equal(analysis.findings.length, types.length);
  assert.equal(analysis.counts.seen, 36);
  assert.equal(analysis.counts.eligible, 36);
  assert.equal(analysis.coverage, 'observed');
  assert.equal(analysis.previewCoverage.captured, 18);
  for (const finding of analysis.findings) {
    assert.equal(finding.outlier.count, 1);
    assert.equal(finding.common.count, 3);
    assert.equal(finding.differences.length, 4);
    assert.equal(analysis.observations.find((entry) => entry.id === finding.outlier.example).source.status, 'likely');
    assert.ok(analysis.previews[finding.outlier.example].width > 140);
  }
  const report = path.join(root, 'report');
  const run = await beginReportScan(report); data.scanRunId = run.runId;
  await writeReport(data, report); await run.finish('completed');
  const checked = await checkReport(report);
  assert.equal(checked.elementPages.length, 1);
  assert.equal(checked.findings.filter((finding) => finding.kind === 'configured-element-style-outlier').length, 9);
  assert.equal(JSON.stringify(checked).includes('data:image'), false);
  const elementFile = path.join(root, 'element-baselines.json');
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url)), 'element-baseline', report, '--file', elementFile, '--observation', 'input:0', '--reason', 'Approve the input reference.']);
  const approved = await scanProject(root);
  await capturePage(approved, url, { browserPath, elementGroups: [elementGroups[0]], elementBaselines: (await readElementBaselines(elementFile)).rules });
  assert.equal(approved.elementConsistency.pages[0].findings.length, 1);
  assert.equal(approved.elementConsistency.pages[0].findings[0].reference, 'approved');
  await setDecision(report, { file: path.join(root, 'decisions.json'), findingId: analysis.findings[0].id, status: 'intentional', reason: 'Explicit sample exception.' });
  const reviewed = await checkReport(report);
  assert.equal(reviewed.findings.find((entry) => entry.id === analysis.findings[0].id).actionable, false);
  const changed = structuredClone(reviewed); changed.elementPages[0].actions = [{ kind: 'focus', selector: '#inputs-0' }];
  assert.throws(() => compareChecks(reviewed, changed), /configured element contexts/);

  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(report, 'index.html')).href);
    assert.equal(await page.locator('.element-finding').count(), 9);
    assert.equal(await page.getByRole('heading', { name: 'Possible UI differences' }).count(), 1);
    assert.equal(await page.locator('.element-finding .comparison-image img').count(), 18);
    const locations = page.locator('.element-finding').first().locator('.finding-locations');
    await locations.locator('summary').click();
    await locations.locator('.location-list li').first().waitFor();
    assert.equal(await locations.locator('.location-list li').count(), 3, 'all common source occurrences are available in the visual report');
  } finally { await browser.close(); }

  const focused = await scanProject(root);
  await capturePage(focused, url, { browserPath, elementGroups: [elementGroups[0]], actions: [{ kind: 'focus', selector: '#inputs-3' }] });
  const focusedAnalysis = focused.elementConsistency.pages[0];
  assert.equal(focusedAnalysis.findings.length, 0, 'focused appearance is separated from idle inputs');
  assert.equal(focusedAnalysis.counts.undersampled, 1);
  assert.deepEqual(focused.consistency.scope.actions, [{ kind: 'focus', selector: '#inputs-3' }]);
  const hovered = await scanProject(root);
  await capturePage(hovered, url, { browserPath, elementGroups: [elementGroups[0]], actions: [{ kind: 'hover', selector: '#inputs-3' }] });
  assert.equal(hovered.elementConsistency.pages[0].findings.length, 0, 'hovered appearance is separated from idle inputs');
  assert.equal(hovered.elementConsistency.pages[0].counts.undersampled, 1);
  assert.deepEqual(hovered.consistency.scope.actions, [{ kind: 'hover', selector: '#inputs-3' }]);
  currentHtml = '<!doctype html><style>.inputs{appearance:none;border:1px solid black;border-radius:8px;padding:8px}.inputs:invalid{border-radius:2px}</style>' + Array.from({ length: 4 }, (_, index) => `<input id="validity-${index}" class="inputs" required${index < 3 ? ' value="Synthetic"' : ''}>`).join('');
  await fs.writeFile(path.join(root, 'index.html'), currentHtml);
  const validity = await scanProject(root);
  await capturePage(validity, url, { browserPath, elementGroups: [elementGroups[0]] });
  assert.equal(validity.elementConsistency.pages[0].findings.length, 0, 'native valid and invalid inputs are separate states');
  assert.equal(validity.elementConsistency.pages[0].counts.undersampled, 1);
  currentHtml = '<!doctype html><style>.inputs{appearance:none;border:1px solid black;border-radius:8px;padding:8px}.inputs:indeterminate{border-radius:2px}</style>' + Array.from({ length: 4 }, (_, index) => `<input id="check-${index}" type="checkbox" class="inputs">`).join('') + '<script>document.getElementById("check-3").indeterminate=true</script>';
  await fs.writeFile(path.join(root, 'index.html'), currentHtml);
  const indeterminate = await scanProject(root);
  await capturePage(indeterminate, url, { browserPath, elementGroups: [elementGroups[0]] });
  assert.equal(indeterminate.elementConsistency.pages[0].findings.length, 0, 'native indeterminate state is separate from unchecked');
  assert.equal(indeterminate.elementConsistency.pages[0].counts.undersampled, 1);
  await assert.rejects(capturePage(await scanProject(root), url, { browserPath, actions: [{ kind: 'focus', selector: '.inputs' }] }), /exactly one/);
});
