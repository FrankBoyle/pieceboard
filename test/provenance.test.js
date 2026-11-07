import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectSourceRevision } from '../src/provenance.js';

const exec = promisify(execFile);

test('records a commit and dirty state without exposing changed paths', async () => {
  const commands = [];
  const runGit = async (command, args) => {
    commands.push([command, ...args]);
    if (args.includes('ls-files')) return { stdout: 'src/Tracked.jsx\0' };
    return { stdout: args.includes('rev-parse') ? `${'a'.repeat(40)}\n` : ' M private/path.jsx\n' };
  };
  const result = await inspectSourceRevision('.', { runGit, sourcePaths: ['src/Tracked.jsx', 'src/Ignored.jsx'] });
  assert.equal(result.commit, 'a'.repeat(40));
  assert.equal(result.dirty, true);
  assert.equal(result.trackedSourceFiles, 1);
  assert.equal(result.scannedSourceFiles, 2);
  assert.equal(JSON.stringify(result).includes('private/path'), false);
  assert.equal(commands.length, 3);
});

test('reports unavailable Git context honestly and preserves a commit if status fails', async () => {
  assert.equal(await inspectSourceRevision('.', { sourcePaths: ['index.html'], runGit: async () => { throw new Error('not a repository'); } }), null);
  const unknown = await inspectSourceRevision('.', { runGit: async (_command, args) => {
    if (args.includes('status')) throw new Error('status unavailable');
    if (args.includes('ls-files')) return { stdout: 'index.html\0' };
    return { stdout: `${'b'.repeat(40)}\n` };
  }, sourcePaths: ['index.html'] });
  assert.equal(unknown.dirty, null);
  assert.equal(unknown.commit, 'b'.repeat(40));
});

test('does not attribute ignored source to an enclosing Git checkout', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-git-context-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    const temp = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('ui-sheet-git-context-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'ignored-project'));
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored-project/\nsrc/ignored.html\n');
  await fs.writeFile(path.join(root, 'src', 'tracked.html'), '<button>Save</button>');
  await fs.writeFile(path.join(root, 'src', 'ignored.html'), '<button>Ignored</button>');
  await fs.writeFile(path.join(root, 'src', 'untracked.html'), '<button>New</button>');
  await fs.writeFile(path.join(root, 'ignored-project', 'index.html'), '<button>Outside source</button>');
  await exec('git', ['init', '-q', root]);
  await exec('git', ['-C', root, 'add', '.gitignore', 'src/tracked.html']);
  await exec('git', ['-C', root, '-c', 'user.name=UI Sheet Test', '-c', 'user.email=ui-sheet@example.invalid', 'commit', '-qm', 'Fixture']);
  const context = await inspectSourceRevision(root, { sourcePaths: ['src/tracked.html', 'src/ignored.html', 'src/untracked.html'] });
  assert.equal(context.trackedSourceFiles, 1);
  assert.equal(context.scannedSourceFiles, 3);
  assert.equal(context.dirty, true);
  assert.equal(JSON.stringify(context).includes('tracked.html'), false);
  assert.equal(await inspectSourceRevision(path.join(root, 'ignored-project'), { sourcePaths: ['index.html'] }), null);
});
