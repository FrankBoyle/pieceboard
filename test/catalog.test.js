import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { catalogReport } from '../src/catalog.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));

test('catalog provides compact searchable source references without image data', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-catalog-'));
  t.after(async () => { await fs.rm(path.join(root, 'ui-sheet.json'), { force: true }); await fs.rmdir(root); });
  const data = { format: 'ui-sheet/v1', name: 'Demo', items: [
    { id: 'button', name: 'Button', kind: 'components', subtype: 'Component', source: 'src/Button.jsx', definitions: [{ file: 'src/Button.jsx', line: 2 }], usages: Array.from({ length: 15 }, (_, i) => ({ file: `src/page${i}.jsx`, line: i + 1, detail: 'primary' })), preview: 'data:image/png;base64,SECRET' },
    { id: 'ink', name: '--ink', kind: 'colors', subtype: 'CSS custom property', source: 'src/colors.css', value: '#123456', definitions: [], usages: [] },
  ] };
  await fs.writeFile(path.join(root, 'ui-sheet.json'), JSON.stringify(data));
  const result = await catalogReport(root, { kind: 'components', search: 'button' });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].usageCount, 15);
  assert.equal(result.entries[0].usages.length, 10);
  assert.equal(result.entries[0].usagesTruncated, true);
  assert.equal(result.entries[0].previewAvailable, true);
  assert.equal(JSON.stringify(result).includes('data:image'), false);
  assert.equal((await catalogReport(root, { id: 'button' })).entries[0].usages.length, 15);
  const command = await exec(process.execPath, [cli, 'catalog', root, '--kind', 'colors', '--search', 'ink']);
  assert.equal(JSON.parse(command.stdout).entries[0].value, '#123456');
  await assert.rejects(catalogReport(root, { limit: 0 }), /between 1 and 200/);
});
