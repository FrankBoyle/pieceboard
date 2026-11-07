import { BUTTON_STYLE_FIELDS, FILTER_PATTERN, GRADIENT_PATTERN, isSameButtonStyle, MAX_BACKGROUND_IMAGE_LENGTH, MAX_FILTER_LENGTH, UNSAFE_IMAGE_PATTERN } from './consistency.js';

const policy = { gradient: GRADIENT_PATTERN, filter: FILTER_PATTERN, unsafe: UNSAFE_IMAGE_PATTERN, maxLength: MAX_BACKGROUND_IMAGE_LENGTH, maxFilterLength: MAX_FILTER_LENGTH };

// This function runs in the page. It never reads form values or interacts with UI.
function measureInPage({ rules, properties, policy, instrumentedSources, only, limit }) {
  const counts = Object.create(null);
  const elements = [];
  let omitted = 0;
  const candidates = only ? [document.querySelectorAll(only.tag)[only.index]].filter(Boolean) : document.querySelectorAll('*');
  for (const element of candidates) {
    const tag = element.localName;
    const index = only ? only.index : counts[tag] || 0;
    counts[tag] = index + 1;
    const matches = rules.filter((rule) => element.matches(rule.selector));
    if (matches.length > 1) throw new Error('Configured element groups overlap. Make their selectors mutually exclusive.');
    if (!matches.length) continue;
    if (elements.length >= limit) { omitted++; continue; }
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    let visible = rect.width > 1 && rect.height > 1;
    for (let node = element; visible && node; node = node.parentElement) {
      const current = getComputedStyle(node);
      if (current.display === 'none' || current.visibility === 'hidden' || current.visibility === 'collapse' || Number(current.opacity) === 0) visible = false;
    }
    let visibilityEvidence = 'unverified';
    if (visible && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight) {
      let clear = true, missing = false;
      for (const x of [0.15, 0.5, 0.85]) for (const y of [0.15, 0.5, 0.85]) {
        const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
        if (!hit) missing = true;
        else if (hit !== element && !element.contains(hit)) clear = false;
      }
      if (!missing) visibilityEvidence = clear ? 'clear' : 'possibly-blocked';
    }
    const state = [];
    let knownState = true;
    for (const name of ['aria-selected', 'aria-checked', 'aria-pressed', 'aria-expanded', 'aria-current', 'aria-invalid']) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      if (!['true', 'false', 'mixed', 'page', 'step', 'location', 'date', 'time', 'spelling', 'grammar'].includes(value)) knownState = false;
      else state.push(`${name}=${value}`);
    }
    if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') state.push('disabled');
    if (element.matches(':focus')) state.push('focused');
    if (element.matches(':hover')) state.push('hovered');
    if (element.matches(':checked')) state.push('checked');
    if (element.matches(':indeterminate')) state.push('indeterminate');
    if (element.matches(':invalid')) state.push('invalid');
    if (element.matches(':valid')) state.push('valid');
    if (element.matches(':focus-within')) state.push('focus-within');
    if (element.matches(':focus-visible')) state.push('focus-visible');
    if (element.hasAttribute('role')) {
      const role = element.getAttribute('role');
      if (!/^[a-z][a-z -]{0,79}$/.test(role)) knownState = false;
      else state.push(`role=${role}`);
    }
    if (element.hasAttribute('readonly')) state.push('readonly');
    if (element.hasAttribute('required')) state.push('required');
    if (element.classList.contains('active')) state.push('active');
    const gradient = new RegExp(policy.gradient, 'i'), unsafe = new RegExp(policy.unsafe, 'i');
    const filter = new RegExp(policy.filter, 'i');
    const measured = Object.fromEntries(properties.map((key) => {
      const value = style[key];
      if (key === 'filter') return [key, value === 'none' || (value.length <= policy.maxFilterLength && filter.test(value) && !unsafe.test(value)) ? value : ''];
      return [key, key !== 'backgroundImage' || value === 'none' || (value.length <= policy.maxLength && gradient.test(value) && !unsafe.test(value)) ? value : ''];
    }));
    const sourceMarker = instrumentedSources && element.hasAttribute('data-ui-sheet-source') ? (element.getAttribute('data-ui-sheet-source') || '').slice(0, 2049) : null;
    elements.push({ tag, index, configured: matches[0], nativeType: tag === 'select' ? (element.multiple ? 'multiple' : 'single') : tag === 'input' ? element.type : '', state: knownState ? state.join(';') || 'default' : '', visible, visibilityEvidence, style: measured, id: element.id || '', classes: [...element.classList].sort(), role: element.getAttribute('role') || '', type: element.getAttribute('type') || '', text: (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 501), placeholder: element.getAttribute('placeholder') || '', ariaLabel: element.getAttribute('aria-label') || '', manualSelectorMatches: !only?.manualSelector || element.matches(only.manualSelector), ...(sourceMarker !== null ? { sourceMarker } : {}) });
  }
  return { elements, omitted };
}

