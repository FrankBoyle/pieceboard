import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { baselineRuleId, normalizeButtonStyle, scopeIdentity } from './consistency.js';

const FORMAT = 'ui-sheet/baselines-v4';
const MAX_BYTES = 2 * 1024 * 1024;

function validScopeUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) return false;
  if (value === '*') return true;
  if (value.startsWith('local:/')) return !/[?#]/.test(value);
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && value === scopeIdentity(value);
  } catch { return false; }
}

function validScope(scope) {
  return validScopeUrl(scope?.url) && Number.isInteger(scope.viewport?.width) && scope.viewport.width > 0 && scope.viewport.width <= 8192 && Number.isInteger(scope.viewport?.height) && scope.viewport.height > 0 && scope.viewport.height <= 8192 && typeof scope.theme === 'string' && scope.theme.length > 0 && scope.theme.length <= 120 && (scope.pixelRatio === undefined || (Number.isInteger(scope.pixelRatio) && scope.pixelRatio >= 1 && scope.pixelRatio <= 4));
}

function validGroup(group) {
  return group && ['family', 'variant', 'type'].every((key) => typeof group[key] === 'string' && group[key].length > 0 && group[key].length <= 200);
}

export function ensureDistinctBaselineScopes(pages) {
  const scopes = new Set();
  for (const page of pages) {
    const scope = page.scope || {};
    const key = JSON.stringify([scopeIdentity(scope.url), scope.viewport?.width, scope.viewport?.height, scope.theme, scope.pixelRatio ?? 2]);
    if (scopes.has(key)) throw new Error('Cannot use baselines for pages with the same route, viewport, and theme. Query strings are excluded from report identities; use distinct routes.');
    scopes.add(key);
  }
}

