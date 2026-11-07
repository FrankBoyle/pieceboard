import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from '@babel/parser';
import { uiSheetSource } from '../vite.js';

test('Vite source markers are limited to unchanged local JSX controls in development', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-vite-source-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-vite-source-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const file = path.join(root, 'App.tsx');
  const source = 'const X = () => <><button>Save</button><input /><p>Page copy</p><Widget /></>;';
  await fs.writeFile(file, source);
  const plugin = uiSheetSource({ projectRoot: root });
  assert.equal(plugin.apply, 'serve');
  assert.equal(plugin.enforce, 'pre');
  assert.equal(await plugin.transform(source, file), null, 'the transform is disabled before a dev configuration');
  await plugin.configResolved({ command: 'serve', root });
  const result = await plugin.transform(source, file);
  assert.ok(result?.map);
  assert.equal((result.code.match(/data-ui-sheet-source=/g) || []).length, 2);
  assert.doesNotThrow(() => parse(result.code, { sourceType: 'module', plugins: ['jsx', 'typescript'] }));
  assert.equal(await plugin.transform(`${source} `, file), null, 'already-transformed code is not attributed to the disk file');
  assert.equal(await plugin.transform(source, `${file}?raw`), null);
  await plugin.configResolved({ command: 'build', root });
  assert.equal(await plugin.transform(source, file), null, 'production builds are not instrumented');
  assert.throws(() => uiSheetSource({ projectRoot: 'relative' }), /absolute path/);
});
