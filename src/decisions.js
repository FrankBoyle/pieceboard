import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeReport } from './report.js';

const FORMAT = 'ui-sheet/decisions-v1';
const STATUSES = new Set(['intentional', 'needs-fix', 'deferred', 'false-positive']);

function findingsOf(data) {
  return [...(data.consistency ? data.consistency.pages || [data.consistency] : []).flatMap((page) => page.findings || []), ...(data.crossPageConsistency?.findings || []), ...(data.elementConsistency?.pages || []).flatMap((page) => page.findings || [])];
}

async function readDecisions(file, { allowMissing = false } = {}) {
  let contents;
  try { contents = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT' && allowMissing) return { format: FORMAT, decisions: [] }; throw error; }
  let data;
  try { data = JSON.parse(contents); } catch { throw new Error('Decision file is not valid JSON.'); }
  if (data?.format !== FORMAT || !Array.isArray(data.decisions)) throw new Error('Refusing to use a file that is not a Pieceboard decision file.');
  const ids = new Set();
  for (const entry of data.decisions) {
    if (!entry || !/^[a-f0-9]{16}$/.test(entry.findingId) || !STATUSES.has(entry.status) || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 500 || ids.has(entry.findingId)) throw new Error('Decision file contains an invalid or duplicate entry.');
    ids.add(entry.findingId);
  }
  return data;
}

/** Apply only exact, source-anchored decisions; stale entries remain visible. */
export async function applyDecisions(data, file) {
  const decisions = await readDecisions(path.resolve(file));
  const findings = findingsOf(data);
  const byId = new Map(decisions.decisions.map((entry) => [entry.findingId, entry]));
  const occurrences = new Map();
  for (const finding of findings) occurrences.set(finding.id, (occurrences.get(finding.id) || 0) + 1);
  const appliedIds = new Set();
  for (const finding of findings) {
    delete finding.review;
    const decision = byId.get(finding.id);
    if (!decision || !finding.decisionAnchor || occurrences.get(finding.id) !== 1) continue;
    finding.review = { status: decision.status, reason: decision.reason, recordedAt: decision.recordedAt || '' };
    appliedIds.add(finding.id);
  }
  data.decisionSummary = { applied: appliedIds.size, stale: decisions.decisions.length - appliedIds.size };
  return data.decisionSummary;
}

/** Record a narrowly scoped review decision and update the generated report. */
export async function setDecision(reportDir, { file, findingId, status, reason }) {
  if (!file || !/^[a-f0-9]{16}$/.test(findingId || '')) throw new Error('A decision file and 16-character finding ID are required.');
  if (!STATUSES.has(status)) throw new Error('Status must be intentional, needs-fix, deferred, or false-positive.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new Error('A reason of 1–500 characters is required.');
  const directory = path.resolve(reportDir);
  const data = JSON.parse(await fs.readFile(path.join(directory, 'ui-sheet.json'), 'utf8'));
  if (data.format !== 'ui-sheet/v1' || !Array.isArray(data.items)) throw new Error('The output directory does not contain a Pieceboard report.');
  const matches = findingsOf(data).filter((finding) => finding.id === findingId);
  if (matches.length !== 1) throw new Error('Finding ID must identify exactly one finding in the report.');
  if (!matches[0].decisionAnchor) throw new Error('This finding has no source anchor; it cannot yet receive a persistent decision.');
  const target = path.resolve(file);
  const decisions = await readDecisions(target, { allowMissing: true });
  const entry = { findingId, status, reason: reason.trim(), recordedAt: new Date().toISOString() };
  const index = decisions.decisions.findIndex((decision) => decision.findingId === findingId);
  if (index < 0) decisions.decisions.push(entry);
  else decisions.decisions[index] = entry;
  const temporary = path.join(path.dirname(target), `.ui-sheet-decision-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(decisions, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  await applyDecisions(data, target);
  await writeReport(data, directory);
  return { findingId, status, file: target };
}
