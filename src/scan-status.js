import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FORMAT = 'ui-sheet/scan-status-v1';
const STATUS = '.ui-sheet-scan.json';
const LOCK = '.ui-sheet-scan.lock';
const PHASES = ['observe', 'capture'];

function validPageProgress(progress, status) {
  if (!progress || Array.isArray(progress) || typeof progress !== 'object' || !['active,captured,failed,observed,requested', 'active,captured,failed,observed,requested,skipped'].includes(Object.keys(progress).sort().join(','))) return false;
  if (!Number.isSafeInteger(progress.requested) || progress.requested < 0 || progress.requested > 500) return false;
  if (Object.hasOwn(progress, 'skipped') && !Array.isArray(progress.skipped)) return false;
  const validIndex = (index) => Number.isSafeInteger(index) && index >= 1 && index <= progress.requested;
  for (const phase of ['observed', 'captured', ...(progress.skipped ? ['skipped'] : [])]) {
    if (!Array.isArray(progress[phase]) || progress[phase].length > progress.requested || progress[phase].some((index, offset, indexes) => !validIndex(index) || (offset > 0 && indexes[offset - 1] >= index))) return false;
  }
  if (progress.skipped?.some((index) => progress.captured.includes(index))) return false;
  for (const key of ['active', 'failed']) {
    const page = progress[key];
    if (page === null) continue;
    if (!page || Array.isArray(page) || typeof page !== 'object' || Object.keys(page).sort().join(',') !== 'index,phase' || !validIndex(page.index) || !PHASES.includes(page.phase)) return false;
    if (progress[page.phase === 'observe' ? 'observed' : 'captured'].includes(page.index) || progress.skipped?.includes(page.index)) return false;
  }
  if (progress.active && progress.failed) return false;
  if (status === 'completed' && (progress.active || progress.failed)) return false;
  if (status === 'completed' && new Set([...progress.observed, ...progress.captured, ...(progress.skipped || [])]).size !== progress.requested) return false;
  if (status === 'in-progress' && progress.failed) return false;
  if (status === 'failed' && progress.active) return false;
  return true;
}

async function readMarker(directory) {
  const file = path.join(directory, STATUS);
  let stat;
  try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('The scan status file is invalid; it was not changed.');
  let marker;
  try { marker = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new Error('The scan status file is invalid; it was not changed.'); }
  if (marker?.format !== FORMAT || !['in-progress', 'failed', 'completed'].includes(marker.status) || typeof marker.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(marker.runId)) throw new Error('The scan status file is invalid; it was not changed.');
  if (marker.pageProgress !== undefined && !validPageProgress(marker.pageProgress, marker.status)) throw new Error('The scan status file has invalid page progress; it was not changed.');
  return marker;
}

async function ensureUnlocked(directory) {
  try { await fs.lstat(path.join(directory, LOCK)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('A scan is in progress or was interrupted for this report. After verifying no scan is running, remove .ui-sheet-scan.lock and run the scan again.');
}

const transientWindowsRenameCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function markerBytes(file) {
  let stat;
  try { stat = await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('The scan status file is invalid; it was not changed.');
  return fs.readFile(file, 'utf8');
}

async function markerBytesAfterContention(file, platform, delay) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return await markerBytes(file); }
    catch (error) {
      if (platform !== 'win32' || !transientWindowsRenameCodes.has(error.code) || attempt === 6) throw error;
      await delay(25 * attempt);
    }
  }
}