export function snapshotElementGroups(page, rules, { instrumentedSources = false } = {}) {
  return page.evaluate(measureInPage, { rules, properties: BUTTON_STYLE_FIELDS.map(([key]) => key), policy, instrumentedSources, limit: 500 });
}

export async function captureElementPreviews(page, rules, snapshot, analysis, { pixelRatio = 2, maskOptions = {}, instrumentedSources = false, throwIfExpired = () => {}, expectedUrl } = {}) {
  const examples = [...new Set([...analysis.findings.flatMap((finding) => [finding.common.example, finding.outlier.example]), ...analysis.appearances.map((appearance) => appearance.example)].filter(Boolean))];
  const snapshots = new Map(snapshot.elements.map((element) => [`${element.tag}:${element.index}`, element]));
  const observations = new Map(analysis.observations.map((element) => [element.id, element]));
  analysis.previews = {};
  for (const id of examples.slice(0, 40)) {
    throwIfExpired();
    if (expectedUrl) {
      const expected = new URL(expectedUrl), actual = new URL(page.url());
      if (actual.origin !== expected.origin || actual.pathname.replace(/\/+$/, '') !== expected.pathname.replace(/\/+$/, '')) throw new Error('Capture page navigated away; provide the final URL explicitly.');
    }
    const original = snapshots.get(id), observation = observations.get(id);
    if (!original || !observation) continue;
    try {
      const locator = page.locator(`css:light=${original.tag}`).nth(original.index);
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
      const current = (await page.evaluate(measureInPage, { rules, properties: BUTTON_STYLE_FIELDS.map(([key]) => key), policy, instrumentedSources, only: { tag: original.tag, index: original.index, manualSelector: original.manualSelector }, limit: 1 })).elements[0];
      if (!current || !current.visible || !current.manualSelectorMatches || current.visibilityEvidence !== 'clear' || ['id', 'text', 'state', 'placeholder', 'ariaLabel', 'nativeType', 'type', 'role'].some((key) => current[key] !== original[key]) || JSON.stringify(current.classes) !== JSON.stringify(original.classes) || JSON.stringify(current.configured) !== JSON.stringify(original.configured) || (observation.source?.status === 'instrumented' && current.sourceMarker !== original.sourceMarker) || !isSameButtonStyle(observation.style, current.style)) continue;
      let ratio = pixelRatio;
      let image = await locator.screenshot({ type: 'png', scale: 'device', animations: 'disabled', timeout: 4000, ...maskOptions });
      if (image.length > 1024 * 1024) { image = await locator.screenshot({ type: 'png', scale: 'css', animations: 'disabled', timeout: 4000, ...maskOptions }); ratio = 1; }
      if (image.length > 1024 * 1024) continue;
      throwIfExpired();
      const dimensions = image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? { width: image.readUInt32BE(16), height: image.readUInt32BE(20) } : {};
      analysis.previews[id] = { image: `data:image/png;base64,${image.toString('base64')}`, pixelRatio: ratio, ...dimensions };
    } catch { throwIfExpired(); /* Changed or unreachable examples are unavailable. */ }
  }
  const attempted = Math.min(40, examples.length), captured = Object.keys(analysis.previews).length;
  analysis.previewCoverage = { requested: examples.length, attempted, captured, unavailable: attempted - captured, omitted: examples.length - attempted };
  analysis.counts.omitted += snapshot.omitted;
  analysis.counts.seen += snapshot.omitted;
  if (analysis.coverage === 'observed' && (snapshot.omitted || captured < examples.length)) analysis.coverage = 'partial';
  return analysis;
}
