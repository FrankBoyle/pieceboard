import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { browserFixture, scoreBrowserAnalysis, summarizeBrowserScores, validateBrowserCases } from '../evaluation/browser-evaluate.js';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';

const data = validateBrowserCases(JSON.parse(await fs.readFile(new URL('../evaluation/browser-holdout.json', import.meta.url), 'utf8')));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-browser-eval-'));
const fixtures = new Map();
let server;
try {
  for (const sample of data.cases) {
    const fixture = browserFixture(sample);
    fixtures.set(`/${sample.id}`, fixture);
    await fs.writeFile(path.join(root, `${sample.id}.html`), fixture.html);
  }
  server = http.createServer((request, response) => {
    const fixture = fixtures.get(request.url);
    if (!fixture) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fixture.html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [];
  const browsers = new Set();
  for (const sample of data.cases) {
    const sourceFile = `${sample.id}.html`;
    const scan = await scanProject(root, { includePaths: [sourceFile] });
    if (scan.warnings.length) throw new Error(`Source scan produced warnings for ${sample.id}.`);
    await capturePage(scan, `${base}/${sample.id}`, { browserPath: process.env.UI_SHEET_BROWSER, ...(sample.viewport ? { viewport: sample.viewport } : {}), colorScheme: sample.colorScheme || 'light' });
    const analysis = scan.consistency;
    if (analysis.counts.seen !== sample.buttons.length) throw new Error(`Unexpected number of buttons in ${sample.id}.`);
    browsers.add(analysis.scope.browser.version);
    cases.push(scoreBrowserAnalysis(sample, analysis, sourceFile, fixtures.get(`/${sample.id}`).sourceLines));
    if (cases.length % 6 === 0 || cases.length === data.cases.length) console.error(`Evaluated ${cases.length} of ${data.cases.length} browser cases.`);
  }
  const result = { ...summarizeBrowserScores(cases), checkedAt: new Date().toISOString(), preparedAgainst: data.preparedAgainst, browsers: [...browsers], limitations: 'Synthetic cases, labels by the implementer, not independent or representative. Source checks use generated pages with unique IDs. Captures do not establish general image quality.' };
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Separate synthetic browser set: ${cases.length} cases, ${result.totals.tp} true positives, ${result.totals.fp} false positives, ${result.totals.fn} false negatives.`);
    console.log(`Precision: ${result.precision === null ? 'not defined' : `${(100 * result.precision).toFixed(1)}%`}; recall: ${result.recall === null ? 'not defined' : `${(100 * result.recall).toFixed(1)}%`}.`);
    for (const sample of cases.filter((entry) => entry.fp || entry.fn)) console.log(`- ${sample.id}: expected [${sample.expected.join(', ')}], reported [${sample.predicted.join(', ')}]. ${sample.description}`);
    console.log(result.limitations);
  }
} finally {
  try {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } finally {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-browser-eval-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  }
}
