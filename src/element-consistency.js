import { createHash } from 'node:crypto';
import { BUTTON_STYLE_FIELDS, decisionAnchorFor, decisionAnchorIdentity, normalizeButtonStyle, scopeIdentity } from './consistency.js';
import { validatePixelRatio, validateViewport } from './context.js';

export const ELEMENT_FINDING_IDENTITY = 'ui-sheet/element-finding-v2';
export const ELEMENT_TYPES = Object.freeze(['inputs', 'dropdowns', 'selectors', 'tabs', 'headers', 'sidebars', 'navigation', 'headings', 'text']);
export const MAX_ELEMENT_OBSERVATIONS = 5000;

const hint = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_. -]{0,79}$/i.test(value.trim()) ? value.trim().toLowerCase() : '';
const validState = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);

/** Scope approval to the exact configured group, observed state and rendering context. */
export function elementBaselineId(scope, group) {
  const identity = ['ui-sheet/element-baselines-v2', scopeIdentity(scope?.url), scope?.viewport?.width, scope?.viewport?.height, scope?.theme, scope?.pixelRatio, group?.family, group?.variant, group?.type, group?.tag, group?.nativeType, group?.state];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
}

function validBaselineScope(scope) {
  if (!scope || Array.isArray(scope) || typeof scope.url !== 'string' || !scope.url || scope.url.length > 2000 || typeof scope.theme !== 'string' || !scope.theme || scope.theme === 'unknown' || scope.theme.length > 120 || /[\x00-\x1f\x7f]/.test(scope.theme)) return false;
  try { validateViewport(scope.viewport); validatePixelRatio(scope.pixelRatio); } catch { return false; }
  if (scope.url === '*') return true;
  if (scope.url.startsWith('local:/')) return !/[?#\x00-\x20\x7f]/.test(scope.url) && !scope.url.includes('\\');
  try {
    const url = new URL(scope.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && scope.url === scopeIdentity(scope.url);
  } catch { return false; }
}

function baselineGroup(group) {
  if (!group || Array.isArray(group) || !['family', 'variant', 'nativeType'].every((key) => hint(group[key]) && hint(group[key]) === group[key]) || !ELEMENT_TYPES.includes(group.type) || typeof group.tag !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(group.tag) || !validState(group.state)) return null;
  return Object.fromEntries(['family', 'variant', 'type', 'tag', 'nativeType', 'state'].map((key) => [key, group[key]]));
}

function baselineSource(source) {
  if (!source || Array.isArray(source) || !['likely', 'manual', 'instrumented'].includes(source.status) || typeof source.file !== 'string' || !source.file || source.file.length > 500 || /[\\:\x00-\x1f\x7f]/.test(source.file) || source.file.split('/').some((part) => !part || part === '.' || part === '..') || !Number.isSafeInteger(source.line) || source.line < 1) return null;
  if (source.method !== undefined && (typeof source.method !== 'string' || source.method.length > 200 || /[\x00-\x1f\x7f]/.test(source.method))) return null;
  if (source.column !== undefined && (!Number.isSafeInteger(source.column) || source.column < 1)) return null;
  if (source.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(source.sha256)) return null;
  if (source.elementId !== undefined && !/^[a-z][a-z0-9_.:-]{0,99}$/i.test(source.elementId)) return null;
  if (source.status === 'instrumented' && (source.column === undefined || source.sha256 === undefined)) return null;
  return Object.fromEntries(['status', 'file', 'line', 'method', 'column', 'sha256', 'elementId'].filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

/** Shared semantic validation for loaded approvals and direct engine callers. */
export function normalizeElementBaselineRule(rule) {
  if (!rule || Array.isArray(rule) || !validBaselineScope(rule.scope) || typeof rule.reason !== 'string' || !rule.reason.trim() || rule.reason.length > 500) return null;
  const group = baselineGroup(rule.group);
  const style = normalizeButtonStyle(rule.style);
  if (!group || !style || rule.id !== elementBaselineId(rule.scope, group)) return null;
  if (rule.recordedAt !== undefined && (typeof rule.recordedAt !== 'string' || rule.recordedAt.length > 100 || !Number.isFinite(Date.parse(rule.recordedAt)))) return null;
  const source = rule.source === undefined ? undefined : baselineSource(rule.source);
  if (rule.source !== undefined && !source) return null;
  const scope = { url: rule.scope.url, viewport: { width: rule.scope.viewport.width, height: rule.scope.viewport.height }, theme: rule.scope.theme, pixelRatio: rule.scope.pixelRatio };
  return { id: rule.id, scope, group, style, reason: rule.reason.trim(), ...(rule.recordedAt !== undefined ? { recordedAt: rule.recordedAt } : {}), ...(source ? { source } : {}) };
}

function configuredGroup(element) {
  const config = element.configured;
  const family = hint(config.family);
  const variant = config.variant === undefined ? 'unspecified' : hint(config.variant);
  const nativeType = hint(element.nativeType || element.type || '') || 'unspecified';
  if (!family || !variant || !ELEMENT_TYPES.includes(config.type) || typeof element.tag !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(element.tag)) {
    throw new Error('Configured elements require a supported UI type, family, optional variant, and valid native tag.');
  }
  return { family, familyEvidence: 'configured group', variant, variantEvidence: config.variant === undefined ? 'unspecified' : 'configured variant', type: config.type, tag: element.tag, nativeType, state: element.state };
}

/** Compare explicitly grouped rendered UI elements without inferring their purpose from content. */
export function analyzeElementConsistency(elements, options = {}) {
  if (!Array.isArray(elements)) throw new Error('Configured element observations must be an array.');
  if (options.baselines !== undefined && (!Array.isArray(options.baselines) || options.baselines.length > 1000)) throw new Error('Configured element baselines must contain at most 1,000 valid element rules.');
  const baselines = (options.baselines || []).map(normalizeElementBaselineRule);
  if (baselines.some((rule) => !rule) || new Set(baselines.map((rule) => rule?.id)).size !== baselines.length) throw new Error('Configured element baselines contain an invalid or duplicate rule. Use a current element baseline file, not button baselines.');
  const viewport = validateViewport(options.viewport || { width: 1440, height: 900 });
  const pixelRatio = validatePixelRatio(options.pixelRatio ?? 2);
  const url = typeof options.url === 'string' ? options.url : '';
  const theme = typeof options.theme === 'string' && options.theme ? options.theme : 'unknown';
  const scope = { url, viewport, theme, pixelRatio, state: 'explicit groups separated by observed semantic state' };
  if (options.browser) scope.browser = { engine: options.browser.engine, version: options.browser.version };
  const counts = { seen: 0, eligible: 0, hidden: 0, possiblyBlocked: 0, visibilityUnverified: 0, missingStyle: 0, missingState: 0, omitted: 0, comparable: 0, undersampled: 0, tied: 0, ambiguous: 0, repeatedMinority: 0 };
  const observations = [];
  const groups = new Map();
  const ids = new Set();
  for (const element of elements) {
    if (!element?.configured) continue;
    counts.seen++;
    const group = configuredGroup(element);
    if (!Number.isSafeInteger(element.index) || element.index < 0) throw new Error('Configured elements require a nonnegative native-tag index.');
    const id = `${element.tag}:${element.index}`;
    if (ids.has(id)) throw new Error('Configured element observations contain a duplicate native-tag index.');
    ids.add(id);
    if (!element.visible) { counts.hidden++; continue; }
    if (element.visibilityEvidence === 'possibly-blocked') { counts.possiblyBlocked++; continue; }
    if (!validState(element.state)) { counts.missingState++; continue; }
    if (observations.length >= MAX_ELEMENT_OBSERVATIONS) { counts.omitted++; continue; }
    const style = normalizeButtonStyle(element.style);
    if (!style) { counts.missingStyle++; continue; }
    const visibilityEvidence = element.visibilityEvidence === 'clear' ? 'clear' : 'unverified';
    if (visibilityEvidence === 'unverified') counts.visibilityUnverified++;
    const observation = { id, group, style, visibilityEvidence, ...(element.source ? { source: element.source } : {}) };
    observations.push(observation);
    counts.eligible++;
    const groupKey = JSON.stringify([group.family, group.variant, group.type, group.tag, group.nativeType, group.state]);
    if (!groups.has(groupKey)) groups.set(groupKey, { group, styles: new Map(), count: 0 });
    const bucket = groups.get(groupKey);
    bucket.count++;
    const styleKey = JSON.stringify(style);
    if (!bucket.styles.has(styleKey)) bucket.styles.set(styleKey, { style, observations: [] });
    bucket.styles.get(styleKey).observations.push(observation);
  }

  const findings = [];
  const appearances = [];
  const baselinesUsed = [];
  for (const [groupKey, bucket] of groups) {
    const variants = [...bucket.styles.values()].sort((a, b) => b.observations.length - a.observations.length || a.observations[0].id.localeCompare(b.observations[0].id));
    for (const variant of variants) {
      const first = variant.observations[0];
      appearances.push({ group: bucket.group, count: variant.observations.length, example: first.id, style: variant.style, source: first.source || { status: 'unresolved' } });
    }
    const approved = baselines.find((rule) => rule.id === elementBaselineId(scope, bucket.group)) || baselines.find((rule) => rule.id === elementBaselineId({ ...scope, url: '*' }, bucket.group));
    let common;
    let candidates;
    if (approved) {
      const observed = variants.find((variant) => JSON.stringify(variant.style) === JSON.stringify(approved.style));
      common = { style: approved.style, observations: observed?.observations || [] };
      candidates = variants.filter((variant) => JSON.stringify(variant.style) !== JSON.stringify(approved.style));
      baselinesUsed.push(approved.id);
    } else {
      common = variants[0];
      if (bucket.count < 3 || common.observations.length < 2) { counts.undersampled += bucket.count; continue; }
      if (variants.length > 1 && common.observations.length === variants[1].observations.length) { counts.tied += bucket.count; continue; }
      if (common.observations.length <= bucket.count / 2) { counts.ambiguous += bucket.count; continue; }
      candidates = variants.slice(1);
    }
    counts.comparable += bucket.count;
    for (const candidate of candidates) {
      // A minority may be repeated and still differ from the group's majority.
      // Report it as a suggestion; repeated instances cannot use singleton anchors.
      if (!approved && candidate.observations.length > 1) counts.repeatedMinority += candidate.observations.length;
      const differences = BUTTON_STYLE_FIELDS.flatMap(([property, label]) => common.style[property] === candidate.style[property] ? [] : [{ property, label, common: common.style[property], observed: candidate.style[property] }]);
      if (!differences.length) continue;
      const outlier = candidate.observations[0];
      const anchor = decisionAnchorFor(outlier.source, candidate.observations.length);
      const identity = [ELEMENT_FINDING_IDENTITY, scopeIdentity(url), viewport.width, viewport.height, theme, pixelRatio, scope.browser || null, groupKey, approved?.id || null, common.style, candidate.style, decisionAnchorIdentity(anchor) || outlier.id];
      const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
      findings.push({ id, kind: 'configured-element-style-outlier', status: 'possible difference', evidence: approved ? 'approved element baseline' : bucket.count < 5 ? 'small configured sample' : 'configured group frequency', reference: approved ? 'approved' : 'inferred', group: bucket.group, total: bucket.count, common: { count: common.observations.length, example: common.observations[0]?.id || null, ...(approved ? { style: common.style, ...(approved.source ? { source: approved.source } : {}) } : {}) }, outlier: { count: candidate.observations.length, example: outlier.id }, differences, ...(anchor ? { decisionAnchor: anchor } : {}) });
    }
  }
  appearances.sort((a, b) => b.count - a.count || a.example.localeCompare(b.example));
  const incomplete = counts.possiblyBlocked || counts.visibilityUnverified || counts.missingStyle || counts.missingState || counts.omitted || counts.undersampled || counts.tied || counts.ambiguous || !url || theme === 'unknown';
  const coverage = counts.comparable === 0 ? 'insufficient' : incomplete ? 'partial' : 'observed';
  return { format: 'ui-sheet/elements-v1', findingIdentity: ELEMENT_FINDING_IDENTITY, scope, counts, observations, findings, appearances, baselinesUsed, coverage };
}
