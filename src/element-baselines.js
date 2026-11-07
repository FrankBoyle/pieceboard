import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { elementBaselineId, ELEMENT_FINDING_IDENTITY, normalizeElementBaselineRule } from './element-consistency.js';
import { scopeIdentity } from './consistency.js';

export { elementBaselineId };
export const ELEMENT_BASELINE_FORMAT = 'ui-sheet/element-baselines-v2';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RULES = 1000;

async function readFile(file, allowMissing) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Element baseline file must be a regular file of at most 2 MB; symbolic links are not replaced.');
    const raw = await fs.readFile(file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Element baseline file must be at most 2 MB.');
    return raw;
  } catch (error) { if (allowMissing && error.code === 'ENOENT') return null; throw error; }
}

function parseFile(raw) {
  if (raw === null) return { format: ELEMENT_BASELINE_FORMAT, rules: [] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Element baseline file is not valid JSON; it was not changed.'); }
  if (parsed?.format === 'ui-sheet/element-baselines-v1') throw new Error('This element baseline predates opacity and filter measurements. Capture a fresh report and reapprove appearances in a new element baseline file.');
  if (parsed?.format !== ELEMENT_BASELINE_FORMAT || !Array.isArray(parsed.rules) || parsed.rules.length > MAX_RULES) throw new Error('Refusing to use an unsupported element baseline file. Keep older or button baseline files separate, capture a fresh report, and reapprove appearances in a new file.');
  const rules = parsed.rules.map(normalizeElementBaselineRule);
  if (rules.some((rule) => !rule) || new Set(rules.map((rule) => rule?.id)).size !== rules.length) throw new Error('Element baseline file contains an invalid or duplicate rule; it was not changed.');
  return { format: ELEMENT_BASELINE_FORMAT, rules };
}

/** Read current, bounded, explicitly approved element references. */
export async function readElementBaselines(file, { allowMissing = false } = {}) {
  return parseFile(await readFile(file, allowMissing));
}

/** Prepare an approval from an actual observation without inventing missing context. */
export function elementBaselineTemplate(page, observation, { crossPage = false } = {}) {
  if (page?.format !== 'ui-sheet/elements-v1' || page.findingIdentity !== ELEMENT_FINDING_IDENTITY) throw new Error('This report lacks current element measurements. Capture a fresh report before approving an appearance.');
  if (observation?.group?.familyEvidence !== 'configured group') throw new Error('An element baseline requires an explicitly configured group.');
  if (crossPage && observation.group.variantEvidence !== 'configured variant') throw new Error('A cross-page element baseline requires an explicitly configured variant.');
  const group = Object.fromEntries(['family', 'variant', 'type', 'tag', 'nativeType', 'state'].map((key) => [key, observation.group[key]]));
  const scope = { url: crossPage ? '*' : scopeIdentity(page.scope?.url), viewport: page.scope?.viewport, theme: page.scope?.theme, pixelRatio: page.scope?.pixelRatio };
  const candidate = { id: elementBaselineId(scope, group), scope, group, style: observation.style, reason: 'Approval pending.', ...(['likely', 'manual', 'instrumented'].includes(observation.source?.status) ? { source: observation.source } : {}) };
  const normalized = normalizeElementBaselineRule(candidate);
  if (!normalized) throw new Error('This appearance has incomplete scope, group, style or source evidence. Capture a fresh report before approving it.');
  const { reason, ...template } = normalized;
  return template;
}

function ensureDistinctScopes(pages) {
  const scopes = new Set();
  for (const page of pages) {
    const scope = page.scope || {};
    const identity = JSON.stringify([scopeIdentity(scope.url), scope.viewport?.width, scope.viewport?.height, scope.theme, scope.pixelRatio]);
    if (scopes.has(identity)) throw new Error('Cannot approve elements for duplicate route, viewport, theme and capture-density scopes. Query strings are excluded; use distinct routes.');
    scopes.add(identity);
  }
}

async function releaseLock(file, owner) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100 || await fs.readFile(file, 'utf8') !== owner) throw new Error('The element baseline lock changed; it was not removed.');
  await fs.unlink(file);
}

/** Merge one explicitly approved observation; never change a scanned application. */
export async function setElementBaseline(reportDir, { file, observationId, pageIndex = 1, crossPage = false, reason } = {}) {
  if (typeof file !== 'string' || !file || typeof observationId !== 'string' || !/^[a-z][a-z0-9-]{0,79}:\d+$/.test(observationId) || !Number.isSafeInteger(pageIndex) || pageIndex < 1 || typeof crossPage !== 'boolean') throw new Error('An element baseline requires a file, native-tag observation ID, optional positive page number, and boolean cross-page setting.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new Error('An approval reason of 1–500 characters is required.');
  const data = JSON.parse(await fs.readFile(path.join(path.resolve(reportDir), 'ui-sheet.json'), 'utf8'));
  const pages = data?.elementConsistency?.pages;
  if (data?.format !== 'ui-sheet/v1' || !Array.isArray(pages) || !pages.length) throw new Error('The report has no configured element consistency analysis.');
  ensureDistinctScopes(pages);
  const page = pages[pageIndex - 1];
  if (!page) throw new Error('Page is not present in the configured element report.');
  const matches = (page.observations || []).filter((entry) => entry.id === observationId);
  if (matches.length !== 1) throw new Error('Observation ID must identify exactly one configured element on the selected page.');
  const rule = { ...elementBaselineTemplate(page, matches[0], { crossPage }), reason: reason.trim(), recordedAt: new Date().toISOString() };
  const target = path.resolve(file);
  const lock = `${target}.ui-sheet.lock`;
  const owner = randomUUID();
  let lockHandle;
  try { lockHandle = await fs.open(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Element baseline file is being changed or a previous update was interrupted. Verify no update is running before removing its .ui-sheet.lock file.'); throw error; }
  try { await lockHandle.writeFile(owner); } finally { await lockHandle.close(); }
  const temporary = path.join(path.dirname(target), `.ui-sheet-element-baseline-${owner}.tmp`);
  try {
    const original = await readFile(target, true);
    const baseline = parseFile(original);
    const index = baseline.rules.findIndex((entry) => entry.id === rule.id);
    if (index < 0) baseline.rules.push(rule);
    else baseline.rules[index] = rule;
    if (baseline.rules.length > MAX_RULES) throw new Error('Element baseline file would exceed the 1,000-rule limit.');
    const serialized = JSON.stringify(baseline, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new Error('Element baseline file would exceed the 2 MB limit.');
    await fs.writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
    const current = await readFile(target, true);
    if (current !== original) throw new Error('Element baseline file changed during approval; it was not overwritten. Run the approval again after reviewing the file.');
    if (original === null) await fs.link(temporary, target); // An unrelated new file must never be replaced.
    else await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
    await releaseLock(lock, owner);
  }
  return { id: rule.id, file: target };
}
