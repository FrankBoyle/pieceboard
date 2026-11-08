import { readCheckedReport } from './scan-status.js';

const STATUSES = ['passed', 'finding', 'incomplete'];
const KINDS = ['text-inset', 'horizontal-gap', 'style', 'image'];
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const countFields = ['rules', 'passed', 'findings', 'incomplete'];
const invalid = () => { throw new Error('The saved layout audit is incomplete or unsupported. Run a new capture with layoutChecks.'); };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const allowedKeys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const bounded = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const properties = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap', 'wordSpacing', 'letterSpacing', 'lineHeight', 'textIndent'];
const measuredKeys = {
  'text-inset': ['top', 'right', 'bottom', 'left', 'textRects', 'textNodes', 'matches', 'otherMatches'],
  'horizontal-gap': ['gap', 'verticalOverlap', 'matches', 'otherMatches'],
  style: ['property', 'value', 'px', 'matches', 'otherMatches'],
  image: ['elementTag', 'decoded', 'approvedPath', 'sameOrigin', 'naturalWidth', 'naturalHeight', 'renderedWidth', 'renderedHeight', 'aspectRatioError', 'matches', 'otherMatches'],
};

function validateExpected(kind, value) {
  if (kind === 'text-inset') return allowedKeys(value, ['min']) && allowedKeys(value.min, ['top', 'right', 'bottom', 'left'])
    && Object.keys(value.min).length > 0 && Object.values(value.min).every((number) => bounded(number, 0, 1000));
  if (kind === 'image') return allowedKeys(value, ['paths', 'maxAspectRatioError']) && Array.isArray(value.paths)
    && value.paths.length >= 1 && value.paths.length <= 5 && new Set(value.paths).size === value.paths.length
    && value.paths.every((entry) => text(entry, 500) && entry.startsWith('/') && !entry.startsWith('//') && !/[?#\\\x00-\x1f\x7f]/.test(entry))
    && bounded(value.maxAspectRatioError, 0, 1);
  if (kind === 'style' && (!allowedKeys(value, ['property', 'expected', 'min', 'max']) || !properties.includes(value.property))) return false;
  if (kind === 'horizontal-gap' && !allowedKeys(value, ['min', 'max'])) return false;
  if (kind === 'style' && Object.hasOwn(value, 'expected')) return text(value.expected, 100) && value.min === undefined && value.max === undefined;
  return object(value) && (value.min !== undefined || value.max !== undefined)
    && (value.min === undefined || bounded(value.min, -10000, 10000))
    && (value.max === undefined || bounded(value.max, -10000, 10000))
    && !(value.min !== undefined && value.max !== undefined && value.min > value.max);
}

function validateOutcome(result) {
  if (result.status === 'incomplete') return;
  const measured = result.measured, expected = result.expected;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const rangeFails = (value) => (expected.min !== undefined && value < expected.min) || (expected.max !== undefined && value > expected.max);
  let failed;
  if (result.kind === 'text-inset') {
    if (!['top', 'right', 'bottom', 'left'].every((key) => finite(measured[key]))
      || !positive(measured.textRects) || measured.textRects > 2000) invalid();
    failed = Object.entries(expected.min).some(([side, minimum]) => measured[side] < minimum);
  } else if (result.kind === 'horizontal-gap') {
    if (!finite(measured.gap) || !finite(measured.verticalOverlap) || measured.verticalOverlap <= 0) invalid();
    failed = rangeFails(measured.gap);
  } else if (result.kind === 'style') {
    if (measured.property !== expected.property || !text(measured.value, 500)) invalid();
    if (expected.expected !== undefined) failed = measured.value !== expected.expected;
    else {
      if (!finite(measured.px) || (measured.value !== '0' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(measured.value))
        || Math.abs(Number.parseFloat(measured.value) - measured.px) > 1e-8) invalid();
      failed = rangeFails(measured.px);
    }
  } else {
    if (!text(measured.elementTag, 100) || typeof measured.decoded !== 'boolean') invalid();
    if (measured.elementTag !== 'img') failed = true;
    else {
      if (!measured.decoded || typeof measured.sameOrigin !== 'boolean' || typeof measured.approvedPath !== 'boolean'
        || !['naturalWidth', 'naturalHeight', 'renderedWidth', 'renderedHeight'].every((key) => finite(measured[key]) && measured[key] > 0)
        || !finite(measured.aspectRatioError) || measured.aspectRatioError < 0
        || (measured.approvedPath && !measured.sameOrigin)) invalid();
      const error = Math.abs((measured.renderedWidth / measured.renderedHeight) / (measured.naturalWidth / measured.naturalHeight) - 1);
      if (Math.abs(error - measured.aspectRatioError) > 1e-8) invalid();
      failed = !measured.sameOrigin || !measured.approvedPath || measured.aspectRatioError > expected.maxAspectRatioError;
    }
  }
  if ((failed ? 'finding' : 'passed') !== result.status) invalid();
}

function validateSource(source) {
  if (!source || !['manual', 'unresolved'].includes(source.status)) return false;
  if (source.status === 'unresolved') return true;
  return text(source.file, 4096) && !/[\\:\x00-\x1f\x7f]/.test(source.file)
    && !source.file.split('/').some((part) => !part || part === '.' || part === '..')
    && positive(source.line) && (source.column === undefined || positive(source.column));
}

function validatePage(page) {
  if (!page || page.format !== 'ui-sheet/layout-v1' || !page.scope || !Array.isArray(page.results) || page.results.length > 30) invalid();
  const scope = page.scope;
  if (!text(scope.url, 8192) || !positive(scope.viewport?.width) || !positive(scope.viewport?.height)
    || !['light', 'dark'].includes(scope.colorScheme) || !['screen', 'print'].includes(scope.media)
    || !Number.isInteger(scope.pixelRatio) || scope.pixelRatio < 1 || scope.pixelRatio > 4
    || scope.browser?.engine !== 'chromium' || !text(scope.browser.version, 200)) invalid();
  const ids = new Set();
  for (const result of page.results) {
    if (!result || !/^[a-z][a-z0-9-]{0,63}$/.test(result.id) || ids.has(result.id)
      || !KINDS.includes(result.kind) || !text(result.selector, 500) || !STATUSES.includes(result.status)
      || !text(result.message, 2000) || !validateSource(result.source)
      || !validateExpected(result.kind, result.expected)
      || !result.measured || typeof result.measured !== 'object' || Array.isArray(result.measured)
      || !Object.keys(result.measured).every((key) => measuredKeys[result.kind].includes(key))
      || Object.values(result.measured).some((value) => !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && value.length > 500) || (typeof value === 'number' && !Number.isFinite(value)))) invalid();
    if (result.otherSelector !== undefined && !text(result.otherSelector, 500)) invalid();
    if (result.kind === 'horizontal-gap' && !text(result.otherSelector, 500)) invalid();
    validateOutcome(result);
    ids.add(result.id);
  }
  const counts = {
    rules: page.results.length,
    passed: page.results.filter((result) => result.status === 'passed').length,
    findings: page.results.filter((result) => result.status === 'finding').length,
    incomplete: page.results.filter((result) => result.status === 'incomplete').length,
  };
  if (!page.counts || countFields.some((key) => page.counts[key] !== counts[key])) invalid();
  const coverage = !counts.rules ? 'insufficient' : counts.incomplete ? 'partial' : 'observed';
  if (page.coverage !== coverage) invalid();
  return counts;
}

/** Summarize only explicitly configured layout evidence, without screenshots. */
export async function checkLayout(reportDir) {
  const { data, scanStatus } = await readCheckedReport(reportDir);
  const audit = data.layoutAudit;
  if (data.format !== 'ui-sheet/v1' || audit?.format !== 'ui-sheet/layout-pages-v1'
    || !Array.isArray(audit.pages) || !audit.pages.length || audit.pages.length > 500) {
    throw new Error('The report has no supported layout audit. Configure layoutChecks and run a captured scan.');
  }
  const counts = { rules: 0, passed: 0, findings: 0, incomplete: 0 };
  const results = [];
  const pages = audit.pages.map((page, index) => {
    const current = validatePage(page);
    for (const key of countFields) counts[key] += current[key];
    for (const result of page.results) {
      // Copy only the public compact fields: no arbitrary report objects/images.
      results.push({ page: index + 1, id: result.id, kind: result.kind, selector: result.selector,
        ...(result.otherSelector ? { otherSelector: result.otherSelector } : {}),
        status: result.status, message: result.message, expected: structuredClone(result.expected),
        measured: structuredClone(result.measured), source: result.source.status === 'manual'
          ? { status: 'manual', file: result.source.file, line: result.source.line, ...(result.source.column !== undefined ? { column: result.source.column } : {}) }
          : { status: 'unresolved' },
        previewAvailable: typeof result.preview?.image === 'string' && result.preview.image.startsWith('data:image/png;base64,'),
      });
    }
    return { page: index + 1, scope: { url: page.scope.url, viewport: { width: page.scope.viewport.width, height: page.scope.viewport.height },
      colorScheme: page.scope.colorScheme, media: page.scope.media, pixelRatio: page.scope.pixelRatio,
      browser: { engine: 'chromium', version: page.scope.browser.version } }, coverage: page.coverage, counts: current };
  });
  const sourceWarnings = Array.isArray(data.warnings) ? data.warnings.length : null;
  const complete = scanStatus === 'completed' && sourceWarnings === 0 && counts.incomplete === 0;
  return { format: 'ui-sheet/layout-check-v1', scanStatus, sourceWarnings,
    coverage: !counts.rules ? 'insufficient' : complete ? 'observed' : 'partial', counts, pages, results };
}
