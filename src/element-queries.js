import { normalizeButtonStyle } from './consistency.js';
import { ELEMENT_FINDING_IDENTITY, ELEMENT_TYPES } from './element-consistency.js';
import { validatePixelRatio, validateViewport } from './context.js';
import { readCheckedReport } from './scan-status.js';

const hint = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_. -]{0,79}$/i.test(value.trim()) ? value.trim().toLowerCase() : '';
const coverageValues = new Set(['observed', 'partial', 'insufficient']);
const invalidReport = () => new Error('Configured element observations are incomplete or unsupported. Regenerate a current captured report.');
const boundedText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value) && !/data:image\//i.test(value);

function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Limit must be an integer between 1 and 200.');
}

function projectScope(scope) {
  if (!scope || Array.isArray(scope) || !boundedText(scope.url, 2000) || !boundedText(scope.theme, 120)) throw invalidReport();
  let url;
  try { url = new URL(scope.url); } catch { throw invalidReport(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalidReport();
  let viewport, pixelRatio;
  try { viewport = validateViewport(scope.viewport); pixelRatio = validatePixelRatio(scope.pixelRatio); } catch { throw invalidReport(); }
  const result = { url: scope.url, viewport, theme: scope.theme, pixelRatio };
  if (scope.state !== undefined) {
    if (!boundedText(scope.state, 512)) throw invalidReport();
    result.state = scope.state;
  }
  if (scope.browser !== undefined) {
    if (scope.browser?.engine !== 'chromium' || !boundedText(scope.browser.version, 100)) throw invalidReport();
    result.browser = { engine: scope.browser.engine, version: scope.browser.version };
  }
  if (scope.instrumentedSources !== undefined) {
    if (typeof scope.instrumentedSources !== 'boolean') throw invalidReport();
    result.instrumentedSources = scope.instrumentedSources;
  }
  if (scope.maskSelectorsConfigured !== undefined) {
    if (!Number.isSafeInteger(scope.maskSelectorsConfigured) || scope.maskSelectorsConfigured < 0) throw invalidReport();
    result.maskSelectorsConfigured = scope.maskSelectorsConfigured;
  }
  return result;
}

function projectGroup(group) {
  if (!group || Array.isArray(group) || !['family', 'variant', 'nativeType'].every((key) => hint(group[key]) && hint(group[key]) === group[key]) || !ELEMENT_TYPES.includes(group.type) || typeof group.tag !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(group.tag) || !boundedText(group.state, 512) || group.familyEvidence !== 'configured group' || !['configured variant', 'unspecified'].includes(group.variantEvidence)) throw invalidReport();
  return Object.fromEntries(['family', 'variant', 'type', 'tag', 'nativeType', 'state', 'familyEvidence', 'variantEvidence'].map((key) => [key, group[key]]));
}

function projectSource(source) {
  if (source === undefined) return { status: 'unresolved' };
  if (!source || Array.isArray(source) || !['likely', 'manual', 'instrumented', 'unresolved'].includes(source.status)) throw invalidReport();
  const result = { status: source.status };
  if (source.method !== undefined) {
    if (!boundedText(source.method, 200)) throw invalidReport();
    result.method = source.method;
  }
  if (source.status === 'unresolved') return result;
  if (!boundedText(source.file, 500) || /[\\:]/.test(source.file) || source.file.split('/').some((part) => !part || part === '.' || part === '..') || !Number.isSafeInteger(source.line) || source.line < 1) throw invalidReport();
  result.file = source.file;
  result.line = source.line;
  if (source.column !== undefined) {
    if (!Number.isSafeInteger(source.column) || source.column < 1) throw invalidReport();
    result.column = source.column;
  }
  if (source.sha256 !== undefined) {
    if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) throw invalidReport();
    result.sha256 = source.sha256;
  }
  if (source.elementId !== undefined) {
    if (typeof source.elementId !== 'string' || !/^[a-z][a-z0-9_.:-]{0,99}$/i.test(source.elementId)) throw invalidReport();
    result.elementId = source.elementId;
  }
  if (source.status === 'instrumented' && (result.column === undefined || result.sha256 === undefined)) throw invalidReport();
  return result;
}

function projectObservation(observation, previews) {
  if (!observation || typeof observation.id !== 'string') throw invalidReport();
  const group = projectGroup(observation.group);
  const prefix = `${group.tag}:`;
  const index = observation.id.startsWith(prefix) ? observation.id.slice(prefix.length) : '';
  if (!/^\d+$/.test(index) || !Number.isSafeInteger(Number(index)) || String(Number(index)) !== index) throw invalidReport();
  const style = normalizeButtonStyle(observation.style);
  if (!style || Object.values(style).some((value) => value.length > 2048 || /data:image\//i.test(value))) throw invalidReport();
  const image = previews?.[observation.id]?.image;
  return { id: observation.id, group, style, source: projectSource(observation.source), previewAvailable: typeof image === 'string' && image.startsWith('data:image/png;base64,') && image.length > 22 };
}

async function readPages(reportDir) {
  const { data, scanStatus } = await readCheckedReport(reportDir);
  const container = data?.elementConsistency;
  if (data?.format !== 'ui-sheet/v1' || container?.format !== 'ui-sheet/element-pages-v1' || !Array.isArray(container.pages) || !container.pages.length) throw new Error('The report has no supported configured element analysis. Run a captured scan with elementGroups.');
  const pages = container.pages.map((page) => {
    if (page?.format !== 'ui-sheet/elements-v1' || page.findingIdentity !== ELEMENT_FINDING_IDENTITY || !Array.isArray(page.observations) || !coverageValues.has(page.coverage) || !Number.isSafeInteger(page.counts?.seen) || page.counts.seen < 0 || page.counts.eligible !== page.observations.length || page.counts.seen < page.counts.eligible) throw invalidReport();
    const observations = page.observations.map((entry) => projectObservation(entry, page.previews));
    if (new Set(observations.map((entry) => entry.id)).size !== observations.length) throw invalidReport();
    return { scope: projectScope(page.scope), coverage: page.coverage, observations };
  });
  return { pages, scanStatus };
}

/** Return only measured appearance facts, without screenshots or approval payloads. */
export async function listElementAppearances(reportDir, { page = 1, limit = 50 } = {}) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Page must be a positive integer.');
  validateLimit(limit);
  const { pages, scanStatus } = await readPages(reportDir);
  const selected = pages[page - 1];
  if (!selected) throw new Error('Page is not present in the configured element report.');
  const grouped = new Map();
  for (const observation of selected.observations) {
    const group = observation.group;
    const key = JSON.stringify([group.family, group.variant, group.type, group.tag, group.nativeType, group.state, observation.style]);
    if (!grouped.has(key)) grouped.set(key, { group: observation.group, count: 0, example: observation.id, style: observation.style, source: observation.source, previewAvailable: observation.previewAvailable });
    grouped.get(key).count++;
  }
  const appearances = [...grouped.values()].sort((a, b) => b.count - a.count || a.example.localeCompare(b.example));
  return { format: 'ui-sheet/element-appearances-v1', scanStatus, page, pageCount: pages.length, scope: selected.scope, coverage: selected.coverage, totalAppearances: appearances.length, truncated: appearances.length > limit, appearances: appearances.slice(0, limit) };
}

/** List each matching occurrence actually observed on the selected captured pages. */
export async function locateElements(reportDir, { family, variant, type, limit = 100 } = {}) {
  const wantedFamily = hint(family);
  if (!wantedFamily) throw new Error('A configured element family of up to 80 letters, numbers, spaces, underscores, dots or hyphens is required.');
  const wantedVariant = variant === undefined ? null : hint(variant);
  if (variant !== undefined && !wantedVariant) throw new Error('Variant must be a nonempty configured hint of at most 80 characters.');
  const wantedType = type === undefined ? null : type;
  if (type !== undefined && !ELEMENT_TYPES.includes(type)) throw new Error('Type must be a supported configured element category.');
  validateLimit(limit);
  const { pages, scanStatus } = await readPages(reportDir);
  const occurrences = [];
  const matchingPages = new Set();
  const scopes = pages.map((entry, index) => ({ page: index + 1, scope: entry.scope, coverage: entry.coverage }));
  for (const [index, page] of pages.entries()) {
    for (const observation of page.observations) {
      const group = observation.group;
      if (group.family !== wantedFamily || (wantedVariant !== null && group.variant !== wantedVariant) || (wantedType !== null && group.type !== wantedType)) continue;
      matchingPages.add(index);
      occurrences.push({ page: index + 1, scope: page.scope, observationId: observation.id, group, source: observation.source, previewAvailable: observation.previewAvailable });
    }
  }
  return { format: 'ui-sheet/element-locations-v1', scanStatus, family: wantedFamily, variant: wantedVariant, type: wantedType, pagesVisited: pages.length, matchingPages: matchingPages.size, scopes, total: occurrences.length, truncated: occurrences.length > limit, occurrences: occurrences.slice(0, limit) };
}
