import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { frozenIndependentArtifacts, independentBrowserFixture, independentCaptureOptions, scoreIndependentCase, summarizeIndependentScores, validateIndependentCases } from '../evaluation/independent-evaluate.js';
import { scanProject } from '../src/scan.js';
import { capturePage } from '../src/capture.js';

const runFile = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const runtimePaths = ['src', 'bin', 'vite.js', 'package.json', 'package-lock.json'];
const captureTimeoutMs = 120000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function gitBytes(args) {
  const { stdout } = await runFile('git', args, { cwd: projectRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return stdout;
}

async function gitText(args) {
  return (await gitBytes(args)).toString('utf8').trimEnd();
}

async function artifactFreeze() {
  const commit = await gitText(['rev-parse', `${frozenIndependentArtifacts.commit}^{commit}`]);
  const files = [];
  for (const [file, expectedSha256] of Object.entries(frozenIndependentArtifacts.files)) {
    const disk = await fs.readFile(path.join(projectRoot, file));
    const committed = await gitBytes(['show', `${commit}:${file}`]);
    if (sha256(disk) !== expectedSha256 || sha256(committed) !== expectedSha256) throw new Error(`Frozen artifact hash mismatch: ${file}. Do not score modified labels.`);
    files.push({ file, sha256: expectedSha256 });
  }
  return { commit, files };
}

async function detectorContext() {
  const [commit, status, runtimeStatus, tracked, untracked, diff] = await Promise.all([
    gitText(['rev-parse', 'HEAD']),
    gitText(['status', '--porcelain=v1', '--untracked-files=all']),
    gitText(['status', '--porcelain=v1', '--untracked-files=all', '--', ...runtimePaths]),
    gitBytes(['ls-files', '-z', '--', ...runtimePaths]),
    gitBytes(['ls-files', '--others', '--exclude-standard', '-z', '--', ...runtimePaths]),
    gitBytes(['diff', '--binary', 'HEAD', '--', ...runtimePaths]),
  ]);
  const paths = [...new Set(Buffer.concat([tracked, untracked]).toString('utf8').split('\0').filter(Boolean))].sort();
  const sourceFiles = await Promise.all(paths.map(async (file) => {
    try {
      return { file, sha256: sha256(await fs.readFile(path.join(projectRoot, file))) };
    } catch (error) {
      if (error.code === 'ENOENT') return { file, deleted: true };
      throw error;
    }
  }));
  return {
    commit,
    checkoutDirty: Boolean(status),
    checkoutStatus: status ? status.split(/\r?\n/) : [],
    runtimeDirty: Boolean(runtimeStatus),
    runtimeStatus: runtimeStatus ? runtimeStatus.split(/\r?\n/) : [],
    runtimeDiffSha256: sha256(diff),
    runtimeSourceSha256: sha256(JSON.stringify(sourceFiles)),
    runtimeSourceFiles: sourceFiles,
  };
}

async function runnerContext() {
  const files = ['scripts/evaluate-independent.js', 'evaluation/independent-evaluate.js', 'evaluation/browser-evaluate.js'];
  return Promise.all(files.map(async (file) => ({ file, sha256: sha256(await fs.readFile(path.join(projectRoot, file))) })));
}

function argumentsFrom(argv) {
  const options = { json: false, help: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--help') options.help = true;
    else if (argument === '--out' && argv[index + 1] && !argv[index + 1].startsWith('--') && !options.out) options.out = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argument}.`);
  }
  return options;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/evaluate-independent.js [--json] [--out FILE]\nRuns the frozen separately authored synthetic browser set. --out writes a new JSON artifact and refuses to overwrite an existing file.');
    return;
  }
  if (options.out) {
    try {
      await fs.access(options.out);
      throw new Error(`Output already exists: ${options.out}. Preserve frozen results by choosing a new path.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const startedAt = new Date().toISOString();
  const [freeze, detector, runnerFiles] = await Promise.all([artifactFreeze(), detectorContext(), runnerContext()]);
  const data = validateIndependentCases(JSON.parse(await fs.readFile(new URL('../evaluation/independent-button-cases.json', import.meta.url), 'utf8')));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-independent-eval-'));
  const fixtures = new Map();
  const cases = [];
  const browsers = new Map();
  let server;
  let interrupted = false;
  const onSignal = () => { interrupted = true; console.error('Stopping after the active bounded capture closes.'); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    for (const sample of data.cases) {
      const fixture = independentBrowserFixture(sample);
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
    for (const sample of data.cases) {
      if (interrupted) throw new Error('Evaluation interrupted; no complete result was written.');
      const sourceFile = `${sample.id}.html`;
      const fixture = fixtures.get(`/${sample.id}`);
      const scan = await scanProject(root, { includePaths: [sourceFile] });
      if (scan.warnings.length) throw new Error(`Source scan produced warnings for ${sample.id}.`);
      const captureOptions = independentCaptureOptions(data, sample);
      await capturePage(scan, `${base}/${sample.id}`, { ...captureOptions, browserPath: process.env.UI_SHEET_BROWSER, captureTimeoutMs });
      if (interrupted) throw new Error('Evaluation interrupted; no complete result was written.');
      const analysis = scan.consistency;
      if (!analysis?.scope?.browser?.version) throw new Error(`Missing browser version for ${sample.id}.`);
      browsers.set(JSON.stringify(analysis.scope.browser), analysis.scope.browser);
      cases.push({ ...scoreIndependentCase(sample, analysis, sourceFile, fixture.sourceLines, captureOptions), fixtureSha256: sha256(fixture.html) });
      if (cases.length % 6 === 0 || cases.length === data.cases.length) console.error(`Evaluated ${cases.length} of ${data.cases.length} separately authored browser cases.`);
    }
    const finalDetector = await detectorContext();
    const finalRunnerFiles = await runnerContext();
    const stable = detector.commit === finalDetector.commit && detector.runtimeSourceSha256 === finalDetector.runtimeSourceSha256 && JSON.stringify(runnerFiles) === JSON.stringify(finalRunnerFiles);
    if (!stable) throw new Error('Detector or runner changed during evaluation. No complete result was written; preserve the run log and repeat only after freezing the runtime.');
    // Recheck the labels as well as the runtime before accepting a result.
    await artifactFreeze();
    const checkedAt = new Date().toISOString();
    const result = {
      ...summarizeIndependentScores(cases),
      setId: data.setId,
      startedAt,
      checkedAt,
      durationMs: Date.parse(checkedAt) - Date.parse(startedAt),
      frozenArtifacts: freeze,
      detector: { ...detector, stableDuringRun: true },
      runnerFiles,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      browsers: [...browsers.values()],
      captureDefaults: data.captureDefaults,
      captureTimeoutMs,
      authorship: data.authorship,
      limitations: 'Synthetic cases authored by a second software agent, without independent human review. Documentation exposed prior detector behavior. Unscorable cases are diagnostics only. Unique IDs simplify source checks; preview presence does not prove readability or general source accuracy. Scores apply only to this frozen set and recorded runtime/context.',
    };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.out) {
      await fs.mkdir(path.dirname(options.out), { recursive: true });
      await fs.writeFile(options.out, json, { flag: 'wx' });
      console.error(`Saved new evaluation artifact: ${options.out}`);
    }
    if (options.json) process.stdout.write(json);
    else {
      console.log(`Separately authored synthetic set: ${result.scoredCases} scored cases, ${result.unscorableCases} unscorable diagnostics, ${result.totals.tp} true positives, ${result.totals.fp} false positives, ${result.totals.fn} false negatives.`);
      console.log(`Precision: ${result.precision === null ? 'not defined' : `${(100 * result.precision).toFixed(1)}%`}; recall: ${result.recall === null ? 'not defined' : `${(100 * result.recall).toFixed(1)}%`}.`);
      for (const sample of cases.filter((entry) => entry.metrics && (entry.metrics.fp || entry.metrics.fn))) console.log(`- ${sample.id}: expected [${sample.expected.join(', ')}], predicted [${sample.predicted.join(', ')}], false positives [${sample.metrics.falsePositiveIndexes.join(', ')}], false negatives [${sample.metrics.falseNegativeIndexes.join(', ')}].`);
      console.log(result.limitations);
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      const actual = await fs.realpath(root);
      const temp = await fs.realpath(os.tmpdir());
      if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-independent-eval-')) throw new Error('Unexpected temporary directory; refusing recursive removal.');
      await fs.rm(actual, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
