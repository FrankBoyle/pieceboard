import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beginReportScan } from '../src/scan-status.js';
import { checkTokens, listTokens, readTokenBaselines, setTokenBaseline } from '../src/token-baselines.js';

const light = [{ type: 'rule', selector: ':root' }];
const dark = [{ type: 'at-rule', name: 'media', params: '(prefers-color-scheme: dark)' }, { type: 'rule', selector: ':root' }];
const declaration = (changes = {}) => ({ token: '--accent', file: 'src/theme.css', value: '#123456', important: false, line: 2, column: 3, context: structuredClone(light), ...changes });
const source = (declarations = [declaration()], files = [{ file: 'src/theme.css', status: 'scanned' }]) => ({ format: 'ui-sheet/token-source-v1', files, declarations });
const idFor = (entry) => `token:${createHash('sha256').update(JSON.stringify({ file: entry.file, token: entry.token, context: entry.context })).digest('hex').slice(0, 24)}`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-token-baseline-'));
  const report = path.join(root, 'report');
  const file = path.join(root, 'approved.json');
  await fs.mkdir(report);
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temporary || !path.basename(actual).startsWith('ui-sheet-token-baseline-')) throw new Error('Unexpected token test directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  async function write(tokenSource = source(), { warnings = [], verified = true } = {}) {
    const scan = verified ? await beginReportScan(report) : null;
    const data = { format: 'ui-sheet/v1', warnings, ...(tokenSource === undefined ? {} : { tokenSource }), ...(scan ? { scanRunId: scan.runId } : {}) };
    await fs.writeFile(path.join(report, 'ui-sheet.json'), JSON.stringify(data));
    if (scan) await scan.finish('completed');
    else await fs.rm(path.join(report, '.ui-sheet-scan.json'), { force: true });
  }
  return { root, report, file, write };
}

async function approve(env, entry = declaration()) {
  return setTokenBaseline(env.report, { file: env.file, declarationId: idFor(entry), reason: 'Approved project convention.' });
}

test('token approvals preserve separate theme contexts and survive line moves', async (t) => {
  const env = await fixture(t);
  const a = declaration();
  const b = declaration({ context: dark, value: '#abcdef', line: 7 });
  await env.write(source([a, b]));
  const listed = await listTokens(env.report);
  assert.equal(listed.sourceStatus, 'available');
  assert.equal(listed.entries.length, 2);
  assert.notEqual(listed.entries[0].id, listed.entries[1].id);
  await approve(env, a);
  await approve(env, b);
  assert.equal((await readTokenBaselines(env.file)).rules.length, 2);
  await env.write(source([{ ...a, line: 30, column: 1 }, { ...b, line: 40 }]));
  let checked = await checkTokens(env.report, { file: env.file });
  assert.equal(checked.coverage, 'observed');
  assert.equal(checked.matched, 2);
  assert.equal(checked.findings[0].current[0].line, 30);
  await env.write(source([a, { ...b, important: true }]));
  checked = await checkTokens(env.report, { file: env.file });
  assert.equal(checked.matched, 1);
  assert.equal(checked.changed, 1);
  assert.equal(checked.findings[1].approved.value, '#abcdef');
  assert.equal(checked.findings[1].current[0].important, true);
  assert.equal(checked.coverage, 'observed');
  const stored = await readTokenBaselines(env.file);
  assert.equal(stored.rules[1].important, false);
});

test('missing declarations, skipped files and duplicate scopes have distinct results', async (t) => {
  const env = await fixture(t);
  await env.write();
  await approve(env);
  await env.write(source([]));
  let checked = await checkTokens(env.report, { file: env.file });
  assert.equal(checked.missing, 1);
  assert.equal(checked.coverage, 'observed');
  await env.write(source([], []));
  checked = await checkTokens(env.report, { file: env.file });
  assert.equal(checked.unscanned, 1);
  assert.equal(checked.missing, 0);
  assert.equal(checked.coverage, 'partial');
  await env.write(source([], [{ file: 'src/theme.css', status: 'failed' }]), { warnings: [{ file: 'src/theme.css', message: 'Parse failed' }] });
  assert.equal((await checkTokens(env.report, { file: env.file })).unscanned, 1);
  await env.write(source([declaration(), declaration({ line: 3, value: '#fff' })]));
  const listed = await listTokens(env.report);
  assert.equal(listed.entries[0].id, listed.entries[1].id);
  assert.equal(listed.entries.every((entry) => entry.ambiguous), true);
  checked = await checkTokens(env.report, { file: env.file });
  assert.equal(checked.ambiguous, 1);
  assert.equal(checked.coverage, 'partial');
  assert.equal(checked.findings[0].current.length, 2);
  const original = await fs.readFile(env.file, 'utf8');
  await assert.rejects(approve(env), /exactly one unambiguous/);
  assert.equal(await fs.readFile(env.file, 'utf8'), original);
});

