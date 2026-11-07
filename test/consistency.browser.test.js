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
import { applyDecisions } from '../src/decisions.js';

const bundledBrowser = chromium.executablePath();
const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(bundledBrowser) ? bundledBrowser : '');
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const exec = promisify(execFile);

test('captures and explains a real rendered button difference with likely source locations', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const html = await fs.readFile(new URL('../examples/button-review/index.html', import.meta.url));
  let privateRequestsWithoutCookie = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/private' && !request.headers.cookie?.includes('ui_sheet_test=synthetic-cookie')) {
      privateRequestsWithoutCookie++;
      response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      response.end('Sign-in required');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const body = html.toString();
    const grouped = body.replaceAll(' data-ui-sheet-group="account actions" data-ui-sheet-variant="primary"', '')
      .replace('id="save-profile" type="button" class="button"', 'id="save-profile" type="button" class="button create-profile-btn"')
      .replace('id="save-email" type="button" class="button"', 'id="save-email" type="button" class="button create-email-btn"')
      .replace('id="save-alerts" type="button" class="button different"', 'id="save-alerts" type="button" class="button different create-alerts-btn"');
    response.end(request.url === '/consistent' ? body.replace('.different { border-radius: 3px; }', '.different { border-radius: 8px; }') : request.url === '/border' ? body.replace('.different { border-radius: 3px; }', '.different { border-bottom: 3px dashed rgb(200, 0, 0); }') : request.url === '/uniform-border' ? body.replace('.different { border-radius: 3px; }', '.different { border: 3px dashed rgb(200, 0, 0); }') : request.url === '/grouped' ? grouped : html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-consistency-'));
  t.after(async () => {
    for (const dir of [reportDir, ...['authenticated', 'consistent', 'border', 'uniform-border', 'masked', 'grouped'].map((name) => path.join(reportDir, name))]) await fs.rm(path.join(dir, '.ui-sheet-scan.json'), { force: true });
    await fs.rm(path.join(reportDir, 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'ui-sheet.json'), { force: true });
    await fs.rm(path.join(reportDir, 'decisions.json'), { force: true });
    await fs.rm(path.join(reportDir, 'import-decisions.json'), { force: true });
    await fs.rm(path.join(reportDir, 'state.json'), { force: true });
    await fs.rm(path.join(reportDir, 'authenticated', 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'authenticated', 'ui-sheet.json'), { force: true });
    try { await fs.rmdir(path.join(reportDir, 'authenticated')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(path.join(reportDir, 'consistent', 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'consistent', 'ui-sheet.json'), { force: true });
    try { await fs.rmdir(path.join(reportDir, 'consistent')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(path.join(reportDir, 'border', 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'border', 'ui-sheet.json'), { force: true });
    try { await fs.rmdir(path.join(reportDir, 'border')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(path.join(reportDir, 'uniform-border', 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'uniform-border', 'ui-sheet.json'), { force: true });
    try { await fs.rmdir(path.join(reportDir, 'uniform-border')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(path.join(reportDir, 'masked', 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'masked', 'ui-sheet.json'), { force: true });
    try { await fs.rmdir(path.join(reportDir, 'masked')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(path.join(reportDir, 'grouped', 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'grouped', 'ui-sheet.json'), { force: true });
    try { await fs.rmdir(path.join(reportDir, 'grouped')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(path.join(reportDir, 'project', 'index.html'), { force: true });
    await fs.rm(path.join(reportDir, 'project', 'ui-sheet.config.json'), { force: true });
    await fs.rm(path.join(reportDir, 'project', 'baselines.json'), { force: true });
    await fs.rm(path.join(reportDir, 'project', 'group-baselines.json'), { force: true });
    try { await fs.rmdir(path.join(reportDir, 'project')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rmdir(reportDir);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = path.join(reportDir, 'project');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'index.html'), html);
  await fs.writeFile(path.join(project, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [`${base}/`, `${base}/second`] }));
  const command = await exec(process.execPath, [cli, 'scan', project, '--capture', '--browser', browserPath, '--out', reportDir]);
  assert.match(command.stdout, /Compared 8 eligible buttons; found 2 possible difference/);
  const data = JSON.parse(await fs.readFile(path.join(reportDir, 'ui-sheet.json'), 'utf8'));
  assert.equal(data.consistency.format, 'ui-sheet/consistency-v2');
  assert.equal(data.consistency.pages.length, 2);
  assert.equal(data.captureSummary.pages.length, 2);
  const first = data.consistency.pages[0];
  assert.equal(first.scope.browser.engine, 'chromium');
  assert.match(first.scope.browser.version, /^\d+/);
  assert.equal(first.counts.seen, 5);
  assert.equal(first.counts.eligible, 4);
  assert.equal(first.counts.disabled, 1);
  assert.deepEqual(first.previewCoverage, { requested: 3, attempted: 3, captured: 3, unavailable: 0, omitted: 0 });
  assert.equal(first.findings.length, 1);
  const finding = first.findings[0];
  assert.equal(finding.group.variant, 'primary');
  assert.equal(finding.common.count, 2);
  assert.equal(finding.outlier.count, 1);
  assert.ok(finding.differences.some((difference) => difference.property === 'borderTopLeftRadius' && difference.common === '8px' && difference.observed === '3px'));
  const outlier = first.observations.find((entry) => entry.id === finding.outlier.example);
  assert.equal(outlier.source.status, 'likely');
  assert.equal(outlier.source.file, 'index.html');
  assert.ok(outlier.source.line > 0);
  for (const id of [finding.common.example, finding.outlier.example]) {
    const preview = first.previews[id];
    assert.equal(preview.pixelRatio, 2);
    const bytes = Buffer.from(preview.image.split(',')[1], 'base64');
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(bytes.readUInt32BE(16) > 100, 'the real capture contains a high-resolution image');
  }

  assert.equal(data.consistency.pages[1].findings.length, 1);
  assert.ok(data.captureSummary.pages.every((page) => page.captured > 0), 'captures from both pages are preserved');

  const decisions = path.join(reportDir, 'decisions.json');
  const baselines = path.join(project, 'baselines.json');
  await exec(process.execPath, [cli, 'decision', reportDir, '--file', decisions, '--finding', finding.id, '--status', 'intentional', '--reason', 'This example is intentionally different.']);
  const appearances = JSON.parse((await exec(process.execPath, [cli, 'appearances', reportDir, '--page', '1'])).stdout);
  const approved = appearances.appearances.find((entry) => entry.group.variant === 'primary' && entry.count === 2);
  assert.ok(approved);
  await exec(process.execPath, [cli, 'baseline', reportDir, '--file', baselines, '--observation', approved.example, '--page', '1', '--reason', 'Approved primary action.']);
  await fs.writeFile(path.join(project, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [`${base}/`, `${base}/second`], baseline: 'baselines.json' }));
  const rerun = await exec(process.execPath, [cli, 'scan', project, '--capture', '--browser', browserPath, '--decisions', decisions, '--out', reportDir]);
  assert.match(rerun.stdout, /Applied 1 review decision\(s\); 0 no longer match/);
  assert.match(rerun.stdout, /Applied 1 approved baseline\(s\); 0 were not matched/);
  const reviewed = JSON.parse(await fs.readFile(path.join(reportDir, 'ui-sheet.json'), 'utf8'));
  assert.equal(reviewed.consistency.pages[0].findings[0].review.status, 'intentional');
  assert.equal(reviewed.consistency.pages[0].findings[0].reference, 'approved');
  assert.equal(reviewed.consistency.pages[1].findings[0].reference, 'inferred');
  assert.equal(reviewed.consistency.pages[1].findings[0].review, undefined);
  const importedDecisions = path.join(reportDir, 'import-decisions.json');
  const oldDecisions = JSON.parse(await fs.readFile(decisions, 'utf8'));
  oldDecisions.decisions.push({ findingId: 'aaaaaaaaaaaaaaaa', status: 'deferred', reason: 'An older decision.' });
  await fs.writeFile(importedDecisions, JSON.stringify(oldDecisions));
  const comparison = JSON.parse((await exec(process.execPath, [cli, 'check', reportDir, '--previous', reportDir, '--json'])).stdout);
  assert.equal(comparison.comparison.newActionable, 0);
  assert.equal(comparison.comparison.status, 'incomplete', 'undersampled groups remain visible as incomplete coverage');

  const stateFile = path.join(reportDir, 'state.json');
  const authenticatedDir = path.join(reportDir, 'authenticated');
  await fs.writeFile(stateFile, JSON.stringify({ cookies: [{ name: 'ui_sheet_test', value: 'synthetic-cookie', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }));
  const authenticated = await exec(process.execPath, [cli, 'scan', project, '--include', 'index.html', '--page', `${base}/private`, '--capture', '--browser', browserPath, '--storage-state', stateFile, '--out', authenticatedDir]);
  assert.match(authenticated.stdout, /found 1 possible difference/);
  assert.equal(privateRequestsWithoutCookie, 0, 'authenticated scans do not perform a separate unauthenticated HTML fetch');
  assert.equal((await fs.readFile(path.join(authenticatedDir, 'ui-sheet.json'), 'utf8')).includes('synthetic-cookie'), false);
  const consistentDir = path.join(reportDir, 'consistent');
  await fs.writeFile(path.join(project, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [`${base}/`], baseline: 'baselines.json', viewport: { width: 800, height: 600 }, colorScheme: 'light' }));
  await exec(process.execPath, [cli, 'scan', project, '--page', `${base}/consistent`, '--capture', '--viewport', '390x844', '--color-scheme', 'dark', '--browser', browserPath, '--out', consistentDir]);
  const consistent = JSON.parse(await fs.readFile(path.join(consistentDir, 'ui-sheet.json'), 'utf8')).consistency;
  assert.deepEqual(consistent.scope.viewport, { width: 390, height: 844 });
  assert.match(consistent.scope.theme, /browser:dark/);
  assert.equal(consistent.findings.length, 0);
  assert.equal(consistent.appearances.length, 2);
  assert.ok(consistent.previews[consistent.appearances[0].example]?.image, 'a consistent appearance still receives a real screenshot');
  const borderDir = path.join(reportDir, 'border');
  await exec(process.execPath, [cli, 'scan', project, '--page', `${base}/border`, '--capture', '--browser', browserPath, '--out', borderDir]);
  const border = JSON.parse(await fs.readFile(path.join(borderDir, 'ui-sheet.json'), 'utf8')).consistency;
  assert.equal(border.findings.length, 1);
  assert.deepEqual(border.findings[0].differences.map((difference) => difference.property), ['borderBottomWidth', 'borderBottomStyle', 'borderBottomColor']);
  assert.ok(border.previews[border.findings[0].outlier.example]?.image, 'the border finding has a real browser capture');
  const uniformBorderDir = path.join(reportDir, 'uniform-border');
  await exec(process.execPath, [cli, 'scan', project, '--page', `${base}/uniform-border`, '--capture', '--browser', browserPath, '--out', uniformBorderDir]);
  const maskedDir = path.join(reportDir, 'masked');
  await fs.writeFile(path.join(project, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [`${base}/`], maskSelectors: ['#save-profile'] }));
  await exec(process.execPath, [cli, 'scan', project, '--page', `${base}/masked`, '--capture', '--mask-selector', '#save-alerts', '--browser', browserPath, '--out', maskedDir]);
  const maskedData = JSON.parse(await fs.readFile(path.join(maskedDir, 'ui-sheet.json'), 'utf8'));
  const masked = maskedData.consistency;
  assert.equal(masked.scope.maskSelectorsConfigured, 1);
  const maskedExample = masked.previews[masked.findings[0].outlier.example].image;
  const unmaskedExample = masked.previews[masked.findings[0].common.example].image;
  const maskedInventory = maskedData.items.flatMap((item) => item.captures || []).find((capture) => capture.label === 'Save alerts').image;
  await assert.rejects(exec(process.execPath, [cli, 'scan', project, '--page', `${base}/masked`, '--capture', '--mask-selector', '[', '--browser', browserPath, '--out', maskedDir]), /Mask selectors must be valid CSS/);
  const groupedDir = path.join(reportDir, 'grouped');
  const group = { selector: '.create-profile-btn, .create-email-btn, .create-alerts-btn', family: 'create actions', variant: 'icon' };
  await fs.writeFile(path.join(project, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [`${base}/grouped`], buttonGroups: [group] }));
  await exec(process.execPath, [cli, 'scan', project, '--capture', '--browser', browserPath, '--out', groupedDir]);
  const grouped = JSON.parse(await fs.readFile(path.join(groupedDir, 'ui-sheet.json'), 'utf8')).consistency;
  assert.equal(grouped.findings.length, 1);
  assert.equal(grouped.findings[0].group.family, 'create actions');
  assert.equal(grouped.findings[0].group.familyEvidence, 'configured group');
  assert.equal(grouped.findings[0].group.variantEvidence, 'configured variant');
  await exec(process.execPath, [cli, 'baseline', groupedDir, '--file', path.join(project, 'group-baselines.json'), '--observation', grouped.findings[0].common.example, '--reason', 'Approved add control.']);
  await fs.writeFile(path.join(project, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [`${base}/grouped`], buttonGroups: [group, { selector: '#save-profile', family: 'overlap' }] }));
  await assert.rejects(exec(process.execPath, [cli, 'scan', project, '--capture', '--browser', browserPath, '--out', groupedDir]), /groups overlap/);
  await fs.writeFile(path.join(project, 'ui-sheet.config.json'), JSON.stringify({ include: ['index.html'], pages: [`${base}/grouped`], buttonGroups: [{ selector: '[', family: 'invalid' }] }));
  await assert.rejects(exec(process.execPath, [cli, 'scan', project, '--capture', '--browser', browserPath, '--out', groupedDir]), /Button group selectors must be valid CSS/);

  // Exercise the generated viewer in a browser using only the synthetic fixture.
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const center = (src) => page.evaluate(async (dataUrl) => {
      const image = new Image(); image.src = dataUrl; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
    }, src);
    assert.deepEqual(await center(maskedExample), [32, 32, 32, 255], 'comparison screenshot masks the selected button');
    assert.deepEqual(await center(maskedInventory), [32, 32, 32, 255], 'inventory screenshot uses the same mask');
    assert.notDeepEqual(await center(unmaskedExample), [32, 32, 32, 255], 'CLI masks replace the configured list');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(await fs.readFile(path.join(reportDir, 'index.html'), 'utf8'));
    await page.getByRole('heading', { name: 'Possible button differences' }).waitFor();
    assert.equal(await page.locator('.finding-card .comparison-image img').count(), 4);
    await page.locator('.comparison-image img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    assert.match(await page.locator('#consistency-review').innerText(), /8px → 3px/);
    assert.equal(await page.locator('.finding-card').first().locator('.difference-row').filter({ hasText: 'Corner radius' }).count(), 1);
    assert.match(await page.locator('#consistency-review').innerText(), /Possible source: index\.html:/);
    assert.match(await page.locator('#consistency-review').innerText(), /\/second/);
    assert.match(await page.locator('#consistency-review').innerText(), /Reviewed as intentional: This example is intentionally different/);
    assert.match(await page.locator('#consistency-review').innerText(), /Approved appearance/);
    await page.locator('.review-tools > summary').click();
    await page.locator('.review-import input').setInputFiles(importedDecisions);
    await page.getByText('2 existing decisions ready to preserve in the download.').waitFor();
    const reviewForm = page.locator('.finding-card').nth(1).locator('.review-form');
    await reviewForm.locator('summary').click();
    await reviewForm.getByLabel('Decision').selectOption('needs-fix');
    await reviewForm.getByLabel('Reason').fill('Correct the second page.');
    await reviewForm.getByRole('button', { name: 'Queue decision' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download review decisions' }).click()]);
    const decisionFile = await download.path();
    const downloaded = JSON.parse(await fs.readFile(decisionFile, 'utf8'));
    assert.equal(downloaded.decisions.length, 3);
    assert.ok(downloaded.decisions.some((entry) => entry.findingId === 'aaaaaaaaaaaaaaaa'));
    const applied = await applyDecisions(reviewed, decisionFile);
    assert.deepEqual(applied, { applied: 2, stale: 1 });
    assert.equal(reviewed.consistency.pages[1].findings[0].review.reason, 'Correct the second page.');
    await page.locator('.appearance-gallery > summary').first().click();
    assert.equal(await page.locator('.appearance-gallery').first().locator('.comparison-image img').count(), 3);
    assert.match(await page.locator('.appearance-gallery').first().innerText(), /Observation: button:/);
    await page.locator('.appearance-gallery').first().locator('.appearance-locations > summary').first().click();
    assert.match(await page.locator('.appearance-gallery').first().innerText(), /Page 2: .*\/second · 3 buttons/);
    const imageSize = await page.locator('.finding-card .comparison-image img').first().evaluate((image) => ({ natural: image.naturalWidth, displayed: parseFloat(image.style.width), dpr: window.devicePixelRatio }));
    assert.equal(imageSize.dpr, 1);
    assert.equal(imageSize.displayed, imageSize.natural / 2, '2x captures use their capture density, even on a 1x display');
    assert.deepEqual(errors, []);
    await page.setContent(await fs.readFile(path.join(consistentDir, 'index.html'), 'utf8'));
    await page.locator('.appearance-gallery > summary').click();
    assert.equal(await page.locator('.appearance-gallery .comparison-image img').count(), 2, 'gallery is present without a finding');
    await page.setContent(await fs.readFile(path.join(borderDir, 'index.html'), 'utf8'));
    assert.deepEqual(await page.locator('.finding-card .difference-row strong').allTextContents(), ['Bottom border width', 'Bottom border style', 'Bottom border color']);
    await page.setContent(await fs.readFile(path.join(uniformBorderDir, 'index.html'), 'utf8'));
    assert.deepEqual(await page.locator('.finding-card .difference-row strong').allTextContents(), ['Border width', 'Border style', 'Border color']);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
