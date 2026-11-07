import { BUTTON_STYLE_FIELDS, normalizeButtonStyle } from './consistency.js';
import { ELEMENT_FINDING_IDENTITY, ELEMENT_TYPES } from './element-consistency.js';
import { validateCaptureActions, validatePixelRatio, validateViewport } from './context.js';
import { readCheckedReport } from './scan-status.js';

const unsupported = () => new Error('Finding observations are incomplete or unsupported. Regenerate a current captured report.');
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value) && !/data:image\//i.test(value);
const sourceStatuses = new Set(['likely', 'manual', 'instrumented', 'unresolved']);
const styleFields = new Set(BUTTON_STYLE_FIELDS.map(([key]) => key));

function argumentsOf({ findingId, side = 'outlier', limit = 100 } = {}) {
  if (typeof findingId !== 'string' || !/^[a-f0-9]{16}$/.test(findingId)) throw new Error('A 16-character hexadecimal finding ID is required.');
  if (!['common', 'outlier'].includes(side)) throw new Error('Finding side must be common or outlier.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Limit must be an integer between 1 and 200.');
  return { findingId, side, limit };
}

function sourceOf(source) {
  if (source === undefined) return { status: 'unresolved' };
  if (!source || Array.isArray(source) || !sourceStatuses.has(source.status)) throw unsupported();
  const result = { status: source.status };
  if (source.method !== undefined) {
    if (!text(source.method, 200)) throw unsupported();
    result.method = source.method;
  }
  if (source.status === 'unresolved') return result;
  if (!text(source.file, 500) || /[\\:]/.test(source.file) || source.file.split('/').some((part) => !part || part === '.' || part === '..') || !Number.isSafeInteger(source.line) || source.line < 1) throw unsupported();
  result.file = source.file;
  result.line = source.line;
  if (source.column !== undefined) {
    if (!Number.isSafeInteger(source.column) || source.column < 1) throw unsupported();
    result.column = source.column;
  }
  if (source.sha256 !== undefined) {
    if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) throw unsupported();
    result.sha256 = source.sha256;
  }
  if (source.elementId !== undefined) {
    if (typeof source.elementId !== 'string' || !/^[a-z][a-z0-9_.:-]{0,99}$/i.test(source.elementId)) throw unsupported();
    result.elementId = source.elementId;
  }
  if (source.status === 'instrumented' && (result.column === undefined || result.sha256 === undefined)) throw unsupported();
  return result;
}

function groupOf(group, configured) {
  if (!group || Array.isArray(group) || !['family', 'variant', 'type'].every((key) => text(group[key], 200))) throw unsupported();
  const fields = ['family', 'variant', 'type'];
  if (configured) {
    if (!ELEMENT_TYPES.includes(group.type) || typeof group.tag !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(group.tag) || !text(group.nativeType, 80) || !text(group.state, 512)) throw unsupported();
    fields.push('tag', 'nativeType', 'state');
  }
  for (const key of ['familyEvidence', 'variantEvidence']) if (group[key] !== undefined) {
    if (!text(group[key], 200)) throw unsupported();
    fields.push(key);
  }
  return Object.fromEntries(fields.map((key) => [key, group[key]]));
}

function groupIdentity(group, configured) {
  return JSON.stringify((configured ? ['family', 'variant', 'type', 'tag', 'nativeType', 'state'] : ['family', 'variant', 'type']).map((key) => group[key]));
}

