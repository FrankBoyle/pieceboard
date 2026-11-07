import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject } from '../src/scan.js';
import { readProjectConfig } from '../src/config.js';
import { capturePage } from '../src/capture.js';
import { beginReportScan } from '../src/scan-status.js';
import { writeReport } from '../src/report.js';
import { checkLayout } from '../src/layout-check.js';

const fixture = fileURLToPath(new URL('../examples/layout-review/', import.meta.url));
const output = path.resolve('.ui-sheet-demo-layout');
const html = await fs.readFile(path.join(fixture, 'index.html'));
const logo = await fs.readFile(path.join(fixture, 'approved-mark.svg'));
const config = await readProjectConfig(fixture);
// Link explicit synthetic targets to their source lines without copying private artwork.
const lines = html.toString('utf8').split(/\r?\n/);
for (const rule of config.layoutChecks) {
  const line = lines.findIndex((value) => value.includes(`id="${rule.selector.slice(1)}"`));
  if (line >= 0) rule.source = { file: 'index.html', line: line + 1 };
}
const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1').pathname;
  if (!['/', '/approved-mark.svg'].includes(route)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': route === '/' ? 'text/html; charset=utf-8' : 'image/svg+xml' });
  response.end(route === '/' ? html : logo);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
try {
  const run = await beginReportScan(output);
  try {
    const data = await scanProject(fixture, { outputDir: output });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await run.planPages(1);
    await run.startPage(1, 'capture');
    await capturePage(data, url, { layoutChecks: config.layoutChecks, ...(process.env.UI_SHEET_TEST_BROWSER ? { browserPath: process.env.UI_SHEET_TEST_BROWSER } : {}) });
    await run.completePage(1, 'capture');
    data.scanRunId = run.runId;
    data.scanProgress = run.getPageProgress();
    await writeReport(data, output);
    await run.finish('completed');
  } catch (error) { await run.finish('failed'); throw error; }
  const result = await checkLayout(output);
  console.log(`${result.counts.findings} layout findings; ${result.counts.incomplete} incomplete checks. Coverage: ${result.coverage}.`);
  console.log(`Open ${path.join(output, 'index.html')}`);
} finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
