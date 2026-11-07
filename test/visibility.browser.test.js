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
import { capturePage } from '../src/capture.js';
import { checkReport } from '../src/check.js';
import { writeReport } from '../src/report.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const exec = promisify(execFile);

test('reports blocked and offscreen button visibility as incomplete evidence', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const button = (name, different = false) => `<button type="button" class="button" data-ui-sheet-group="actions" data-ui-sheet-variant="primary"${different ? ' style="border-radius:3px"' : ''}>${name}</button>`;
  const styles = '<style>body{margin:20px}.button{width:110px;height:40px;border-radius:8px}.cover{position:relative;display:inline-block}.shield{position:absolute;inset:0;background:#ddd;z-index:2}</style>';
  const blocked = `<!doctype html>${styles}<main>${button('One')}${button('Two')}<span class="cover">${button('Three', true)}<span class="shield"></span></span></main>`;
  const offscreen = `<!doctype html>${styles}<main>${button('One')}${button('Two')}${button('Three', true)}<div style="height:1200px"></div>${button('Four')}</main>`;
  const many = `<!doctype html><style>body{margin:20px}button{width:20px;height:20px;box-sizing:border-box}</style><main>${Array.from({ length: 501 }, () => '<button type="button" class="button">x</button>').join('')}</main>`;
  const server = http.createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(request.url === '/blocked' ? blocked : request.url === '/many' ? many : offscreen); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-visibility-'));
  t.after(async () => { await fs.rm(path.join(root, 'index.html'), { force: true }); await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rmdir(root); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const makeData = () => ({ format: 'ui-sheet/v1', name: 'Synthetic visibility', scannedFiles: 0, warnings: [], items: [] });

  const covered = await capturePage(makeData(), `${url}/blocked`, { browserPath, viewport: { width: 800, height: 600 } });
  assert.equal(covered.consistency.counts.possiblyBlocked, 1);
  assert.equal(covered.consistency.counts.eligible, 2);
  assert.equal(covered.consistency.findings.length, 0, 'a blocked style does not become an outlier');
  await writeReport(covered, root);
  assert.equal((await checkReport(root)).coverage, 'insufficient');

  const below = await capturePage(makeData(), `${url}/offscreen`, { browserPath, viewport: { width: 800, height: 600 } });
  assert.equal(below.consistency.counts.eligible, 4);
  assert.equal(below.consistency.counts.visibilityUnverified, 1);
  assert.equal(below.consistency.findings.length, 1);
  await writeReport(below, root);
  const summary = await checkReport(root);
  assert.equal(summary.coverage, 'partial');
  await assert.rejects(exec(process.execPath, [cli, 'check', root, '--strict-coverage']), (error) => error.code === 2);

  const limited = await capturePage(makeData(), `${url}/many`, { browserPath, pixelRatio: 1, viewport: { width: 800, height: 600 } });
  assert.equal(limited.consistency.counts.seen, 501);
  assert.equal(limited.consistency.counts.visibilityUnverified, 1, 'buttons beyond the 500-check budget remain unverified');
});
