import { createHash } from 'node:crypto';

// Image URLs can contain credentials or large data payloads. Gradients contain
// no external resource references, so compare only those and "none".
export const MAX_BACKGROUND_IMAGE_LENGTH = 2048;
export const GRADIENT_PATTERN = '^(?:repeating-)?(?:linear|radial|conic)-gradient\\(';
export const UNSAFE_IMAGE_PATTERN = '["\'\\\\]|(?:url|image-set|cross-fade|image|element|paint)\\s*\\(';
export function isComparableBackgroundImage(input) {
  if (typeof input !== 'string') return false;
  const value = input.trim();
  return value === 'none' || (value.length <= MAX_BACKGROUND_IMAGE_LENGTH && new RegExp(GRADIENT_PATTERN, 'i').test(value) && !new RegExp(UNSAFE_IMAGE_PATTERN, 'i').test(value));
}

export const MAX_FILTER_LENGTH = 2048;
const CSS_NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const CSS_NONNEGATIVE_NUMBER = '\\+?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
export const OPACITY_PATTERN = `^${CSS_NUMBER}$`;
const FILTER_FACTOR = `${CSS_NONNEGATIVE_NUMBER}%?`;
const FILTER_COLOR_NUMBER = `${CSS_NUMBER}%?`;
const FILTER_COLOR_SEPARATOR = '(?:\\s*,\\s*|\\s+)';
const FILTER_COLOR_NUMBERS = `${FILTER_COLOR_NUMBER}${FILTER_COLOR_SEPARATOR}${FILTER_COLOR_NUMBER}${FILTER_COLOR_SEPARATOR}${FILTER_COLOR_NUMBER}(?:\\s*(?:,|/)\\s*${FILTER_FACTOR})?`;
const FILTER_COLOR = `(?:(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\(\\s*${FILTER_COLOR_NUMBERS}\\s*\\)|color\\(\\s*(?:srgb(?:-linear)?|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz(?:-d50|-d65)?)\\s+${FILTER_COLOR_NUMBERS}\\s*\\)|currentcolor|transparent)`;
const FILTER_LENGTHS = `${CSS_NUMBER}px\\s+${CSS_NUMBER}px(?:\\s+${CSS_NONNEGATIVE_NUMBER}px)?`;
const FILTER_SHADOW = `(?:${FILTER_COLOR}\\s+${FILTER_LENGTHS}|${FILTER_LENGTHS}(?:\\s+${FILTER_COLOR})?)`;
const FILTER_FUNCTION = `(?:(?:brightness|contrast|grayscale|invert|opacity|saturate|sepia)\\(\\s*${FILTER_FACTOR}\\s*\\)|blur\\(\\s*${CSS_NONNEGATIVE_NUMBER}px\\s*\\)|hue-rotate\\(\\s*${CSS_NUMBER}(?:deg|grad|rad|turn)\\s*\\)|drop-shadow\\(\\s*${FILTER_SHADOW}\\s*\\))`;
// Full-string allowlist: imported styles and browser measurements share this
// policy, including common computed drop-shadow color serializations.
export const FILTER_PATTERN = `^${FILTER_FUNCTION}(?:\\s+${FILTER_FUNCTION})*$`;
export function isComparableFilter(input) {
  if (typeof input !== 'string') return false;
  const value = input.trim();
  return value === 'none' || (value.length <= MAX_FILTER_LENGTH && !new RegExp(UNSAFE_IMAGE_PATTERN, 'i').test(value) && new RegExp(FILTER_PATTERN, 'i').test(value));
}

export function isComparableStyleValue(property, input) {
  if (property === 'backgroundImage') return isComparableBackgroundImage(input);
  if (property === 'filter') return isComparableFilter(input);
  if (property === 'opacity') {
    if (typeof input !== 'string' || !new RegExp(OPACITY_PATTERN, 'i').test(input.trim())) return false;
    const value = Number(input);
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }
  return typeof input === 'string' && Boolean(input.trim());
}

