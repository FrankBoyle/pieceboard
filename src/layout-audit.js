const SIDES = ['top', 'right', 'bottom', 'left'];
const PROPERTIES = new Set(['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap', 'wordSpacing', 'letterSpacing', 'lineHeight', 'textIndent']);
const ownKeys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => [...required, ...optional].includes(key));
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const number = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const validPath = (value) => text(value, 4096) && !/[\\:]/.test(value) && !value.split('/').some((part) => !part || part === '.' || part === '..');
function validSource(value) {
  return ownKeys(value, ['file', 'line'], ['column']) && validPath(value.file) && Number.isSafeInteger(value.line) && value.line > 0
    && (value.column === undefined || Number.isSafeInteger(value.column) && value.column > 0);
}
function validImagePath(value) {
  if (!text(value, 500) || !value.startsWith('/') || value.startsWith('//') || /[\\?#]/.test(value)) return false;
  try { return new URL(value, 'https://ui-sheet.invalid').pathname === value; } catch { return false; }
}
function validRange(value) {
  return (value.min !== undefined || value.max !== undefined)
    && (value.min === undefined || number(value.min, -10000, 10000))
    && (value.max === undefined || number(value.max, -10000, 10000))
    && (value.min === undefined || value.max === undefined || value.min <= value.max);
}

/** Validate explicit review contracts; no layout convention is inferred. */
export function validateLayoutChecks(raw) {
  if (!Array.isArray(raw) || raw.length > 30) throw new Error('layoutChecks must be an array of up to 30 explicit rules.');
  const ids = new Set();
  return raw.map((rule) => {
    if (!rule || typeof rule.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(rule.id) || ids.has(rule.id) || !text(rule.selector, 500)) throw new Error('Layout rules require unique lowercase IDs and nonempty selectors of at most 500 characters.');
    ids.add(rule.id);
    if (rule.source !== undefined && !validSource(rule.source)) throw new Error('A layout source must be a project-relative file and a positive line, with an optional positive column.');
    const common = ['id', 'kind', 'selector'];
    const optional = ['source'];
    let valid = false;
    if (rule.kind === 'text-inset') {
      valid = ownKeys(rule, [...common, 'min'], optional) && ownKeys(rule.min, [], SIDES) && Object.keys(rule.min).length > 0
        && Object.values(rule.min).every((value) => number(value, 0, 1000));
    } else if (rule.kind === 'horizontal-gap') {
      valid = ownKeys(rule, [...common, 'otherSelector'], [...optional, 'min', 'max']) && text(rule.otherSelector, 500) && validRange(rule);
    } else if (rule.kind === 'style') {
      const exact = Object.hasOwn(rule, 'expected');
      valid = ownKeys(rule, [...common, 'property'], [...optional, 'expected', 'min', 'max']) && PROPERTIES.has(rule.property)
        && (exact ? text(rule.expected, 100) && !Object.hasOwn(rule, 'min') && !Object.hasOwn(rule, 'max') : validRange(rule));
    } else if (rule.kind === 'image') {
      valid = ownKeys(rule, [...common, 'paths'], [...optional, 'maxAspectRatioError']) && Array.isArray(rule.paths) && rule.paths.length >= 1 && rule.paths.length <= 5
        && rule.paths.every(validImagePath) && new Set(rule.paths).size === rule.paths.length
        && (rule.maxAspectRatioError === undefined || number(rule.maxAspectRatioError, 0, 1));
    }
    if (!valid) throw new Error(`Layout rule ${JSON.stringify(rule.id)} has an unsupported kind, property, range, path, or field.`);
    const result = structuredClone(rule);
    if (result.kind === 'image' && result.maxAspectRatioError === undefined) result.maxAspectRatioError = 0.02;
    return result;
  });
}

// Runs in the existing capture page. It returns no text, form values, image
// bytes, or resource URLs, and does not initiate any network request.
function measureLayoutInPage({ rules }) {
  // Keep the actual browser values for threshold comparisons. Rounding first
  // can turn a value just below a configured minimum into an apparent pass.
  const rounded = (value) => Object.is(value, -0) ? 0 : value;
  const rectValues = (rect) => [rect.width, rect.height].map(rounded);
  const hidden = (element, requireBox = true) => {
    const rect = element.getBoundingClientRect();
    if (!element.isConnected || requireBox && (rect.width <= 0 || rect.height <= 0)) return true;
    let depth = 0;
    for (let node = element; node; node = node.parentElement) {
      if (++depth > 128) return true;
      const style = getComputedStyle(node);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return true;
    }
    return false;
  };
  const unsupported = (element) => {
    let depth = 0;
    for (let node = element; node; node = node.parentElement) {
      if (++depth > 128) return true;
      const style = getComputedStyle(node);
      if (style.transform !== 'none' || style.translate && style.translate !== 'none' || style.rotate && style.rotate !== 'none'
          || style.scale && style.scale !== 'none' || !['', 'normal', '1'].includes(style.zoom)
          || style.writingMode !== 'horizontal-tb' || style.perspective !== 'none'
          || node.getAnimations?.().some((animation) => animation.playState === 'running' || animation.playState === 'pending')) return true;
    }
    return Boolean(element.getAnimations?.({ subtree: true }).some((animation) => animation.playState === 'running' || animation.playState === 'pending'));
  };
  const fail = (id, message, measured = {}) => ({ id, ok: false, message, measured });
  return rules.map((rule) => {
    let elements, others;
    try {
      elements = document.querySelectorAll(rule.selector);
      others = rule.kind === 'horizontal-gap' ? document.querySelectorAll(rule.otherSelector) : null;
    } catch { return fail(rule.id, 'The configured CSS selector is unsupported or invalid.'); }
    if (elements.length !== 1 || others && others.length !== 1) return fail(rule.id, 'Each configured selector must match exactly one element.', { matches: Math.min(elements.length, 100000), ...(others ? { otherMatches: Math.min(others.length, 100000) } : {}) });
    const element = elements[0];
    const other = others?.[0];
    if (hidden(element) || other && hidden(other)) return fail(rule.id, 'A target is hidden, empty, detached, or beyond the supported ancestor depth.');
    if (unsupported(element) || other && unsupported(other)) return fail(rule.id, 'Transforms, zoom, vertical writing, perspective, or active animations make this measurement unsupported.');
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const base = [...rectValues(box), style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing, style.wordSpacing, style.whiteSpace, style.textIndent];
    if (rule.kind === 'style') {
      const value = style[rule.property];
      const numeric = /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/.test(value) ? Number.parseFloat(value) : value === '0' ? 0 : null;
      const measured = { property: rule.property, value, ...(numeric === null ? {} : { px: rounded(numeric) }) };
      if (rule.expected === undefined && numeric === null) return fail(rule.id, 'The computed value is not a supported pixel measurement; it was not replaced with zero.', measured);
      return { id: rule.id, ok: true, measured, fingerprint: [...base, value] };
    }
    if (rule.kind === 'horizontal-gap') {
      const second = other.getBoundingClientRect();
      const verticalOverlap = Math.min(box.bottom, second.bottom) - Math.max(box.top, second.top);
      const measured = { gap: rounded(second.left - box.right), verticalOverlap: rounded(verticalOverlap) };
      if (verticalOverlap <= 0) return fail(rule.id, 'The two targets do not share a horizontal row; a horizontal gap was not inferred.', measured);
      return { id: rule.id, ok: true, measured, fingerprint: [...base, ...rectValues(second), ...Object.values(measured)] };
    }
    if (rule.kind === 'image') {
      const measured = { elementTag: element.localName, decoded: false };
      if (!(element instanceof HTMLImageElement)) return { id: rule.id, ok: true, measured, fingerprint: [...base, element.localName] };
      measured.decoded = element.complete && element.naturalWidth > 0 && element.naturalHeight > 0;
      if (!measured.decoded) return fail(rule.id, 'The selected image has not decoded successfully.', measured);
      let selected;
      try { selected = new URL(element.currentSrc, document.baseURI); } catch { return fail(rule.id, 'The selected image source could not be inspected.', measured); }
      measured.sameOrigin = selected.origin === location.origin;
      measured.approvedPath = measured.sameOrigin && rule.paths.includes(selected.pathname);
      measured.naturalWidth = element.naturalWidth;
      measured.naturalHeight = element.naturalHeight;
      // The image element's content box is the area its image replaces. Border
      // and padding are excluded, so they cannot masquerade as stretching.
      const contentWidth = box.width - Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const contentHeight = box.height - Number.parseFloat(style.borderTopWidth) - Number.parseFloat(style.borderBottomWidth) - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
      if (contentWidth <= 0 || contentHeight <= 0 || !Number.isFinite(contentWidth + contentHeight)) return fail(rule.id, 'The image content box is empty or unsupported.', measured);
      measured.renderedWidth = rounded(contentWidth);
      measured.renderedHeight = rounded(contentHeight);
      // contain/cover/none/scale-down can preserve an image's aspect while its
      // element has another shape. Report unknown rather than a false stretch.
      if (style.objectFit !== 'fill') return fail(rule.id, 'Image object-fit is not fill; this version does not infer the painted image rectangle.', measured);
      measured.aspectRatioError = rounded(Math.abs((contentWidth / contentHeight) / (element.naturalWidth / element.naturalHeight) - 1));
      return { id: rule.id, ok: true, measured, fingerprint: [...base, ...Object.values(measured)] };
    }
    const inner = {
      top: box.top + Number.parseFloat(style.borderTopWidth), right: box.right - Number.parseFloat(style.borderRightWidth),
      bottom: box.bottom - Number.parseFloat(style.borderBottomWidth), left: box.left + Number.parseFloat(style.borderLeftWidth),
    };
    if (!Object.values(inner).every(Number.isFinite)) return fail(rule.id, 'Container border geometry is unsupported.');
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let count = 0, rectCount = 0;
    const union = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++count > 1000) return fail(rule.id, 'The target exceeds the 1,000 text-node measurement limit; no partial inset was used.', { textNodes: count });
      if (!/\S/.test(node.textContent || '')) continue;
      const parent = node.parentElement;
      if (!(parent instanceof HTMLElement) || parent.closest('script,style,noscript,template') || hidden(parent, false)) continue;
      if (unsupported(parent)) return fail(rule.id, 'A text descendant has unsupported transforms, writing mode, or active animations.');
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (++rectCount > 2000) return fail(rule.id, 'The target exceeds the 2,000 text-rectangle limit; no partial inset was used.', { textRects: rectCount });
        union.top = Math.min(union.top, rect.top); union.right = Math.max(union.right, rect.right);
        union.bottom = Math.max(union.bottom, rect.bottom); union.left = Math.min(union.left, rect.left);
      }
    }
    if (!rectCount) return fail(rule.id, 'No measurable visible HTML text rectangles were found.');
    const measured = { top: rounded(union.top - inner.top), right: rounded(inner.right - union.right), bottom: rounded(inner.bottom - union.bottom), left: rounded(union.left - inner.left), textRects: rectCount };
    return { id: rule.id, ok: true, measured, fingerprint: [...base, ...Object.values(measured)] };
  });
}

