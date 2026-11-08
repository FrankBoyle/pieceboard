import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { readCheckedReport } from '../src/scan-status.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));

test('long site scans publish clearly partial checkpoints before the complete report', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 120000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-site-progress-'));
  const out = path.join(root, 'report');
  t.after(async () => {
    for (const file of ['index.html', 'ui-sheet.json', '.ui-sheet-scan.json']) await fs.rm(path.join(out, file), { force: true });
    await fs.rmdir(out).catch(() => {});
    await fs.rm(path.join(root, 'App.html'), { force: true });
    await fs.rmdir(root);
  });
  const links = Array.from({ length: 10 }, (_, i) => `<a href="/p${i + 1}">Page ${i + 1}</a>`).join('');
  const html = '<!doctype html><meta name="viewport" content="width=device-width"><h1>Demo</h1>';
  await fs.writeFile(path.join(root, 'App.html'), html);
  let lastRequests = 0;
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    const send = () => response.end(html + (request.url === '/' ? links : ''));
    if (request.url === '/p10' && ++lastRequests > 1) setTimeout(send, 5000);
    else send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const child = spawn(process.execPath, [cli, 'scan', root, '--include', 'App.html', '--site', `http://127.0.0.1:${server.address().port}/`, '--site-limit', '11', '--responsive-viewport', '390x844', '--browser', browserPath, '--out', out], { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = ''; child.stderr.on('data', data => { diagnostic += data; });
  let ended = false;
  const completion = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { ended = true; resolve(code); }); });
  let partial;
  for (let i = 0; i < 900 && !ended; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { const value = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8')); if (value.siteScan?.inProgress) { partial = value; break; } } catch { /* The first checkpoint is not ready. */ }
  }
  try {
    assert.ok(partial, 'a partial report should be visible before completion');
    assert.equal(partial.siteScan.captured, 10);
    assert.equal(partial.siteScan.captureRemaining, 1);
    assert.match(await fs.readFile(path.join(out, 'index.html'), 'utf8'), /This is a partial report/);
    await assert.rejects(readCheckedReport(out), /in progress/);
    const browser = await chromium.launch({ headless: true, executablePath: browserPath });
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
      assert.match(await page.locator('#site-review').innerText(), /This is a partial report/);
    } finally { await browser.close(); }
    assert.equal(await completion, 0, diagnostic);
    const final = JSON.parse(await fs.readFile(path.join(out, 'ui-sheet.json'), 'utf8'));
    assert.equal(final.siteScan.inProgress, false);
    assert.equal(final.siteScan.captured, 11);
    assert.equal((await readCheckedReport(out)).scanStatus, 'completed');
  } finally {
    if (!ended) child.kill();
    await completion.catch(() => {});
  }
});