// Only compare properties that can be explained to a person. Width and height
// are excluded because a different label can legitimately change their size.
export const BUTTON_STYLE_FIELDS = [
  ['backgroundColor', 'Background color'],
  ['backgroundImage', 'Background gradient'],
  ['color', 'Text color'],
  ['opacity', 'Opacity'],
  ['filter', 'Visual filter'],
  ['borderTopWidth', 'Top border width'],
  ['borderTopStyle', 'Top border style'],
  ['borderTopColor', 'Top border color'],
  ['borderRightWidth', 'Right border width'],
  ['borderRightStyle', 'Right border style'],
  ['borderRightColor', 'Right border color'],
  ['borderBottomWidth', 'Bottom border width'],
  ['borderBottomStyle', 'Bottom border style'],
  ['borderBottomColor', 'Bottom border color'],
  ['borderLeftWidth', 'Left border width'],
  ['borderLeftStyle', 'Left border style'],
  ['borderLeftColor', 'Left border color'],
  ['borderTopLeftRadius', 'Top-left radius'],
  ['borderTopRightRadius', 'Top-right radius'],
  ['borderBottomRightRadius', 'Bottom-right radius'],
  ['borderBottomLeftRadius', 'Bottom-left radius'],
  ['fontFamily', 'Font family'],
  ['fontSize', 'Font size'],
  ['fontWeight', 'Font weight'],
  ['fontStyle', 'Font style'],
  ['lineHeight', 'Line height'],
  ['letterSpacing', 'Letter spacing'],
  ['textTransform', 'Text transform'],
  ['textDecorationLine', 'Text decoration'],
  ['paddingTop', 'Top padding'],
  ['paddingRight', 'Right padding'],
  ['paddingBottom', 'Bottom padding'],
  ['paddingLeft', 'Left padding'],
  ['boxShadow', 'Shadow'],
];

function normalizeValue(input) {
  if (typeof input !== 'string') return '';
  let value = input.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').toLowerCase();
  // Browsers normally resolve colors to rgb/rgba; treat an opaque alpha as the
  // same color, and normalize numeric zero lengths without a unit.
  value = value.replace(/^rgba\((\d+),(\d+),(\d+),1(?:\.0+)?\)$/, 'rgb($1,$2,$3)');
  return value === '0' ? '0px' : value;
}

export function normalizeButtonStyle(input) {
  if (!input || typeof input !== 'object') return null;
  const result = {};
  for (const [key] of BUTTON_STYLE_FIELDS) {
    if (!isComparableStyleValue(key, input[key])) return null;
    const value = key === 'opacity' ? String(Number(input[key])) : normalizeValue(input[key]);
    if (!value) return null;
    result[key] = value;
  }
  // The style and color of a zero-width side cannot affect its appearance.
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    if (parseFloat(result[`border${side}Width`]) === 0) {
      result[`border${side}Style`] = 'not visible';
      result[`border${side}Color`] = 'not visible';
    }
  }
  return result;
}

export function isSameButtonStyle(reference, measured) {
  const normalized = normalizeButtonStyle(measured);
  return normalized !== null && JSON.stringify(reference) === JSON.stringify(normalized);
}

function simpleHint(input) {
  if (typeof input !== 'string') return '';
  const value = input.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_. -]{0,79}$/.test(value) ? value : '';
}