function expectedFor(rule) {
  if (rule.kind === 'text-inset') return { min: structuredClone(rule.min) };
  if (rule.kind === 'image') return { paths: [...rule.paths], maxAspectRatioError: rule.maxAspectRatioError };
  return { ...(rule.property ? { property: rule.property } : {}), ...(rule.expected !== undefined ? { expected: rule.expected } : {}), ...(rule.min !== undefined ? { min: rule.min } : {}), ...(rule.max !== undefined ? { max: rule.max } : {}) };
}
function outcome(rule, measured) {
  if (rule.kind === 'text-inset') {
    const sides = Object.entries(rule.min).filter(([side, minimum]) => measured[side] < minimum).map(([side]) => side);
    return sides.length ? ['finding', sides.map((side) => `${side[0].toUpperCase()}${side.slice(1)} text clearance is ${measured[side]} CSS px; the project requires at least ${rule.min[side]} CSS px.`).join(' ')] : ['passed', 'Measured text clearance meets the configured minimums.'];
  }
  if (rule.kind === 'image') {
    if (measured.elementTag !== 'img') return ['finding', 'The target is recreated markup rather than the expected image element.'];
    if (!measured.approvedPath) return ['finding', 'The decoded image does not use an approved same-origin source pathname; file bytes were not compared.'];
    if (measured.aspectRatioError > rule.maxAspectRatioError) return ['finding', 'The rendered image content box exceeds the configured aspect-ratio error.'];
    return ['passed', 'The decoded image uses an approved source pathname and its aspect ratio meets the limit; file bytes were not compared.'];
  }
  const measuredValue = rule.kind === 'style' ? measured.px : measured.gap;
  const failed = rule.expected !== undefined ? measured.value !== rule.expected : rule.min !== undefined && measuredValue < rule.min || rule.max !== undefined && measuredValue > rule.max;
  const requirement = rule.expected !== undefined ? `expected ${rule.expected}` : [rule.min !== undefined ? `minimum ${rule.min} CSS px` : '', rule.max !== undefined ? `maximum ${rule.max} CSS px` : ''].filter(Boolean).join(', ');
  return failed ? ['finding', rule.kind === 'horizontal-gap' ? `Measured horizontal gap: ${measured.gap} CSS px; ${requirement}. Negative values indicate overlapping boxes.` : `Measured ${rule.property.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}: ${measured.value}; ${requirement}.`]
    : ['passed', rule.kind === 'horizontal-gap' ? 'The measured horizontal gap meets the configured range.' : 'The computed spacing property meets the configured expectation.'];
}
const equivalent = (first, second) => Array.isArray(first) && Array.isArray(second) && first.length === second.length && first.every((value, index) => typeof value === 'number' && typeof second[index] === 'number' ? Math.abs(value - second[index]) <= 0.05 : value === second[index]);

