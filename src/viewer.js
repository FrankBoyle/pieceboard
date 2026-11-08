// Group only repeated, observed evidence. Captures remain unchanged and every
// original finding is still available in the detailed report.
function createPieceboardReviewModel() {
  const fingerprint = (value) => {
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 3266489917); }
    return `${value.length.toString(16)}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
  };
  const normalize = (value) => String(value || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:number');
  const image = (page, observation) => {
    const value = page?.previews?.[observation]?.image;
    return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value) ? value : null;
  };
  function visual(data) {
    const buttons = data.consistency ? (data.consistency.pages || [data.consistency]) : [];
    const elements = data.elementConsistency?.pages || [];
    const groups = [], buckets = new Map();
    let missing = 0, indistinct = 0, originalIndex = 0;
    function add(kind, finding, pageA, idA, pageB, idB, context, target) {
      const a = image(pageA, idA), b = image(pageB, idB);
      if (!a || !b) { missing++; return; }
      const original = originalIndex++;
      if (a === b) { indistinct++; return; }
      const group = finding.group || {};
      const observationA = (pageA?.observations || []).find((entry) => entry.id === idA);
      const observationB = (pageB?.observations || []).find((entry) => entry.id === idB);
      const name = [group.family, group.variant, group.type].filter(Boolean).join(' · ') || 'UI appearance';
      const scope = pageA?.scope || {};
      const bucketKey = JSON.stringify([kind, group.family, group.variant, group.type, group.familyEvidence, scope.viewport?.width, scope.viewport?.height, scope.theme]);
      const bucket = buckets.get(bucketKey) || [];
      let current = bucket.find((entry) => {
        const hasA = entry.options.some((option) => option.image === a), hasB = entry.options.some((option) => option.image === b);
        return (hasA || hasB) && entry.options.length + Number(!hasA) + Number(!hasB) <= 4;
      });
      if (!current) {
        current = { key: `visual:${finding.id || 'choice'}:${fingerprint(a)}:${fingerprint(b)}:${bucketKey}`, name, options: [], occurrences: [], legacy: [], search: '', requested: false };
        bucket.push(current); buckets.set(bucketKey, bucket); groups.push(current);
      }
      const addOption = (src, observation) => {
        let index = current.options.findIndex((option) => option.image === src);
        if (index < 0) { index = current.options.length; current.options.push({ image: src, label: 'Observed appearance', actions: [], labels: [] }); }
        const option = current.options[index];
        option.actions = [...new Set([...option.actions, ...(observation?.focus?.actions || [])])];
        option.labels = [...new Set([...option.labels, ...(observation?.searchLabel ? [observation.searchLabel] : [])])];
        if (option.labels.length === 1) option.label = option.labels[0];
        else if (option.actions.length === 1) option.label = `${option.actions[0][0].toUpperCase()}${option.actions[0].slice(1)} action`;
        else if (option.actions.length > 1) option.label = 'Observed actions';
        else option.label = 'Observed appearance';
        return index;
      };
      const first = addOption(a, observationA);
      const second = addOption(b, observationB);
      current.search += ` ${name} ${kind} ${context} ${[observationA, observationB].flatMap((entry) => [entry?.source?.file, entry?.searchLabel, entry?.searchAlias, ...(entry?.focus?.actions || []), ...(entry?.focus?.regions || [])]).filter(Boolean).join(' ')}`;
      current.requested ||= Boolean(observationA?.focus?.requested || observationB?.focus?.requested);
      current.occurrences.push({ id: finding.id || `choice-${original + 1}`, context, target });
      current.legacy.push({ key: `${original}:${finding.id || `choice-${original + 1}`}`, first, second });
    }
    for (const [kind, pages] of [['Button', buttons], ['UI group', elements]]) {
      for (const [index, page] of pages.entries()) for (const [findingIndex, finding] of (page.findings || []).entries()) {
        const scope = page.scope || {};
        const viewport = scope.viewport ? `${scope.viewport.width} × ${scope.viewport.height}` : 'viewport unknown';
        add(kind, finding, page, finding.common?.example, page, finding.outlier?.example,
          `${kind} · page ${index + 1} · ${scope.url || 'page unknown'} · ${viewport} · ${scope.theme || 'theme unknown'}`,
          `#site-${kind === 'Button' ? 'button' : 'element'}-${index}-${findingIndex}`);
      }
    }
    for (const [index, finding] of (data.crossPageConsistency?.findings || []).entries()) {
      const a = finding.common?.example, b = finding.outlier?.example;
      add('Button', finding, buttons[(a?.page || 0) - 1], a?.observation, buttons[(b?.page || 0) - 1], b?.observation,
        `Button across selected pages ${a?.page || '?'} and ${b?.page || '?'}`, `#site-cross-${index}`);
    }
    return { groups, missing, indistinct, original: originalIndex };
  }
  function layout(data) {
    const groups = new Map();
    for (const [pageIndex, page] of (data.responsiveAudit?.pages || []).entries()) for (const [widthIndex, width] of (page.viewports || []).entries()) for (const [findingIndex, finding] of (width.findings || []).entries()) {
      const route = normalize(page.url), selector = normalize(finding.selector), other = normalize(finding.otherSelector), container = normalize(finding.container);
      const key = JSON.stringify([finding.kind, route, width.viewport?.width, width.viewport?.height, selector, other, container]);
      if (!groups.has(key)) groups.set(key, { key, kind: finding.kind, route, selector, other, container, viewport: width.viewport, regions: [], occurrences: [] });
      const group = groups.get(key);
      group.regions = [...new Set([...group.regions, ...(finding.regions || [])])];
      const evidence = Number.isInteger(finding.previewIndex) ? width.previews?.[finding.previewIndex] : undefined;
      group.occurrences.push({ page: pageIndex + 1, target: `#site-responsive-${pageIndex}-${widthIndex}-${findingIndex}`, finding, evidence });
    }
    return [...groups.values()].sort((a, b) => b.occurrences.length - a.occurrences.length);
  }
  return { visual, layout };
}

