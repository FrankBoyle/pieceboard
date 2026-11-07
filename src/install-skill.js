import fs from 'node:fs/promises';
import path from 'node:path';

/** Install the bundled skill in a project without overwriting existing work. */
export async function installSkill(projectDir, agent) {
  if (!['codex', 'claude'].includes(agent)) throw new Error('Agent must be codex or claude.');
  const root = await fs.realpath(path.resolve(projectDir));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Project path must be a directory.');
  const source = await fs.readFile(new URL('../skills/ui-consistency/SKILL.md', import.meta.url), 'utf8');
  let directory = root;
  for (const part of [agent === 'codex' ? '.agents' : '.claude', 'skills', 'ui-consistency']) {
    directory = path.join(directory, part);
    let stat;
    try { stat = await fs.lstat(directory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(directory);
      stat = await fs.lstat(directory);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Skill path must be a directory without symlinks: ${directory}`);
  }
  const destination = path.join(directory, 'SKILL.md');
  try {
    const stat = await fs.lstat(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing to overwrite the existing skill: ${destination}`);
    if (await fs.readFile(destination, 'utf8') === source) return { path: destination, installed: false };
    throw new Error(`Refusing to overwrite the existing skill: ${destination}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.writeFile(destination, source, { flag: 'wx' });
  return { path: destination, installed: true };
}
