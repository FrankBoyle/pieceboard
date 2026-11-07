import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';
import { writeReport } from '../src/report.js';
import { beginReportScan } from '../src/scan-status.js';

const fixture = fileURLToPath(new URL('../examples/button-review/', import.meta.url));
const html = await fs.readFile(path.join(fixture, 'index.html'));
const output = path.resolve('.ui-sheet-demo-consistency');
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let run;
try {
  run = await beginReportScan(output);
  const data = await scanProject(fixture, { outputDir: output });
  await capturePage(data, `http://127.0.0.1:${server.address().port}/`, { browserPath: process.env.UI_SHEET_BROWSER, ...(process.env.UI_SHEET_PIXEL_RATIO ? { pixelRatio: Number(process.env.UI_SHEET_PIXEL_RATIO) } : {}) });
  data.scanRunId = run.runId;
  await writeReport(data, output);
  await run.finish('completed');
  console.log(`Found ${data.consistency.findings.length} possible button difference(s) among ${data.consistency.counts.eligible} eligible controls.`);
  console.log(`Open ${path.join(output, 'index.html')}`);
} catch (error) {
  if (run) await run.finish('failed');
  throw error;
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