/** Measure selected UI geometry in the caller's settled capture context. */
export async function auditLayout(page, input, options = {}) {
  const rules = validateLayoutChecks(input);
  const scope = structuredClone(options.scope || {});
  const expire = options.throwIfExpired || (() => {});
  const verifyPage = () => {
    if (typeof page.url !== 'function' || !scope.url) return;
    const expected = new URL(scope.url), current = new URL(page.url());
    if (current.origin !== expected.origin || current.pathname !== expected.pathname) throw new Error('The layout page navigated away from its recorded route.');
  };
  expire();
  verifyPage();
  const first = await page.evaluate(measureLayoutInPage, { rules });
  await new Promise((resolve) => setTimeout(resolve, 80));
  expire();
  verifyPage();
  const second = await page.evaluate(measureLayoutInPage, { rules });
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== rules.length || second.length !== rules.length) throw new Error('Layout measurement returned incomplete rule data.');
  const results = rules.map((rule, index) => {
    const initial = first[index], latest = second[index];
    if (initial?.id !== rule.id || latest?.id !== rule.id) throw new Error('Layout measurement returned mismatched rule data.');
    let status, message;
    if (!initial.ok || !latest.ok) { status = 'incomplete'; message = latest.message || initial.message || 'Layout evidence is incomplete.'; }
    else if (!equivalent(initial.fingerprint, latest.fingerprint)) { status = 'incomplete'; message = 'The selected layout changed between measurements; no stable comparison was made.'; }
    else [status, message] = outcome(rule, latest.measured);
    return { id: rule.id, kind: rule.kind, selector: rule.selector, ...(rule.otherSelector ? { otherSelector: rule.otherSelector } : {}), status, message,
      expected: expectedFor(rule), measured: structuredClone(latest.measured || {}), source: rule.source ? { status: 'manual', ...structuredClone(rule.source) } : { status: 'unresolved' } };
  });
  const previewIndexes = results.map((result, index) => ({ result, index })).filter(({ result }) => result.status !== 'incomplete')
    .sort((a, b) => Number(b.result.status === 'finding') - Number(a.result.status === 'finding')).slice(0, 10);
  for (const { result, index } of previewIndexes) {
    expire();
    verifyPage();
    let handle;
    try {
      const current = await page.evaluate(measureLayoutInPage, { rules: [rules[index]] });
      if (!current?.[0]?.ok || !equivalent(second[index].fingerprint, current[0].fingerprint)) {
        result.status = 'incomplete';
        result.message = 'The selected layout changed before preview capture; the comparison is incomplete.';
        continue;
      }
      const locator = page.locator(`css:light=${rules[index].selector}`);
      handle = rules[index].kind === 'horizontal-gap'
        ? await locator.evaluateHandle((element, otherSelector) => { const other = document.querySelector(otherSelector); let parent = element; while (parent && !parent.contains(other)) parent = parent.parentElement; return parent; }, rules[index].otherSelector)
        : await locator.elementHandle();
      const element = handle?.asElement ? handle.asElement() : handle;
      const box = await element?.boundingBox();
      if (!box || box.width < 1 || box.height < 1 || box.width > 4096 || box.height > 4096 || box.width * box.height > 4 * 1024 * 1024) continue;
      if (rules[index].kind === 'horizontal-gap') {
        const reasonableContext = await element.evaluate((ancestor, selectors) => {
          const first = document.querySelector(selectors[0])?.getBoundingClientRect();
          const second = document.querySelector(selectors[1])?.getBoundingClientRect();
          if (!first || !second) return false;
          const unionArea = (Math.max(first.right, second.right) - Math.min(first.left, second.left)) * (Math.max(first.bottom, second.bottom) - Math.min(first.top, second.top));
          const bounds = ancestor.getBoundingClientRect();
          return unionArea > 0 && bounds.width * bounds.height <= unionArea * 4;
        }, [rules[index].selector, rules[index].otherSelector]);
        if (!reasonableContext) continue;
      }
      let ratio = options.pixelRatio || scope.pixelRatio || 2;
      let image = await element.screenshot({ type: 'png', timeout: 4000, ...options.maskOptions });
      if (image.length > 1024 * 1024) { image = await element.screenshot({ type: 'png', scale: 'css', timeout: 4000, ...options.maskOptions }); ratio = 1; }
      const after = await page.evaluate(measureLayoutInPage, { rules: [rules[index]] });
      if (!after?.[0]?.ok || !equivalent(second[index].fingerprint, after[0].fingerprint)) {
        result.status = 'incomplete';
        result.message = 'The selected layout changed during preview capture; the comparison is incomplete.';
        continue;
      }
      if (image.length <= 1024 * 1024 && image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        result.preview = { image: `data:image/png;base64,${image.toString('base64')}`, pixelRatio: ratio, width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
      }
    } catch (error) {
      if (page.isClosed?.()) throw error;
      // A masked, detached, oversized, or uncapturable target gets no invented preview.
    }
    finally { await handle?.dispose?.(); }
  }
  expire();
  verifyPage();
  const counts = { rules: results.length, passed: results.filter((result) => result.status === 'passed').length, findings: results.filter((result) => result.status === 'finding').length, incomplete: results.filter((result) => result.status === 'incomplete').length };
  return { format: 'ui-sheet/layout-v1', scope, coverage: !counts.rules ? 'insufficient' : counts.incomplete ? 'partial' : 'observed', counts, results };
}