/** Windows readers can briefly deny a replacement rename; keep the old marker intact while retrying. */
export async function writeMarker(directory, marker, { rename = fs.rename, platform = process.platform, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const target = path.join(directory, STATUS);
  const previous = await markerBytes(target);
  const temporary = path.join(directory, `.ui-sheet-status-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(marker) + '\n'); }
    finally { await handle.close(); }
    for (let attempt = 1; attempt <= 6; attempt++) {
      try { await rename(temporary, target); break; }
      catch (error) {
        if (platform !== 'win32' || !transientWindowsRenameCodes.has(error.code) || attempt === 6) throw error;
        await delay(25 * attempt);
        const current = await markerBytesAfterContention(target, platform, delay);
        if (current !== previous) throw new Error('The scan status changed during the run; it was not overwritten.');
      }
    }
  } finally { if (handle) await fs.rm(temporary, { force: true }); }
}

async function assertOwnedLock(file, runId) {
  let stat;
  try { stat = await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('The scan lock changed during the run; it was not removed.'); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('The scan lock changed during the run; it was not removed.');
  let marker;
  try { marker = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new Error('The scan lock changed during the run; it was not removed.'); }
  if (marker?.format !== FORMAT || marker.runId !== runId || Object.keys(marker).sort().join(',') !== 'format,runId') throw new Error('The scan lock changed during the run; it was not removed.');
}

async function releaseOwnedLock(file, runId) {
  await assertOwnedLock(file, runId);
  await fs.unlink(file);
}

/** Mark a CLI scan before work begins; concurrent or interrupted runs fail closed. */
export async function beginReportScan(outputDir) {
  const directory = path.resolve(outputDir);
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, LOCK);
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A scan is in progress or was interrupted for this report. After verifying no scan is running, remove .ui-sheet-scan.lock and run the scan again.');
    throw error;
  }
  const runId = randomUUID();
  try { await handle.writeFile(JSON.stringify({ format: FORMAT, runId }) + '\n'); }
  finally { await handle.close(); }
  try { await readMarker(directory); }
  catch (error) { await releaseOwnedLock(lock, runId); throw error; }
  // If writing the marker fails, keep the lock so a check cannot trust an old report.
  await assertOwnedLock(lock, runId);
  let state = { format: FORMAT, status: 'in-progress', runId };
  await writeMarker(directory, state);
  let finished = false;
  let updating = false;
  async function update(transition) {
    if (finished) throw new Error('This scan has already finished.');
    if (updating) throw new Error('A scan progress update is already in progress; await each update before continuing.');
    updating = true;
    try {
      const current = await readMarker(directory);
      if (current?.runId !== runId || current.status !== 'in-progress' || JSON.stringify(current) !== JSON.stringify(state)) throw new Error('The scan status changed during the run; it was not overwritten.');
      await assertOwnedLock(lock, runId);
      const next = transition(structuredClone(current));
      await writeMarker(directory, next);
      state = next;
    } finally { updating = false; }
  }
  function page(progress, index, phase) {
    if (!progress) throw new Error('Plan the scan pages before recording page progress.');
    if (!Number.isSafeInteger(index) || index < 1 || index > progress.requested || !PHASES.includes(phase)) throw new Error('Page progress requires a planned page index and an observe or capture phase.');
    return { index, phase };
  }
  return {
    runId,
    async planPages(count) {
      await update((current) => {
        if (!Number.isSafeInteger(count) || count < 0 || count > 500) throw new Error('Page count must be an integer from 0 to 500.');
        if (current.pageProgress) throw new Error('The scan pages have already been planned.');
        current.pageProgress = { requested: count, observed: [], captured: [], active: null, failed: null };
        return current;
      });
    },
    async startPage(index, phase) {
      await update((current) => {
        const progress = current.pageProgress;
        const active = page(progress, index, phase);
        if (progress.active) throw new Error('Complete the active page phase before starting another.');
        if (progress[phase === 'observe' ? 'observed' : 'captured'].includes(index) || progress.skipped?.includes(index)) throw new Error('This page phase has already completed.');
        progress.active = active;
        return current;
      });
    },
    async completePage(index, phase) {
      await update((current) => {
        const progress = current.pageProgress;
        page(progress, index, phase);
        if (progress.active?.index !== index || progress.active?.phase !== phase) throw new Error('Page completion must match the active page and phase.');
        progress[phase === 'observe' ? 'observed' : 'captured'].push(index);
        progress[phase === 'observe' ? 'observed' : 'captured'].sort((a, b) => a - b);
        progress.active = null;
        return current;
      });
    },
    async skipPage(index, phase) {
      await update((current) => {
        const progress = current.pageProgress;
        page(progress, index, phase);
        if (progress.active?.index !== index || progress.active?.phase !== phase) throw new Error('A skipped page must match the active page and phase.');
        if (progress.captured.includes(index) || progress.skipped?.includes(index)) throw new Error('This page has already been captured or skipped.');
        progress.skipped = [...(progress.skipped || []), index].sort((a, b) => a - b);
        progress.active = null;
        return current;
      });
    },
    getPageProgress() {
      return state.pageProgress ? structuredClone(state.pageProgress) : null;
    },
    async finish(status) {
      if (finished) return;
      if (!['completed', 'failed'].includes(status)) throw new Error('Invalid scan completion status.');
      await update((current) => {
        if (status === 'completed' && current.pageProgress?.active) throw new Error('Complete the active page phase before completing the scan.');
        if (status === 'completed' && current.pageProgress && new Set([...current.pageProgress.observed, ...current.pageProgress.captured, ...(current.pageProgress.skipped || [])]).size !== current.pageProgress.requested) throw new Error('The scan has unvisited pages. Complete at least one observe or capture phase for every planned page before completing the scan.');
        if (status === 'failed' && current.pageProgress) {
          current.pageProgress.failed = current.pageProgress.active;
          current.pageProgress.active = null;
        }
        current.status = status;
        return current;
      });
      await releaseOwnedLock(lock, runId);
      finished = true;
    },
  };
}

function incompleteMessage(marker) {
  const page = marker.pageProgress?.failed || marker.pageProgress?.active;
  const context = page ? ` The ${page.phase} phase did not complete at page ${page.index} of ${marker.pageProgress.requested}.` : '';
  return `The most recent scan did not complete.${context} Run the scan again before checking this report.`;
}

/** Read a report only when its last tracked scan completed successfully. */
export async function readCheckedReport(reportDir) {
  const directory = path.resolve(reportDir);
  await ensureUnlocked(directory);
  const before = await readMarker(directory);
  if (before && before.status !== 'completed') throw new Error(incompleteMessage(before));
  const data = JSON.parse(await fs.readFile(path.join(directory, 'ui-sheet.json'), 'utf8'));
  const after = await readMarker(directory);
  await ensureUnlocked(directory);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('The report changed during this check. Run the check again.');
  if (after && after.status !== 'completed') throw new Error(incompleteMessage(after));
  if (after && after.runId !== data.scanRunId) throw new Error('The report and scan status do not match. Run the scan again before checking this report.');
  return { data, scanStatus: after ? 'completed' : 'unverified', ...(after?.pageProgress ? { pageProgress: structuredClone(after.pageProgress) } : {}) };
}
