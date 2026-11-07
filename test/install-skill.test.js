import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installSkill } from '../src/install-skill.js';

test('installs project skills for both agents without overwriting edits', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-skill-'));
  t.after(async () => {
    const removeEmpty = async (directory) => { try { await fs.rmdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
    for (const prefix of ['.agents', '.claude']) {
      await fs.rm(path.join(root, prefix, 'skills', 'ui-consistency', 'SKILL.md'), { force: true });
      await removeEmpty(path.join(root, prefix, 'skills', 'ui-consistency'));
      await removeEmpty(path.join(root, prefix, 'skills'));
      await removeEmpty(path.join(root, prefix));
    }
    await fs.rmdir(root);
  });
  const codex = await installSkill(root, 'codex');
  assert.equal(codex.installed, true);
  assert.match(await fs.readFile(codex.path, 'utf8'), /name: ui-consistency/);
  assert.equal((await installSkill(root, 'codex')).installed, false);
  const claude = await installSkill(root, 'claude');
  assert.equal(claude.installed, true);
  assert.equal(await fs.readFile(codex.path, 'utf8'), await fs.readFile(claude.path, 'utf8'));
  await fs.writeFile(codex.path, 'My customized skill');
  await assert.rejects(installSkill(root, 'codex'), /Refusing to overwrite/);
  assert.equal(await fs.readFile(codex.path, 'utf8'), 'My customized skill');
  await assert.rejects(installSkill(root, 'unknown'), /codex or claude/);
});