test('legacy reports and unverified scans cannot silently authorize token approvals', async (t) => {
  const env = await fixture(t);
  await env.write();
  await approve(env);
  const data = JSON.parse(await fs.readFile(path.join(env.report, 'ui-sheet.json'), 'utf8'));
  delete data.tokenSource;
  await fs.writeFile(path.join(env.report, 'ui-sheet.json'), JSON.stringify(data));
  assert.deepEqual(await listTokens(env.report), { format: 'ui-sheet/tokens-v1', scanStatus: 'completed', sourceStatus: 'missing', total: 0, truncated: false, entries: [] });
  let checked = await checkTokens(env.report, { file: env.file });
  assert.equal(checked.coverage, 'partial');
  assert.equal(checked.unscanned, 1);
  await assert.rejects(approve(env), /completed current source scan/);
  await env.write(source(), { verified: false });
  await assert.rejects(approve(env), /completed current source scan/);
  checked = await checkTokens(env.report, { file: env.file });
  assert.equal(checked.scanStatus, 'unverified');
  assert.equal(checked.matched, 1);
  assert.equal(checked.coverage, 'partial');
});

test('token commands reject failed, locked and mismatched report runs', async (t) => {
  const env = await fixture(t);
  await env.write();
  await approve(env);
  const scan = await beginReportScan(env.report);
  await assert.rejects(listTokens(env.report), /in progress or was interrupted/);
  await assert.rejects(checkTokens(env.report, { file: env.file }), /in progress or was interrupted/);
  await assert.rejects(approve(env), /in progress or was interrupted/);
  await scan.finish('failed');
  await assert.rejects(checkTokens(env.report, { file: env.file }), /most recent scan did not complete/);
  await env.write();
  const data = JSON.parse(await fs.readFile(path.join(env.report, 'ui-sheet.json'), 'utf8'));
  data.scanRunId = 'different';
  await fs.writeFile(path.join(env.report, 'ui-sheet.json'), JSON.stringify(data));
  await assert.rejects(listTokens(env.report), /report and scan status do not match/);
});

test('list filtering is bounded and IDs remain stable across object key order', async (t) => {
  const env = await fixture(t);
  const a = declaration();
  const b = declaration({ token: '--spacing', line: 3 });
  const c = declaration({ file: 'other.css', line: 1 });
  await env.write(source([a, b, c], [{ file: 'src/theme.css', status: 'scanned' }, { file: 'other.css', status: 'scanned' }]));
  assert.equal((await listTokens(env.report, { limit: 1 })).truncated, true);
  assert.equal((await listTokens(env.report, { name: '--accent' })).total, 2);
  assert.equal((await listTokens(env.report, { file: 'src/theme.css' })).total, 2);
  assert.equal((await listTokens(env.report, { name: '--spacing', file: 'src/theme.css' })).entries[0].value, '#123456');
  const id = (await listTokens(env.report, { file: 'src/theme.css', name: '--accent' })).entries[0].id;
  await env.write(source([{ ...a, context: [{ selector: ':root', type: 'rule' }] }]));
  assert.equal((await listTokens(env.report)).entries[0].id, id);
  for (const limit of [0, 201, 1.5, '5']) await assert.rejects(listTokens(env.report, { limit }), /limit/);
  for (const file of ['../theme.css', '/theme.css', 'C:/theme.css', 'src\\theme.css', 'src/./theme.css']) await assert.rejects(listTokens(env.report, { file }), /project-relative CSS/);
});

test('source warnings prevent complete checks and only affected files prevent approval', async (t) => {
  const env = await fixture(t);
  await env.write(source(), { warnings: [{ file: 'unrelated.jsx', message: 'Parse failed' }] });
  await approve(env);
  assert.equal((await checkTokens(env.report, { file: env.file })).coverage, 'partial');
  await env.write(source(), { warnings: [{ file: 'src/theme.css', message: 'Unknown scan condition' }] });
  await assert.rejects(approve(env), /incomplete warning evidence/);
  const data = JSON.parse(await fs.readFile(path.join(env.report, 'ui-sheet.json'), 'utf8'));
  delete data.warnings;
  await fs.writeFile(path.join(env.report, 'ui-sheet.json'), JSON.stringify(data));
  await assert.rejects(approve(env), /incomplete warning evidence/);
  assert.equal((await checkTokens(env.report, { file: env.file })).coverage, 'partial');
});

