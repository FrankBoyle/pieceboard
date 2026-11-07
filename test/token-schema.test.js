import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { scanProject } from '../src/scan.js';
import { writeReport } from '../src/report.js';
import { beginReportScan } from '../src/scan-status.js';
import { listTokens, setTokenBaseline, readTokenBaselines, checkTokens } from '../src/token-baselines.js';

const directory = new URL('../schemas/', import.meta.url);
const schemas = new Map();
const validator = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
for (const file of await fs.readdir(directory)) {
  if (!file.endsWith('.schema.json')) continue;
  const schema = JSON.parse(await fs.readFile(new URL(file, directory), 'utf8'));
  schemas.set(file.replace('.schema.json', ''), schema);
  validator.addSchema(schema);
}
function validate(name, value) {
  const check = validator.getSchema(schemas.get(name).$id);
  assert.equal(check(value), true, `${name}: ${validator.errorsText(check.errors)}`);
}
function reject(name, value) {
  const check = validator.getSchema(schemas.get(name).$id);
  assert.equal(check(value), false, `${name} accepted invalid data`);
}

test('token schemas validate actual source, list, approval and check producers', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-token-schema-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const out = path.join(root, '.ui-sheet');
  const baseline = path.join(root, 'approved.json');
  const source = path.join(root, 'theme.css');
  async function scan(css, options = {}) {
    await fs.writeFile(source, css);
    const run = await beginReportScan(out);
    try {
      const data = await scanProject(root, { outputDir: out, ...options });
      data.scanRunId = run.runId;
      await writeReport(data, out);
      await run.finish('completed');
      validate('token-source-v1', data.tokenSource);
      validate('report-v1', data);
      return data;
    } catch (error) {
      await run.finish('failed');
      throw error;
    }
  }
  await scan(':root { --accent: #abcdef; } @layer theme { [data-theme="dark"] { --accent: #123456 !important; } }');
  const listed = await listTokens(out);
  validate('tokens-v1', listed);
  assert.equal(listed.total, 2);
  const rootDeclaration = listed.entries.find((entry) => entry.context.length === 1);
  await setTokenBaseline(out, { file: baseline, declarationId: rootDeclaration.id, reason: 'Approved light theme accent' });
  validate('token-baselines-v1', await readTokenBaselines(baseline));
  const checked = async () => {
    const result = await checkTokens(out, { file: baseline });
    validate('token-check-v1', result);
    return result;
  };
  assert.equal((await checked()).matched, 1);
  await scan(':root { --accent: #fedcba; }');
  assert.equal((await checked()).changed, 1);
  await scan(':root { --spacing: 8px; }');
  assert.equal((await checked()).missing, 1);
  await scan(':root { --accent: #abcdef; --accent: #123456; }');
  assert.equal((await checked()).ambiguous, 1);
  await fs.writeFile(path.join(root, 'other.css'), ':root { --spacing: 8px; }');
  await scan(':root { --accent: #abcdef; }', { includePaths: ['other.css'] });
  assert.equal((await checked()).unscanned, 1);
});

test('token contracts reject unsafe paths, malformed contexts and unexpected approval fields', () => {
  const declaration = { token: '--accent', value: '#abcdef', important: false, file: 'styles/theme.css', line: 1, column: 9, context: [{ type: 'rule', selector: ':root' }] };
  const source = { format: 'ui-sheet/token-source-v1', files: [{ file: declaration.file, status: 'scanned' }], declarations: [declaration] };
  validate('token-source-v1', source);
  for (const file of ['/theme.css', '../theme.css', 'styles/../theme.css', 'C:/theme.css', 'styles\\theme.css', 'styles//theme.css', './theme.css', 'theme.scss', 'a\u0000.css']) {
    reject('token-source-v1', { ...source, files: [{ file, status: 'scanned' }] });
  }
  for (const context of [[{ type: 'rule', selector: '' }], [{ type: 'at-rule', name: 'media' }], [{ type: 'rule', selector: ':root', extra: true }], [{ type: 'mystery', selector: ':root' }]]) {
    reject('token-source-v1', { ...source, declarations: [{ ...declaration, context }] });
  }
  reject('token-source-v1', { ...source, declarations: [{ ...declaration, line: 0 }] });
  reject('token-source-v1', { ...source, declarations: [{ ...declaration, important: 'false' }] });
  const { line, column, ...scopeValue } = declaration;
  const rule = { id: `token:${'a'.repeat(24)}`, ...scopeValue, reason: 'Approved', recordedAt: '2026-11-04T00:00:00.000Z' };
  const baseline = { format: 'ui-sheet/token-baselines-v1', rules: [rule] };
  validate('token-baselines-v1', baseline);
  reject('token-baselines-v1', { ...baseline, rules: [{ ...rule, allowAnyValue: true }] });
  reject('token-baselines-v1', { ...baseline, rules: [{ ...rule, reason: '   ' }] });
  reject('token-baselines-v1', { ...baseline, rules: [{ ...rule, id: 'any-token' }] });
  validate('error-v1', { format: 'ui-sheet/error-v1', error: { code: 'TOKEN_CHECK_FAILED', message: 'Invalid baseline' } });
  validate('error-v1', { format: 'ui-sheet/error-v1', error: { code: 'CHECK_FAILED', message: 'Invalid report' } });
});
