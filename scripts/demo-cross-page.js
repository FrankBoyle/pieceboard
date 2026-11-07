import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';
import { analyzeAcrossPages } from '../src/cross-page.js';
import { writeReport } from '../src/report.js';
import { beginReportScan } from '../src/scan-status.js';

const fixture = fileURLToPath(new URL('../examples/cross-page/', import.meta.url));
const routes = new Map([['/profile', 'profile.html'], ['/email', 'email.html'], ['/alerts', 'alerts.html'], ['/styles.css', 'styles.css']]);
const server = http.createServer(async (request, response) => {
  const file = routes.get(request.url);
  if (!file) { response.writeHead(404); response.end(); return; }
  try {
    const body = await fs.readFile(path.join(fixture, file));
    response.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' });
    response.end(body);
  } catch { response.writeHead(500); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let run;
try {
  const output = path.resolve('.ui-sheet-demo-cross-page');
  run = await beginReportScan(output);
  const data = await scanProject(fixture, { outputDir: output });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [index, route] of ['/profile', '/email', '/alerts'].entries()) await capturePage(data, `${base}${route}`, { browserPath: process.env.UI_SHEET_BROWSER, append: index > 0 });
  data.crossPageConsistency = analyzeAcrossPages(data.consistency.pages);
  data.scanRunId = run.runId;
  await writeReport(data, output);
  await run.finish('completed');
  console.log(`Found ${data.crossPageConsistency.findings.length} possible cross-page difference(s).`);
  console.log(`Open ${path.join(output, 'index.html')}`);
} catch (error) {
  if (run) await run.finish('failed');
  throw error;
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
