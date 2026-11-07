import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { listAppearances } from '../src/appearances.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));

test('lists observed styles and counts without embedding images', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-appearances-'));
  t.after(async () => { await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rmdir(root); });
  const group = { family: '.button', variant: 'primary', type: 'button' };
  const page = { scope: { url: 'https://example.test/', theme: 'light' }, observations: [
    { id: 'button:0', group, style: { color: 'red' }, source: { status: 'likely', file: 'src/Button.jsx', line: 2 } },
    { id: 'button:1', group, style: { color: 'red' } },
    { id: 'button:2', group, style: { color: 'blue' } },
  ], previews: { 'button:0': { image: 'data:image/png;base64,SECRET' } } };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ format: 'ui-sheet/v1', consistency: page }));
  const result = await listAppearances(root, { limit: 1 });
  assert.equal(result.totalAppearances, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.appearances[0].count, 2);
  assert.equal(result.appearances[0].example, 'button:0');
  assert.equal(JSON.stringify(result).includes('data:image'), false);
  const command = await exec(process.execPath, [cli, 'appearances', root, '--page', '1']);
  assert.equal(JSON.parse(command.stdout).appearances.length, 2);
  await assert.rejects(listAppearances(root, { page: 2 }), /not present/);
});