test('invalid contracts and unrelated output files are preserved unchanged', async (t) => {
  const env = await fixture(t);
  await env.write();
  await approve(env);
  const valid = await readTokenBaselines(env.file);
  const cases = [
    { other: 'unrelated data' },
    { ...valid, extra: true },
    { ...valid, rules: [valid.rules[0], valid.rules[0]] },
    { ...valid, rules: [{ ...valid.rules[0], id: 'token:000000000000000000000000' }] },
    { ...valid, rules: [{ ...valid.rules[0], file: '../theme.css' }] },
    { ...valid, rules: [{ ...valid.rules[0], context: [{ type: 'rule', selector: ':root', extra: true }] }] },
    { ...valid, rules: [{ ...valid.rules[0], reason: ' ' }] },
    { ...valid, rules: [{ ...valid.rules[0], reason: 'x'.repeat(501) }] },
    { ...valid, rules: [{ ...valid.rules[0], recordedAt: 'yesterday' }] },
    { ...valid, rules: [{ ...valid.rules[0], extra: true }] },
  ];
  for (const invalid of cases) {
    const raw = JSON.stringify(invalid);
    await fs.writeFile(env.file, raw);
    await assert.rejects(readTokenBaselines(env.file), /token baseline file|invalid or duplicate rule/);
    await assert.rejects(approve(env), /token baseline file|invalid or duplicate rule/);
    assert.equal(await fs.readFile(env.file, 'utf8'), raw);
  }
  await fs.writeFile(env.file, 'not JSON');
  await assert.rejects(approve(env), /not valid JSON/);
  assert.equal(await fs.readFile(env.file, 'utf8'), 'not JSON');
  await fs.writeFile(env.file, ' '.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(readTokenBaselines(env.file), /at most 2 MB/);
  await fs.rm(env.file);
  await fs.mkdir(env.file);
  await assert.rejects(approve(env), /regular file/);
  await fs.rmdir(env.file);
  assert.deepEqual(await readTokenBaselines(env.file, { allowMissing: true }), { format: 'ui-sheet/token-baselines-v1', rules: [] });
  assert.deepEqual((await fs.readdir(env.root)).filter((entry) => entry.endsWith('.tmp')), []);
});

test('invalid source evidence fails closed rather than looking like an empty scan', async (t) => {
  const env = await fixture(t);
  const variants = [
    null,
    { ...source(), extra: true },
    source([declaration({ file: '../theme.css' })]),
    source([declaration()], [{ file: 'src/theme.css', status: 'failed' }]),
    source([declaration({ context: [{ type: 'unknown', name: 'media' }] })]),
    source([declaration({ column: 0 })]),
    source([declaration({ important: 'false' })]),
    source([], [{ file: 'src/theme.css', status: 'scanned' }, { file: 'src/theme.css', status: 'scanned' }]),
  ];
  for (const invalid of variants) {
    await env.write(invalid);
    await assert.rejects(listTokens(env.report), /Token source|Token declarations/);
  }
});

test('empty contracts remain insufficient and exact values are not CSS-equivalence claims', async (t) => {
  const env = await fixture(t);
  await env.write();
  await fs.writeFile(env.file, JSON.stringify({ format: 'ui-sheet/token-baselines-v1', rules: [] }));
  assert.equal((await checkTokens(env.report, { file: env.file })).coverage, 'insufficient');
  await approve(env);
  await env.write(source([declaration({ value: 'rgb(18 52 86)' })]));
  const result = await checkTokens(env.report, { file: env.file });
  assert.equal(result.changed, 1);
  await assert.rejects(setTokenBaseline(env.report, { file: env.file, declarationId: idFor(declaration()), reason: ' ' }), /reason/);
});

test('the rule limit permits updates but refuses additional approvals without changing the file', async (t) => {
  const env = await fixture(t);
  await env.write();
  await approve(env);
  const baseline = await readTokenBaselines(env.file);
  const original = baseline.rules[0];
  for (let index = 1; index < 1000; index++) {
    const entry = { ...original, token: `--sample-${index}` };
    baseline.rules.push({ ...entry, id: idFor(entry) });
  }
  await fs.writeFile(env.file, JSON.stringify(baseline));
  await approve(env);
  assert.equal((await readTokenBaselines(env.file)).rules.length, 1000);
  const extra = declaration({ token: '--new' });
  await env.write(source([declaration(), extra]));
  const before = await fs.readFile(env.file, 'utf8');
  await assert.rejects(approve(env, extra), /supported Pieceboard token baseline/);
  assert.equal(await fs.readFile(env.file, 'utf8'), before);
});

function holdNextRead(t, file) {
  const original = fs.readFile;
  let pause = true;
  let signal;
  let resume;
  const reached = new Promise((resolve) => { signal = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  t.mock.method(fs, 'readFile', async function (candidate, ...options) {
    if (candidate === file && pause) {
      pause = false;
      signal();
      await resumed;
    }
    return original.call(this, candidate, ...options);
  });
  return { reached, resume };
}

test('concurrent approvals acknowledge only serialized writes and a contender can retry safely', { timeout: 10000 }, async (t) => {
  const env = await fixture(t);
  const a = declaration();
  const b = declaration({ token: '--spacing' });
  const c = declaration({ token: '--radius' });
  await env.write(source([a, b, c]));
  await approve(env, a);
  // Hold the first writer while it reads the existing baseline. The second
  // writer really runs concurrently and must not read a competing snapshot.
  const held = holdNextRead(t, env.file);
  const first = approve(env, b);
  await Promise.race([held.reached, first.then(() => { throw new Error('Writer completed without reading the baseline.'); })]);
  try {
    await assert.rejects(approve(env, c), /approval is in progress or was interrupted.*After verifying no token-baseline writer is running/);
    assert.deepEqual((await readTokenBaselines(env.file)).rules.map((rule) => rule.token), ['--accent']);
    assert.equal((await checkTokens(env.report, { file: env.file })).matched, 1);
  } finally { held.resume(); }
  await first;
  assert.deepEqual((await readTokenBaselines(env.file)).rules.map((rule) => rule.token), ['--accent', '--spacing']);
  await approve(env, c);
  assert.deepEqual((await readTokenBaselines(env.file)).rules.map((rule) => rule.token), ['--accent', '--spacing', '--radius']);
  await assert.rejects(fs.access(`${env.file}.lock`), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(env.root)).filter((entry) => entry.endsWith('.tmp')), []);
});

test('an existing writer lock remains unchanged and read-only token checks still work', async (t) => {
  const env = await fixture(t);
  await env.write();
  await approve(env);
  const baseline = await fs.readFile(env.file, 'utf8');
  const lock = `${env.file}.lock`;
  const interrupted = '{"format":"ui-sheet/token-baseline-lock-v1","owner":"another-writer"}\n';
  await fs.writeFile(lock, interrupted);
  await assert.rejects(approve(env), /approval is in progress or was interrupted.*After verifying.*remove.*approved.json.lock.*retry/);
  assert.equal(await fs.readFile(lock, 'utf8'), interrupted);
  assert.equal(await fs.readFile(env.file, 'utf8'), baseline);
  assert.equal((await listTokens(env.report)).entries.length, 1);
  assert.equal((await checkTokens(env.report, { file: env.file })).matched, 1);
});

test('a writer whose lock ownership changed cannot publish or remove the replacement lock', { timeout: 10000 }, async (t) => {
  const env = await fixture(t);
  const b = declaration({ token: '--spacing' });
  await env.write(source([declaration(), b]));
  await approve(env);
  const baseline = await fs.readFile(env.file, 'utf8');
  const held = holdNextRead(t, env.file);
  const writer = approve(env, b);
  await Promise.race([held.reached, writer.then(() => { throw new Error('Writer completed without reading the baseline.'); })]);
  const lock = `${env.file}.lock`;
  const replacement = '{"format":"ui-sheet/token-baseline-lock-v1","owner":"replacement-writer"}\n';
  try { await fs.writeFile(lock, replacement); }
  finally { held.resume(); }
  await assert.rejects(writer, /approval lock changed; it was not removed/);
  assert.equal(await fs.readFile(env.file, 'utf8'), baseline);
  assert.equal(await fs.readFile(lock, 'utf8'), replacement);
  assert.deepEqual((await fs.readdir(env.root)).filter((entry) => entry.endsWith('.tmp')), []);
});
