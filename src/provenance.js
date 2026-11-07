import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

/** Record enclosing Git context only when it tracks some scanned source. */
export async function inspectSourceRevision(root, { runGit = run, sourcePaths = [] } = {}) {
  if (!sourcePaths.length) return null;
  const prefix = ['-C', path.resolve(root), '-c', 'core.fsmonitor=false'];
  const options = { timeout: 4000, maxBuffer: 1024 * 1024, windowsHide: true };
  let trackedFiles;
  try {
    const result = await runGit('git', [...prefix, 'ls-files', '-z', '--', '.'], { ...options, maxBuffer: 8 * 1024 * 1024 });
    const key = (value) => process.platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value.replaceAll('\\', '/');
    const tracked = new Set(result.stdout.split('\0').filter(Boolean).map(key));
    trackedFiles = sourcePaths.reduce((count, file) => count + Number(tracked.has(key(file))), 0);
    if (!trackedFiles) return null;
  } catch { return null; }
  let commit;
  try {
    const result = await runGit('git', [...prefix, 'rev-parse', '--verify', 'HEAD'], options);
    commit = result.stdout.trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)) return null;
  } catch { return null; }
  let dirty = null;
  try {
    const result = await runGit('git', [...prefix, 'status', '--porcelain=v1', '--untracked-files=normal'], options);
    dirty = result.stdout.length > 0;
  } catch { /* A valid commit can still be reported when status is unavailable. */ }
  return { kind: 'git', commit: commit.toLowerCase(), dirty, trackedSourceFiles: trackedFiles, scannedSourceFiles: sourcePaths.length, recordedAt: new Date().toISOString() };
}