function scopeOf(scope) {
  if (!scope || Array.isArray(scope) || !text(scope.url, 2000) || !text(scope.theme, 120)) throw unsupported();
  let url;
  try { url = new URL(scope.url); } catch { throw unsupported(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw unsupported();
  let viewport, pixelRatio, actions;
  try { viewport = validateViewport(scope.viewport); pixelRatio = validatePixelRatio(scope.pixelRatio); actions = validateCaptureActions(scope.actions === undefined ? [] : scope.actions); } catch { throw unsupported(); }
  if (scope.browser?.engine !== 'chromium' || !text(scope.browser.version, 100)) throw unsupported();
  return { url: scope.url, viewport, pixelRatio, theme: scope.theme, browser: { engine: scope.browser.engine, version: scope.browser.version }, actions };
}

function contextOf(scope) {
  return JSON.stringify([scope.viewport.width, scope.viewport.height, scope.theme, scope.pixelRatio, scope.browser.engine, scope.browser.version, scope.actions]);
}

function pageOf(page, index, configured) {
  if (!page || page.format !== (configured ? 'ui-sheet/elements-v1' : 'ui-sheet/consistency-v1') || page.findingIdentity !== (configured ? ELEMENT_FINDING_IDENTITY : 'ui-sheet/button-finding-v6') || !Array.isArray(page.observations) || !Array.isArray(page.findings)) throw unsupported();
  const scope = scopeOf(page.scope);
  const seen = new Set();
  const observations = page.observations.map((observation) => {
    if (!observation || typeof observation.id !== 'string') throw unsupported();
    const group = groupOf(observation.group, configured);
    const match = /^([a-z][a-z0-9-]{0,79}):(0|[1-9]\d*)$/.exec(observation.id);
    if (!match || !Number.isSafeInteger(Number(match[2])) || match[1] !== (configured ? group.tag : 'button') || seen.has(observation.id)) throw unsupported();
    seen.add(observation.id);
    const style = normalizeButtonStyle(observation.style);
    if (!style) throw unsupported();
    const image = page.previews?.[observation.id]?.image;
    return { id: observation.id, group, style, source: sourceOf(observation.source), previewAvailable: typeof image === 'string' && image.startsWith('data:image/png;base64,') && image.length > 22 };
  });
  return { index: index + 1, scope, observations, findings: page.findings, configured };
}

function pagesOf(data) {
  if (data?.format !== 'ui-sheet/v1') throw unsupported();
  let native = [], configured = [];
  if (data.consistency) {
    const pages = data.consistency.pages || [data.consistency];
    if (!Array.isArray(pages) || !pages.length) throw unsupported();
    native = pages.map((page, index) => pageOf(page, index, false));
  }
  if (data.elementConsistency) {
    if (data.elementConsistency.format !== 'ui-sheet/element-pages-v1' || !Array.isArray(data.elementConsistency.pages) || !data.elementConsistency.pages.length) throw unsupported();
    configured = data.elementConsistency.pages.map((page, index) => pageOf(page, index, true));
  }
  return { native, configured };
}

function exampleOf(entry, side) {
  const example = entry.finding[side]?.example;
  if (example === null && side === 'common') return null;
  const page = entry.crossPage ? entry.pages[example?.page - 1] : entry.page;
  const id = entry.crossPage ? example?.observation : example;
  if (!page || typeof id !== 'string' || (entry.crossPage && example.url !== page.scope.url)) throw unsupported();
  const matches = page.observations.filter((observation) => observation.id === id);
  if (matches.length !== 1) throw unsupported();
  return { page, observation: matches[0] };
}

function expectedStyle(entry, selected, outlier) {
  if (selected) return selected.observation.style;
  if (entry.finding.reference !== 'approved') throw unsupported();
  if (entry.finding.common.style !== undefined) {
    const style = normalizeButtonStyle(entry.finding.common.style);
    if (!style) throw unsupported();
    return style;
  }
  if (!Array.isArray(entry.finding.differences) || !entry.finding.differences.length) throw unsupported();
  const style = { ...outlier.observation.style }, seen = new Set();
  for (const difference of entry.finding.differences) {
    if (!difference || !styleFields.has(difference.property) || typeof difference.common !== 'string' || seen.has(difference.property)) throw unsupported();
    seen.add(difference.property);
    style[difference.property] = difference.common;
  }
  const normalized = normalizeButtonStyle(style);
  if (!normalized) throw unsupported();
  return normalized;
}

/** Find recorded occurrences only; a matching source remains evidence, not deployment proof. */
export function findingLocations(data, options = {}) {
  const { findingId, side, limit } = argumentsOf(options);
  const { native, configured } = pagesOf(data);
  const entries = [...native, ...configured].flatMap((page) => page.findings.filter((finding) => finding?.id === findingId).map((finding) => ({ finding, page, pages: [page], crossPage: false, configured: page.configured })));
  if (data.crossPageConsistency) {
    const cross = data.crossPageConsistency;
    if (cross.format !== 'ui-sheet/cross-page-v1' || cross.findingIdentity !== 'ui-sheet/cross-page-finding-v5' || !Array.isArray(cross.findings) || !native.length) throw unsupported();
    entries.push(...cross.findings.filter((finding) => finding?.id === findingId).map((finding) => ({ finding, pages: native, crossPage: true, configured: false })));
  }
  if (entries.length !== 1) throw new Error('Finding ID must identify exactly one finding in the report.');
  const entry = entries[0];
  const expectedKind = entry.crossPage ? 'cross-page-button-style-outlier' : entry.configured ? 'configured-element-style-outlier' : 'button-style-outlier';
  if (entry.finding.kind !== expectedKind || !['inferred', 'approved'].includes(entry.finding.reference)) throw unsupported();
  const group = groupOf(entry.finding.group, entry.configured);
  const groupKey = groupIdentity(group, entry.configured);
  const outlier = exampleOf(entry, 'outlier');
  const selected = side === 'outlier' ? outlier : exampleOf(entry, 'common');
  const scope = outlier.page.scope;
  if (groupIdentity(outlier.observation.group, entry.configured) !== groupKey || (selected && (groupIdentity(selected.observation.group, entry.configured) !== groupKey || contextOf(selected.page.scope) !== contextOf(scope)))) throw unsupported();
  const styleKey = JSON.stringify(expectedStyle(entry, selected, outlier));
  const pages = entry.crossPage ? entry.pages.filter((page) => contextOf(page.scope) === contextOf(scope)) : [entry.page];
  const locations = [];
  for (const page of pages) {
    for (const observation of page.observations) {
      if (entry.crossPage && (!['page-provided group', 'configured group'].includes(observation.group.familyEvidence) || !['page-provided variant', 'configured variant'].includes(observation.group.variantEvidence))) continue;
      if (groupIdentity(observation.group, entry.configured) !== groupKey || JSON.stringify(observation.style) !== styleKey) continue;
      locations.push({ page: page.index, url: page.scope.url, observationId: observation.id, group: observation.group, source: observation.source, previewAvailable: observation.previewAvailable });
    }
  }
  const expectedCount = entry.finding[side]?.count;
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount !== locations.length) throw new Error('Finding occurrence counts do not match the recorded observations. Regenerate the report before relying on its locations.');
  return { format: 'ui-sheet/finding-locations-v1', findingId, side, total: locations.length, truncated: locations.length > limit, locations: locations.slice(0, limit) };
}

/** Read current report evidence only after validating its scan completion marker. */
export async function listFindingLocations(reportDir, options = {}) {
  argumentsOf(options);
  const { data, scanStatus } = await readCheckedReport(reportDir);
  return { ...findingLocations(data, options), scanStatus };
}
