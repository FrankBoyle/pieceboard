import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePage } from '../src/capture.js';
import { readProjectConfig } from '../src/config.js';
import { writeReport } from '../src/report.js';
import { scanProject } from '../src/scan.js';
import { beginReportScan } from '../src/scan-status.js';

const fixture = fileURLToPath(new URL('../examples/ui-groups/', import.meta.url));
const output = path.resolve('.ui-sheet-demo-elements');
const [html, mark, config] = await Promise.all([fs.readFile(path.join(fixture, 'index.html')), fs.readFile(path.join(fixture, 'mark.svg')), readProjectConfig(fixture)]);
const server = http.createServer((request, response) => {
  if (!['/', '/mark.svg'].includes(request.url)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': request.url === '/' ? 'text/html; charset=utf-8' : 'image/svg+xml' });
  response.end(request.url === '/' ? html : mark);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let run;
try {
  run = await beginReportScan(output);
  const data = await scanProject(fixture, { outputDir: output });
  await capturePage(data, `http://127.0.0.1:${server.address().port}/`, { elementGroups: config.elementGroups, browserPath: process.env.UI_SHEET_BROWSER, ...(process.env.UI_SHEET_PIXEL_RATIO ? { pixelRatio: Number(process.env.UI_SHEET_PIXEL_RATIO) } : {}) });
  data.scanRunId = run.runId;
  await writeReport(data, output);
  await run.finish('completed');
  console.log(`${data.elementConsistency.pages[0].findings.length} configured UI differences and ${data.consistency.findings.length} button difference(s).`);
  console.log(`Open ${path.join(output, 'index.html')}`);
} catch (error) {
  if (run) await run.finish('failed');
  throw error;
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