function variantOf(button) {
  const supplied = simpleHint(button.variant);
  const inheritedSize = simpleHint(button.sizeHint);
  if (supplied) return { name: [supplied, inheritedSize].filter(Boolean).join(' + '), evidence: button.variantEvidence === 'configured variant' ? 'configured variant' : 'page-provided variant' };
  const words = (button.classes || []).join(' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
  const recognized = ['destructive', 'danger', 'warning', 'success', 'info', 'secondary', 'tertiary', 'primary', 'outline', 'ghost', 'subtle', 'link', 'light', 'dark', 'small', 'large', 'sm', 'lg', 'close'];
  const names = [...new Set(recognized.filter((name) => words.includes(name)).map((name) => name === 'destructive' ? 'danger' : name === 'sm' ? 'small' : name === 'lg' ? 'large' : name))];
  if (inheritedSize && !names.includes(inheritedSize)) names.push(inheritedSize);
  if (names.length) return { name: names.join(' + '), evidence: 'class name' };
  // Use this only to separate likely destructive actions; never save the text
  // or claim it is a verified design-system variant.
  const label = `${button.ariaLabel || ''} ${button.text || ''}`.trim().toLowerCase();
  if (/\b(delete|destroy|discard|erase|remove)\b/.test(label)) return { name: 'danger', evidence: 'action label' };
  return { name: 'unspecified', evidence: 'no explicit variant detected' };
}

function familyOf(button) {
  const supplied = simpleHint(button.family);
  if (supplied) return { name: supplied, evidence: button.familyEvidence === 'configured group' ? 'configured group' : 'page-provided group' };
  const classes = (button.classes || []).filter((name) => /^[a-z][a-z0-9_-]{0,79}$/i.test(name));
  // Prefer a specific component class to a generic shared "button" class.
  const specific = classes.find((name) => /(?:^|[-_])(button|btn)$/i.test(name) && !/^(button|btn)$/i.test(name));
  const base = specific || classes.find((name) => /^(button|btn)$/i.test(name)) || classes.find((name) => /(?:^|[-_])(button|btn)(?:[-_]|$)/i.test(name));
  if (base) return { name: `.${base}`, evidence: 'component class' };
  const parent = simpleHint(button.parentGroup);
  if (parent) return { name: parent, evidence: 'shared container' };
  // Unknown families must not all be assumed comparable across the page.
  return { name: `unclassified button ${button.index}`, evidence: 'unresolved' };
}

export function scopeIdentity(input) {
  if (typeof input === 'string' && input.startsWith('local:/')) return input;
  try {
    const url = new URL(input);
    // Development servers often choose a new port each run. Decisions are kept
    // per project, so retain the local route without the temporary port.
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return `local:${url.pathname}`;
    return `${url.origin}${url.pathname}`;
  } catch { return input; }
}

export function baselineRuleId(scope, group) {
  const identity = [scopeIdentity(scope.url), scope.viewport?.width, scope.viewport?.height, scope.theme || 'unknown', group.family, group.variant, group.type];
  // Reports made before this setting existed always used a 2x context.
  if ((scope.pixelRatio ?? 2) !== 2) identity.push(['pixelRatio', scope.pixelRatio]);
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
}

export function decisionAnchorFor(source, count) {
  if (count !== 1 || !['likely', 'manual', 'instrumented'].includes(source?.status) || !source.file || !Number.isInteger(source.line)) return null;
  if (source.status === 'instrumented' && (!Number.isSafeInteger(source.column) || source.column < 1 || !/^[a-f0-9]{64}$/.test(source.sha256 || ''))) return null;
  const anchor = { file: source.file, line: source.line };
  if (source.status === 'instrumented') { anchor.column = source.column; anchor.sha256 = source.sha256; }
  if (source.status === 'likely' && source.method === 'unique ID and tag' && typeof source.elementId === 'string' && /^[a-z][a-z0-9_.:-]{0,99}$/i.test(source.elementId)) anchor.elementId = source.elementId;
  return anchor;
}

export function decisionAnchorIdentity(anchor) {
  return anchor?.elementId ? { file: anchor.file, elementId: anchor.elementId } : anchor;
}

// Retain only a small, fixed vocabulary rather than the page's actual label.
// These are browsing hints, not proof of what a control does.
const ACTION_HINTS = [
  ['save', /\b(save|saving)\b/i], ['cancel', /\b(cancel|discard)\b/i],
  ['submit', /\b(submit|send)\b/i], ['delete', /\b(delete|remove)\b/i],
  ['edit', /\b(edit|modify)\b/i], ['add', /\b(add|create|new)\b/i],
  ['download', /\b(download|export)\b/i], ['upload', /\b(upload|import)\b/i],
  ['search', /\b(search|find)\b/i], ['close', /\b(close|dismiss)\b/i],
  ['open', /\b(open|view)\b/i], ['back', /\b(back|previous)\b/i],
  ['next', /\b(next|continue)\b/i], ['print', /\bprint\b/i],
  ['refresh', /\b(refresh|reload)\b/i], ['confirm', /\b(confirm|approve)\b/i],
  ['reject', /\b(reject|decline)\b/i], ['archive', /\barchive\b/i],
];

const focusWords = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  .match(/[\p{L}\p{N}]+/gu)?.map((word) => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word) || [];
const focusFiller = new Set(['a', 'an', 'the', 'that', 'which', 'for', 'look', 'at', 'please', 'show', 'me', 'buttons', 'button', 'controls', 'control']);

export function buttonFocusHints(button, requestedFocus = '') {
  const label = button.searchMasked ? '' : [button.text, button.ariaLabel].filter(Boolean).join(' ');
  const actions = ACTION_HINTS.filter(([, pattern]) => pattern.test(label)).map(([action]) => action);
  const regions = (button.regions || []).filter((region) => ['sidebar', 'header', 'navigation'].includes(region));
  const terms = focusWords(requestedFocus).filter((term) => !focusFiller.has(term));
  const haystack = focusWords([label, button.id, ...(button.classes || []), button.tag, ...regions].filter(Boolean).join(' '));
  const requested = !button.searchMasked && terms.length > 0 && terms.every((term) => haystack.some((word) => word.includes(term)));
  return { actions, regions: [...new Set(regions)], requested };
}

/** Analyze one rendered page. The result is evidence, not a verdict or baseline. */
export function analyzeButtonConsistency(buttons, { url = '', viewport = { width: 1440, height: 900 }, theme = 'unknown', pixelRatio = 2, baselines = [], requestedFocus = '', searchButtonLabels = false } = {}) {
  const scope = { url, viewport, theme, pixelRatio, state: 'enabled, non-toggle buttons' };
  const counts = { seen: 0, eligible: 0, hidden: 0, disabled: 0, otherRole: 0, stateful: 0, possiblyBlocked: 0, visibilityUnverified: 0, missingStyle: 0, comparable: 0, undersampled: 0, tied: 0, ambiguous: 0, repeatedMinority: 0 };
  const groups = new Map();
  const observations = [];
  for (const button of buttons) {
    if (button.tag !== 'button') continue;
    counts.seen++;
    if (!button.visible) { counts.hidden++; continue; }
    if (button.disabled) { counts.disabled++; continue; }
    if (button.role && button.role !== 'button') { counts.otherRole++; continue; }
    // Toggle, disclosure and selection controls require state-aware comparisons.
    if (button.stateful) { counts.stateful++; continue; }
    if (button.visibilityEvidence === 'possibly-blocked') { counts.possiblyBlocked++; continue; }
    const style = normalizeButtonStyle(button.style);
    if (!style) { counts.missingStyle++; continue; }
    if (button.visibilityEvidence !== 'clear') counts.visibilityUnverified++;
    const variant = variantOf(button);
    const family = familyOf(button);
    const type = simpleHint(button.type) || 'unspecified';
    const group = { family: family.name, familyEvidence: family.evidence, variant: variant.name, variantEvidence: variant.evidence, type };
    const groupKey = JSON.stringify([family.name, variant.name, type]);
    const styleKey = JSON.stringify(style);
    const focus = buttonFocusHints(button, requestedFocus);
    const label = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const searchLabel = searchButtonLabels && !button.searchMasked ? label(button.text) || label(button.ariaLabel) : '';
    const searchAlias = searchButtonLabels && !button.searchMasked && label(button.ariaLabel) !== searchLabel ? label(button.ariaLabel) : '';
    const observation = { id: `button:${button.index}`, group, style, visibilityEvidence: button.visibilityEvidence === 'clear' ? 'clear' : 'unverified', ...(button.source ? { source: button.source } : {}), ...(focus.actions.length || focus.regions.length || focus.requested ? { focus } : {}), ...(searchLabel ? { searchLabel } : {}), ...(searchAlias ? { searchAlias } : {}) };
    observations.push(observation);
    counts.eligible++;
    if (!groups.has(groupKey)) groups.set(groupKey, { group, styles: new Map(), count: 0 });
    const bucket = groups.get(groupKey);
    bucket.count++;
    if (!bucket.styles.has(styleKey)) bucket.styles.set(styleKey, { style, observations: [] });
    bucket.styles.get(styleKey).observations.push(observation);
  }

  const findings = [];
  const baselinesUsed = [];
  for (const [groupKey, bucket] of groups) {
    const variants = [...bucket.styles.values()].sort((a, b) => b.observations.length - a.observations.length);
    const approved = baselines.find((entry) => entry.id === baselineRuleId(scope, bucket.group));
    let common;
    let candidates;
    if (approved) {
      const style = normalizeButtonStyle(approved.style);
      if (!style) throw new Error('Approved baseline has invalid style values.');
      const observed = variants.find((variant) => JSON.stringify(variant.style) === JSON.stringify(style));
      common = { style, observations: observed?.observations || [] };
      candidates = variants.filter((variant) => JSON.stringify(variant.style) !== JSON.stringify(style));
      counts.comparable += bucket.count;
      baselinesUsed.push(approved.id);
    } else {
      // Frequency is only useful when a repeated style is a genuine majority.
      if (bucket.count < 3 || variants[0].observations.length < 2) { counts.undersampled += bucket.count; continue; }
      if (variants.length > 1 && variants[0].observations.length === variants[1].observations.length) { counts.tied += bucket.count; continue; }
      if (variants[0].observations.length <= bucket.count / 2) { counts.ambiguous += bucket.count; continue; }
      counts.comparable += bucket.count;
      if (variants.length < 2) continue;
      common = variants[0];
      candidates = variants.slice(1);
      counts.repeatedMinority += candidates.filter((candidate) => candidate.observations.length > 1).reduce((total, candidate) => total + candidate.observations.length, 0);
    }
    for (const candidate of candidates) {
      const differences = BUTTON_STYLE_FIELDS.flatMap(([property, label]) => common.style[property] === candidate.style[property] ? [] : [{ property, label, common: common.style[property], observed: candidate.style[property] }]);
      if (!differences.length) continue;
      const source = candidate.observations[0].source;
      const anchor = decisionAnchorFor(source, candidate.observations.length);
      const identity = [scopeIdentity(url), viewport.width, viewport.height, theme, groupKey, common.style, candidate.style, decisionAnchorIdentity(anchor) || candidate.observations[0].id];
      if (pixelRatio !== 2) identity.push(['pixelRatio', pixelRatio]);
      const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
      findings.push({ id, kind: 'button-style-outlier', status: 'possible difference', evidence: approved ? 'approved baseline' : bucket.count < 5 ? 'small sample' : 'repeated appearance', reference: approved ? 'approved' : 'inferred', group: bucket.group, total: bucket.count, common: { count: common.observations.length, example: common.observations[0]?.id || null }, outlier: { count: candidate.observations.length, example: candidate.observations[0].id }, differences, ...(anchor ? { decisionAnchor: anchor } : {}) });
    }
  }
  return { format: 'ui-sheet/consistency-v1', findingIdentity: 'ui-sheet/button-finding-v6', scope, counts, observations, findings, baselinesUsed };
}