(() => {
  const data = window.__UI_SHEET_DATA__;
  const reviewModel = createPieceboardReviewModel();
  const reviewState = { visual: [], visualAnswers: {}, layout: [], layoutAnswers: {}, status: [] };
  const focusState = { value: '', listeners: [] };
  const focusWords = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)?.map((word) => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word) || [];
  const focusFiller = new Set(['a', 'an', 'the', 'that', 'which', 'for', 'look', 'at', 'please', 'show', 'me']);
  const focusAliases = { sidebar: ['sidebar', 'sidenav', 'aside'], header: ['header', 'banner', 'topbar'], button: ['button', 'btn'], cancel: ['cancel', 'discard'], save: ['save', 'saving'] };
  function focusMatches(value, requested = false) {
    const terms = focusWords(focusState.value).filter((term) => !focusFiller.has(term));
    if (!terms.length) return true;
    const requestedTerms = focusWords(data.reviewFocus).filter((term) => !focusFiller.has(term) && !['button', 'control'].includes(term));
    const comparableTerms = terms.filter((term) => !['button', 'control'].includes(term));
    if (requested && comparableTerms.length && comparableTerms.join(' ') === requestedTerms.join(' ')) return true;
    const words = focusWords(value);
    return terms.every((term) => (focusAliases[term] || [term]).some((alias) => words.some((word) => word.includes(alias))));
  }
  function updateFocus(value) {
    focusState.value = String(value || '').trim().slice(0, 80);
    for (const listener of focusState.listeners) listener();
  }
  const byId = (id) => document.getElementById(id);
  const grid = byId('grid');
  const dialog = byId('detail-dialog');
  const dialogContent = byId('detail-content');
  const filters = [
    { id: 'all', label: 'All pieces', icon: '▦' },
    { id: 'captured', label: 'Captured on page', icon: '◉' },
    { id: 'focused', label: 'UI-focused', icon: '✳' },
    { id: 'components', label: 'Components', icon: '◇' },
    { id: 'colors', label: 'Colors', icon: '◒' },
    { id: 'typography', label: 'Typography', icon: 'Aa' },
    { id: 'assets', label: 'Assets', icon: '▧' },
    { id: 'tokens', label: 'Other tokens', icon: '⌘' },
  ];
  const types = [
    { id: 'all', label: 'All types' },
    { id: 'tabs', label: 'Tabs' },
    { id: 'sidebars', label: 'Sidebars' },
    { id: 'headers', label: 'Headers' },
    { id: 'buttons', label: 'Buttons' },
    { id: 'dropdowns', label: 'Dropdowns' },
    { id: 'selectors', label: 'Selectors' },
    { id: 'inputs', label: 'Inputs' },
    { id: 'navigation', label: 'Navigation' },
    { id: 'headings', label: 'Headings' },
    { id: 'text', label: 'Text' },
    { id: 'images', label: 'Images' },
    { id: 'other', label: 'Other components' },
  ];
  let active = data.captureSummary?.captured ? 'captured' : 'focused';
  let activeType = 'all';
  let query = '';
  const count = (kind) => kind === 'all' ? data.items.length : kind === 'captured' ? data.items.reduce((total, item) => total + (item.captures?.length || 0), 0) : kind === 'focused' ? itemEntries.filter(isFocused).length : data.items.filter((item) => item.kind === kind).length;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const plural = (number, singular, pluralForm = `${singular}s`) => `${number} ${number === 1 ? singular : pluralForm}`;
  function captureDetails(capture, className, summary, alt) {
    const details = el('details', className);
    const control = el('label', 'capture-zoom', 'Zoom');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.step = 'any';
    slider.disabled = true;
    slider.setAttribute('aria-label', `Zoom ${alt}`);
    const value = el('span', 'capture-zoom-value', 'Loading');
    control.append(slider, value);
    const note = el('p', 'capture-zoom-note', 'Maximum size uses the available image pixels at your display density.');
    const scroll = el('div', 'capture-full-scroll');
    const image = document.createElement('img');
    image.alt = alt;
    image.addEventListener('load', () => {
      const ratio = Number.isFinite(capture.pixelRatio) && capture.pixelRatio >= 1 && capture.pixelRatio <= 4 ? capture.pixelRatio : 1;
      const displayRatio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      const maximum = ratio / displayRatio;
      const minimum = Math.min(1, maximum);
      slider.min = String(minimum);
      slider.max = String(maximum);
      slider.value = String(maximum);
      slider.disabled = maximum <= minimum;
      const resize = () => {
        const zoom = Number(slider.value);
        image.style.width = `${Math.min(image.naturalWidth / displayRatio, image.naturalWidth / ratio * zoom)}px`;
        value.textContent = `${Math.round(zoom * 100)}%`;
      };
      slider.addEventListener('input', resize);
      resize();
    });
    image.addEventListener('error', () => { value.textContent = 'Image unavailable'; slider.disabled = true; });
    image.src = capture.image;
    scroll.append(image);
    details.append(el('summary', '', summary), control, note, scroll);
    return details;
  }
  const fileLabel = (location) => location.line ? `${location.file}:${location.line}${location.column ? `:${location.column}` : ''}` : location.file;

  // A component can belong to more than one group (for example, a tab button).
  // These are browsing clues, not a claim about the component's design intent.
  function classify(item, capture) {
    if (item.kind !== 'components' && item.kind !== 'assets') return [];
    const locations = capture ? item.usages.filter((usage) => usage.file === capture.file && usage.line === capture.line) : item.usages;
    const elements = [...(capture?.element ? [capture.element] : []), ...locations.map((usage) => usage.element).filter(Boolean)];
    const tags = new Set(elements.map((element) => element.tag));
    const roles = new Set(elements.map((element) => element.role));
    const inputTypes = new Set([...elements.map((element) => element.type), ...locations.map((location) => /\btype=["']([^"']+)["']/.exec(location.detail || '')?.[1])]);
    // Only a manually supplied label is intended as a description of the UI
    // type; rendered page text such as "opens in a new tab" is content.
    const manualLabel = capture?.method?.startsWith('provided') ? capture.label : '';
    const hints = [item.name, item.subtype === 'Component' ? item.source : '', manualLabel, capture?.file,
      ...(capture ? [] : (item.classNames || [])),
      ...elements.flatMap((element) => element.classes || [])]
      .filter(Boolean).join(' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^a-z0-9]+/gi, ' ').toLowerCase();
    const has = (expression) => expression.test(hints);
    const groups = [];
    if (roles.has('tab') || roles.has('tablist') || roles.has('tabpanel') || has(/\b(tabs?|tablist|tabpanel)\b/)) groups.push('tabs');
    if (tags.has('aside') || has(/\b(sidebars?|sidenav|side nav|side navigation)\b/)) groups.push('sidebars');
    if (tags.has('header') || roles.has('banner') || has(/\b(headers?|masthead|topbar|top bar)\b/)) groups.push('headers');
    if (tags.has('button') || roles.has('button') || has(/\b(buttons?|btn)\b/)) groups.push('buttons');
    if (tags.has('select') || roles.has('combobox') || roles.has('listbox') || has(/\b(dropdown|drop down|combobox|select|selector)\b/)) groups.push('dropdowns');
    if (tags.has('select') || ['checkbox', 'radio', 'switch', 'combobox', 'listbox', 'option'].some((role) => roles.has(role)) || ['checkbox', 'radio'].some((type) => inputTypes.has(type)) || has(/\b(selectors?|checkbox|check box|radio|switch|toggle)\b/)) groups.push('selectors');
    if (tags.has('input') || tags.has('textarea') || roles.has('textbox') || roles.has('searchbox') || has(/\b(inputs?|text field|textfield|search field)\b/)) groups.push('inputs');
    if (tags.has('nav') || roles.has('navigation') || has(/\b(navigation|navbar|nav bar|nav menu)\b/)) groups.push('navigation');
    if ([...tags].some((tag) => /^h[1-6]$/.test(tag)) || has(/\b(headings?|titles?)\b/)) groups.push('headings');
    if (tags.has('p') || tags.has('label') || has(/\b(text|paragraph|typography)\b/)) groups.push('text');
    if (item.kind === 'assets' || tags.has('img') || has(/\b(images?|icons?|logos?)\b/)) groups.push('images');
    for (const rule of elements.flatMap((element) => element.inventoryTypes || [])) {
      if ((!capture || (capture.element?.classes || []).includes(rule.className)) && !groups.includes(rule.type)) groups.push(rule.type);
    }
    if (!groups.length && item.kind === 'components') groups.push('other');
    return groups;
  }
  const itemEntries = data.items.map((item) => ({ item, capture: null, types: classify(item, null) }));
  const capturedEntries = data.items.flatMap((item) => (item.captures || []).map((capture) => ({ item, capture, types: classify(item, capture) })));
  const isFocused = (entry) => entry.item.kind !== 'components' || entry.types.some((type) => type !== 'other');
  const currentEntries = () => active === 'captured' ? capturedEntries : active === 'all' ? itemEntries : active === 'focused' ? itemEntries.filter(isFocused) : itemEntries.filter(({ item }) => item.kind === active);
  document.title = `${data.name} · Pieceboard`;
  byId('workspace-name').textContent = data.name;
  byId('workspace-initial').textContent = data.name[0]?.toUpperCase() || 'U';
  byId('item-count').textContent = String(data.items.length).padStart(2, '0');
  const scannedAt = typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : NaN;
  const scannedTime = Number.isFinite(scannedAt) ? ` · ${new Date(scannedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}` : '';
  byId('scan-info').textContent = `${plural(data.scannedFiles, 'source file')} scanned${data.scanScope?.length ? ' · scoped' : ''}${data.sourceExclusions ? ` · ${plural(data.sourceExclusions, 'source exclusion')}` : ''}${scannedTime}`;

  function renderNavigation(focusId = '') {
    const nav = byId('navigation');
    nav.replaceChildren();
    for (const filter of filters) {
      const button = el('button', `nav-item${active === filter.id ? ' active' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(active === filter.id));
      const icon = el('span', 'nav-icon', filter.icon);
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon, el('span', 'nav-name', filter.label), el('span', 'nav-count', String(count(filter.id)).padStart(2, '0')));
      button.addEventListener('click', () => { active = filter.id; activeType = 'all'; renderNavigation(filter.id); renderTypes(); renderGrid(); });
      nav.append(button);
      if (filter.id === focusId) button.focus();
    }
  }

  function renderTypes(focusId = '') {
    const entries = currentEntries();
    const nav = byId('type-navigation');
    nav.replaceChildren();
    byId('type-filter').hidden = !entries.some(({ types: entryTypes }) => entryTypes.length);
    for (const type of types) {
      const number = type.id === 'all' ? entries.length : entries.filter((entry) => entry.types.includes(type.id)).length;
      const button = el('button', `type-chip${activeType === type.id ? ' active' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(activeType === type.id));
      button.append(el('span', '', type.label), el('span', 'type-count', String(number)));
      button.addEventListener('click', () => { activeType = type.id; renderTypes(type.id); renderGrid(); });
      nav.append(button);
      if (type.id === focusId) button.focus();
    }
  }

  function renderResponsive() {
    const review = byId('responsive-review');
    const audit = data.responsiveAudit;
    if (!review || audit?.format !== 'ui-sheet/responsive-pages-v1' || !audit.pages?.length) return;
    review.hidden = false;
    const widths = audit.pages.flatMap((page) => page.viewports || []);
    const issueCount = widths.reduce((total, entry) => total + (entry.findings?.length || 0), 0);
    const header = el('div', 'consistency-header');
    const title = el('div');
    title.append(el('div', 'section-kicker', 'RESPONSIVE REVIEW'), el('h2', '', 'Layout across screen widths'),
      el('p', '', 'Browser inspections flag possible horizontal overflow, clipped text, and overlapping text. Review each finding in context.'));
    header.append(title, el('span', 'consistency-count', `${plural(issueCount, 'possible issue')} · ${widths.filter((entry) => entry.coverage !== 'observed').length} partial or incomplete`));
    review.append(header, el('p', 'consistency-note', 'Only selected pages, widths, and states are inspected. Intentional scrolling, text truncation, overlays, and other designs can need human review; a clear result is not a complete responsive audit. Finding captures may be taken after scrolling.'));
    const labels = { 'horizontal-overflow': 'Horizontal overflow', 'clipped-text': 'Clipped text', 'overlapping-text': 'Overlapping text' };
    for (const [pageIndex, page] of audit.pages.entries()) {
      const pageSection = el('section', 'consistency-page');
      pageSection.append(el('h3', '', `Page ${pageIndex + 1}`), el('p', 'consistency-scope', `${page.url || 'Unknown route'} · ${page.colorScheme || 'unknown'} color preference · ${page.pixelRatio || '?'}× device scale · Chromium ${page.browser?.version || 'unknown'}`));
      for (const [widthIndex, entry] of (page.viewports || []).entries()) {
        const section = el('section', 'responsive-viewport');
        const size = `${entry.viewport?.width || '?'} × ${entry.viewport?.height || '?'}`;
        section.append(el('h4', '', `${size} CSS px · ${entry.coverage || 'unknown'} coverage`));
        if (entry.reason) section.append(el('p', 'consistency-note', entry.reason));
        if (entry.coverage === 'partial') section.append(el('p', 'consistency-note', 'Layout changed between measurements, an inspection limit was reached, or a visible frame or shadow root was not inspected. Findings may be incomplete.'));
        if (entry.document) section.append(el('p', 'consistency-scope', `Viewport width: ${entry.document.viewportWidth}px · document scroll width: ${entry.document.scrollWidth}px`));
        const firstPreview = entry.previews?.[0];
        if (firstPreview?.image) {
          const preview = el('img', 'responsive-preview');
          preview.src = firstPreview.image;
          preview.alt = `Page ${pageIndex + 1} at ${size} CSS pixels`;
          section.append(preview, captureDetails(firstPreview, 'comparison-full', 'View viewport capture', `Page ${pageIndex + 1} at ${size}`));
        } else section.append(el('p', 'consistency-note', 'Viewport screenshot unavailable or too large.'));
        if (entry.coverage !== 'incomplete' && !entry.findings?.length) section.append(el('p', 'consistency-empty', 'No issues found by the supported checks at this width.'));
        for (const [findingIndex, finding] of (entry.findings || []).entries()) {
          const card = el('details', 'layout-result');
          card.id = `site-responsive-${pageIndex}-${widthIndex}-${findingIndex}`;
          card.open = !data.siteScan;
          const summary = el('summary', 'finding-heading');
          summary.append(el('strong', '', labels[finding.kind] || 'Possible layout issue'), el('span', 'finding-badge layout-status-finding', 'Review'));
          card.append(summary, el('p', 'layout-message', finding.message || ''), el('code', 'layout-selector', finding.selector || 'Unknown element'));
          if (finding.container) card.append(el('p', 'comparison-source', `${finding.kind === 'clipped-text' ? 'Clipping container' : 'Shared container'}: ${finding.container}`));
          if (finding.otherSelector) card.append(el('p', 'comparison-source', `Overlaps: ${finding.otherSelector}`));
          if (Number.isFinite(finding.overflowPx)) card.append(el('p', 'comparison-source', `Measured overhang: ${finding.overflowPx} CSS px`));
          if (finding.bounds) card.append(el('p', 'comparison-source', `Location in document: x ${finding.bounds.x}, y ${finding.bounds.y} CSS px`));
          card.append(el('p', 'comparison-source', finding.source?.status === 'likely' ? `Possible source: ${fileLabel(finding.source)} · verify the match` : 'Source location not resolved; use the selector in browser developer tools.'));
          const evidence = entry.previews?.[finding.previewIndex];
          if (evidence?.image) {
            const frame = el('div', 'responsive-evidence');
            frame.style.width = `${Math.min(entry.viewport.width, 320 * entry.viewport.width / entry.viewport.height)}px`;
            const image = el('img', 'responsive-evidence-image');
            image.src = evidence.image;
            image.alt = `Browser capture near ${finding.selector} at ${size} CSS pixels`;
            image.loading = 'lazy';
            frame.append(image);
            if (finding.bounds && evidence.scroll) {
              const x1 = Math.max(0, Math.min(entry.viewport.width, finding.bounds.x - evidence.scroll.x));
              const y1 = Math.max(0, Math.min(entry.viewport.height, finding.bounds.y - evidence.scroll.y));
              const x2 = Math.max(0, Math.min(entry.viewport.width, finding.bounds.x + finding.bounds.width - evidence.scroll.x));
              const y2 = Math.max(0, Math.min(entry.viewport.height, finding.bounds.y + finding.bounds.height - evidence.scroll.y));
              if (x2 > x1 && y2 > y1) {
                const marker = el('span', 'responsive-highlight');
                marker.setAttribute('aria-hidden', 'true');
                marker.style.left = `${x1 / entry.viewport.width * 100}%`;
                marker.style.top = `${y1 / entry.viewport.height * 100}%`;
                marker.style.width = `${(x2 - x1) / entry.viewport.width * 100}%`;
                marker.style.height = `${(y2 - y1) / entry.viewport.height * 100}%`;
                frame.append(marker);
              }
            }
            card.append(frame, el('p', 'consistency-note', 'The outline marks the approximate measured area.'), captureDetails(evidence, 'comparison-full', 'View original finding capture', `${finding.selector} at ${size}`));
            if (evidence.scroll?.x || evidence.scroll?.y) card.append(el('p', 'consistency-note', `Captured after scrolling to x ${evidence.scroll.x}, y ${evidence.scroll.y}.`));
          } else card.append(el('p', 'consistency-note', 'Finding screenshot unavailable or omitted by capture limits.'));
          if (finding.recommendation) {
            const suggestion = el('div', 'responsive-suggestion');
            suggestion.append(el('h5', '', 'Possible improvement'), el('p', '', finding.recommendation.summary || ''));
            if (finding.recommendation.css) suggestion.append(el('pre', '', finding.recommendation.css));
            if (finding.recommendation.note) suggestion.append(el('p', 'consistency-note', finding.recommendation.note));
            card.append(suggestion);
          }
          if (finding.computedStyle && Object.keys(finding.computedStyle).length) {
            const details = el('details', 'layout-expected');
            details.append(el('summary', '', 'Computed styles from browser inspection'), el('pre', '', JSON.stringify(finding.computedStyle, null, 2)));
            card.append(details);
          }
          section.append(card);
        }
        pageSection.append(section);
      }
      review.append(pageSection);
    }
  }

  function renderLayout() {
    const review = byId('layout-review');
    const audit = data.layoutAudit;
    if (!review || audit?.format !== 'ui-sheet/layout-pages-v1' || !audit.pages?.length) return;
    review.hidden = false;
    const results = audit.pages.flatMap((page) => page.results || []);
    const header = el('div', 'consistency-header');
    const title = el('div');
    title.append(el('div', 'section-kicker', 'LAYOUT AND BRAND REVIEW'), el('h2', '', 'Spacing, clearance, and approved logos'),
      el('p', '', 'Checks use explicit project rules. Missing or unsupported evidence stays incomplete.'));
    header.append(title, el('span', 'consistency-count', `${results.filter((entry) => entry.status === 'finding').length} findings · ${results.filter((entry) => entry.status === 'incomplete').length} incomplete`));
    review.append(header);
    review.append(el('p', 'consistency-note', 'Distances use CSS pixels; image aspect error is a ratio. Saved measurements describe the selected viewport and screen/print media. Print preview is not validation of an exported PDF. Source links below are manual assertions.'));
    const labels = { 'text-inset': 'Text clearance', 'horizontal-gap': 'Gap between elements', style: 'Spacing property', image: 'Approved logo source' };
    for (const [index, page] of audit.pages.entries()) {
      const section = el('section', 'consistency-page');
      section.append(el('h3', '', `Page ${index + 1} · ${page.scope?.media || 'unknown'} media`),
        el('p', 'consistency-scope', `${page.scope?.url || 'Unknown route'} · ${page.scope?.viewport?.width || '?'} × ${page.scope?.viewport?.height || '?'} CSS px · ${page.coverage || 'unknown'} coverage`));
      if (!page.results?.length) section.append(el('p', 'consistency-empty', 'No layout rules were checked.'));
      for (const [resultIndex, result] of [...(page.results || [])].sort((a, b) => (a.status === 'passed') - (b.status === 'passed')).entries()) {
        const card = el('details', 'layout-result');
        card.id = `site-layout-${index}-${resultIndex}`;
        card.open = result.status !== 'passed';
        const summary = el('summary', 'finding-heading');
        summary.append(el('strong', '', `${labels[result.kind] || 'Layout check'} · ${result.id}`), el('span', `finding-badge layout-status-${result.status}`, result.status));
        card.append(summary, el('p', 'layout-message', result.message),
          el('code', 'layout-selector', `${result.selector}${result.otherSelector ? ` → ${result.otherSelector}` : ''}`));
        const measurements = el('dl', 'layout-measurements');
        for (const [label, value] of Object.entries(result.measured || {})) {
          measurements.append(el('dt', '', label.replace(/([a-z])([A-Z])/g, '$1 $2')), el('dd', '', String(value)));
        }
        if (Object.keys(result.measured || {}).length) card.append(measurements);
        const expected = el('details', 'layout-expected');
        expected.append(el('summary', '', 'Project rule'), el('pre', '', JSON.stringify(result.expected, null, 2)));
        card.append(expected);
        card.append(el('p', 'comparison-source', result.source?.status === 'manual' ? `Manually linked source: ${fileLabel(result.source)} · verify the code before editing` : 'Source unresolved; inspect the selected element in your project.'));
        if (result.preview?.image) {
          const preview = el('img', 'layout-preview');
          preview.src = result.preview.image;
          preview.alt = `Captured target for ${result.id}`;
          const ratio = Number.isInteger(result.preview.pixelRatio) && result.preview.pixelRatio >= 1 && result.preview.pixelRatio <= 4 ? result.preview.pixelRatio : 1;
          if (Number.isFinite(result.preview.width) && result.preview.width > 0) preview.style.width = `${result.preview.width / ratio}px`;
          card.append(preview, captureDetails(result.preview, 'comparison-full', 'View original pixels', `Layout target ${result.id}`));
          if (result.preview.pixelRatio < page.scope?.pixelRatio) card.append(el('p', 'consistency-note', `Preview fell back to ${result.preview.pixelRatio}× because of the image-size limit.`));
        } else card.append(el('p', 'consistency-note', 'Preview unavailable or omitted by the capture limit.'));
        section.append(card);
      }
      review.append(section);
    }
  }

  function renderSiteReview() {
    const area = byId('site-review');
    const site = data.siteScan;
    if (!area || site?.format !== 'pieceboard/site-scan-v1') return;
    area.hidden = false;
    const results = [];
    const add = (category, title, detail, target) => results.push({ category, title, detail, target });
    const buttonPages = data.consistency ? (data.consistency.pages || [data.consistency]) : [];
    for (const [pageIndex, page] of buttonPages.entries()) for (const [index, finding] of (page.findings || []).entries()) {
      add('Button', [finding.group?.family, finding.group?.variant].filter(Boolean).join(' · ') || 'Button appearance', `Page ${pageIndex + 1} · ${page.scope?.url || 'Unknown page'}`, `site-button-${pageIndex}-${index}`);
    }
    for (const [pageIndex, page] of (data.elementConsistency?.pages || []).entries()) for (const [index, finding] of (page.findings || []).entries()) {
      add('UI group', [finding.group?.family, finding.group?.variant].filter(Boolean).join(' · ') || 'Component appearance', `Page ${pageIndex + 1} · ${page.scope?.url || 'Unknown page'}`, `site-element-${pageIndex}-${index}`);
    }
    for (const [index, finding] of (data.crossPageConsistency?.findings || []).entries()) {
      add('Across pages', [finding.group?.family, finding.group?.variant].filter(Boolean).join(' · ') || 'Button appearance', `Pages ${finding.common?.example?.page || '?'} and ${finding.outlier?.example?.page || '?'}`, `site-cross-${index}`);
    }
    const labels = { 'horizontal-overflow': 'Horizontal overflow', 'clipped-text': 'Clipped text', 'overlapping-text': 'Overlapping text' };
    for (const [pageIndex, page] of (data.responsiveAudit?.pages || []).entries()) for (const [widthIndex, width] of (page.viewports || []).entries()) for (const [index, finding] of (width.findings || []).entries()) {
      add('Layout', labels[finding.kind] || 'Possible layout issue', `Page ${pageIndex + 1} · ${page.url || 'Unknown page'} · ${width.viewport?.width || '?'} px${finding.selector ? ` · ${finding.selector}` : ''}`, `site-responsive-${pageIndex}-${widthIndex}-${index}`);
    }
    for (const [pageIndex, page] of (data.layoutAudit?.pages || []).entries()) for (const [index, finding] of [...(page.results || [])].sort((a, b) => (a.status === 'passed') - (b.status === 'passed')).entries()) {
      if (finding.status === 'finding') add('Project rule', finding.message || finding.id || 'Layout issue', `Page ${pageIndex + 1} · ${page.scope?.url || 'Unknown page'}`, `site-layout-${pageIndex}-${index}`);
    }
    area.append(el('div', 'section-kicker', 'SITE REVIEW · ALL DETECTED FINDINGS'), el('h2', '', `${plural(results.length, 'possible issue')} found${site.inProgress ? ' so far' : ''}`));
    if (site.inProgress) area.append(el('p', 'site-note', `This is a partial report: ${site.captureRemaining || 0} discovered pages have not yet been inspected. Cross-page comparisons run after the last page.`));
    area.append(el('p', 'site-overview', `${site.captured || 0} pages inspected · ${site.partial || 0} with partial checks · ${site.incomplete || 0} pages could not be inspected${site.truncated ? ` · ${site.timeLimited ? 'discovery time limit reached' : 'page or link limit reached'} (${site.remaining || 0} links still queued)` : ''}.`));
    area.append(el('p', 'site-note', 'These are all findings from the supported checks on the inspected pages. Review each one; differences may be intentional. Unvisited roles, states, controls requiring clicks, and pages that could not be reached are not covered.'));
    if (site.blockedWrites || site.blockedNavigation) area.append(el('p', 'site-note', `${site.blockedWrites || 0} non-read requests and ${site.blockedNavigation || 0} action or external navigations were blocked; some screens may be incomplete.`));
    if (data.warnings?.length) area.append(el('p', 'site-note', `${plural(data.warnings.length, 'source file')} could not be fully read. Details appear in the inventory warnings below.`));
    if (site.excluded?.length || site.excludedTruncated) area.append(el('p', 'site-note', `${plural(site.excluded?.length || 0, 'action or sensitive link')} not followed${site.excludedTruncated ? '; additional links were omitted' : ''}. See page coverage below.`));
    if (site.previewsOmitted) area.append(el('p', 'site-note', `${plural(site.previewsOmitted, 'preview')} could not be included because of image limits or capture problems. Findings remain listed.`));
    const withoutScreenshot = (data.responsiveAudit?.pages || []).flatMap((page) => page.viewports || []).reduce((total, width) => total + (width.findings || []).filter((finding) => !Number.isInteger(finding.previewIndex) || !width.previews?.[finding.previewIndex]?.image).length, 0);
    if (withoutScreenshot) area.append(el('p', 'site-note', `Screenshots are unavailable for ${plural(withoutScreenshot, 'layout finding')}; those findings need additional context.`));
    if (site.crossPageSkipped) area.append(el('p', 'site-note', `${plural(site.crossPageSkipped, 'page state')} shared a route with another page and could not be included in the cross-page comparison.`));
    const choiceLink = el('a', 'site-choice-link', 'Jump to appearance choices ↓'); choiceLink.href = '#choice-review'; area.append(choiceLink);
    if (data.responsiveAudit?.pages?.some((page) => page.viewports?.some((width) => width.findings?.length))) { const layoutLink = el('a', 'site-choice-link site-secondary-link', 'Jump to layout decisions ↓'); layoutLink.href = '#layout-decisions'; area.append(layoutLink); }
    if (results.length) {
      const findingsBlock = el('details', 'site-findings-block');
      findingsBlock.open = results.length <= 20;
      findingsBlock.append(el('summary', '', `See all ${plural(results.length, 'detected finding')}`));
      const controls = el('div', 'site-filters');
      const searchLabel = el('label', '', 'Search findings');
      const search = el('input'); search.type = 'search'; search.placeholder = 'Page, element, or issue'; searchLabel.append(search);
      const categoryLabel = el('label', '', 'Finding category');
      const category = el('select');
      const all = el('option', '', 'All categories'); all.value = ''; category.append(all);
      for (const name of [...new Set(results.map((result) => result.category))]) { const option = el('option', '', name); option.value = name; category.append(option); }
      categoryLabel.append(category);
      const status = el('p', 'site-filter-status'); status.setAttribute('aria-live', 'polite');
      controls.append(searchLabel, categoryLabel, status); findingsBlock.append(controls);
      const list = el('ol', 'site-findings');
      const rows = [];
      for (const result of results) {
        const row = el('li'); const link = el('a'); link.href = `#${result.target}`;
        link.append(el('span', 'site-category', result.category), el('strong', '', result.title), el('small', '', result.detail));
        row.append(link); list.append(row); rows.push({ node: row, category: result.category, search: `${result.category} ${result.title} ${result.detail}`.toLowerCase() });
      }
      function filterFindings() {
        const query = search.value.trim().toLowerCase(); let visible = 0;
        for (const row of rows) { row.node.hidden = Boolean((category.value && row.category !== category.value) || (query && !row.search.includes(query))); if (!row.node.hidden) visible++; }
        status.textContent = `Showing ${visible} of ${results.length} possible issues.`;
      }
      search.addEventListener('input', filterFindings); category.addEventListener('change', filterFindings); filterFindings();
      findingsBlock.append(list); area.append(findingsBlock);
    } else area.append(el('p', 'site-note', 'No issues were reported by the checks that completed. This is not proof that the site has no UI issues.'));
    const coverage = el('details', 'site-coverage');
    coverage.append(el('summary', '', 'See every inspected or incomplete page'));
    const list = el('ul');
    for (const page of site.pages || []) {
      const row = el('li'); row.append(el('strong', '', page.status === 'captured' ? `${page.partial ? 'Partially inspected' : 'Inspected'} · page ${page.reportPage}` : 'Incomplete'), el('span', '', ` ${page.url}${page.reason ? ` · ${page.reason}` : ''}`)); list.append(row);
    }
    for (const page of site.discoveryFailures || []) {
      const row = el('li'); row.append(el('strong', '', 'Not reached'), el('span', '', ` ${page.url} · ${page.reason}`)); list.append(row);
    }
    for (const page of site.excluded || []) {
      const row = el('li'); row.append(el('strong', '', 'Not followed'), el('span', '', ` ${page.url} · ${page.reason}`)); list.append(row);
    }
    if (site.excludedTruncated) list.append(el('li', '', 'Additional action or sensitive links were omitted from this list.'));
    coverage.append(list); area.append(coverage);
  }

  function downloadReview() {
    const chosenVisual = reviewState.visual.filter((choice) => reviewState.visualAnswers[choice.key]?.selection);
    const chosenLayout = reviewState.layout.filter((group) => reviewState.layoutAnswers[group.key]?.selection);
    const lines = ['# Pieceboard review', '', `Saved: ${new Date().toISOString()}`, '', 'These are review notes; no application changes have been made.', '', `- Visual decisions: ${chosenVisual.length} of ${reviewState.visual.length}`, `- Layout decisions: ${chosenLayout.length} of ${reviewState.layout.length}`, ''];
    if (chosenVisual.length) lines.push('## Appearance decisions', '');
    for (const [index, choice] of chosenVisual.entries()) {
      const answer = reviewState.visualAnswers[choice.key];
      const letter = answer.selection.toUpperCase();
      const option = choice.options['abcd'.indexOf(answer.selection)];
      const label = answer.selection === 'ignore' ? 'Ignore this comparison' : answer.selection === 'none' ? 'Neither appearance' : answer.selection === 'unsure' ? 'Needs more context' : `${letter} · ${option?.label || 'Observed appearance'}`;
      lines.push(`### ${index + 1}. ${choice.name}`, '', `- Decision: ${label}`, `- Repeated findings grouped: ${choice.occurrences.length}`, `- Example: ${choice.occurrences[0].context}`, `- Finding IDs: ${[...new Set(choice.occurrences.map((item) => item.id))].join(', ')}`);
      if (answer.note.trim()) lines.push(`- Explanation: ${answer.note.trim().replaceAll('\n', '\n  ')}`);
      lines.push('');
    }
    if (chosenLayout.length) lines.push('## Layout decisions', '');
    const labels = { fix: 'Needs a fix', keep: 'Keep as is', ignore: 'Ignore', unsure: 'Needs more context' };
    for (const [index, group] of chosenLayout.entries()) {
      const answer = reviewState.layoutAnswers[group.key];
      lines.push(`### ${index + 1}. ${layoutLabels[group.kind] || 'Possible layout issue'}`, '', `- Decision: ${labels[answer.selection] || answer.selection}`, `- Repeated findings grouped: ${group.occurrences.length}`, `- Route pattern: ${group.route || 'Unknown route'}`, `- Width: ${group.viewport?.width || '?'} px`, `- Element: ${group.selector || 'Unknown element'}`);
      if (group.other) lines.push(`- Other element: ${group.other}`);
      if (group.container) lines.push(`- Container: ${group.container}`);
      if (answer.note.trim()) lines.push(`- Explanation: ${answer.note.trim().replaceAll('\n', '\n  ')}`);
      lines.push('');
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const link = el('a'); link.href = url; link.download = 'pieceboard-review.md'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    for (const status of reviewState.status) status.textContent = 'Review downloaded. Share it only after checking its contents.';
  }

  function downloadReviewJson() {
    const visual = reviewState.visual.flatMap((choice) => {
      const answer = reviewState.visualAnswers[choice.key];
      return answer?.selection ? [{ key: choice.key, selection: answer.selection, note: answer.note || '' }] : [];
    });
    const layout = reviewState.layout.flatMap((group) => {
      const answer = reviewState.layoutAnswers[group.key];
      return answer?.selection ? [{ key: group.key, selection: answer.selection, note: answer.note || '' }] : [];
    });
    const contents = JSON.stringify({ format: 'pieceboard/review-v1', scanRunId: data.scanRunId || 'report', visual, layout }, null, 2) + '\n';
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }));
    const link = el('a'); link.href = url; link.download = 'pieceboard-review.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    for (const status of reviewState.status) status.textContent = 'Review downloaded. Share it only after checking its contents.';
  }

  function reviewFileControls() {
    const controls = el('div', 'review-file-controls');
    const download = el('button', 'review-button', 'Download JSON'); download.type = 'button'; download.addEventListener('click', downloadReviewJson);
    const label = el('label', 'review-file-import', 'Import review JSON'); const input = el('input'); input.type = 'file'; input.accept = '.json,application/json'; label.append(input);
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file || file.size > 2 * 1024 * 1024) throw new Error('Choose a review JSON file under 2 MB.');
        const imported = JSON.parse(await file.text());
        if (imported?.format !== 'pieceboard/review-v1' || imported.scanRunId !== (data.scanRunId || 'report') || !Array.isArray(imported.visual) || !Array.isArray(imported.layout) || imported.visual.length + imported.layout.length > 5000) throw new Error('This review does not match the current scan.');
        const visual = new Map(reviewState.visual.map((choice) => [choice.key, choice]));
        const layout = new Set(reviewState.layout.map((group) => group.key));
        let applied = 0, skipped = 0;
        for (const [items, known, answers, allowed] of [[imported.visual, visual, reviewState.visualAnswers, null], [imported.layout, layout, reviewState.layoutAnswers, ['fix', 'keep', 'ignore', 'unsure']]]) {
          for (const item of items) {
            const target = known instanceof Map ? known.get(item?.key) : known.has(item?.key);
            const valid = allowed || (target ? [...'abcd'.slice(0, target.options.length), 'none', 'ignore', 'unsure'] : []);
            if (!target || !valid.includes(item?.selection) || typeof item.note !== 'string' || item.note.length > 1000 || answers[item.key]?.selection || answers[item.key]?.note) { skipped++; continue; }
            answers[item.key] = { selection: item.selection, note: item.note }; applied++;
          }
        }
        const visualKey = `pieceboard:choices:${data.scanRunId || 'report'}`, layoutKey = `pieceboard:layout:${data.scanRunId || 'report'}`;
        const priorVisual = JSON.parse(localStorage.getItem(visualKey) || '{}'), priorLayout = JSON.parse(localStorage.getItem(layoutKey) || '{}');
        localStorage.setItem(visualKey, JSON.stringify({ ...priorVisual, ...reviewState.visualAnswers }));
        localStorage.setItem(layoutKey, JSON.stringify({ ...priorLayout, ...reviewState.layoutAnswers }));
        sessionStorage.setItem('pieceboard:import-status', `Imported ${applied} decisions; ${skipped} existing or unmatched entries were left unchanged.`);
        location.reload();
      } catch (error) { for (const status of reviewState.status) status.textContent = error.message || 'The review could not be imported.'; }
      finally { input.value = ''; }
    });
    controls.append(download, label); return controls;
  }

  function renderFocus() {
    const area = byId('focus-review');
    if (!area) return;
    const title = el('div');
    const heading = el('h2', '', 'What would you like help with?'); heading.id = 'focus-title';
    title.append(el('div', 'section-kicker', 'FOCUS YOUR REVIEW'), heading, el('p', 'choice-intro', 'Filter the decisions, layout patterns, and captured pieces below. The full scan and all findings are still available.'));
    const searchLabel = el('label', 'focus-label', 'Feature or action');
    const search = el('input'); search.type = 'search'; search.maxLength = 80; search.placeholder = 'For example: sidebar, header, or save buttons'; searchLabel.append(search);
    const shortcuts = el('div', 'focus-shortcuts'); shortcuts.setAttribute('aria-label', 'Suggested review focuses');
    const buttons = [];
    for (const [label, value] of [['Everything', ''], ['Sidebars', 'sidebar'], ['Headers', 'header'], ['Save buttons', 'save buttons'], ['Cancel buttons', 'cancel buttons']]) {
      const button = el('button', 'focus-chip', label); button.type = 'button';
      button.addEventListener('click', () => { search.value = value; updateFocus(value); });
      buttons.push({ button, value }); shortcuts.append(button);
    }
    const labelSearchEnabled = data.consistency && (data.consistency.pages || [data.consistency]).some((page) => page.scope?.searchButtonLabels);
    const explanation = el('p', 'focus-help', labelSearchEnabled
      ? 'Matches use captured button labels, action and region hints, source names, and locations. Capture limits and hints can still miss controls.'
      : 'Matches use captured action and region hints, source names, and locations. To search another button label, enter its action before scanning or turn on button-label search. Hints can miss controls or identify the wrong purpose.');
    const status = el('p', 'focus-status'); status.setAttribute('aria-live', 'polite');
    const examples = el('div', 'focus-examples');
    const more = el('button', 'review-button focus-more', 'Show more examples'); more.type = 'button';
    area.append(title, searchLabel, shortcuts, explanation, status, examples, more);
    const pages = data.consistency ? (data.consistency.pages || [data.consistency]) : [];
    const observed = pages.flatMap((page, pageIndex) => (page.observations || []).map((observation) => ({
      observation, page: page.scope?.url || 'Unknown page', pageIndex: pageIndex + 1, image: page.previews?.[observation.id]?.image,
      search: `button ${page.scope?.url || ''} ${observation.group?.family || ''} ${observation.source?.file || ''} ${observation.searchLabel || ''} ${observation.searchAlias || ''} ${(observation.focus?.actions || []).join(' ')} ${(observation.focus?.regions || []).join(' ')}`,
    })));
    const landmarks = (data.responsiveAudit?.pages || []).flatMap((page, pageIndex) => (page.viewports || []).flatMap((width) => (width.landmarks || []).map((landmark) => ({
      landmark, viewport: width.viewport, preview: width.previews?.[landmark.previewIndex], page: page.url || 'Unknown page', pageIndex: pageIndex + 1,
      search: `${landmark.kind} ${page.url || ''}`,
    }))));
    const sourceExamples = capturedEntries.filter(({ capture }) => typeof capture?.image === 'string');
    let shown = 12;
    function draw() {
      buttons.forEach(({ button, value }) => button.setAttribute('aria-pressed', String(focusState.value.toLowerCase() === value.toLowerCase())));
      examples.replaceChildren(); more.hidden = true;
      if (!focusState.value) { status.textContent = 'Choose a focus or explore everything below.'; return; }
      const matchingButtons = observed.filter((entry) => focusMatches(entry.search, entry.observation.focus?.requested));
      const matchingLandmarks = landmarks.filter((entry) => focusMatches(entry.search));
      const matchingSources = sourceExamples.filter(({ item, capture, types: entryTypes }) => focusMatches(`${item.name} ${item.kind} ${item.source || ''} ${capture.label || ''} ${capture.file || ''} ${capture.page || ''} ${entryTypes.join(' ')} ${capture.element?.tag || ''}`));
      const unique = new Map();
      for (const entry of matchingButtons) if (entry.image && !unique.has(entry.image)) unique.set(entry.image, { kind: 'button', ...entry });
      for (const entry of matchingLandmarks) if (entry.preview?.image && !unique.has(entry.preview.image)) unique.set(entry.preview.image, { kind: 'region', ...entry });
      for (const entry of matchingSources) if (!unique.has(entry.capture.image)) unique.set(entry.capture.image, { kind: 'source', ...entry });
      const list = [...unique.values()];
      status.textContent = list.length
        ? `${plural(list.length, 'captured example')} match this focus. Matching decisions and layout patterns are below.`
        : 'No captured examples match this focus. Check matching decisions and layout patterns below, or scan another page or state.';
      for (const entry of list.slice(0, shown)) {
        const card = el('article', 'focus-example');
        const image = el('img'); image.src = entry.kind === 'button' ? entry.image : entry.kind === 'region' ? entry.preview.image : entry.capture.image; image.alt = 'Captured interface example'; image.loading = 'lazy';
        const description = entry.kind === 'button'
          ? `${entry.observation.searchLabel || entry.observation.focus?.actions?.join(' / ') || 'Observed'} button · page ${entry.pageIndex}`
          : entry.kind === 'region' ? `${entry.landmark.kind} · page ${entry.pageIndex} · ${entry.viewport.width} px` : entry.capture.label || entry.item.name || 'Captured interface piece';
        if (entry.kind === 'region') {
          const frame = el('div', 'focus-region-preview'); frame.append(image);
          const bounds = entry.landmark.bounds, scroll = entry.preview.scroll, viewport = entry.viewport;
          if (bounds && scroll && viewport?.width && viewport?.height) {
            const x1 = Math.max(0, Math.min(viewport.width, bounds.x - scroll.x)), y1 = Math.max(0, Math.min(viewport.height, bounds.y - scroll.y));
            const x2 = Math.max(0, Math.min(viewport.width, bounds.x + bounds.width - scroll.x)), y2 = Math.max(0, Math.min(viewport.height, bounds.y + bounds.height - scroll.y));
            if (x2 > x1 && y2 > y1) {
              const width = x2 - x1, height = y2 - y1;
              frame.style.width = `${Math.min(240, 180 * width / height)}px`; frame.style.aspectRatio = `${width} / ${height}`;
              image.style.width = `${viewport.width / width * 100}%`; image.style.left = `${-x1 / width * 100}%`; image.style.top = `${-y1 / height * 100}%`;
            }
          }
          card.append(frame);
        } else card.append(image);
        card.append(el('strong', '', description), el('span', '', entry.kind === 'button' || entry.kind === 'region' ? entry.page : entry.capture.page || entry.capture.file || 'Source-linked example'));
        if (entry.kind === 'source') { const details = el('button', 'focus-detail', 'View details'); details.type = 'button'; details.addEventListener('click', () => showItem(entry.item, entry.capture)); card.append(details); }
        examples.append(card);
      }
      if (list.length > shown) { more.hidden = false; more.textContent = `Show more examples (${list.length - shown} remaining)`; }
      if (matchingButtons.some((entry) => !entry.image)) examples.append(el('p', 'focus-help', 'Some matching controls were observed without a captured preview.'));
      if (matchingLandmarks.some((entry) => !entry.preview?.image)) examples.append(el('p', 'focus-help', 'Some matching regions did not have an available screenshot.'));
    }
    search.addEventListener('input', () => { shown = 12; updateFocus(search.value); });
    more.addEventListener('click', () => { shown += 12; draw(); });
    focusState.listeners.push(draw);
    search.value = typeof data.reviewFocus === 'string' ? data.reviewFocus : '';
    updateFocus(search.value);
  }

  function renderChoices() {
    const area = byId('choice-review');
    if (!area) return;
    const result = reviewModel.visual(data), candidates = result.groups;
    reviewState.visual = candidates;
    area.append(el('div', 'section-kicker', 'START HERE · CHOOSE WHAT FITS'), el('h2', '', 'Which version should we use?'));
    if (!candidates.length) {
      area.append(el('p', 'choice-empty', data.consistency || data.elementConsistency
        ? result.missing
          ? 'No side-by-side choices can be shown because comparison screenshots are unavailable. Check capture coverage and try the relevant page again.'
          : 'No differences were identified that can be shown as a choice in these captures. Browse the focused examples and check coverage; this does not establish that the interface is consistent.'
        : 'This is a source inventory, so it does not yet contain visual choices. Ask your agent to capture authorized test screens and compare the same interface in each one.'));
      if (result.indistinct) area.append(el('p', 'choice-empty', `${plural(result.indistinct, 'comparison')} had identical captures and needs closer inspection before making a visual choice.`));
      return;
    }
    area.append(el('p', 'choice-intro', `${plural(result.original - result.indistinct, 'captured comparison')} grouped into ${plural(candidates.length, 'decision')}. Choose an observed appearance, neither, ignore, or ask for more context; explain your reasoning and download your review.`));
    if (result.missing) area.append(el('p', 'choice-empty', `${plural(result.missing, 'additional comparison')} could not be shown because an image is unavailable.`));
    if (result.indistinct) area.append(el('p', 'choice-empty', `${plural(result.indistinct, 'comparison')} had identical captures and needs closer inspection before making a visual choice.`));
    let saved = {};
    const storageKey = `pieceboard:choices:${data.scanRunId || 'report'}`;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { /* Browser storage can be unavailable. */ }
    const answers = reviewState.visualAnswers;
    const status = el('p', 'choice-status'); status.setAttribute('role', 'status'); reviewState.status.push(status);
    try { const message = sessionStorage.getItem('pieceboard:import-status'); if (message) { status.textContent = message; sessionStorage.removeItem('pieceboard:import-status'); } } catch { /* Optional confirmation only. */ }
    const save = () => {
      try { localStorage.setItem(storageKey, JSON.stringify({ ...saved, ...answers })); status.textContent = 'Saved on this device. Download your review to keep or share it.'; }
      catch { status.textContent = 'Download your review to keep it.'; }
    };
    const list = el('div', 'choice-list');
    const cards = [];
    const focusedEmpty = el('p', 'choice-empty', 'No appearance decisions match this focus. Check the examples and layout findings, or try another focus.');
    focusedEmpty.hidden = true;
    candidates.forEach((choice, index) => {
      let previous = saved?.[choice.key];
      if (!previous) {
        const legacy = choice.legacy.flatMap((entry) => {
          const answer = saved?.[entry.key];
          if (!answer || typeof answer !== 'object') return [];
          const option = answer.selection === 'a' ? entry.first : answer.selection === 'b' ? entry.second : -1;
          return [{ selection: option >= 0 ? 'abcd'[option] : '', note: typeof answer.note === 'string' ? answer.note : '' }];
        });
        const unique = [...new Set(legacy.map((entry) => entry.selection).filter(Boolean))];
        const notes = [...new Set(legacy.map((entry) => entry.note.trim()).filter(Boolean))].join('\n\n');
        if (unique.length > 1) previous = { selection: '', note: `Earlier answers for these repeated comparisons differed; please review this grouped decision.\n\n${notes}` };
        else if (legacy.length) previous = { selection: unique[0] || '', note: notes };
      }
      const allowed = [...'abcd'.slice(0, choice.options.length), 'none', 'ignore', 'unsure'];
      answers[choice.key] = { selection: allowed.includes(previous?.selection) ? previous.selection : '', note: typeof previous?.note === 'string' ? previous.note.slice(0, 1000) : '' };
      const card = el('fieldset', 'choice-card');
      cards.push({ card, choice });
      card.append(el('legend', '', `${index + 1}. Which ${choice.name} should we use?`), el('p', 'choice-context', `${plural(choice.occurrences.length, 'matching comparison')} · ${choice.occurrences[0].context}`));
      const actionSets = choice.options.map((option) => (option.actions || []).join(','));
      if (actionSets.every(Boolean) && new Set(actionSets).size > 1) card.append(el('p', 'choice-context', 'These examples may serve different actions. They may intentionally look different; check their purpose before choosing.'));
      if (choice.occurrences.length > 1) {
        const more = el('details', 'choice-occurrences'); more.append(el('summary', '', 'See matching occurrences'));
        const entries = el('ul');
        for (const occurrence of choice.occurrences) { const item = el('li'); const link = el('a', '', occurrence.context); link.href = occurrence.target; item.append(link); entries.append(item); }
        more.append(entries); card.append(more);
      }
      const options = el('div', 'choice-pair');
      choice.options.forEach((option, optionIndex) => {
        const value = 'abcd'[optionIndex], label = el('label', 'choice-option');
        const input = el('input'); input.type = 'radio'; input.name = `choice-${index}`; input.value = value; input.checked = answers[choice.key].selection === value;
        const copy = el('span', 'choice-option-copy'); copy.append(el('strong', '', `Choose ${value.toUpperCase()} · ${option.label}`));
        const preview = el('img'); preview.src = option.image; preview.alt = `${option.label} captured from the selected test page`; preview.loading = 'lazy'; copy.append(preview);
        label.append(input, copy); options.append(label); input.addEventListener('change', () => { answers[choice.key].selection = value; save(); });
      });
      const other = el('div', 'choice-other');
      for (const [value, labelText] of [['none', 'Neither — a different design is needed'], ['ignore', 'Ignore — this difference is intentional or unrelated'], ['unsure', 'Needs more context']]) {
        const label = el('label', 'choice-action'); const input = el('input'); input.type = 'radio'; input.name = `choice-${index}`; input.value = value; input.checked = answers[choice.key].selection === value;
        input.addEventListener('change', () => { answers[choice.key].selection = value; save(); }); label.append(input, el('span', '', labelText)); other.append(label);
      }
      const noteLabel = el('label', 'choice-note', 'Explanation');
      const note = el('textarea'); note.maxLength = 1000; note.rows = 2; note.placeholder = 'Why this choice, or why should it be ignored?'; note.value = answers[choice.key].note; noteLabel.append(note);
      note.addEventListener('input', () => { answers[choice.key].note = note.value; save(); });
      card.append(options, other, noteLabel); list.append(card);
    });
    const download = el('button', 'review-button choice-download', 'Download my review'); download.type = 'button'; download.addEventListener('click', downloadReview);
    area.append(list, focusedEmpty, download, reviewFileControls(), status);
    const applyFocus = () => {
      let visible = 0;
      for (const { card, choice } of cards) { card.hidden = !focusMatches(choice.search, choice.requested); if (!card.hidden) visible++; }
      focusedEmpty.hidden = visible > 0;
    };
    focusState.listeners.push(applyFocus);
    applyFocus();
  }

  const layoutLabels = { 'horizontal-overflow': 'Horizontal overflow', 'clipped-text': 'Clipped text', 'overlapping-text': 'Overlapping text' };
  function renderLayoutDecisions() {
    const groups = reviewModel.layout(data); reviewState.layout = groups;
    if (!groups.length) return;
    const area = el('section', 'choice-review layout-decisions'); area.id = 'layout-decisions'; area.setAttribute('aria-label', 'Grouped layout decisions');
    byId('choice-review').after(area);
    const total = groups.reduce((count, group) => count + group.occurrences.length, 0);
    area.append(el('div', 'section-kicker', 'LAYOUT · GROUPED FOR REVIEW'), el('h2', '', 'What should happen to these layout issues?'), el('p', 'choice-intro', `${plural(total, 'detected occurrence')} grouped into ${plural(groups.length, 'pattern')} by route, elements, and screen size. Review the example and decide whether it needs a fix, is intentional, should be ignored, or needs more context. Matching routes can contain different states, so check the listed occurrences before applying a decision.`));
    const storageKey = `pieceboard:layout:${data.scanRunId || 'report'}`;
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      for (const group of groups) {
        const answer = saved?.[group.key];
        if (answer && typeof answer === 'object') reviewState.layoutAnswers[group.key] = { selection: ['fix', 'keep', 'ignore', 'unsure'].includes(answer.selection) ? answer.selection : '', note: typeof answer.note === 'string' ? answer.note.slice(0, 1000) : '' };
      }
    } catch { /* Download remains available. */ }
    const answers = reviewState.layoutAnswers;
    const status = el('p', 'choice-status'); status.setAttribute('role', 'status'); reviewState.status.push(status);
    const save = () => { try { localStorage.setItem(storageKey, JSON.stringify({ ...saved, ...answers })); status.textContent = 'Saved on this device. Download your review to keep or share it.'; } catch { status.textContent = 'Download your review to keep it.'; } };
    const controls = el('div', 'site-filters');
    const searchLabel = el('label', '', 'Search layout patterns'); const search = el('input'); search.type = 'search'; search.placeholder = 'Route, element, or issue'; searchLabel.append(search);
    const kindLabel = el('label', '', 'Layout issue type'); const kind = el('select'); const all = el('option', '', 'All issue types'); all.value = ''; kind.append(all);
    for (const [value, label] of Object.entries(layoutLabels)) { const option = el('option', '', label); option.value = value; kind.append(option); }
    kindLabel.append(kind); controls.append(searchLabel, kindLabel); area.append(controls);
    const list = el('div', 'choice-list'), pager = el('div', 'layout-pager'), count = el('p', 'site-filter-status');
    const previous = el('button', 'review-button', 'Previous'); previous.type = 'button';
    const next = el('button', 'review-button', 'Next'); next.type = 'button';
    pager.append(previous, count, next); area.append(list, pager);
    let pageNumber = 0;
    const pageSize = 20;
    function draw() {
      const query = search.value.trim().toLowerCase();
      const filtered = groups.filter((group) => {
        const description = `${layoutLabels[group.kind] || ''} ${group.route} ${group.selector} ${group.other} ${group.container} ${(group.regions || []).join(' ')} ${group.occurrences.map((entry) => entry.finding?.source?.file || '').join(' ')}`;
        return (!kind.value || group.kind === kind.value) && (!query || description.toLowerCase().includes(query)) && focusMatches(description);
      });
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); pageNumber = Math.min(pageNumber, pages - 1);
      previous.disabled = pageNumber === 0; next.disabled = pageNumber >= pages - 1;
      count.textContent = `${filtered.length} patterns · page ${pageNumber + 1} of ${pages}`;
      list.replaceChildren();
      for (const [offset, group] of filtered.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize).entries()) {
        const card = el('fieldset', 'choice-card layout-decision-card');
        card.append(el('legend', '', `${pageNumber * pageSize + offset + 1}. ${layoutLabels[group.kind] || 'Possible layout issue'}`), el('p', 'choice-context', `${plural(group.occurrences.length, 'matching occurrence')} · ${group.route || 'Unknown route'} · ${group.viewport?.width || '?'} px`), el('code', 'layout-selector', group.selector || 'Unknown element'));
        const guidance = {
          'overlapping-text': 'Two text areas occupy the same space. Check whether both are visible at once; if so, give them room or adjust their positioning.',
          'clipped-text': 'Text extends beyond an area that clips its contents. Check whether truncation is intentional and the full text is available.',
          'horizontal-overflow': 'Content extends beyond the screen width. Check that people can reach it without unintended sideways scrolling.',
        };
        card.append(el('p', 'layout-message', guidance[group.kind] || 'Inspect the captured area and decide whether it needs a change.'));
        if (group.other) card.append(el('p', 'choice-context', `Overlaps: ${group.other}`));
        if (group.container) card.append(el('p', 'choice-context', `Container: ${group.container}`));
        const sample = group.occurrences.find((entry) => entry.evidence?.image) || group.occurrences[0];
        if (sample?.evidence?.image) {
          const frame = el('div', 'responsive-evidence layout-decision-preview');
          const viewport = group.viewport || {}, bounds = sample.finding?.bounds, scroll = sample.evidence.scroll;
          if (viewport.width && viewport.height) frame.style.width = `${Math.min(viewport.width, 500, 320 * viewport.width / viewport.height)}px`;
          const preview = el('img', 'responsive-evidence-image'); preview.src = sample.evidence.image; preview.alt = `Captured example of ${layoutLabels[group.kind] || 'a layout issue'}`; preview.loading = 'lazy'; frame.append(preview);
          if (bounds && scroll && viewport.width && viewport.height) {
            const x1 = Math.max(0, Math.min(viewport.width, bounds.x - scroll.x)), y1 = Math.max(0, Math.min(viewport.height, bounds.y - scroll.y));
            const x2 = Math.max(0, Math.min(viewport.width, bounds.x + bounds.width - scroll.x)), y2 = Math.max(0, Math.min(viewport.height, bounds.y + bounds.height - scroll.y));
            if (x2 > x1 && y2 > y1) { const marker = el('span', 'responsive-highlight'); marker.setAttribute('aria-hidden', 'true'); marker.style.left = `${x1 / viewport.width * 100}%`; marker.style.top = `${y1 / viewport.height * 100}%`; marker.style.width = `${(x2 - x1) / viewport.width * 100}%`; marker.style.height = `${(y2 - y1) / viewport.height * 100}%`; frame.append(marker); }
          }
          const otherBounds = sample.finding?.otherBounds;
          if (otherBounds && scroll && viewport.width && viewport.height) {
            const x1 = Math.max(0, Math.min(viewport.width, otherBounds.x - scroll.x)), y1 = Math.max(0, Math.min(viewport.height, otherBounds.y - scroll.y));
            const x2 = Math.max(0, Math.min(viewport.width, otherBounds.x + otherBounds.width - scroll.x)), y2 = Math.max(0, Math.min(viewport.height, otherBounds.y + otherBounds.height - scroll.y));
            if (x2 > x1 && y2 > y1) { const marker = el('span', 'responsive-highlight responsive-highlight-other'); marker.setAttribute('aria-hidden', 'true'); marker.style.left = `${x1 / viewport.width * 100}%`; marker.style.top = `${y1 / viewport.height * 100}%`; marker.style.width = `${(x2 - x1) / viewport.width * 100}%`; marker.style.height = `${(y2 - y1) / viewport.height * 100}%`; frame.append(marker); }
          }
          card.append(frame, el('p', 'choice-context', otherBounds ? 'Orange and blue outlines mark the two measured text areas when visible.' : 'The outline marks the measured area when visible.'));
        }
        else card.append(el('p', 'choice-empty', 'No screenshot is available for this pattern. Choose “Needs more context” if the evidence is insufficient.'));
        if (sample?.finding?.recommendation?.summary) {
          const suggestion = el('details', 'choice-occurrences'); suggestion.append(el('summary', '', 'Technical suggestion'), el('p', 'layout-message', sample.finding.recommendation.summary)); card.append(suggestion);
        }
        const detail = el('details', 'choice-occurrences'); detail.append(el('summary', '', 'See every matching occurrence')); const entries = el('ul');
        for (const occurrence of group.occurrences) { const item = el('li'); const link = el('a', '', `Page ${occurrence.page} · inspect finding`); link.href = occurrence.target; item.append(link); entries.append(item); }
        detail.append(entries); card.append(detail);
        const row = el('div', 'choice-other');
        for (const [value, labelText] of [['fix', 'Needs a fix'], ['keep', 'Keep as is'], ['ignore', 'Ignore'], ['unsure', 'Needs more context']]) {
          const label = el('label', 'choice-action'), input = el('input'); input.type = 'radio'; input.name = `layout-${pageNumber}-${offset}`; input.value = value; input.checked = answers[group.key]?.selection === value;
          input.addEventListener('change', () => { answers[group.key] = { ...(answers[group.key] || {}), selection: value, note: answers[group.key]?.note || '' }; save(); }); label.append(input, el('span', '', labelText)); row.append(label);
        }
        const noteLabel = el('label', 'choice-note', 'Explanation'); const note = el('textarea'); note.rows = 2; note.maxLength = 1000; note.placeholder = 'Why is this a problem, intentional, or uncertain?'; note.value = answers[group.key]?.note || '';
        note.addEventListener('input', () => { answers[group.key] = { ...(answers[group.key] || {}), selection: answers[group.key]?.selection || '', note: note.value }; save(); }); noteLabel.append(note); card.append(row, noteLabel); list.append(card);
      }
      if (!filtered.length) list.append(el('p', 'choice-empty', 'No layout patterns match these filters.'));
    }
    previous.addEventListener('click', () => { pageNumber--; draw(); }); next.addEventListener('click', () => { pageNumber++; draw(); });
    search.addEventListener('input', () => { pageNumber = 0; draw(); }); kind.addEventListener('change', () => { pageNumber = 0; draw(); });
    focusState.listeners.push(() => { pageNumber = 0; draw(); }); draw();
    const download = el('button', 'review-button choice-download', 'Download my review'); download.type = 'button'; download.addEventListener('click', downloadReview); area.append(download, reviewFileControls(), status);
  }


  function renderConsistency() {
    const review = byId('consistency-review');
    const result = data.consistency;
    if (!review || !result) return;
    const pages = result.pages || [result];
    const elementPages = data.elementConsistency?.pages || [];
    const crossPage = data.crossPageConsistency;
    const findings = [...pages.flatMap((page) => page.findings), ...(crossPage?.findings || []), ...elementPages.flatMap((page) => page.findings)];
    review.hidden = false;
    const header = el('div', 'consistency-header');
    const title = el('div');
    title.append(el('div', 'section-kicker', 'CONSISTENCY REVIEW'), el('h2', '', elementPages.length ? 'Possible UI differences' : 'Possible button differences'), el('p', '', 'Compare the common appearance with a rarer one. Differences can be intentional.'));
    header.append(title, el('span', 'consistency-count', plural(findings.length, 'finding')));
    review.append(header);
    if (data.scanProgress?.requested) review.append(el('p', 'consistency-note', `Selected pages: ${data.scanProgress.requested} · HTML observation phases completed: ${data.scanProgress.observed.length} · browser capture phases completed: ${data.scanProgress.captured.length}. Phase completion does not establish complete UI coverage.`));
    const explicitLocations = new Map();
    for (const [pageIndex, page] of pages.entries()) {
      for (const observation of page.observations) {
        const group = observation.group;
        if (!['page-provided group', 'configured group'].includes(group?.familyEvidence)) continue;
        const key = JSON.stringify([group.family, group.variant, group.type]);
        if (!explicitLocations.has(key)) explicitLocations.set(key, new Map());
        const locations = explicitLocations.get(key);
        if (!locations.has(pageIndex)) locations.set(pageIndex, { page: pageIndex + 1, url: page.scope.url, count: 0 });
        locations.get(pageIndex).count++;
      }
    }
    const occurrences = new Map();
    for (const finding of findings) occurrences.set(finding.id, (occurrences.get(finding.id) || 0) + 1);
    const reviewable = (finding) => Boolean(finding.decisionAnchor) && occurrences.get(finding.id) === 1;
    const initialReviews = new Map(findings.filter((finding) => reviewable(finding) && finding.review).map((finding) => [finding.id, { findingId: finding.id, ...finding.review }]));
    const queuedReviews = new Map();
    const reviewWidgets = new Map();
    let importedReviews = new Map();
    const baselineQueue = new Map();
    const baselineFeedback = new Map();
    let importedBaselines = new Map();
    let baselineMessage;
    const elementBaselineQueue = new Map();
    const elementBaselineFeedback = new Map();
    let importedElementBaselines = new Map();
    let elementBaselineMessage;
    const requiredStyleFields = window.__UI_SHEET_STYLE_FIELDS__ || [];
    const hasCurrentStyle = (style) => requiredStyleFields.length > 0 && requiredStyleFields.every((key) => typeof style?.[key] === 'string' && style[key].trim()) && Number.isFinite(Number(style.opacity)) && Number(style.opacity) >= 0 && Number(style.opacity) <= 1;
    const templateMatchesObservation = (page, appearance) => {
      const observation = page.observations?.find((entry) => entry.id === appearance.example);
      return observation && hasCurrentStyle(observation.style) && hasCurrentStyle(appearance.approval?.page?.style) && requiredStyleFields.every((key) => appearance.approval.page.style[key] === observation.style[key]);
    };
    const currentButtonMeasurements = (page) => page.findingIdentity === 'ui-sheet/button-finding-v6' && page.observations?.length > 0 && page.observations.every((entry) => hasCurrentStyle(entry.style));
    const baselineCandidates = pages.some((page) => currentButtonMeasurements(page) && !page.scope?.maskSelectorsConfigured && page.appearances?.some((appearance) => templateMatchesObservation(page, appearance) && page.previews?.[appearance.example]?.image));
    const scopeKey = (scope) => {
      try {
        let url = scope.url;
        if (!url.startsWith('local:/')) {
          const parsed = new URL(url);
          url = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ? `local:${parsed.pathname}` : `${parsed.origin}${parsed.pathname}`;
        }
        if (!scope.viewport || !scope.theme) return '';
        return JSON.stringify([url, scope.viewport.width, scope.viewport.height, scope.theme, scope.pixelRatio ?? 2]);
      } catch { return ''; }
    };
    const baselineScopeKeys = baselineCandidates ? pages.map((page) => scopeKey(page.scope || {})) : [];
    const baselineScopesDistinct = baselineScopeKeys.length === pages.length && baselineScopeKeys.every(Boolean) && new Set(baselineScopeKeys).size === baselineScopeKeys.length;
    const currentElementMeasurements = (page) => page.format === 'ui-sheet/elements-v1' && page.findingIdentity === 'ui-sheet/element-finding-v2' && page.observations?.length > 0 && page.observations.every((entry) => hasCurrentStyle(entry.style));
    const elementBaselineCandidates = elementPages.some((page) => currentElementMeasurements(page) && !page.scope?.maskSelectorsConfigured && page.appearances?.some((appearance) => templateMatchesObservation(page, appearance) && page.previews?.[appearance.example]?.image));
    const elementScopeKeys = elementBaselineCandidates ? elementPages.map((page) => scopeKey(page.scope || {})) : [];
    const elementScopesDistinct = elementScopeKeys.length === elementPages.length && elementScopeKeys.every(Boolean) && new Set(elementScopeKeys).size === elementScopeKeys.length;
    if (findings.some(reviewable)) {
      const tools = el('details', 'review-tools');
      tools.append(el('summary', '', 'Save review decisions'));
      tools.append(el('p', 'consistency-note', 'Review individual findings below, then download a decision file. Import an existing file first to preserve its other decisions.'));
      const label = el('label', 'review-import', 'Import an existing decision file (optional)');
      const file = el('input');
      file.type = 'file';
      file.accept = '.json,application/json';
      label.append(file);
      const message = el('p', 'review-message');
      message.setAttribute('role', 'status');
      file.addEventListener('change', async () => {
        try {
          const selected = file.files?.[0];
          if (!selected) return;
          if (selected.size > 2 * 1024 * 1024) throw new Error('Decision file is larger than 2 MB.');
          const content = JSON.parse(await selected.text());
          if (content?.format !== 'ui-sheet/decisions-v1' || !Array.isArray(content.decisions) || content.decisions.length > 5000) throw new Error('This is not a supported Pieceboard decision file.');
          const loaded = new Map();
          for (const entry of content.decisions) {
            if (!entry || !/^[a-f0-9]{16}$/.test(entry.findingId) || !['intentional', 'needs-fix', 'deferred', 'false-positive'].includes(entry.status) || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 500 || loaded.has(entry.findingId)) throw new Error('The decision file contains an invalid or duplicate entry.');
            loaded.set(entry.findingId, { findingId: entry.findingId, status: entry.status, reason: entry.reason, ...(typeof entry.recordedAt === 'string' && entry.recordedAt.length <= 100 ? { recordedAt: entry.recordedAt } : {}) });
          }
          importedReviews = loaded;
          for (const [id, widget] of reviewWidgets) {
            const selected = queuedReviews.get(id) || loaded.get(id) || initialReviews.get(id);
            widget.status.value = selected?.status || 'intentional';
            widget.reason.value = selected?.reason || '';
            widget.reviewStatus.textContent = selected ? `${queuedReviews.has(id) ? 'Queued' : loaded.has(id) ? 'Imported' : 'Reviewed'} as ${selected.status}: ${selected.reason}` : '';
            widget.reviewStatus.hidden = !selected;
          }
          message.textContent = `${plural(loaded.size, 'existing decision')} ready to preserve in the download.`;
        } catch (error) { message.textContent = `${error instanceof SyntaxError ? 'Decision file is not valid JSON.' : error.message} Any previous import remains available.`; }
      });
      const download = el('button', 'review-button', 'Download review decisions');
      download.type = 'button';
      download.addEventListener('click', () => {
        const combined = new Map([...initialReviews, ...importedReviews, ...queuedReviews]);
        if (!combined.size) { message.textContent = 'Review a finding or import a decision file first.'; return; }
        const blob = new Blob([JSON.stringify({ format: 'ui-sheet/decisions-v1', decisions: [...combined.values()] }, null, 2) + '\n'], { type: 'application/json' });
        if (blob.size > 2 * 1024 * 1024) { message.textContent = 'The combined decision file would exceed 2 MB.'; return; }
        const url = URL.createObjectURL(blob);
        const link = el('a');
        link.href = url;
        link.download = 'ui-sheet.decisions.json';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message.textContent = `Downloaded ${plural(combined.size, 'decision')}. Supply this file with --decisions on the next scan.`;
      });
      tools.append(label, download, message);
      review.append(tools);
    }
    if (elementBaselineCandidates && elementScopesDistinct) {
      const tools = el('details', 'element-baseline-tools');
      tools.append(el('summary', '', 'Export approved UI group appearances'));
      tools.append(el('p', 'consistency-note', 'Queue a captured UI appearance below, then download its separate element baseline file. Import an existing element baseline first to preserve its other rules. The next scan validates all imported rules; nothing is applied or written back automatically.'));
      const label = el('label', 'review-import', 'Import an existing UI group baseline file (optional)');
      const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; label.append(file);
      elementBaselineMessage = el('p', 'review-message'); elementBaselineMessage.setAttribute('role', 'status');
      file.addEventListener('change', async () => {
        try {
          const selected = file.files?.[0];
          if (!selected) return;
          if (selected.size > 2 * 1024 * 1024) throw new Error('Element baseline file is larger than 2 MB.');
          const content = JSON.parse(await selected.text());
          if (content?.format === 'ui-sheet/element-baselines-v1') throw new Error('This element baseline predates opacity and filter measurements. Capture a fresh report and reapprove appearances in a new element baseline file.');
          if (content?.format !== 'ui-sheet/element-baselines-v2' || !Array.isArray(content.rules) || content.rules.length > 1000) throw new Error('This is not a supported Pieceboard element baseline file.');
          const loaded = new Map();
          const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
          for (const rule of content.rules) {
            if (!object(rule) || !/^[a-f0-9]{16}$/.test(rule.id) || typeof rule.reason !== 'string' || !rule.reason.trim() || rule.reason.length > 500 || !object(rule.scope) || !object(rule.group) || !object(rule.style) || loaded.has(rule.id)) throw new Error('The element baseline file contains an invalid or duplicate entry.');
            loaded.set(rule.id, rule);
          }
          importedElementBaselines = loaded;
          elementBaselineMessage.textContent = `${plural(loaded.size, 'existing UI approval')} ready to preserve. The next scan validates all imported rules.`;
        } catch (error) { elementBaselineMessage.textContent = `${error instanceof SyntaxError ? 'Element baseline file is not valid JSON.' : error.message} Any previous import remains available.`; }
      });
      const download = el('button', 'review-button', 'Download UI group baseline file'); download.type = 'button';
      download.addEventListener('click', () => {
        const combined = new Map([...importedElementBaselines, ...elementBaselineQueue]);
        if (!combined.size) { elementBaselineMessage.textContent = 'Approve a UI appearance or import an element baseline file first.'; return; }
        if (combined.size > 1000) { elementBaselineMessage.textContent = 'An element baseline file can contain at most 1,000 approvals.'; return; }
        const blob = new Blob([JSON.stringify({ format: 'ui-sheet/element-baselines-v2', rules: [...combined.values()] }, null, 2) + '\n'], { type: 'application/json' });
        if (blob.size > 2 * 1024 * 1024) { elementBaselineMessage.textContent = 'The combined element baseline file would exceed 2 MB.'; return; }
        const url = URL.createObjectURL(blob), link = el('a');
        link.href = url; link.download = 'ui-sheet.elements.json'; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        elementBaselineMessage.textContent = `Downloaded ${plural(combined.size, 'UI approval')}. Supply this file with --element-baseline on the next scan.`;
      });
      tools.append(label, download, elementBaselineMessage); review.append(tools);
    }
    if (baselineCandidates && baselineScopesDistinct) {
      const tools = el('details', 'baseline-tools');
      tools.append(el('summary', '', 'Export approved appearances'));
      tools.append(el('p', 'consistency-note', 'Queue an appearance below, then download a baseline file. Import an existing file first to preserve its other rules.'));
      const label = el('label', 'baseline-import', 'Import an existing baseline file (optional)');
      const file = el('input');
      file.type = 'file';
      file.accept = '.json,application/json';
      label.append(file);
      baselineMessage = el('p', 'review-message');
      baselineMessage.setAttribute('role', 'status');
      file.addEventListener('change', async () => {
        try {
          const selected = file.files?.[0];
          if (!selected) return;
          if (selected.size > 2 * 1024 * 1024) throw new Error('Baseline file is larger than 2 MB.');
          const content = JSON.parse(await selected.text());
          if (content?.format === 'ui-sheet/baselines-v1') throw new Error('This baseline predates four-sided border measurements. Capture a fresh report and reapprove appearances in a new baseline file.');
          if (content?.format === 'ui-sheet/baselines-v2') throw new Error('This baseline predates gradient and text-style measurements. Capture a fresh report and reapprove appearances in a new baseline file.');
          if (content?.format === 'ui-sheet/baselines-v3') throw new Error('This baseline predates opacity and filter measurements. Capture a fresh report and reapprove appearances in a new baseline file.');
          if (content?.format !== 'ui-sheet/baselines-v4' || !Array.isArray(content.rules) || content.rules.length > 1000) throw new Error('This is not a supported Pieceboard baseline file.');
          const loaded = new Map();
          for (const rule of content.rules) {
            if (!rule || !/^[a-f0-9]{16}$/.test(rule.id) || typeof rule.reason !== 'string' || !rule.reason.trim() || rule.reason.length > 500 || !rule.scope || !rule.group || !rule.style || loaded.has(rule.id)) throw new Error('The baseline file contains an invalid or duplicate entry.');
            loaded.set(rule.id, rule);
          }
          importedBaselines = loaded;
          baselineMessage.textContent = `${plural(loaded.size, 'existing approval')} ready to preserve. The next scan validates all imported rules.`;
        } catch (error) { baselineMessage.textContent = `${error instanceof SyntaxError ? 'Baseline file is not valid JSON.' : error.message} Any previous import remains available.`; }
      });
      const download = el('button', 'review-button', 'Download baseline file');
      download.type = 'button';
      download.addEventListener('click', () => {
        const combined = new Map([...importedBaselines, ...baselineQueue]);
        if (!combined.size) { baselineMessage.textContent = 'Approve an appearance or import a baseline file first.'; return; }
        if (combined.size > 1000) { baselineMessage.textContent = 'A baseline file can contain at most 1,000 approvals.'; return; }
        const blob = new Blob([JSON.stringify({ format: 'ui-sheet/baselines-v4', rules: [...combined.values()] }, null, 2) + '\n'], { type: 'application/json' });
        if (blob.size > 2 * 1024 * 1024) { baselineMessage.textContent = 'The combined baseline file would exceed 2 MB.'; return; }
        const url = URL.createObjectURL(blob);
        const link = el('a');
        link.href = url;
        link.download = 'ui-sheet.baselines.json';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        baselineMessage.textContent = `Downloaded ${plural(combined.size, 'approval')}. Supply this file with --baseline on the next scan.`;
      });
      tools.append(label, download, baselineMessage);
      review.append(tools);
    }
    const observationMaps = new Map([...pages, ...elementPages].map((page) => [page, new Map(page.observations.map((observation) => [observation.id, observation]))]));
    function example(analysis, label, entry, acrossPages = false) {
      const noun = analysis.format === 'ui-sheet/elements-v1' ? 'component' : 'button';
      const figure = el('figure', 'comparison-side');
      const observation = observationMaps.get(analysis)?.get(entry.example);
      const snapshot = analysis.previews?.[entry.example];
      figure.append(el('figcaption', '', `${label} · ${plural(entry.count, 'example')}`));
      const frame = el('div', 'comparison-image');
      if (snapshot?.image) {
        const image = document.createElement('img');
        image.src = snapshot.image;
        image.alt = `${label} ${noun} appearance`;
        if (snapshot.width) image.style.width = `${snapshot.width / Math.max(1, snapshot.pixelRatio || 1)}px`;
        frame.append(image);
      } else frame.append(el('span', '', 'Preview unavailable'));
      figure.append(frame);
      if (snapshot?.pixelRatio && analysis.scope.pixelRatio && snapshot.pixelRatio < analysis.scope.pixelRatio) figure.append(el('p', 'comparison-source', `Preview fell back to ${snapshot.pixelRatio}× from ${analysis.scope.pixelRatio}× because of the image-size limit.`));
      const source = observation?.source;
      figure.append(el('p', 'comparison-source', !entry.example && label === 'Approved appearance' ? 'Approved appearance was not observed in this scan' : source?.status === 'manual' ? `Manually linked source: ${fileLabel(source)} · user-supplied, not verified deployment` : source?.status === 'instrumented' ? `Instrumented source: ${fileLabel(source)} · local file hash matched, not verified deployment` : source?.status === 'likely' ? `Possible source: ${fileLabel(source)} · ${source.method || 'source match'}` : 'Source not resolved'));
      if (snapshot?.image) {
        figure.append(captureDetails(snapshot, 'comparison-full', 'View original pixels', `Full-size ${label.toLowerCase()} ${noun} capture`));
      }
      if (entry.count > 1 && observation?.style) {
        const locations = el('details', 'finding-locations');
        locations.append(el('summary', '', `Observed source locations · ${plural(entry.count, 'occurrence')}`));
        let built = false;
        locations.addEventListener('toggle', () => {
          if (!locations.open || built) return;
          built = true;
          const collection = analysis.format === 'ui-sheet/elements-v1' ? elementPages : pages;
          const context = (page) => JSON.stringify([page.scope?.viewport, page.scope?.theme, page.scope?.pixelRatio ?? 2, page.scope?.browser, page.scope?.actions || []]);
          const keys = analysis.format === 'ui-sheet/elements-v1' ? ['family', 'variant', 'type', 'tag', 'nativeType', 'state'] : ['family', 'variant', 'type'];
          const group = (entry) => JSON.stringify(keys.map((key) => entry.group?.[key]));
          const style = (entry) => entry.style && JSON.stringify(Object.keys(entry.style).sort().map((key) => [key, entry.style[key]]));
          const observed = (acrossPages ? collection.filter((page) => context(page) === context(analysis)) : [analysis]).flatMap((page) => page.observations.filter((entry) => group(entry) === group(observation) && style(entry) === style(observation)).map((entry) => ({ page: collection.indexOf(page) + 1, entry })));
          if (observed.length !== entry.count) locations.append(el('p', 'consistency-note', 'The stored count does not match the available observations. Regenerate this report before treating the list as complete.'));
          locations.append(el('p', 'consistency-note', 'Only occurrences observed on the selected page(s) are listed. Source matches remain clues; unvisited code and states are not covered.'));
          const list = el('ul', 'location-list');
          for (const { page, entry } of observed.slice(0, 200)) {
            const row = el('li');
            const body = el('div');
            const source = entry.source;
            body.append(el('code', '', source?.file ? fileLabel(source) : 'Source unresolved'), el('span', 'location-detail', `Page ${page} · ${entry.id} · ${source?.status || 'unresolved'}`));
            row.append(el('span', 'location-icon', '↳'), body); list.append(row);
          }
          locations.append(list);
          if (observed.length > 200) locations.append(el('p', 'consistency-note', `Showing 200 of ${observed.length} occurrences. Use finding-locations in the CLI for a bounded focused query.`));
        });
        figure.append(locations);
      }
      return figure;
    }
    function differenceList(finding) {
      const differences = el('div', 'difference-list');
      let displayDifferences = [...finding.differences];
      const uniformGroups = [
        { names: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'], label: 'Corner radius' },
        ...['Width', 'Style', 'Color'].map((property) => ({ names: ['Top', 'Right', 'Bottom', 'Left'].map((side) => `border${side}${property}`), label: `Border ${property.toLowerCase()}` })),
      ];
      for (const { names, label } of uniformGroups) {
        const group = displayDifferences.filter((difference) => names.includes(difference.property));
        if (group.length !== 4 || !group.every((difference) => difference.common === group[0].common && difference.observed === group[0].observed)) continue;
        const first = displayDifferences.findIndex((difference) => names.includes(difference.property));
        displayDifferences = displayDifferences.filter((difference) => !names.includes(difference.property));
        displayDifferences.splice(first, 0, { ...group[0], label });
      }
      for (const difference of displayDifferences) {
        const row = el('div', 'difference-row');
        row.append(el('strong', '', difference.label), el('code', '', `${difference.common} → ${difference.observed}`));
        differences.append(row);
      }
      return differences;
    }
    function appendReview(card, finding, reviewStatus) {
      if (!reviewable(finding)) return;
      const form = el('details', 'review-form');
      form.append(el('summary', '', 'Review this finding'));
      const statusLabel = el('label', '', 'Decision');
      const status = el('select');
      for (const [value, text] of [['intentional', 'Intentional'], ['needs-fix', 'Needs fix'], ['deferred', 'Deferred'], ['false-positive', 'False positive']]) {
        const option = el('option', '', text); option.value = value; status.append(option);
      }
      if (finding.review) status.value = finding.review.status;
      statusLabel.append(status);
      const reasonLabel = el('label', '', 'Reason');
      const reason = el('input');
      reason.type = 'text'; reason.maxLength = 500; reason.value = finding.review?.reason || '';
      reason.placeholder = 'Why did you choose this decision?';
      reasonLabel.append(reason);
      const save = el('button', 'review-button', 'Queue decision');
      save.type = 'button';
      const feedback = el('p', 'review-message'); feedback.setAttribute('role', 'status');
      reviewWidgets.set(finding.id, { status, reason, reviewStatus });
      save.addEventListener('click', () => {
        const text = reason.value.trim();
        if (!text || text.length > 500) { feedback.textContent = 'Enter a reason of 1–500 characters.'; return; }
        queuedReviews.set(finding.id, { findingId: finding.id, status: status.value, reason: text, recordedAt: new Date().toISOString() });
        reviewStatus.textContent = `Queued as ${status.value}: ${text}`;
        reviewStatus.hidden = false;
        feedback.textContent = 'Decision queued. Download the decision file to keep it.';
      });
      form.append(statusLabel, reasonLabel, save, feedback);
      card.append(form);
    }
    function appendApproval(figure, analysis, appearance, pageIndex) {
      if (!currentButtonMeasurements(analysis) || !baselineScopesDistinct || !templateMatchesObservation(analysis, appearance)) return;
      if (analysis.scope.maskSelectorsConfigured) {
        figure.append(el('p', 'consistency-note', 'Approval from this report is unavailable when screenshot masks are configured.'));
        return;
      }
      if (!analysis.previews?.[appearance.example]?.image) {
        figure.append(el('p', 'consistency-note', 'A captured preview is needed to approve this appearance here.'));
        return;
      }
      const form = el('details', 'review-form baseline-form');
      form.append(el('summary', '', 'Approve this appearance'));
      form.append(el('p', 'consistency-note', `This records your chosen reference for the group, viewport, theme, and capture density.${appearance.approval.crossPage ? ' Cross-page approvals also apply to future matching pages.' : ''}`));
      const scopeLabel = el('label', '', 'Approval scope');
      const scope = el('select');
      const pageOption = el('option', '', `Page ${pageIndex + 1} only`); pageOption.value = 'page'; scope.append(pageOption);
      if (appearance.approval.crossPage) {
        const crossOption = el('option', '', 'This group across selected and future matching pages'); crossOption.value = 'crossPage'; scope.append(crossOption);
      }
      scopeLabel.append(scope);
      const reasonLabel = el('label', '', 'Reason');
      const reason = el('input'); reason.type = 'text'; reason.maxLength = 500; reason.placeholder = 'Why is this appearance approved?'; reasonLabel.append(reason);
      const queue = el('button', 'review-button', 'Queue approval'); queue.type = 'button';
      const feedback = el('p', 'review-message'); feedback.setAttribute('role', 'status');
      queue.addEventListener('click', () => {
        const text = reason.value.trim();
        if (!text || text.length > 500) { feedback.textContent = 'Enter a reason of 1–500 characters.'; return; }
        const template = appearance.approval[scope.value];
        if (!template) { feedback.textContent = 'This approval scope is unavailable.'; return; }
        const previous = baselineFeedback.get(template.id);
        if (previous && previous !== feedback) previous.textContent = 'Replaced by a later approval for this group and scope.';
        baselineQueue.set(template.id, { ...template, reason: text, recordedAt: new Date().toISOString() });
        baselineFeedback.set(template.id, feedback);
        feedback.textContent = 'Approval queued. Download the baseline file to keep it.';
        baselineMessage.textContent = `${plural(baselineQueue.size, 'approval')} queued. A later choice for the same group and scope replaces the earlier one.`;
      });
      form.append(scopeLabel, reasonLabel, queue, feedback);
      figure.append(form);
    }
    function appendElementApproval(figure, analysis, appearance, pageIndex) {
      if (!currentElementMeasurements(analysis) || !elementScopesDistinct || !templateMatchesObservation(analysis, appearance)) return;
      if (analysis.scope.maskSelectorsConfigured) {
        figure.append(el('p', 'consistency-note', 'UI approval from this report is unavailable when screenshot masks are configured.'));
        return;
      }
      if (!analysis.previews?.[appearance.example]?.image) {
        figure.append(el('p', 'consistency-note', 'A captured preview is needed to approve this UI appearance here.'));
        return;
      }
      const form = el('details', 'review-form element-baseline-form');
      form.append(el('summary', '', 'Approve this UI appearance'));
      form.append(el('p', 'consistency-note', 'This records your chosen reference for this configured group, observed state, viewport, theme, and capture density.'));
      const scopeLabel = el('label', '', 'UI approval scope'), scope = el('select');
      const pageOption = el('option', '', `Page ${pageIndex + 1} only`); pageOption.value = 'page'; scope.append(pageOption);
      if (appearance.approval.crossPage) {
        const crossOption = el('option', '', 'This group and state across selected and future matching pages'); crossOption.value = 'crossPage'; scope.append(crossOption);
      }
      scopeLabel.append(scope);
      const reasonLabel = el('label', '', 'UI approval reason'), reason = el('input');
      reason.type = 'text'; reason.maxLength = 500; reason.placeholder = 'Why is this UI appearance approved?'; reasonLabel.append(reason);
      const queue = el('button', 'review-button', 'Queue UI approval'); queue.type = 'button';
      const feedback = el('p', 'review-message'); feedback.setAttribute('role', 'status');
      queue.addEventListener('click', () => {
        const text = reason.value.trim();
        if (!text || text.length > 500) { feedback.textContent = 'Enter a reason of 1–500 characters.'; return; }
        const template = appearance.approval[scope.value];
        if (!template) { feedback.textContent = 'This UI approval scope is unavailable.'; return; }
        const combined = new Map([...importedElementBaselines, ...elementBaselineQueue]);
        if (!combined.has(template.id) && combined.size >= 1000) { feedback.textContent = 'An element baseline file can contain at most 1,000 approvals.'; return; }
        const previous = elementBaselineFeedback.get(template.id);
        if (previous && previous !== feedback) previous.textContent = 'Replaced by a later UI approval for this group and scope.';
        elementBaselineQueue.set(template.id, { ...template, reason: text, recordedAt: new Date().toISOString() });
        elementBaselineFeedback.set(template.id, feedback);
        feedback.textContent = 'UI approval queued. Download the element baseline file to keep it.';
        elementBaselineMessage.textContent = `${plural(elementBaselineQueue.size, 'UI approval')} queued. A later choice for the same group and scope replaces the earlier one.`;
      });
      form.append(scopeLabel, reasonLabel, queue, feedback); figure.append(form);
    }
    if (data.sourceRevision?.kind === 'git') {
      const revision = data.sourceRevision;
      const tracking = Number.isInteger(revision.trackedSourceFiles) && Number.isInteger(revision.scannedSourceFiles) ? ` · ${revision.trackedSourceFiles}/${revision.scannedSourceFiles} scanned source files tracked` : '';
      review.append(el('p', 'consistency-note', `Enclosing Git revision: ${revision.commit.slice(0, 12)} · ${revision.dirty === true ? 'working tree has changes' : revision.dirty === false ? 'working tree clean' : 'working tree status unavailable'}${tracking}. This does not verify what was deployed.`));
    }
    if (data.decisionSummary?.stale) review.append(el('p', 'consistency-note', `${plural(data.decisionSummary.stale, 'saved decision')} no longer match the current findings.`));
    if (data.baselineSummary?.unmatched) review.append(el('p', 'consistency-note', `${plural(data.baselineSummary.unmatched, 'approved baseline')} were not matched in this scan.`));
    if (crossPage) {
      const section = el('section', 'cross-page-review');
      section.append(el('h3', '', 'Across selected pages'));
      section.append(el('p', 'consistency-note', `${plural(crossPage.counts.comparableGroups, 'group')} comparable across pages · ${plural(crossPage.counts.skippedObservations, 'observation')} without a comparable group skipped · coverage ${crossPage.coverage}. ${crossPage.inferredClassesIncluded ? 'Explicit groups and matching component classes with named variants are compared; class-based matches need human review.' : 'Only explicitly named groups and variants are compared.'}`));
      if (crossPage.counts.visibilityIncompletePages) section.append(el('p', 'consistency-note', `${plural(crossPage.counts.visibilityIncompletePages, 'page')} had blocked or unverified button visibility.`));
      if (crossPage.counts.styleIncompletePages) section.append(el('p', 'consistency-note', `${plural(crossPage.counts.styleIncompletePages, 'page')} had missing or unsupported button style evidence.`));
      if (!crossPage.findings.length) section.append(el('p', 'consistency-empty', 'No cross-page outlier was identified with the available evidence.'));
      for (const [findingIndex, finding] of crossPage.findings.entries()) {
        const card = el('article', 'finding-card cross-page-finding');
        card.id = `site-cross-${findingIndex}`;
        const head = el('div', 'finding-heading');
        head.append(el('h3', '', 'An appearance differs across pages'), el('span', 'finding-badge', finding.review?.status || finding.evidence));
        card.append(head, el('p', 'finding-context', `${finding.group.family} · ${finding.group.variant} · ${finding.reference === 'approved' ? 'approved appearance' : 'common appearance'} on ${plural(finding.common.pageCount, 'page')} · different on ${plural(finding.outlier.pageCount, 'page')}`));
        const reviewStatus = el('p', 'finding-review', finding.review ? `Reviewed as ${finding.review.status}: ${finding.review.reason}` : '');
        reviewStatus.hidden = !finding.review;
        card.append(reviewStatus, el('p', 'finding-id', `Finding ID: ${finding.id}${finding.decisionAnchor ? '' : ' · source anchor required for a saved decision'}`));
        const common = finding.common.example;
        const outlier = finding.outlier.example;
        const commonFigure = example(common ? pages[common.page - 1] : pages[0], finding.reference === 'approved' ? 'Approved appearance' : 'Common appearance', { count: finding.common.count, example: common?.observation || null }, true);
        const outlierFigure = example(pages[outlier.page - 1], 'Possible outlier', { count: finding.outlier.count, example: outlier.observation }, true);
        if (common) commonFigure.append(el('p', 'comparison-source', `Page ${common.page}: ${common.url}`));
        outlierFigure.append(el('p', 'comparison-source', `Page ${outlier.page}: ${outlier.url}`));
        const comparison = el('div', 'comparison-grid');
        comparison.append(commonFigure, outlierFigure);
        card.append(comparison, differenceList(finding), el('p', 'finding-note', finding.reference === 'approved' ? 'This reference was approved for this group, viewport, and theme across selected pages. Confirm that the difference is unintended.' : 'This reference is inferred from the selected pages, not an approved design rule. Differences may be intentional.'));
        appendReview(card, finding, reviewStatus);
        section.append(card);
      }
      review.append(section);
    }
    for (const [pageIndex, analysis] of elementPages.entries()) {
      const section = el('section', 'element-page-review');
      section.append(el('h3', '', `Configured UI groups · page ${pageIndex + 1}`));
      section.append(el('p', 'consistency-scope', `${analysis.scope.url} · ${analysis.scope.viewport.width} × ${analysis.scope.viewport.height} · ${analysis.scope.theme} · ${analysis.scope.pixelRatio}× capture`));
      section.append(el('p', 'consistency-note', `${analysis.counts.eligible} of ${analysis.counts.seen} configured elements eligible · coverage ${analysis.coverage}. Groups are separated by native type and observed state. Only each element's own measured styles are compared.`));
      if (analysis.previewCoverage) section.append(el('p', 'consistency-note', `Component previews: ${analysis.previewCoverage.captured} of ${analysis.previewCoverage.requested} captured · ${analysis.previewCoverage.unavailable} unavailable · ${analysis.previewCoverage.omitted} beyond the capture limit.`));
      if (!analysis.findings.length) section.append(el('p', 'consistency-empty', 'No outlier was identified in the configured groups. Review the sample and coverage before drawing conclusions.'));
      for (const [findingIndex, finding] of analysis.findings.entries()) {
        const card = el('article', 'finding-card element-finding');
        card.id = `site-element-${pageIndex}-${findingIndex}`;
        const head = el('div', 'finding-heading');
        head.append(el('h3', '', 'A component appearance differs'), el('span', 'finding-badge', finding.review?.status || finding.evidence));
        card.append(head, el('p', 'finding-context', `${finding.group.family} · ${finding.group.variant} · state: ${finding.group.state} · ${finding.total} comparable examples`));
        const reviewStatus = el('p', 'finding-review', finding.review ? `Reviewed as ${finding.review.status}: ${finding.review.reason}` : '');
        reviewStatus.hidden = !finding.review;
        card.append(reviewStatus, el('p', 'finding-id', `Finding ID: ${finding.id}${finding.decisionAnchor ? '' : ' · source anchor required for a saved decision'}`));
        const comparison = el('div', 'comparison-grid');
        comparison.append(example(analysis, finding.reference === 'approved' ? 'Approved appearance' : 'Common appearance', finding.common), example(analysis, 'Possible outlier', finding.outlier));
        card.append(comparison, differenceList(finding), el('p', 'finding-note', finding.reference === 'approved' ? 'This reference was explicitly approved for this group, state, and rendering context. Confirm that the difference is unintended.' : 'This comparison uses your explicit group selectors and the observed state. Frequency is a review clue, not an approved reference.'));
        appendReview(card, finding, reviewStatus);
        section.append(card);
      }
      const gallery = el('details', 'element-appearance-gallery');
      gallery.append(el('summary', '', `Browse ${analysis.appearances.length} configured component appearances`));
      gallery.append(el('p', 'consistency-note', `Page ${pageIndex + 1} · ${elementBaselineCandidates && elementScopesDistinct ? 'Choose a captured UI appearance to queue approval, or use its observation ID in the CLI.' : 'Use a separately verified observation in the CLI to approve a reference.'}`));
      if (elementBaselineCandidates && !elementScopesDistinct) gallery.append(el('p', 'consistency-note', 'UI approval export is unavailable because selected pages share the same route, viewport, theme, and capture density.'));
      const grid = el('div', 'appearance-grid');
      for (const appearance of analysis.appearances.slice(0, 200)) {
        const figure = example(analysis, 'Observed appearance', appearance);
        figure.append(el('p', 'appearance-description', `${appearance.group.type} · ${appearance.group.family} · ${appearance.group.variant} · ${appearance.group.state}`));
        figure.append(el('p', 'finding-id', `Observation: ${appearance.example}`));
        appendElementApproval(figure, analysis, appearance, pageIndex);
        grid.append(figure);
      }
      gallery.append(grid); section.append(gallery); review.append(section);
    }
    for (const [pageIndex, analysis] of pages.entries()) {
      const pageReview = pages.length === 1 ? review : el('div', 'consistency-page');
      if (pages.length > 1) review.append(pageReview);
      const counts = analysis.counts;
      pageReview.append(el('p', 'consistency-scope', `${plural(counts.seen, 'button')} observed · ${plural(counts.eligible, 'eligible button')} · ${counts.seen - counts.eligible} excluded · ${analysis.scope.viewport.width} × ${analysis.scope.viewport.height} · ${analysis.scope.theme || 'theme unknown'}${analysis.scope.pixelRatio ? ` · ${analysis.scope.pixelRatio}× capture` : ''}${analysis.scope.browser?.version ? ` · Chromium ${analysis.scope.browser.version}` : ''} · ${analysis.scope.url}`));
      if (!Number.isInteger(counts.possiblyBlocked) || !Number.isInteger(counts.visibilityUnverified)) pageReview.append(el('p', 'consistency-note', 'Visibility evidence is unavailable in this report. Regenerate it for coverage details.'));
      else if (counts.possiblyBlocked || counts.visibilityUnverified) pageReview.append(el('p', 'consistency-note', `${plural(counts.possiblyBlocked, 'button')} possibly blocked and excluded · ${plural(counts.visibilityUnverified, 'eligible button')} not fully checked for obstruction. Coverage is incomplete.`));
      if (analysis.scope.instrumentedSources) {
        const markers = analysis.instrumentation;
        pageReview.append(el('p', 'consistency-note', markers ? `Instrumented sources: ${markers.matched} of ${markers.eligible} eligible buttons matched · ${markers.missing} without markers · ${markers.invalidOrOverridden} invalid or manually overridden. A marker is not proof of deployment.` : 'Instrumented source coverage is unavailable; regenerate the report.'));
      }
      pageReview.append(el('p', 'consistency-note', 'Only this page and its current state were examined. Eligible counts can include controls that are later found to be covered or unreachable.'));
      if (analysis.previewCoverage) {
        const previews = analysis.previewCoverage;
        pageReview.append(el('p', 'consistency-note', `Button previews: ${previews.captured} of ${previews.requested} captured · ${previews.unavailable} unavailable · ${previews.omitted} beyond the capture limit.`));
      }
      if (analysis.scope.maskSelectorsConfigured) pageReview.append(el('p', 'consistency-note', `${plural(analysis.scope.maskSelectorsConfigured, 'screenshot mask selector')} configured. Check images and report data before sharing.`));
      if (!analysis.findings.length) {
        pageReview.append(el('p', 'consistency-empty', counts.eligible < 3
          ? 'Not enough comparable buttons were observed for this check. Other states or controls may not have been checked.'
          : 'No rare appearance was identified in the observed groups. This does not establish that the whole UI is consistent.'));
      }
      for (const [findingIndex, finding] of analysis.findings.entries()) {
        const card = el('article', 'finding-card');
        card.id = `site-button-${pageIndex}-${findingIndex}`;
        const head = el('div', 'finding-heading');
        head.append(el('h3', '', finding.outlier.count === 1 ? 'A button looks different' : 'Buttons look different'), el('span', 'finding-badge', finding.review?.status || finding.evidence));
        card.append(head, el('p', 'finding-context', `${finding.group.family} · ${finding.group.variant} · ${plural(finding.total, 'comparable button')}`));
        const reviewStatus = el('p', 'finding-review', finding.review ? `Reviewed as ${finding.review.status}: ${finding.review.reason}` : '');
        reviewStatus.hidden = !finding.review;
        card.append(reviewStatus);
        card.append(el('p', 'finding-id', `Finding ID: ${finding.id}${finding.decisionAnchor ? '' : ' · source anchor required for a saved decision'}`));
        const comparison = el('div', 'comparison-grid');
        comparison.append(example(analysis, finding.reference === 'approved' ? 'Approved appearance' : 'Common appearance', finding.common), example(analysis, 'Possible outlier', finding.outlier));
        card.append(comparison);
        card.append(differenceList(finding), el('p', 'finding-note', finding.reference === 'approved'
          ? 'The reference was approved for this page, viewport, theme, and component group. Confirm that this difference is unintended.'
          : 'The common appearance is inferred from this page; it is not an approved design rule. Confirm that this difference is unintended.'));
        appendReview(card, finding, reviewStatus);
        pageReview.append(card);
      }
      if (analysis.appearances?.length) {
        const gallery = el('details', 'appearance-gallery');
        gallery.append(el('summary', '', `Browse ${plural(analysis.appearances.length, 'observed button appearance')}`));
        gallery.append(el('p', 'consistency-note', `Page ${pageIndex + 1} · ${baselineCandidates && baselineScopesDistinct ? 'Choose a captured appearance to queue approval, or use its observation ID in the CLI.' : 'Use an observation ID in the CLI to approve a reference.'} Some previews may be unavailable if a button was covered or changed.`));
        if (baselineCandidates && !baselineScopesDistinct) gallery.append(el('p', 'consistency-note', 'Approval export is unavailable because selected pages share the same route, viewport, theme, and capture density.'));
        const grid = el('div', 'appearance-grid');
        for (const appearance of analysis.appearances.slice(0, 200)) {
          const figure = example(analysis, 'Observed appearance', appearance);
          figure.append(el('p', 'appearance-description', `${appearance.group.family} · ${appearance.group.variant}`));
          figure.append(el('p', 'finding-id', `Observation: ${appearance.example}`));
          appendApproval(figure, analysis, appearance, pageIndex);
          if (['page-provided group', 'configured group'].includes(appearance.group.familyEvidence)) {
            const key = JSON.stringify([appearance.group.family, appearance.group.variant, appearance.group.type]);
            const others = [...(explicitLocations.get(key)?.entries() || [])].filter(([index]) => index !== pageIndex).map(([, location]) => location);
            if (others.length) {
              const locations = el('details', 'appearance-locations');
              locations.append(el('summary', '', `Group also observed on ${plural(others.length, 'other page')}`));
              for (const location of others) locations.append(el('p', 'comparison-source', `Page ${location.page}: ${location.url} · ${plural(location.count, 'button')}`));
              figure.append(locations);
            }
          }
          grid.append(figure);
        }
        gallery.append(grid);
        if (analysis.appearances.length > 200) gallery.append(el('p', 'consistency-note', 'Only the first 200 appearances are displayed.'));
        pageReview.append(gallery);
      }
    }
  }

  function renderSummary() {
    const summary = byId('summary');
    const stats = [
      ['01', 'Pieces collected', data.items.length, 'Your UI pieces in one place'],
      ['02', 'Components', count('components'), 'The building blocks'],
      ['03', 'Source files', data.scannedFiles, 'Scanned in this project'],
      ['04', 'References', data.items.reduce((total, item) => total + item.usages.length, 0), 'Places pieces are used'],
    ];
    for (const [number, label, value, hint] of stats) {
      const box = el('div', 'stat');
      box.append(el('div', 'stat-top', `${number} / ${label.toUpperCase()}`), el('strong', '', String(value).padStart(2, '0')), el('span', '', hint));
      summary.append(box);
    }
  }

  function preview(item, large = false, selectedCapture = null) {
    const box = el('div', `preview preview-${item.kind}${large ? ' preview-large' : ''}`);
    const captured = selectedCapture || item.captures?.[0];
    if (captured?.image || item.preview) {
      const image = document.createElement('img');
      image.src = captured?.image || item.preview;
      image.alt = '';
      box.append(image);
      if (captured) box.classList.add('preview-captured');
      if (item.kind === 'components') box.append(el('span', 'preview-caption', captured && !captured.method?.startsWith('provided') ? 'CAPTURED FROM PAGE' : 'PROVIDED PREVIEW'));
    } else if (item.kind === 'colors') {
      const swatch = el('div', 'color-swatch');
      if (item.value && CSS.supports('color', item.value)) swatch.style.backgroundColor = item.value;
      else { swatch.classList.add('unknown-swatch'); swatch.textContent = '?'; }
      box.append(swatch, el('span', 'swatch-value', item.value || 'UNRESOLVED'));
    } else if (item.kind === 'typography') {
      const sample = el('span', 'type-sample', 'Aa');
      if (item.subtype === 'CSS font family' && item.value && !item.value.includes('var(')) sample.style.fontFamily = item.value;
      box.append(sample, el('span', 'type-caption', item.subtype === 'Font file' ? 'FONT FILE' : 'TYPE SPECIMEN'));
    } else if (item.kind === 'tokens') {
      box.append(el('span', 'token-symbol', '✳'), el('span', 'token-value', item.value || 'UNRESOLVED'));
    } else if (item.kind === 'assets') {
      box.append(el('span', 'placeholder-icon', '▧'), el('span', 'preview-caption', 'PREVIEW UNAVAILABLE'));
    } else {
      const ghost = el('div', 'component-ghost');
      ghost.append(el('span', 'ghost-icon', '✧'), el('span', '', 'Preview unavailable'));
      box.append(ghost, el('span', 'preview-caption', 'CAPTURE OR ADD A PREVIEW'));
    }
    return box;
  }

  function renderGrid() {
    const filtered = [];
    for (const entry of currentEntries()) {
      const { item, capture } = entry;
      if (activeType !== 'all' && !entry.types.includes(activeType)) continue;
      const locations = capture ? item.usages.filter((usage) => usage.file === capture.file && usage.line === capture.line) : item.usages;
      const haystack = [item.name, item.kind, item.subtype, item.source, item.value, item.description,
        capture?.label, capture?.file, capture?.page, ...entry.types, ...locations.map((usage) => `${usage.file} ${usage.detail} ${usage.element?.tag || ''} ${usage.element?.ariaLabel || ''}`)].join(' ').toLowerCase();
      if (haystack.includes(query) && focusMatches(haystack)) filtered.push(entry);
    }
    byId('active-filter').textContent = `${filters.find((filter) => filter.id === active).label}${activeType === 'all' ? '' : ` · ${types.find((type) => type.id === activeType).label}`}`.toUpperCase();
    byId('result-count').textContent = `${String(filtered.length).padStart(2, '0')} ${filtered.length === 1 ? 'ITEM' : 'ITEMS'}`;
    grid.replaceChildren();
    byId('empty').hidden = filtered.length > 0;
    for (const { item, capture } of filtered) {
      const card = el('button', 'card');
      card.type = 'button';
      const title = capture?.label || item.name;
      card.setAttribute('aria-label', `${title}, ${plural(item.usages.length, 'reference')}. View details`);
      const meta = el('div', 'card-meta');
      const top = el('div', 'card-top');
      top.append(el('span', 'card-category', `${item.subtype.toUpperCase()}${item.pageMatches?.length ? ' · PAGE MATCH' : ''}`), el('span', 'card-arrow', '↗'));
      meta.append(top, el('strong', 'card-title', title), el('span', 'card-source', capture ? fileLabel(capture) : item.source || 'Source not resolved'));
      const bottom = el('div', 'card-bottom');
      bottom.append(el('span', '', 'SOURCE REFERENCES'), el('strong', '', String(item.usages.length).padStart(2, '0')));
      card.append(preview(item, false, capture), meta, bottom);
      card.addEventListener('click', () => showItem(item, capture));
      grid.append(card);
    }
  }

  function dialogHeader(eyebrow, title) {
    const header = el('div', 'dialog-header');
    const labels = el('div');
    const heading = el('h2', '', title);
    heading.id = 'dialog-title';
    labels.append(el('span', 'section-kicker', eyebrow), heading);
    const close = el('button', 'close-button', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close details');
    close.addEventListener('click', () => dialog.close());
    header.append(labels, close);
    return header;
  }

  function locationList(title, locations, emptyMessage) {
    const section = el('section', 'detail-section');
    const heading = el('div', 'detail-section-heading');
    heading.append(el('h3', '', title), el('span', '', String(locations.length).padStart(2, '0')));
    section.append(heading);
    if (!locations.length) section.append(el('p', 'detail-empty', emptyMessage));
    else {
      const list = el('ul', 'location-list');
      for (const location of locations) {
        const li = el('li');
        li.append(el('span', 'location-icon', '↗'));
        const text = el('div');
        text.append(el('code', '', fileLabel(location)));
        if (location.detail) text.append(el('span', 'location-detail', location.detail));
        li.append(text);
        list.append(li);
      }
      section.append(list);
    }
    return section;
  }

  function showItem(item, capture = null) {
    dialogContent.replaceChildren(dialogHeader(item.subtype.toUpperCase(), capture?.label || item.name), preview(item, true, capture));
    const body = el('div', 'dialog-body');
    body.append(el('p', 'detail-intro', item.description || 'A piece of your interface, collected from your project.'));
    const locations = capture ? item.usages.filter((usage) => usage.file === capture.file && usage.line === capture.line) : item.usages;
    const configuredTypes = [...new Set(locations.flatMap((usage) => usage.element?.inventoryTypes || []).filter((rule) => !capture || (capture.element?.classes || []).includes(rule.className)).map((rule) => rule.type))];
    if (configuredTypes.length) body.append(el('p', 'detail-note', `UI types supplied by project configuration: ${configuredTypes.join(', ')}.`));
    const selectedCapture = capture || item.captures?.[0];
    if (selectedCapture?.image) {
      body.append(captureDetails(selectedCapture, 'capture-full', 'View full-size capture', `Full-size capture from ${fileLabel(selectedCapture)}`));
    }
    if (item.value) {
      const value = el('div', 'value-line');
      value.append(el('span', '', item.id.startsWith('token:') ? 'FIRST DISCOVERED VALUE' : 'VALUE'), el('code', '', item.value));
      body.append(value);
    }
    if (item.id.startsWith('token:') && data.tokenSource?.format === 'ui-sheet/token-source-v1') {
      const declarations = data.tokenSource.declarations.filter((entry) => entry.token === item.name);
      const locations = declarations.slice(0, 200).map((entry) => ({
        file: entry.file, line: entry.line, column: entry.column,
        detail: `${entry.context.map((context) => context.type === 'rule' ? context.selector : `@${context.name}${context.params ? ` ${context.params}` : ''}`).join(' → ') || 'CSS root'}: ${entry.value}${entry.important ? ' !important' : ''}`,
      }));
      body.append(locationList('Scoped CSS declarations', locations, 'No CSS definition was found in the selected source.'));
      body.append(el('p', 'detail-note', `${declarations.length} declaration(s) recorded${declarations.length > locations.length ? `; showing the first ${locations.length}` : ''}. Values remain separate by selector and enclosing at-rule. This scan does not resolve the CSS cascade or runtime values. Use tokens and token-baseline in the CLI to approve a specific declaration.`));
    }
    if (item.docs) {
      const link = el('a', 'docs-link', 'View documentation ↗');
      link.href = item.docs;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      body.append(link);
    }
    if (item.captures?.length) {
      const section = el('section', 'detail-section');
      const heading = el('div', 'detail-section-heading');
      heading.append(el('h3', '', 'Captured examples'), el('span', '', String(item.captures.length).padStart(2, '0')));
      const gallery = el('div', 'capture-gallery');
      for (const capture of item.captures) {
        const figure = el('figure', 'capture-example');
        const image = document.createElement('img');
        image.src = capture.image;
        image.alt = `Captured element from ${fileLabel(capture)}`;
        figure.append(image, el('figcaption', '', `${capture.label ? `${capture.label} · ` : ''}${fileLabel(capture)} · ${capture.method}${capture.classification ? ` · ${capture.classification}` : ''}`));
        if (capture.captureMetadata) {
          const meta = capture.captureMetadata;
          const context = [
            `Page: ${capture.page || 'unknown'}`,
            `Role: ${meta.role || 'unknown'}`,
            `School: ${meta.school || 'unknown'}`,
            `Viewport: ${meta.viewportWidth && meta.viewportHeight ? `${meta.viewportWidth} × ${meta.viewportHeight}` : 'unknown'}`,
            `Captured: ${meta.capturedAt || 'unknown'}`,
            `Reported served revision: ${meta.servedSha || 'unverified'}`,
            `Image SHA-256: ${meta.screenshotSha256 || 'not supplied'}`,
          ];
          figure.append(el('p', 'capture-context', context.join(' · ')));
        }
        gallery.append(figure);
      }
      section.append(heading, gallery, el('p', 'detail-empty', 'Captured from the rendered page. Source associations may be possible matches or user-supplied links; neither verifies what was deployed.'));
      body.append(section);
    }
    body.append(locationList('Defined in', item.definitions, 'No definition was resolved by this scan.'));
    body.append(locationList('Used in', item.usages, 'No static references were found in supported files.'));
    if (item.styleReferences?.length) body.append(locationList('CSS selectors mentioning these classes', item.styleReferences, ''));
    if (item.pageMatches?.length) {
      body.append(locationList('Possible match in fetched HTML', item.pageMatches, ''));
      body.append(el('p', 'detail-note', 'The HTML check matched a unique element ID and tag. Confirm that this source revision is the one deployed.'));
    }
    body.append(el('p', 'detail-note', 'Static scan results are a starting point. Dynamic references, aliases, and unsupported file types may be missing.'));
    dialogContent.append(body);
    dialog.showModal();
  }

  if (data.captureSummary) {
    const pages = data.captureSummary.pages || [{ url: data.captureSummary.url, captured: data.captureSummary.captured }];
    const sources = pages.map((page) => `${page.captured} from ${page.url}`).join(' · ');
    byId('warnings').append(el('div', 'page-notice', `SOURCE-LINKED INVENTORY PREVIEWS · ${plural(data.captureSummary.captured, 'image')} (${sources}). Button consistency previews are counted separately.`));
  }
  if (data.observedPages?.length) {
    for (const page of data.observedPages) {
      byId('warnings').append(el('div', 'page-notice', `WEBSITE CHECK · ${plural(page.matchingSourceLocations, 'possible match')} in fetched HTML from ${page.url}. Unique ID and tag matches are clues, not proof of deployed source.`));
    }
  }
  if (data.warnings.length) {
    const warning = el('button', 'warning', `⚠  ${plural(data.warnings.length, 'file')} could not be fully scanned. View details  ↗`);
    warning.type = 'button';
    warning.addEventListener('click', () => {
      dialogContent.replaceChildren(dialogHeader('SCAN DETAILS', 'A few things to check'));
      const body = el('div', 'dialog-body');
      const list = el('ul', 'location-list');
      for (const entry of data.warnings) {
        const li = el('li');
        const text = el('div');
        text.append(el('code', '', entry.file), el('span', 'location-detail', entry.message));
        li.append(el('span', 'location-icon', '!'), text);
        list.append(li);
      }
      body.append(el('p', 'detail-intro', 'These files may be missing from your inventory.'), list);
      dialogContent.append(body);
      dialog.showModal();
    });
    byId('warnings').append(warning);
  }
  byId('search').addEventListener('input', (event) => { query = event.target.value.trim().toLowerCase(); renderGrid(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.defaultPrevented && !event.ctrlKey && !event.altKey && !event.metaKey && !dialog.open && !document.activeElement?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      byId('search').focus();
    }
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  renderNavigation();
  renderSummary();
  renderTypes();
  renderGrid();
  renderChoices();
  renderLayoutDecisions();
  renderResponsive();
  renderLayout();
  renderConsistency();
  renderSiteReview();
  focusState.listeners.push(renderGrid);
  renderFocus();
})();
