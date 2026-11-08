import { validateCaptureResolution, validateViewport } from './context.js';

export const DEFAULT_RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

export function validateResponsiveViewports(value, pixelRatio = 1) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('Responsive viewports must contain 1 to 8 viewport sizes.');
  const sizes = value.map((entry) => {
    const viewport = validateViewport(entry);
    validateCaptureResolution(viewport, pixelRatio);
    return viewport;
  });
  if (new Set(sizes.map(({ width, height }) => `${width}x${height}`)).size !== sizes.length) throw new Error('Responsive viewport sizes must be unique.');
  return sizes;
}

// Runs in the page, using rendered DOM geometry rather than guessing from CSS.
// Limits and skipped content are reported so an incomplete inspection is not
// mistaken for proof that an entire application is responsive.
function inspectResponsiveInPage() {
  const MAX_ELEMENTS = 4000, MAX_TEXT_NODES = 2500, MAX_FRAGMENTS = 3000, MAX_FINDINGS = 80, MAX_PAIRS = 50000;
  const tolerance = 2;
  const round = (value) => Math.round(value * 10) / 10;
  const bounds = (rect) => ({ x: round(rect.left + window.scrollX), y: round(rect.top + window.scrollY), width: round(rect.width), height: round(rect.height) });
  const viewportWidth = document.documentElement.clientWidth;
  const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
  let limited = false;
  const selectorFor = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.id && current.id.length <= 100) {
        const id = `#${CSS.escape(current.id)}`;
        try {
          if (document.querySelectorAll(id).length === 1) {
            const selector = [id, ...parts].join(' > ');
            return selector.length <= 500 ? selector : null;
          }
        } catch { /* use a structural path */ }
      }
      const tag = current.localName;
      if (!tag || !/^[a-z][a-z0-9-]*$/i.test(tag)) return null;
      let index = 1;
      for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.localName === tag) index++;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      if (parts.join(' > ').length > 500 || parts.length > 20) return null;
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const uniqueId = (element) => {
    if (!element.id || element.id.length > 100) return '';
    try { return document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1 ? element.id : ''; }
    catch { return ''; }
  };
  const isVisible = (element) => {
    if (!element || element.closest('[hidden], [inert], [aria-hidden="true"], script, style, template, noscript, svg, canvas')) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return false;
      if (current.localName === 'details' && !current.open) {
        const summary = [...current.children].find((child) => child.localName === 'summary');
        if (!summary?.contains(element)) return false;
      }
      if ((style.clip && style.clip !== 'auto') || (style.clipPath && style.clipPath !== 'none')) {
        const rect = current.getBoundingClientRect();
        if (rect.width <= 2 && rect.height <= 2) return false;
      }
    }
    return true;
  };
  const scrollContainer = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|overlay)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + tolerance) return true;
      // Content inside a deliberately clipped container does not create page overflow.
      if (/(hidden|clip)/.test(style.overflowX)) return true;
    }
    return false;
  };
  const findings = [];
  const regionHints = (element) => {
    const regions = new Set();
    for (let current = element; current; current = current.parentElement) {
      const role = current.getAttribute('role') || '';
      const names = `${current.id || ''} ${typeof current.className === 'string' ? current.className : ''}`;
      if (current.localName === 'aside' || role === 'complementary' || /(?:^|[\s_-])(sidebar|side[-_]?nav)(?:$|[\s_-])/i.test(names)) regions.add('sidebar');
      if (current.localName === 'header' || role === 'banner' || /(?:^|[\s_-])(header|top[-_]?bar)(?:$|[\s_-])/i.test(names)) regions.add('header');
      if (current.localName === 'nav' || role === 'navigation') regions.add('navigation');
    }
    return [...regions];
  };
  const add = (finding, ...elements) => {
    if (findings.length >= MAX_FINDINGS) { limited = true; return; }
    const regions = [...new Set(elements.flatMap(regionHints))];
    if (regions.length) finding.regions = regions;
    findings.push(finding);
  };
  const all = document.querySelectorAll('body *');
  const elementCount = Math.min(all.length, MAX_ELEMENTS);
  if (all.length > MAX_ELEMENTS) limited = true;
  let uninspected = 0;
  const landmarks = [];
  for (let i = 0; i < elementCount; i++) {
    const element = all[i];
    if ((element.localName === 'iframe' || element.localName === 'frame' || element.shadowRoot) && isVisible(element)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) uninspected++;
    }
    const role = element.getAttribute('role') || '';
    const names = `${element.id || ''} ${typeof element.className === 'string' ? element.className : ''}`;
    const kinds = [];
    if (element.localName === 'aside' || role === 'complementary' || /(?:^|[\s_-])(sidebar|side[-_]?nav)(?:$|[\s_-])/i.test(names)) kinds.push('sidebar');
    if (element.localName === 'header' || role === 'banner' || /(?:^|[\s_-])(header|top[-_]?bar)(?:$|[\s_-])/i.test(names)) kinds.push('header');
    if (element.localName === 'nav' || role === 'navigation') kinds.push('navigation');
    if (kinds.length && isVisible(element)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) for (const kind of kinds) {
        if (landmarks.filter((entry) => entry.kind === kind).length < 2) landmarks.push({ kind, bounds: bounds(rect) });
      }
    }
  }
  const overflowing = [];
  if (scrollWidth > viewportWidth + tolerance) {
    for (let i = 0; i < elementCount; i++) {
      const element = all[i];
      if (!isVisible(element) || scrollContainer(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || (rect.right <= viewportWidth + tolerance && rect.left >= -tolerance)) continue;
      if (overflowing.some((parent) => parent.contains(element))) continue;
      const selector = selectorFor(element);
      if (!selector) { limited = true; continue; }
      overflowing.push(element);
      add({ kind: 'horizontal-overflow', selector, tag: element.localName, elementId: uniqueId(element), bounds: bounds(rect), overflowPx: round(Math.max(0, rect.right - viewportWidth, -rect.left)), message: 'This element extends beyond the viewport and may cause horizontal overflow or clipping.' }, element);
    }
    if (!overflowing.length) add({ kind: 'horizontal-overflow', selector: 'html', tag: 'html', elementId: '', bounds: { x: 0, y: 0, width: viewportWidth, height: document.documentElement.clientHeight }, overflowPx: round(scrollWidth - viewportWidth), message: 'The document is wider than the viewport; inspect its overflow and positioned content.' });
  }

  const fragments = [];
  const clipped = new Set();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node, textNodes = 0;
  while ((node = walker.nextNode())) {
    if (++textNodes > MAX_TEXT_NODES) { limited = true; break; }
    if (!node.nodeValue?.trim() || !isVisible(node.parentElement)) continue;
    const parent = node.parentElement;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
    for (const rect of rects) {
      if (fragments.length >= MAX_FRAGMENTS) { limited = true; break; }
      let hidden = false;
      for (let ancestor = parent; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const clipX = /^(hidden|clip)$/.test(style.overflowX), clipY = /^(hidden|clip)$/.test(style.overflowY);
        if (!clipX && !clipY) continue;
        const box = ancestor.getBoundingClientRect();
        const outsideX = clipX && (rect.left < box.left - tolerance || rect.right > box.right + tolerance);
        const outsideY = clipY && (rect.top < box.top - tolerance || rect.bottom > box.bottom + tolerance);
        if (!outsideX && !outsideY) continue;
        hidden = true;
        const selector = selectorFor(parent), container = selectorFor(ancestor);
        if (!selector || !container) { limited = true; break; }
        const key = `${selector}\n${container}`;
        if (!clipped.has(key)) {
          clipped.add(key);
          add({ kind: 'clipped-text', selector, container, tag: parent.localName, elementId: uniqueId(parent), bounds: bounds(rect), message: 'Text extends beyond a clipping container and may be cut off; truncation may be intentional.' }, parent);
        }
        break;
      }
      if (!hidden) fragments.push({ element: parent, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, bounds: bounds(rect) });
    }
  }
  // Bucket by vertical position to avoid comparing every fragment on long pages.
  const buckets = new Map(), compared = new Set(), overlapKeys = new Set();
  let pairs = 0;
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i];
    const first = Math.floor(fragment.rect.top / 64), last = Math.min(first + 30, Math.floor(fragment.rect.bottom / 64));
    if (last < Math.floor(fragment.rect.bottom / 64)) limited = true;
    for (let bucket = first; bucket <= last; bucket++) {
      for (const otherIndex of buckets.get(bucket) || []) {
        const pair = `${otherIndex}:${i}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        if (++pairs > MAX_PAIRS) { limited = true; break; }
        const other = fragments[otherIndex];
        if (fragment.element === other.element || fragment.element.contains(other.element) || other.element.contains(fragment.element)) continue;
        const overlapX = Math.min(fragment.rect.right, other.rect.right) - Math.max(fragment.rect.left, other.rect.left);
        const overlapY = Math.min(fragment.rect.bottom, other.rect.bottom) - Math.max(fragment.rect.top, other.rect.top);
        if (overlapX <= tolerance || overlapY <= tolerance) continue;
        const selector = selectorFor(fragment.element), otherSelector = selectorFor(other.element);
        if (!selector || !otherSelector) { limited = true; continue; }
        const key = [selector, otherSelector].sort().join('\n');
        if (overlapKeys.has(key)) continue;
        overlapKeys.add(key);
        const sameParent = fragment.element.parentElement === other.element.parentElement;
        const container = sameParent ? selectorFor(fragment.element.parentElement) : null;
        add({ kind: 'overlapping-text', selector, otherSelector, ...(container ? { container, sameParent: true } : {}), tag: fragment.element.localName, elementId: uniqueId(fragment.element), bounds: fragment.bounds, otherBounds: other.bounds, overlap: { width: round(overlapX), height: round(overlapY) }, message: 'Text from these elements occupies the same area; check whether the overlap is intentional.' }, fragment.element, other.element);
      }
      if (pairs > MAX_PAIRS) break;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(i);
    }
    if (pairs > MAX_PAIRS) break;
  }
  return { viewportWidth, scrollWidth, inspected: { elements: elementCount, textNodes: Math.min(textNodes, MAX_TEXT_NODES), textFragments: fragments.length, limited, uninspected }, findings, landmarks };
}

// Preserve conventional hash-router paths while excluding fragments that are
// usually anchors or authentication parameters. A route path, like a URL
// pathname, can itself contain private data and must be reviewed before sharing.
function hashRoute(url) {
  if (!/^#!?\//.test(url.hash)) return '';
  return url.hash.split('?', 1)[0];
}
export function displayResponsiveRoute(url) {
  const fragment = hashRoute(url);
  // The leading # is a delimiter for the URL itself, not a route parameter.
  const boundary = fragment.slice(1).search(/[;&=#]|%(?:25)*(?:3f|23|3b|26|3d)/i);
  return `${url.origin}${url.pathname}${boundary < 0 ? fragment : fragment.slice(0, boundary + 1)}`;
}
const normalizedPath = (pathname) => pathname.replace(/\/+$/, '') || '/';

function findSource(data, finding) {
  if (!finding.elementId) return undefined;
  if (data._sourceIdCounts && data._sourceIdCounts.get(finding.elementId) !== 1) return undefined;
  const candidates = data.items.flatMap((item) => item.kind === 'components' ? (item.usages || []).filter((usage) => usage.element?.id === finding.elementId && usage.element?.tag === finding.tag) : []);
  if (candidates.length !== 1) return undefined;
  const { file, line, column } = candidates[0];
  return { status: 'likely', file, line, ...(column ? { column } : {}) };
}

function recommend(finding, viewport) {
  const media = (rules) => `@media (max-width: ${viewport.width}px) {\n${rules}\n}`;
  if (finding.kind === 'horizontal-overflow' && finding.selector !== 'html') {
    return {
      summary: `Try allowing ${finding.selector} to shrink within its container at ${viewport.width}px. If horizontal scrolling is intentional, keep it instead.`,
      css: media(`  ${finding.selector} {\n    max-width: 100%;\n    min-width: 0;\n    box-sizing: border-box;\n  }`),
      note: 'If positioning or a transform moves the element outside the viewport, adjust that offset too. Test nearby widths and choose your actual breakpoint.',
    };
  }
  if (finding.kind === 'horizontal-overflow') return { summary: `At ${viewport.width}px the document is wider than the viewport. In DevTools, inspect the elements extending past the right edge and make the responsible container flexible or intentionally scrollable.`, note: 'The browser did not identify a single reliable source element.' };
  if (finding.kind === 'clipped-text') {
    return {
      summary: `If the full text should remain visible at ${viewport.width}px, allow ${finding.container} to grow and ${finding.selector} to wrap.`,
      css: media(`  ${finding.container} {\n    height: auto;\n    overflow: visible;\n  }\n  ${finding.selector} {\n    white-space: normal;\n    overflow-wrap: anywhere;\n  }`),
      note: 'Keep intentional truncation or clipping; check other content and nearby widths before applying this change.',
    };
  }
  if (finding.sameParent && finding.container && [finding.computedStyle?.position, finding.otherComputedStyle?.position].some((position) => position === 'absolute' || position === 'fixed')) {
    return {
      summary: `If ${finding.selector} and ${finding.otherSelector} should flow beside one another at ${viewport.width}px, try a wrapping layout instead of overlapping positioning.`,
      css: media(`  ${finding.container} {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n  }\n  ${finding.selector},\n  ${finding.otherSelector} {\n    position: static;\n  }`),
      note: 'Adjust the gap to the design and retain deliberate overlays; test the surrounding layout after changing positioning.',
    };
  }
  return { summary: `At ${viewport.width}px, inspect the positioning and transforms of ${finding.selector} and ${finding.otherSelector}; put them in normal flow or reserve space between them if they should not overlap.`, note: finding.sameParent ? 'The inspected styles do not establish a safe shared positioning change.' : 'The overlapping elements do not share one immediate container, so a safe shared CSS change cannot be inferred.' };
}

async function screenshot(page, viewport, maskSelectors) {
  try {
    const bytes = await page.screenshot({ type: 'png', scale: 'css', timeout: 5000, ...(maskSelectors.length ? { mask: maskSelectors.map((selector) => page.locator(`css=${selector}`)), maskColor: '#202020' } : {}) });
    if (bytes.length > 1024 * 1024) return undefined;
    return { image: `data:image/png;base64,${bytes.toString('base64')}`, width: viewport.width, height: viewport.height, pixelRatio: 1 };
  } catch { return undefined; }
}

/** Inspect each width in a fresh Chromium context, including page-load JS. */
export async function auditResponsive(browser, data, inputUrl, options) {
  const url = new URL(inputUrl);
  const viewports = validateResponsiveViewports(options.viewports, options.pixelRatio);
  const results = [];
  let previewBudgetChars = options.previewBudgetChars ?? 24 * 1024 * 1024;
  for (const viewport of viewports) {
    options.throwIfExpired();
    let context;
    try {
      context = await browser.newContext({ viewport, colorScheme: options.colorScheme, deviceScaleFactor: options.pixelRatio, ...(options.storageState ? { storageState: options.storageState } : {}), ...(options.siteGuard ? { serviceWorkers: 'block' } : {}) });
      if (options.siteGuard) await guardSiteContext(context, options.siteGuard.origin, options.siteGuard.counts);
      const page = await context.newPage();
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!response?.ok()) throw new Error('Page did not load successfully.');
      const sameRoute = () => { const actual = new URL(page.url()); return actual.origin === url.origin && normalizedPath(actual.pathname) === normalizedPath(url.pathname) && hashRoute(actual) === hashRoute(url) && (!options.siteGuard || !url.hash || actual.hash === url.hash); };
      if (!sameRoute()) throw new Error('Page navigated away from the requested route.');
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      await page.evaluate(async () => { if (document.fonts) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]); });
      for (const action of options.actions) {
        const target = page.locator(`css:light=${action.selector}`);
        if (await target.count() !== 1) throw new Error('A configured page action did not match exactly one element at this width.');
        if (action.kind === 'focus') await target.focus({ timeout: 3000 });
        else await target.hover({ timeout: 3000 });
        if (!await target.evaluate((element, kind) => kind === 'focus' ? document.activeElement === element : element.matches(':hover'), action.kind, { timeout: 3000 })) throw new Error('A configured page action could not be established at this width.');
      }
      const first = await page.evaluate(inspectResponsiveInPage);
      await page.waitForTimeout(100);
      const measured = await page.evaluate(inspectResponsiveInPage);
      if (!sameRoute()) throw new Error('Page navigated away during inspection.');
      const stable = JSON.stringify(first) === JSON.stringify(measured);
      const findings = measured.findings.map((finding) => {
        const source = findSource(data, finding);
        const { elementId, ...result } = finding;
        return { ...result, viewportWidth: viewport.width, ...(source ? { source } : {}) };
      });
      const previews = [];
      let previewOmissionRecorded = false;
      const recordPreviewOmission = () => {
        if (options.siteGuard?.previewBudget && !previewOmissionRecorded) {
          options.siteGuard.previewBudget.omitted++;
          previewOmissionRecorded = true;
        }
      };
      const savePreview = async () => {
        if (previewBudgetChars < 1024) { recordPreviewOmission(); return; }
        const image = await screenshot(page, viewport, options.maskSelectors);
        if (!image || image.image.length > previewBudgetChars || previews.reduce((total, entry) => total + entry.image.length, 0) + image.image.length > 4 * 1024 * 1024) { recordPreviewOmission(); return; }
        const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
        previews.push({ ...image, scroll });
        previewBudgetChars -= image.image.length;
      };
      await savePreview();
      const landmarks = measured.landmarks.map((landmark) => {
        const previewIndex = previews.findIndex((image) => landmark.bounds.x < image.scroll.x + viewport.width && landmark.bounds.x + landmark.bounds.width > image.scroll.x && landmark.bounds.y < image.scroll.y + viewport.height && landmark.bounds.y + landmark.bounds.height > image.scroll.y);
        return { ...landmark, ...(previewIndex >= 0 ? { previewIndex } : {}) };
      });
      // Chrome DevTools Protocol supplies the same inspected box and computed
      // styles shown in the browser's Elements panel, without modifying the DOM.
      let session;
      try {
        session = await context.newCDPSession(page);
        await session.send('DOM.enable');
        await session.send('CSS.enable');
        const { root } = await session.send('DOM.getDocument');
        const inspectStyles = async (selector) => {
          const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
          if (!nodeId) return undefined;
          const { computedStyle } = await session.send('CSS.getComputedStyleForNode', { nodeId });
          const relevant = new Set(['display', 'position', 'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'left', 'right', 'transform', 'box-sizing', 'overflow-x', 'overflow-y', 'white-space']);
          return Object.fromEntries(computedStyle.filter((entry) => relevant.has(entry.name)).map((entry) => [entry.name, entry.value.slice(0, 200)]));
        };
        for (const finding of findings.slice(0, 20)) {
          finding.computedStyle = await inspectStyles(finding.selector);
          if (finding.container) finding.containerStyle = await inspectStyles(finding.container);
          if (finding.otherSelector) finding.otherComputedStyle = await inspectStyles(finding.otherSelector);
        }
      } catch { /* Findings remain useful if DevTools style details are unavailable. */ }
      finally { if (session) await session.detach().catch(() => {}); }
      for (const finding of findings) {
        finding.recommendation = recommend(finding, viewport);
        const visibleIn = (image) => finding.bounds && finding.bounds.x < image.scroll.x + viewport.width && finding.bounds.x + finding.bounds.width > image.scroll.x && finding.bounds.y < image.scroll.y + viewport.height && finding.bounds.y + finding.bounds.height > image.scroll.y;
        let previewIndex = previews.findIndex(visibleIn);
        if (previewIndex < 0 && previews.length < 8) {
          try {
            await page.locator(`css=${finding.kind === 'clipped-text' ? finding.container : finding.selector}`).scrollIntoViewIfNeeded({ timeout: 2000 });
            if (!sameRoute()) throw new Error('Page navigated away during inspection.');
            await savePreview();
            previewIndex = previews.findIndex(visibleIn);
          } catch { /* Preserve the finding and explicitly omit unavailable evidence. */ }
        }
        if (previewIndex >= 0) finding.previewIndex = previewIndex;
      }
      if (!sameRoute()) throw new Error('Page navigated away during inspection.');
      results.push({ viewport, coverage: stable && !measured.inspected.limited && !measured.inspected.uninspected ? 'observed' : 'partial', stable, document: { viewportWidth: measured.viewportWidth, scrollWidth: measured.scrollWidth }, inspected: measured.inspected, findings, previews, landmarks });
    } catch (error) {
      options.throwIfExpired();
      results.push({ viewport, coverage: 'incomplete', reason: error.message?.startsWith('A configured page action') || error.message === 'Page navigated away from the requested route.' || error.message === 'Page navigated away during inspection.' ? error.message : 'The browser could not complete this viewport inspection.', findings: [] });
    } finally { if (context) await context.close(); }
  }
  return { url: displayResponsiveRoute(url), colorScheme: options.colorScheme, pixelRatio: options.pixelRatio, browser: { engine: 'chromium', version: options.browserVersion }, actions: options.actions, maskSelectorsConfigured: options.maskSelectors.length, viewports: results };
}
import { guardSiteContext } from './site-discovery.js';
