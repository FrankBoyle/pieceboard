import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { locateButtons } from '../src/locations.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));

test('lists matching observed buttons across pages without embedding images', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-locations-'));
  t.after(async () => { await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rmdir(root); });
  const group = { family: 'save actions', variant: 'primary', type: 'button', familyEvidence: 'configured group' };
  const first = { scope: { url: 'https://example.test/', viewport: { width: 1440, height: 900 }, theme: 'light' }, observations: [
    { id: 'button:0', group, source: { status: 'likely', file: 'src/One.jsx', line: 2 } }, { id: 'button:1', group },
  ], previews: { 'button:0': { image: 'data:image/png;base64,SECRET' } } };
  const second = { scope: { url: 'https://example.test/settings', viewport: { width: 1440, height: 900 }, theme: 'light' }, observations: [
    { id: 'button:0', group }, { id: 'button:1', group: { ...group, variant: 'danger' } },
  ] };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify({ format: 'ui-sheet/v1', consistency: { pages: [first, second] } }));
  const result = await locateButtons(root, { family: 'Save Actions', variant: 'primary', limit: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.matchingPages, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.locations[0].source.file, 'src/One.jsx');
  assert.equal(result.locations[0].previewAvailable, true);
  assert.equal(result.locations[1].source.status, 'unresolved');
  assert.equal(JSON.stringify(result).includes('data:image'), false);
  const command = await exec(process.execPath, [cli, 'locations', root, '--family', 'save actions', '--variant', 'danger']);
  assert.equal(JSON.parse(command.stdout).total, 1);
  await assert.rejects(locateButtons(root, { family: '' }), /family/);
});
