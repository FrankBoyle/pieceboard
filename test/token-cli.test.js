import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const run = (...args) => exec(process.execPath, [cli, ...args]);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-token-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const css = path.join(root, 'theme.css');
  const report = path.join(root, '.ui-sheet');
  const baseline = path.join(root, 'approved-tokens.json');
  const scan = (...args) => run('scan', root, '--out', report, ...args);
  return { root, css, report, baseline, scan };
}

test('token CLI preserves theme scopes and approvals across moved lines, then fails on a changed approved declaration', { timeout: 30000 }, async (t) => {
  const { css, report, baseline, scan } = await fixture(t);
  await fs.writeFile(css, ':root { --accent: #123456; }\n[data-theme="dark"] { --accent: #abcdef; }');
  await scan();
  const listed = JSON.parse((await run('tokens', report, '--name', '--accent', '--file', 'theme.css')).stdout);
  assert.equal(listed.scanStatus, 'completed');
  assert.equal(listed.total, 2);
  const rootToken = listed.entries.find((entry) => entry.context[0].selector === ':root');
  const darkToken = listed.entries.find((entry) => entry.context[0].selector.includes('dark'));
  assert.notEqual(rootToken.id, darkToken.id);
  await run('token-baseline', report, '--file', baseline, '--declaration', rootToken.id, '--reason', 'Approved light accent');
  const check = (...args) => run('check-tokens', report, '--file', baseline, '--json', ...args);
  assert.equal(JSON.parse((await check('--strict-coverage', '--fail-on-findings')).stdout).matched, 1);
  await fs.writeFile(css, '\n\n:root { --accent: #123456; }\n[data-theme="dark"] { --accent: #222222; }');
  await scan();
  assert.equal(JSON.parse((await check('--strict-coverage', '--fail-on-findings')).stdout).matched, 1, 'unapproved dark definition remains independent');
  await fs.writeFile(css, ':root { --accent: #654321; }\n[data-theme="dark"] { --accent: #222222; }');
  await scan();
  await assert.rejects(check('--fail-on-findings'), (error) => {
    assert.equal(error.code, 1);
    const result = JSON.parse(error.stdout);
    assert.equal(result.changed, 1);
    assert.deepEqual(result.findings[0].approved, { value: '#123456', important: false });
    assert.equal(result.findings[0].current[0].value, '#654321');
    return true;
  });
});

test('token CLI distinguishes a missing declaration from an excluded file and returns structured failures', { timeout: 30000 }, async (t) => {
  const { root, css, report, baseline, scan } = await fixture(t);
  await fs.writeFile(css, ':root { --space: 8px; }');
  await fs.writeFile(path.join(root, 'App.jsx'), 'export function App(){return <button>Save</button>}');
  await scan();
  const id = JSON.parse((await run('tokens', report)).stdout).entries[0].id;
  await run('token-baseline', report, '--file', baseline, '--declaration', id, '--reason', 'Approved spacing');
  await fs.writeFile(css, ':root { color: black; }');
  await scan();
  await assert.rejects(run('check-tokens', report, '--file', baseline, '--json', '--fail-on-findings'), (error) => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).missing, 1);
    return true;
  });
  await scan('--include', 'App.jsx');
  await assert.rejects(run('check-tokens', report, '--file', baseline, '--json', '--strict-coverage'), (error) => {
    assert.equal(error.code, 2);
    const result = JSON.parse(error.stdout);
    assert.equal(result.unscanned, 1);
    assert.equal(result.missing, 0);
    assert.equal(result.coverage, 'partial');
    return true;
  });
  await fs.writeFile(baseline, '{"format":"unrecognized","rules":[]}');
  await assert.rejects(run('check-tokens', report, '--file', baseline, '--json'), (error) => {
    assert.equal(error.code, 2);
    const result = JSON.parse(error.stdout);
    assert.equal(result.format, 'ui-sheet/error-v1');
    assert.equal(result.error.code, 'TOKEN_CHECK_FAILED');
    assert.ok(result.error.message);
    return true;
  });
});

test('token query treats a custom property named --help as a value and retains explicit CLI help', { timeout: 15000 }, async (t) => {
  const { css, report, scan } = await fixture(t);
  await fs.writeFile(css, ':root { --help: 8px; --other: 4px; }');
  await scan();
  const result = JSON.parse((await run('tokens', report, '--name', '--help')).stdout);
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].token, '--help');
  assert.match((await run('tokens', '--help')).stdout, /Usage:/);
});