export async function readBaselines(file, { allowMissing = false } = {}) {
  let raw;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Baseline file must be at most 2 MB.');
    raw = await fs.readFile(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT' && allowMissing) return { format: FORMAT, rules: [] }; throw error; }
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Baseline file is not valid JSON.'); }
  if (data?.format === 'ui-sheet/baselines-v1') throw new Error('This baseline predates four-sided border measurements. Capture a fresh report and reapprove appearances in a new baseline file.');
  if (data?.format === 'ui-sheet/baselines-v2') throw new Error('This baseline predates gradient and text-style measurements. Capture a fresh report and reapprove appearances in a new baseline file.');
  if (data?.format === 'ui-sheet/baselines-v3') throw new Error('This baseline predates opacity and filter measurements. Capture a fresh report and reapprove appearances in a new baseline file.');
  if (data?.format !== FORMAT || !Array.isArray(data.rules) || data.rules.length > 1000) throw new Error('Refusing to use a file that is not a Pieceboard baseline file.');
  const ids = new Set();
  for (const rule of data.rules) {
    const scope = rule?.scope;
    const group = rule?.group;
    if (!validScope(scope) || !validGroup(group) || !normalizeButtonStyle(rule.style) || typeof rule.reason !== 'string' || !rule.reason.trim() || rule.reason.length > 500 || rule.id !== baselineRuleId(scope, group) || ids.has(rule.id)) throw new Error('Baseline file contains an invalid or duplicate rule.');
    ids.add(rule.id);
  }
  return data;
}

/** Prepare a rule from a real observed appearance; a person supplies the reason. */
export function baselineTemplate(page, observation, { crossPage = false, group = observation?.group } = {}) {
  if (!['page-provided group', 'configured group', 'component class'].includes(group?.familyEvidence)) throw new Error('Approve a stable explicit group or component class before creating a baseline.');
  if (crossPage && (!['page-provided group', 'configured group'].includes(group?.familyEvidence) || !['page-provided variant', 'configured variant'].includes(group?.variantEvidence))) throw new Error('A cross-page baseline requires an explicitly named group and variant.');
  if (!page.scope?.theme || page.scope.theme === 'unknown') throw new Error('This report has no theme context. Capture the page again before creating a baseline.');
  if (!observation?.group || !['family', 'variant', 'type'].every((key) => observation.group[key] === group[key])) throw new Error('The selected appearance does not belong to this group. Capture the page again before creating a baseline.');
  const style = normalizeButtonStyle(observation?.style);
  if (!style) throw new Error('The selected appearance lacks current measurements. Capture a fresh report before approving it.');
  const scope = { url: crossPage ? '*' : scopeIdentity(page.scope.url), viewport: page.scope.viewport, theme: page.scope.theme, pixelRatio: page.scope.pixelRatio ?? 2 };
  const baselineGroup = { family: group.family, variant: group.variant, type: group.type };
  if (!validScope(scope) || !validGroup(baselineGroup)) throw new Error('This report has incomplete scope or group context. Capture the page again before creating a baseline.');
  return { id: baselineRuleId(scope, baselineGroup), scope, group: baselineGroup, style, ...(['likely', 'manual', 'instrumented'].includes(observation.source?.status) ? { source: observation.source } : {}) };
}

/** Approve one observed appearance for the specific page, viewport and theme. */
export async function setBaseline(reportDir, { file, findingId, example, observationId, pageIndex, reason, crossPage = false }) {
  const fromFinding = Boolean(findingId);
  const fromObservation = Boolean(observationId);
  if (!file || fromFinding === fromObservation) throw new Error('A baseline file and either a finding ID or observation ID are required.');
  if (crossPage && !fromObservation) throw new Error('A cross-page baseline must be selected from an observed button.');
  if (fromFinding && (!/^[a-f0-9]{16}$/.test(findingId) || !['common', 'outlier'].includes(example) || pageIndex !== undefined)) throw new Error('A finding requires a 16-character ID and example common or outlier.');
  if (fromObservation && (!/^button:\d+$/.test(observationId) || example !== undefined || (pageIndex !== undefined && (!Number.isInteger(pageIndex) || pageIndex < 1)))) throw new Error('An observation requires a button ID and optional positive page number.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new Error('A reason of 1–500 characters is required.');
  const data = JSON.parse(await fs.readFile(path.join(path.resolve(reportDir), 'ui-sheet.json'), 'utf8'));
  if (data.format !== 'ui-sheet/v1' || !data.consistency) throw new Error('The report has no button consistency analysis.');
  const pages = data.consistency.pages || [data.consistency];
  ensureDistinctBaselineScopes(pages);
  let page;
  let group;
  let observation;
  if (fromFinding) {
    const matches = pages.flatMap((candidate) => (candidate.findings || []).filter((finding) => finding.id === findingId).map((finding) => ({ page: candidate, finding })));
    if (matches.length !== 1) throw new Error('Finding ID must identify exactly one finding in the report.');
    page = matches[0].page;
    group = matches[0].finding.group;
    observation = (page.observations || []).find((entry) => entry.id === matches[0].finding[example]?.example);
  } else {
    if (pages.length > 1 && pageIndex === undefined) throw new Error('Specify --page for a report containing multiple pages.');
    page = pages[(pageIndex || 1) - 1];
    if (!page) throw new Error('Page is not present in the report.');
    const matches = (page.observations || []).filter((entry) => entry.id === observationId);
    if (matches.length !== 1) throw new Error('Observation ID must identify exactly one button on the selected page.');
    observation = matches[0];
    group = observation.group;
  }
  const rule = { ...baselineTemplate(page, observation, { crossPage, group }), reason: reason.trim(), recordedAt: new Date().toISOString() };
  const target = path.resolve(file);
  const dataFile = await readBaselines(target, { allowMissing: true });
  const index = dataFile.rules.findIndex((entry) => entry.id === rule.id);
  if (index < 0) dataFile.rules.push(rule);
  else dataFile.rules[index] = rule;
  const serialized = JSON.stringify(dataFile, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new Error('Baseline file would exceed the 2 MB limit.');
  const temporary = path.join(path.dirname(target), `.ui-sheet-baseline-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { id: rule.id, file: target };
}
