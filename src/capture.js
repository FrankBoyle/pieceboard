import { analyzeButtonConsistency, BUTTON_STYLE_FIELDS, FILTER_PATTERN, GRADIENT_PATTERN, isSameButtonStyle, MAX_BACKGROUND_IMAGE_LENGTH, MAX_FILTER_LENGTH, UNSAFE_IMAGE_PATTERN } from './consistency.js';
import { summarizeAppearances } from './appearances.js';
import { baselineTemplate } from './baselines.js';
import { applyInstrumentedSources } from './instrumented-sources.js';
import { runWithCaptureDeadline } from './capture-deadline.js';
import { analyzeElementConsistency } from './element-consistency.js';
import { captureElementPreviews, snapshotElementGroups } from './element-capture.js';
import { elementBaselineTemplate } from './element-baselines.js';
import { auditLayout, validateLayoutChecks } from './layout-audit.js';
import { auditResponsive, validateResponsiveViewports } from './responsive-audit.js';
import { DEFAULT_PIXEL_RATIO, DEFAULT_VIEWPORT, validateButtonGroups, validateCaptureActions, validateCaptureResolution, validateColorScheme, validateElementGroups, validateMaskSelectors, validatePixelRatio, validateSourceLinks, validateViewport } from './context.js';

const MAX_CAPTURES = 80;
const MAX_PER_ITEM = 4;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_COMPARISON_IMAGES = 40;
const MAX_VISIBILITY_CHECKS = 500;
const normalize = (text) => typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
const contentKey = (element) => element?.tag && normalize(element.text) ? JSON.stringify([element.tag, normalize(element.text)]) : '';
const attributeKey = (element, name) => element?.tag && normalize(element[name]) ? JSON.stringify([element.tag, normalize(element[name])]) : '';
const classesKey = (element) => [...(element.classes || [])].sort().join(' ');
function imageKey(element, pageUrl) {
  if (element?.tag !== 'img' || !element.src) return '';
  try {
    const url = new URL(element.src, pageUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
}

function addToIndex(index, key, value) {
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

/** Keep automatic previews focused on UI patterns, not page copy or content media. */
export function isUICaptureCandidate(match) {
  const element = match.rendered;
  const source = match.usage.element || {};
  const tag = element.tag;
  const role = element.role || source.role || '';
  const type = element.type || source.type || '';
  const hints = [element.id, source.id, element.src, source.src, element.alt, ...(element.classes || []), ...(source.classes || [])].filter(Boolean).join(' ').toLowerCase();
  const isBrand = element.inBrand || /(?:^|[^a-z])(logo|brand|icon|mark|emblem)(?:[^a-z]|$)/i.test(hints);
  if (tag === 'input' && type.toLowerCase() === 'hidden') return false;
  if (element.configured) return true;
  if (source.inventoryTypes?.some((rule) => (element.classes || []).includes(rule.className))) return true;
  if (tag === 'img') return Boolean(isBrand);
  if (tag === 'a') {
    if (element.hasMedia && !isBrand) return false;
    return Boolean(isBrand || ['button', 'tab', 'menuitem'].includes(role) || /(?:^|[^a-z])(btn|button|cta|nav|menu|link)(?:[^a-z]|$)/i.test(hints));
  }
  if (['button', 'input', 'select', 'textarea', 'label'].includes(tag) || /^h[1-6]$/.test(tag)) {
    return !(element.width > 700 || element.height > 300);
  }
  return ['header', 'aside', 'nav', 'footer'].includes(tag) || ['tab', 'tablist', 'button', 'checkbox', 'radio', 'switch', 'combobox', 'listbox', 'textbox', 'searchbox', 'navigation', 'banner', 'menu', 'menuitem'].includes(role);
}

/** Match only unambiguous source and rendered elements. This is evidence, not proof of deployment. */
export function matchRenderedElements(data, rendered, pageUrl = 'https://ui-sheet.invalid/') {
  const sourceIds = new Map();
  const sourceText = new Map();
  const pageIds = new Map();
  const pageText = new Map();
  const sourceImages = new Map();
  const pageImages = new Map();
  const sourcePlaceholders = new Map();
  const pagePlaceholders = new Map();
  const sourceLabels = new Map();
  const pageLabels = new Map();
  const sourceConfiguredClasses = new Map();
  const pageClasses = new Map();
  for (const item of data.items) {
    if (item.kind !== 'components') continue;
    for (const usage of item.usages) {
      const element = usage.element;
      if (!element?.tag) continue;
      const candidate = { item, usage };
      addToIndex(sourceIds, element.id, candidate);
      addToIndex(sourceText, contentKey(element), candidate);
      addToIndex(sourceImages, imageKey(element, pageUrl), candidate);
      addToIndex(sourcePlaceholders, attributeKey(element, 'placeholder'), candidate);
      addToIndex(sourceLabels, attributeKey(element, 'ariaLabel'), candidate);
      for (const className of new Set((element.inventoryTypes || []).map((rule) => rule.className))) addToIndex(sourceConfiguredClasses, JSON.stringify([element.tag, className]), candidate);
    }
  }
  for (const element of rendered) {
    addToIndex(pageIds, element.id, element);
    addToIndex(pageText, contentKey(element), element);
    addToIndex(pageImages, imageKey(element, pageUrl), element);
    addToIndex(pagePlaceholders, attributeKey(element, 'placeholder'), element);
    addToIndex(pageLabels, attributeKey(element, 'ariaLabel'), element);
    if (sourceConfiguredClasses.size) for (const className of element.classes || []) {
      const key = JSON.stringify([element.tag, className]);
      if (sourceConfiguredClasses.has(key)) addToIndex(pageClasses, key, element);
    }
  }
  const matches = [];
  const used = new Set();
  for (const [id, sources] of sourceIds) {
    const page = pageIds.get(id);
    if (sources.length !== 1 || page?.length !== 1 || !page[0].visible || page[0].tag !== sources[0].usage.element.tag) continue;
    matches.push({ ...sources[0], rendered: page[0], method: 'unique ID and tag' });
    used.add(`${page[0].tag}:${page[0].index}`);
  }
  const configuredCandidates = new Map();
  for (const [key, sources] of sourceConfiguredClasses) {
    const page = pageClasses.get(key);
    if (sources.length !== 1 || page?.length !== 1 || !page[0].visible || used.has(`${page[0].tag}:${page[0].index}`)) continue;
    const sourceId = sources[0].usage.element.id;
    if (sourceId && (sourceId !== page[0].id || sourceIds.get(sourceId)?.length !== 1 || pageIds.get(sourceId)?.length !== 1)) continue;
    const renderedKey = `${page[0].tag}:${page[0].index}`;
    if (!configuredCandidates.has(renderedKey)) configuredCandidates.set(renderedKey, { rendered: page[0], sources: new Set() });
    configuredCandidates.get(renderedKey).sources.add(sources[0]);
  }
  for (const [renderedKey, candidate] of configuredCandidates) {
    // Two configured classes can point at different source elements. Do not
    // choose one by iteration order or fall back to text in that case.
    used.add(renderedKey);
    if (candidate.sources.size !== 1) continue;
    matches.push({ ...[...candidate.sources][0], rendered: candidate.rendered, method: 'unique configured class and tag' });
  }
  for (const [sourceIndex, pageIndex, method] of [[sourcePlaceholders, pagePlaceholders, 'unique placeholder and tag'], [sourceLabels, pageLabels, 'unique accessible label and tag']]) {
    for (const [key, sources] of sourceIndex) {
      const page = pageIndex.get(key);
      if (sources.length !== 1 || page?.length !== 1 || !page[0].visible || used.has(`${page[0].tag}:${page[0].index}`)) continue;
      const sourceId = sources[0].usage.element.id;
      if (sourceId && (sourceId !== page[0].id || sourceIds.get(sourceId)?.length !== 1 || pageIds.get(sourceId)?.length !== 1)) continue;
      matches.push({ ...sources[0], rendered: page[0], method });
      used.add(`${page[0].tag}:${page[0].index}`);
    }
  }
  for (const [key, sources] of sourceText) {
    const page = pageText.get(key);
    if (sources.length !== 1 || page?.length !== 1 || !page[0].visible || used.has(`${page[0].tag}:${page[0].index}`)) continue;
    // A candidate with an ID must agree with that ID; do not fall back to text on conflict.
    const sourceId = sources[0].usage.element.id;
    if (sourceId && (sourceId !== page[0].id || sourceIds.get(sourceId)?.length !== 1 || pageIds.get(sourceId)?.length !== 1)) continue;
    matches.push({ ...sources[0], rendered: page[0], method: 'unique text and tag' });
    used.add(`${page[0].tag}:${page[0].index}`);
  }
  for (const [key, sources] of sourceImages) {
    const page = pageImages.get(key);
    if (sources.length !== 1 || page?.length !== 1 || !page[0].visible || used.has(`${page[0].tag}:${page[0].index}`)) continue;
    const sourceId = sources[0].usage.element.id;
    if (sourceId && (sourceId !== page[0].id || sourceIds.get(sourceId)?.length !== 1 || pageIds.get(sourceId)?.length !== 1)) continue;
    matches.push({ ...sources[0], rendered: page[0], method: 'unique image source' });
    used.add(`${page[0].tag}:${page[0].index}`);
  }
  // When identical text/class occurrences belong to one inventory item, show the
  // real visual as a group example without claiming which source line produced it.
  for (const [key, sources] of sourceText) {
    const page = pageText.get(key) || [];
    if (sources.length < 2 || !classesKey(sources[0].usage.element)) continue;
    if (sources.some((source) => source.item !== sources[0].item || source.usage.element.id || classesKey(source.usage.element) !== classesKey(sources[0].usage.element))) continue;
    for (const element of page) {
      const renderedKey = `${element.tag}:${element.index}`;
      if (!element.visible || element.id || used.has(renderedKey) || classesKey(element) !== classesKey(sources[0].usage.element)) continue;
      matches.push({ item: sources[0].item, usage: { file: 'Multiple possible source locations', element: sources[0].usage.element }, rendered: element, method: 'matching text and classes; source location ambiguous' });
      used.add(renderedKey);
    }
  }
  return matches;
}

/** A configured mapping is a user assertion, even when its source record exists. */
export function applySourceLinks(data, rendered, matches, rules) {
  const locations = rules.map((rule, index) => {
    const candidates = data.items.flatMap((item) => item.kind === 'components'
      ? item.usages.filter((usage) => usage.file === rule.file && usage.line === rule.line && usage.element?.tag).map((usage) => ({ item, usage })) : []);
    if (candidates.length !== 1) throw new Error(`Source link ${index + 1} must identify exactly one recorded element in the scanned source. Check the file, line, and scan scope.`);
    return candidates[0];
  });
  const byElement = new Map(matches.map((match) => [`${match.rendered.tag}:${match.rendered.index}`, match]));
  for (const element of rendered) {
    if (!element.visible || !Number.isInteger(element.sourceLinkIndex)) continue;
    const index = element.sourceLinkIndex;
    const location = locations[index];
    if (!location || element.tag !== location.usage.element.tag) throw new Error(`Source link ${index + 1} matches a rendered element with a different tag than its source.`);
    const match = { ...location, rendered: element, method: 'configured selector and source location', manualSelector: rules[index].selector };
    if (isUICaptureCandidate(match)) byElement.set(`${element.tag}:${element.index}`, match);
  }
  return [...byElement.values()];
}

/** Capture actual elements in an isolated browser session; no clicks, typing, or existing cookies. */
export async function capturePage(data, inputUrl, options = {}) {
  // Publish evidence only after the whole capture and browser cleanup succeed.
  // Keep large immutable source records and existing image strings shared.
  const working = { ...data, items: data.items.map((item) => ({ ...item, ...(item.captures ? { captures: [...item.captures] } : {}) })) };
  const freshKeys = ['scanRunId', 'scanProgress', 'crossPageConsistency', 'decisionSummary', 'baselineSummary', 'elementBaselineSummary', ...(!options.append ? ['elementConsistency', 'layoutAudit', 'responsiveAudit'] : [])];
  for (const key of freshKeys) delete working[key];
  for (const key of ['_sourceIdCounts', '_sourceHashes']) {
    if (data[key]) Object.defineProperty(working, key, { value: data[key], enumerable: false });
  }
  await runWithCaptureDeadline((deadline) => captureWithinDeadline(working, inputUrl, options, deadline), { timeoutMs: options.captureTimeoutMs });
  for (const key of freshKeys) if (!Object.hasOwn(working, key)) delete data[key];
  Object.assign(data, working);
  return data;
}

async function captureWithinDeadline(data, inputUrl, options, deadline) {
  let url;
  try { url = new URL(inputUrl); } catch { throw new Error('Capture requires a valid HTTP(S) page URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Capture requires an HTTP(S) URL without embedded credentials.');
  const viewport = validateViewport(options.viewport || DEFAULT_VIEWPORT);
  const colorScheme = validateColorScheme(options.colorScheme || 'light');
  const capturePixelRatio = validatePixelRatio(options.pixelRatio ?? DEFAULT_PIXEL_RATIO);
  validateCaptureResolution(viewport, capturePixelRatio);
  const responsiveViewports = options.responsiveViewports ? validateResponsiveViewports(options.responsiveViewports, capturePixelRatio) : null;
  const maskSelectors = validateMaskSelectors(options.maskSelectors || []);
  const buttonGroups = validateButtonGroups(options.buttonGroups || []);
  const elementGroups = validateElementGroups(options.elementGroups || []);
  const layoutChecks = validateLayoutChecks(options.layoutChecks === undefined ? [] : options.layoutChecks);
  const layoutMedia = options.layoutMedia === undefined ? 'screen' : options.layoutMedia;
  if (!['screen', 'print'].includes(layoutMedia)) throw new Error('Layout media must be screen or print.');
  const sourceLinks = validateSourceLinks(options.sourceLinks || []);
  const actions = validateCaptureActions(options.actions || []);
  // Validate even rules for other selected routes, before launching a browser.
  applySourceLinks(data, [], [], sourceLinks);
  const chromium = options.browserType || (await import('playwright')).chromium;
  const previousConsistency = options.append ? data.consistency : null;
  const previousSummary = options.append ? data.captureSummary : null;
  const previousElements = options.append ? data.elementConsistency?.pages || [] : [];
  const previousLayoutPages = options.append && data.layoutAudit?.format === 'ui-sheet/layout-pages-v1' ? data.layoutAudit.pages || [] : [];
  const previousResponsivePages = options.append && data.responsiveAudit?.format === 'ui-sheet/responsive-pages-v1' ? data.responsiveAudit.pages || [] : [];
  let browser;
  try {
    try {
      browser = deadline.ownBrowser(await chromium.launch({ headless: true, ...(options.browserPath ? { executablePath: options.browserPath } : {}) }));
    } catch (error) {
      throw new Error(`Could not start the capture browser. Install Chromium with "npx playwright install chromium" or supply --browser with a compatible browser executable. ${error.message.split('\n')[0]}`);
    }
    const version = typeof browser.version === 'function' ? browser.version() : '';
    // Device pixel ratio can itself affect site styles and is part of the
    // comparison context, even though the CSS viewport dimensions are unchanged.
    let context;
    try {
      context = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: capturePixelRatio, ...(options.storageState ? { storageState: options.storageState } : {}) });
    } catch (error) {
      if (options.storageState) throw new Error('Could not initialize the supplied browser state. Verify the state file and try again.');
      throw error;
    }
    const page = await context.newPage();
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response?.ok()) throw new Error(`Capture page failed with HTTP ${response?.status() || 'unknown'}.`);
    if (new URL(page.url()).origin !== url.origin) throw new Error('Capture page navigated to another origin; provide the final URL explicitly.');
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await page.evaluate(async () => {
      if (document.fonts) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]);
    });
    if (actions.length) await page.mouse.move(0, 0);
    for (const action of actions) {
      deadline.throwIfExpired();
      const target = page.locator(`css:light=${action.selector}`);
      if (await target.count() !== 1) throw new Error('Each capture action must match exactly one element.');
      if (action.kind === 'focus') await target.focus({ timeout: 3000 });
      else await target.hover({ timeout: 3000 });
      const verified = await target.evaluate((element, kind) => kind === 'focus' ? document.activeElement === element : element.matches(':hover'), action.kind, { timeout: 3000 });
      if (!verified) throw new Error(`The requested ${action.kind} state was not established.`);
    }
    if (maskSelectors.length) {
      try { await page.evaluate((selectors) => { for (const selector of selectors) document.querySelector(selector); }, maskSelectors); }
      catch { throw new Error('Mask selectors must be valid CSS selectors.'); }
    }
    if (buttonGroups.length) {
      try { await page.evaluate((groups) => { for (const group of groups) document.querySelector(group.selector); }, buttonGroups); }
      catch { throw new Error('Button group selectors must be valid CSS selectors.'); }
    }
    if (sourceLinks.length) {
      try { await page.evaluate((rules) => { for (const rule of rules) document.querySelector(rule.selector); }, sourceLinks); }
      catch { throw new Error('Source link selectors must be valid CSS selectors.'); }
    }
    const maskOptions = maskSelectors.length ? { mask: maskSelectors.map((selector) => page.locator(`css=${selector}`)), maskColor: '#202020' } : {};
    const elementSnapshot = elementGroups.length ? await snapshotElementGroups(page, elementGroups, { instrumentedSources: options.instrumentedSources === true }) : null;
    deadline.throwIfExpired();
    const normalizedPath = (pathname) => pathname.replace(/\/+$/, '') || '/';
    if (normalizedPath(new URL(page.url()).pathname) !== normalizedPath(url.pathname)) throw new Error('Capture page navigated to a different route; provide the final URL explicitly.');
    const tags = [...new Set(['button', ...data.items.flatMap((item) => item.kind === 'components' ? item.usages.map((usage) => usage.element?.tag).filter(Boolean) : [])])]
      .filter((tag) => /^[a-z][a-z0-9-]*$/.test(tag));
    const styleProperties = BUTTON_STYLE_FIELDS.map(([property]) => property);
    const backgroundPolicy = { gradient: GRADIENT_PATTERN, filter: FILTER_PATTERN, unsafe: UNSAFE_IMAGE_PATTERN, maxLength: MAX_BACKGROUND_IMAGE_LENGTH, maxFilterLength: MAX_FILTER_LENGTH };
    const snapshot = await page.evaluate(({ wantedTags, styleProperties, buttonGroups, sourceLinks, visibilityCheckLimit, instrumentedSources, backgroundPolicy }) => {
      const wanted = new Set(wantedTags);
      const gradient = new RegExp(backgroundPolicy.gradient, 'i');
      const filter = new RegExp(backgroundPolicy.filter, 'i');
      const unsafeImage = new RegExp(backgroundPolicy.unsafe, 'i');
      const styleValue = (style, property) => {
        const value = style[property];
        if (property === 'filter') return value === 'none' || (value.length <= backgroundPolicy.maxFilterLength && filter.test(value) && !unsafeImage.test(value)) ? value : '';
        if (property !== 'backgroundImage') return value;
        return value === 'none' || (value.length <= backgroundPolicy.maxLength && gradient.test(value) && !unsafeImage.test(value)) ? value : '';
      };
      const counts = Object.create(null);
      const result = [];
      const parentIds = new WeakMap();
      let nextParent = 0;
      let overlappingGroups = false;
      let overlappingSourceLinks = false;
      let visibilityChecks = 0;
      const sourceLinkCounts = sourceLinks.map(() => 0);
      for (const element of document.querySelectorAll('*')) {
        const tag = element.localName;
        const index = counts[tag] || 0;
        counts[tag] = index + 1;
        if (!wanted.has(tag) && !element.id) continue;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        let visible = rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
        if (tag === 'button' && visible) {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const ancestorStyle = getComputedStyle(parent);
            if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || Number(ancestorStyle.opacity) === 0) { visible = false; break; }
          }
        }
        let visibilityEvidence = 'unverified';
        if (tag === 'button' && visible && visibilityChecks < visibilityCheckLimit && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight) {
          visibilityChecks++;
          let hits = 0;
          let missingHit = false;
          for (const x of [0.15, 0.5, 0.85]) for (const y of [0.15, 0.5, 0.85]) {
            const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
            if (!hit) missingHit = true;
            else if (hit === element || element.contains(hit)) hits++;
          }
          if (!missingHit) visibilityEvidence = hits === 9 ? 'clear' : 'possibly-blocked';
        }
        const simpleTextStyle = (/^h[1-6]$/.test(tag) || tag === 'label' || tag === 'a') && !element.querySelector('img, picture, video, canvas, svg');
        const styleKey = simpleTextStyle ? JSON.stringify(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textDecorationLine', 'boxShadow'].map((property) => style[property])) : '';
        const parent = element.parentElement;
        if (tag === 'button' && parent && !parentIds.has(parent)) parentIds.set(parent, ++nextParent);
        const groupSize = tag === 'button' ? element.closest('.btn-group-sm, .btn-group-lg') : null;
        const assignedGroups = tag === 'button' ? buttonGroups.filter((group) => element.matches(group.selector)) : [];
        if (assignedGroups.length > 1) overlappingGroups = true;
        const assigned = assignedGroups[0];
        const assignedLinks = visible && wanted.has(tag) ? sourceLinks.flatMap((rule, index) => element.matches(rule.selector) ? [index] : []) : [];
        if (assignedLinks.length > 1) overlappingSourceLinks = true;
        if (assignedLinks.length === 1) sourceLinkCounts[assignedLinks[0]]++;
        const buttonData = tag === 'button' ? {
          disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
          stateful: ['aria-pressed', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-current'].some((name) => element.hasAttribute(name)) || element.classList.contains('active') || element.matches(':focus, :hover'),
          variant: assigned?.variant || element.getAttribute('data-ui-sheet-variant') || element.getAttribute('data-variant') || '',
          variantEvidence: assigned?.variant ? 'configured variant' : 'page-provided variant',
          family: assigned?.family || element.getAttribute('data-ui-sheet-group') || '',
          familyEvidence: assigned?.family ? 'configured group' : 'page-provided group',
          parentGroup: parent ? `container ${parentIds.get(parent)}` : '',
          sizeHint: groupSize?.classList.contains('btn-group-sm') ? 'small' : groupSize?.classList.contains('btn-group-lg') ? 'large' : '',
          style: Object.fromEntries(styleProperties.map((property) => [property, styleValue(style, property)])),
          visibilityEvidence,
        } : {};
        const sourceMarker = instrumentedSources && wanted.has(tag) && element.hasAttribute('data-ui-sheet-source') ? (element.getAttribute('data-ui-sheet-source') || '').slice(0, 2049) : null;
        result.push({ tag, index, id: element.id || '', role: element.getAttribute('role') || '', type: element.getAttribute('type') || '', classes: [...element.classList].sort(), placeholder: element.getAttribute('placeholder') || '', ariaLabel: element.getAttribute('aria-label') || '', src: tag === 'img' ? (element.getAttribute('src') || '') : '', alt: tag === 'img' ? (element.getAttribute('alt') || '') : '', hasMedia: tag === 'a' && !!element.querySelector('img, picture, video, canvas'), inBrand: ['a', 'img'].includes(tag) && !!element.closest('[class*="brand" i], [class*="logo" i], header, nav'), width: rect.width, height: rect.height, styleKey, text: wanted.has(tag) ? (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 501) : '', visible, ...(sourceMarker !== null ? { sourceMarker } : {}), ...(assignedLinks.length === 1 ? { sourceLinkIndex: assignedLinks[0] } : {}), ...buttonData });
      }
      const root = document.documentElement;
      const body = document.body;
      const explicitTheme = root.getAttribute('data-ui-sheet-theme') || root.getAttribute('data-theme') || root.getAttribute('data-bs-theme') || body?.getAttribute('data-theme') || '';
      const appTheme = /^[a-z0-9_-]{1,40}$/i.test(explicitTheme) ? explicitTheme.toLowerCase()
        : [root, body].some((node) => node?.classList.contains('dark') || node?.classList.contains('theme-dark')) ? 'dark'
          : [root, body].some((node) => node?.classList.contains('light') || node?.classList.contains('theme-light')) ? 'light' : 'unspecified';
      const theme = `app:${appTheme};browser:${matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'}`;
      return { elements: result, theme, overlappingGroups, overlappingSourceLinks, sourceLinkCounts };
    }, { wantedTags: tags, styleProperties, buttonGroups, sourceLinks, visibilityCheckLimit: MAX_VISIBILITY_CHECKS, instrumentedSources: options.instrumentedSources === true, backgroundPolicy });
    if (snapshot.overlappingGroups) throw new Error('Configured button groups overlap on at least one button. Make their selectors mutually exclusive.');
    if (snapshot.overlappingSourceLinks) throw new Error('Configured source links overlap on at least one visible element. Make their selectors mutually exclusive.');
    if (snapshot.sourceLinkCounts?.some((count) => count > 1)) throw new Error('A configured source link matches more than one visible element on this page. Use a more specific selector.');
    const renderedByKey = new Map((Array.isArray(snapshot) ? snapshot : snapshot.elements).map((element) => [`${element.tag}:${element.index}`, element]));
    for (const element of elementSnapshot?.elements || []) {
      const key = `${element.tag}:${element.index}`;
      renderedByKey.set(key, { ...renderedByKey.get(key), ...element });
    }
    const rendered = [...renderedByKey.values()];
    const theme = Array.isArray(snapshot) ? 'unknown' : snapshot.theme;
    const inferredMatches = matchRenderedElements(data, rendered, page.url());
    const markedMatches = options.instrumentedSources === true ? applyInstrumentedSources(data, rendered, inferredMatches) : inferredMatches;
    const allMatches = applySourceLinks(data, rendered, markedMatches, sourceLinks);
    const matches = allMatches.filter(isUICaptureCandidate);
    const displayUrl = `${url.origin}${url.pathname}`;
    const sourceByElement = new Map(allMatches.map((match) => {
      const location = match.usage;
      const elementId = location.element?.id || '';
      const stableId = !data.warnings?.length && match.method === 'unique ID and tag' && data._sourceIdCounts?.get(elementId) === 1 && /^[a-z][a-z0-9_.:-]{0,99}$/i.test(elementId);
      const source = location.file && Number.isInteger(location.line) && !match.method.includes('ambiguous')
        ? { status: match.manualSelector ? 'manual' : match.instrumentedHash ? 'instrumented' : 'likely', file: location.file, line: location.line, ...(match.instrumentedHash ? { column: location.column, sha256: match.instrumentedHash } : {}), method: match.method, ...(stableId ? { elementId } : {}) }
        : { status: 'unresolved', method: match.method };
      return [`${match.rendered.tag}:${match.rendered.index}`, source];
    }));
    for (const element of elementSnapshot?.elements || []) {
      const manual = allMatches.find((match) => match.manualSelector && match.rendered.tag === element.tag && match.rendered.index === element.index);
      if (manual) element.manualSelector = manual.manualSelector;
    }
    const buttons = rendered.filter((element) => element.tag === 'button').map((element) => ({ ...element, source: sourceByElement.get(`button:${element.index}`) || { status: 'unresolved' } }));
    const pageElements = elementSnapshot ? analyzeElementConsistency(elementSnapshot.elements.map((element) => ({ ...element, source: sourceByElement.get(`${element.tag}:${element.index}`) || { status: 'unresolved' } })), { url: displayUrl, viewport, theme, pixelRatio: capturePixelRatio, browser: { engine: 'chromium', version }, baselines: options.elementBaselines || [] }) : null;
    const pageConsistency = analyzeButtonConsistency(buttons, { url: displayUrl, viewport, theme, pixelRatio: capturePixelRatio, baselines: options.baselines || [] });
    pageConsistency.scope.instrumentedSources = options.instrumentedSources === true;
    if (pageConsistency.scope.instrumentedSources) {
      const byId = new Map(buttons.map((button) => [`button:${button.index}`, button]));
      const eligible = pageConsistency.observations.map((observation) => byId.get(observation.id));
      const matched = eligible.filter((button) => button.source?.status === 'instrumented').length;
      const missing = eligible.filter((button) => typeof button.sourceMarker !== 'string').length;
      pageConsistency.instrumentation = { eligible: eligible.length, matched, missing, invalidOrOverridden: eligible.length - matched - missing };
    }
    pageConsistency.scope.browser = { engine: 'chromium', version: typeof version === 'string' ? version.slice(0, 100) : '' };
    pageConsistency.scope.maskSelectorsConfigured = maskSelectors.length;
    if (buttonGroups.length) pageConsistency.scope.buttonGroups = buttonGroups;
    if (actions.length) pageConsistency.scope.actions = actions;
    pageConsistency.scope.visibilityCheckLimit = MAX_VISIBILITY_CHECKS;
    pageConsistency.appearances = summarizeAppearances(pageConsistency.observations);
    pageConsistency.previews = {};
    pageConsistency.previewLimit = MAX_COMPARISON_IMAGES;
    const observations = new Map(pageConsistency.observations.map((observation) => [observation.id, observation]));
    for (const appearance of pageConsistency.appearances) {
      const observation = observations.get(appearance.example);
      try { appearance.approval = { page: baselineTemplate(pageConsistency, observation) }; }
      catch { continue; }
      try { appearance.approval.crossPage = baselineTemplate(pageConsistency, observation, { crossPage: true }); }
      catch { /* Cross-page approval needs explicit group and variant evidence. */ }
    }
    const buttonSnapshots = new Map(buttons.map((button) => [`button:${button.index}`, button]));
    const examples = [...new Set([...pageConsistency.findings.flatMap((finding) => [finding.common.example, finding.outlier.example]), ...pageConsistency.appearances.map((appearance) => appearance.example)].filter(Boolean))];
    // Compare every eligible button first; capture only representative examples.
    // Dynamic or covered elements remain in the observations with no image.
    for (const example of examples.slice(0, MAX_COMPARISON_IMAGES)) {
      const snapshot = buttonSnapshots.get(example);
      const observation = observations.get(example);
      if (!snapshot || !observation) continue;
      const currentUrl = new URL(page.url());
      if (currentUrl.origin !== url.origin || normalizedPath(currentUrl.pathname) !== normalizedPath(url.pathname)) throw new Error('Capture page navigated away; provide the final URL explicitly.');
      try {
        // The snapshot uses document.querySelectorAll, which excludes shadow DOM.
        // Playwright's ordinary CSS locators pierce open shadow roots by default.
        const locator = page.locator('css:light=button').nth(snapshot.index);
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
        const current = await locator.evaluate((element, { properties, selector, backgroundPolicy }) => {
          const style = getComputedStyle(element);
          const gradient = new RegExp(backgroundPolicy.gradient, 'i');
          const filter = new RegExp(backgroundPolicy.filter, 'i');
          const unsafeImage = new RegExp(backgroundPolicy.unsafe, 'i');
          const styleValue = (property) => {
            const value = style[property];
            if (property === 'filter') return value === 'none' || (value.length <= backgroundPolicy.maxFilterLength && filter.test(value) && !unsafeImage.test(value)) ? value : '';
            if (property !== 'backgroundImage') return value;
            return value === 'none' || (value.length <= backgroundPolicy.maxLength && gradient.test(value) && !unsafeImage.test(value)) ? value : '';
          };
          const r = element.getBoundingClientRect();
          const left = Math.max(r.left, 0), top = Math.max(r.top, 0);
          const right = Math.min(r.right, innerWidth - 1), bottom = Math.min(r.bottom, innerHeight - 1);
          let unobscured = r.width <= innerWidth && r.height <= innerHeight && right > left && bottom > top;
          for (const x of [0.15, 0.5, 0.85]) for (const y of [0.15, 0.5, 0.85]) {
            const hit = document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y);
            if (!hit || (hit !== element && !element.contains(hit))) unobscured = false;
          }
          return { tag: element.localName, id: element.id || '', text: (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 501), sourceMarker: element.getAttribute('data-ui-sheet-source'), disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true', stateful: ['aria-pressed', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-current'].some((name) => element.hasAttribute(name)) || element.classList.contains('active') || element.matches(':focus, :hover'), style: Object.fromEntries(properties.map((property) => [property, styleValue(property)])), unobscured, selectorMatches: !selector || element.matches(selector) };
        }, { properties: styleProperties, selector: sourceLinks[snapshot.sourceLinkIndex]?.selector, backgroundPolicy }, { timeout: 3000 });
        if (current.tag !== 'button' || (snapshot.id && current.id !== snapshot.id) || current.text !== snapshot.text || (observation.source?.status === 'instrumented' && current.sourceMarker !== snapshot.sourceMarker) || current.disabled || current.stateful || !current.unobscured || !current.selectorMatches || !isSameButtonStyle(observation.style, current.style)) continue;
        let pixelRatio = capturePixelRatio;
        let image = await locator.screenshot({ type: 'png', scale: 'device', animations: 'disabled', timeout: 4000, ...maskOptions });
        if (image.length > MAX_IMAGE_BYTES) {
          image = await locator.screenshot({ type: 'png', scale: 'css', animations: 'disabled', timeout: 4000, ...maskOptions });
          pixelRatio = 1;
        }
        if (image.length <= MAX_IMAGE_BYTES) {
          const dimensions = image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? { width: image.readUInt32BE(16), height: image.readUInt32BE(20) } : {};
          pageConsistency.previews[example] = { image: `data:image/png;base64,${image.toString('base64')}`, pixelRatio, ...dimensions };
        }
      } catch {
        // The page can change between observation and capture; never fabricate a preview.
      }
    }
    const attemptedPreviews = Math.min(examples.length, MAX_COMPARISON_IMAGES);
    const capturedPreviews = Object.keys(pageConsistency.previews).length;
    pageConsistency.previewCoverage = {
      requested: examples.length,
      attempted: attemptedPreviews,
      captured: capturedPreviews,
      unavailable: attemptedPreviews - capturedPreviews,
      omitted: examples.length - attemptedPreviews,
    };
    if (!options.append) for (const item of data.items) delete item.captures;
    let captured = 0;
    const capturedKeys = new Set();
    const capturedStyles = new Map();
    for (const match of matches) {
      if (captured >= MAX_CAPTURES) break;
      if ((match.item.captures || []).filter((capture) => capture.page === displayUrl).length >= MAX_PER_ITEM) continue;
      const { tag, index, id } = match.rendered;
      const styleKey = match.rendered.styleKey && JSON.stringify([tag, match.rendered.role, match.rendered.classes, match.rendered.styleKey]);
      if (styleKey && capturedStyles.get(match.item)?.has(styleKey)) continue;
      const key = `${tag}:${index}`;
      if (capturedKeys.has(key)) continue;
      const locator = page.locator(`css:light=${tag}`).nth(index);
      const currentUrl = new URL(page.url());
      if (currentUrl.origin !== url.origin || normalizedPath(currentUrl.pathname) !== normalizedPath(url.pathname)) throw new Error('Capture page navigated away; provide the final URL explicitly.');
      try {
        const current = await locator.evaluate((element, selector) => ({ tag: element.localName, id: element.id || '', role: element.getAttribute('role') || '', type: element.getAttribute('type') || '', placeholder: element.getAttribute('placeholder') || '', ariaLabel: element.getAttribute('aria-label') || '', src: element.localName === 'img' ? (element.getAttribute('src') || '') : '', classes: [...element.classList].sort(), sourceMarker: element.getAttribute('data-ui-sheet-source'), text: (element.innerText || '').replace(/\s+/g, ' ').trim(), selectorMatches: !selector || element.matches(selector) }), match.manualSelector, { timeout: 3000 });
        if (current.tag !== tag || (id && current.id !== id) || (match.manualSelector && !current.selectorMatches) || (match.instrumentedHash && current.sourceMarker !== match.rendered.sourceMarker) || (match.method === 'unique placeholder and tag' && attributeKey(current, 'placeholder') !== attributeKey(match.usage.element, 'placeholder')) || (match.method === 'unique accessible label and tag' && attributeKey(current, 'ariaLabel') !== attributeKey(match.usage.element, 'ariaLabel')) || ((match.method === 'unique text and tag' || match.method.startsWith('matching text and classes')) && normalize(current.text) !== normalize(match.usage.element.text)) || (match.method.startsWith('matching text and classes') && classesKey(current) !== classesKey(match.usage.element)) || (match.method === 'unique image source' && imageKey(current, page.url()) !== imageKey(match.usage.element, page.url()))) continue;
        if (match.method === 'unique configured class and tag' && !match.usage.element.inventoryTypes?.some((rule) => (current.classes || []).includes(rule.className))) continue;
        if (!isUICaptureCandidate({ rendered: { ...match.rendered, classes: current.classes || [], role: current.role || '', type: current.type || '' }, usage: match.usage })) continue;
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
        const unobscured = await locator.evaluate((element) => {
          const r = element.getBoundingClientRect();
          if (r.width > window.innerWidth || r.height > window.innerHeight) return false;
          const left = Math.max(r.left, 0);
          const top = Math.max(r.top, 0);
          const right = Math.min(r.right, window.innerWidth - 1);
          const bottom = Math.min(r.bottom, window.innerHeight - 1);
          if (right <= left || bottom <= top) return false;
          for (const xFraction of [0.15, 0.5, 0.85]) {
            for (const yFraction of [0.15, 0.5, 0.85]) {
              const hit = document.elementFromPoint(left + (right - left) * xFraction, top + (bottom - top) * yFraction);
              if (!hit || (hit !== element && !element.contains(hit))) return false;
            }
          }
          return true;
        }, undefined, { timeout: 3000 });
        if (!unobscured) continue;
        let pixelRatio = capturePixelRatio;
        let image = await locator.screenshot({ type: 'png', scale: 'device', animations: 'disabled', timeout: 4000, ...maskOptions });
        // A large control may exceed the report's per-image limit at higher density.
        // Keep it at CSS resolution when possible instead of losing it entirely.
        if (image.length > MAX_IMAGE_BYTES) {
          image = await locator.screenshot({ type: 'png', scale: 'css', animations: 'disabled', timeout: 4000, ...maskOptions });
          pixelRatio = 1;
        }
        if (image.length > MAX_IMAGE_BYTES) continue;
        if (!match.item.captures) match.item.captures = [];
        const label = normalize(match.usage.element.text || match.usage.element.placeholder || match.usage.element.ariaLabel).slice(0, 100);
        const element = { tag, ...(current.role ? { role: current.role } : {}), ...(current.type ? { type: current.type } : {}), ...(current.classes?.length ? { classes: current.classes } : {}) };
        const configured = match.usage.element.inventoryTypes?.some((rule) => (current.classes || []).includes(rule.className));
        match.item.captures.push({ image: `data:image/png;base64,${image.toString('base64')}`, file: match.usage.file, line: match.usage.line, ...(match.instrumentedHash ? { column: match.usage.column } : {}), method: match.method, page: displayUrl, pixelRatio, element, ...(configured ? { classification: 'configured UI class' } : {}), ...(label ? { label } : {}) });
        capturedKeys.add(key);
        if (styleKey) {
          if (!capturedStyles.has(match.item)) capturedStyles.set(match.item, new Set());
          capturedStyles.get(match.item).add(styleKey);
        }
        captured++;
      } catch {
        // Dynamic, hidden, or detached elements are skipped rather than given a misleading preview.
      }
    }
    if (pageElements) {
      for (const appearance of pageElements.appearances) {
        const observation = pageElements.observations.find((entry) => entry.id === appearance.example);
        try { appearance.approval = { page: elementBaselineTemplate(pageElements, observation) }; } catch { continue; }
        try { appearance.approval.crossPage = elementBaselineTemplate(pageElements, observation, { crossPage: true }); } catch { /* Requires an explicit variant. */ }
      }
      await captureElementPreviews(page, elementGroups, elementSnapshot, pageElements, { pixelRatio: capturePixelRatio, maskOptions, instrumentedSources: options.instrumentedSources === true, throwIfExpired: deadline.throwIfExpired, expectedUrl: url.href });
      pageElements.scope.maskSelectorsConfigured = maskSelectors.length;
      pageElements.scope.elementGroups = elementGroups;
      if (actions.length) pageElements.scope.actions = actions;
      pageElements.scope.instrumentedSources = options.instrumentedSources === true;
      if (options.instrumentedSources === true) {
        const matched = pageElements.observations.filter((observation) => observation.source?.status === 'instrumented').length;
        pageElements.instrumentation = { eligible: pageElements.observations.length, matched };
        if (matched < pageElements.observations.length && pageElements.coverage === 'observed') pageElements.coverage = 'partial';
      }
      data.elementConsistency = { format: 'ui-sheet/element-pages-v1', pages: [...previousElements, pageElements] };
    }
    if (layoutChecks.length) {
      deadline.throwIfExpired();
      const layoutUrl = new URL(page.url());
      if (layoutUrl.origin !== url.origin || normalizedPath(layoutUrl.pathname) !== normalizedPath(url.pathname)) throw new Error('Layout capture page navigated away; provide the final URL explicitly.');
      if (layoutMedia === 'print') await page.emulateMedia({ media: 'print' });
      let layoutResult;
      try {
        layoutResult = await auditLayout(page, layoutChecks, {
          scope: { url: displayUrl, viewport, colorScheme, media: layoutMedia, pixelRatio: capturePixelRatio, browser: { engine: 'chromium', version } },
          pixelRatio: capturePixelRatio, maskOptions, throwIfExpired: deadline.throwIfExpired,
        });
      } finally {
        if (layoutMedia === 'print') await page.emulateMedia({ media: 'screen' });
      }
      deadline.throwIfExpired();
      const currentUrl = new URL(page.url());
      if (currentUrl.origin !== url.origin || normalizedPath(currentUrl.pathname) !== normalizedPath(url.pathname)) throw new Error('Layout capture page navigated away; provide the final URL explicitly.');
      data.layoutAudit = { format: 'ui-sheet/layout-pages-v1', pages: [...previousLayoutPages, layoutResult] };
    }
    if (responsiveViewports) {
      deadline.throwIfExpired();
      const previousPreviewChars = previousResponsivePages.reduce((total, page) => total + (page.viewports || []).reduce((sum, entry) => sum + (entry.previews || []).reduce((size, preview) => size + (preview.image?.length || 0), 0), 0), 0);
      const responsivePage = await auditResponsive(browser, data, url.href, {
        viewports: responsiveViewports, colorScheme, pixelRatio: capturePixelRatio,
        storageState: options.storageState, maskSelectors, actions, browserVersion: version,
        previewBudgetChars: Math.max(0, 24 * 1024 * 1024 - previousPreviewChars),
        throwIfExpired: deadline.throwIfExpired,
      });
      deadline.throwIfExpired();
      data.responsiveAudit = { format: 'ui-sheet/responsive-pages-v1', pages: [...previousResponsivePages, responsivePage] };
    }
    deadline.throwIfExpired();
    if (previousConsistency) {
      const pages = previousConsistency.pages || [previousConsistency];
      data.consistency = { format: 'ui-sheet/consistency-v2', pages: [...pages, pageConsistency] };
    } else data.consistency = pageConsistency;
    if (previousSummary) {
      const pages = previousSummary.pages || (previousSummary.url ? [{ url: previousSummary.url, captured: previousSummary.captured || 0 }] : []);
      data.captureSummary = { ...previousSummary, captured: (previousSummary.captured || 0) + captured, matched: (previousSummary.matched || 0) + matches.length, pages: [...pages, { url: displayUrl, captured }] };
    } else data.captureSummary = { url: displayUrl, captured, matched: matches.length, limit: MAX_CAPTURES };
    return data;
  } finally { /* The deadline owns bounded browser cleanup. */ }
}
