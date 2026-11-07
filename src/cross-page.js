import { createHash } from 'node:crypto';
import { baselineRuleId, BUTTON_STYLE_FIELDS, decisionAnchorFor, decisionAnchorIdentity, normalizeButtonStyle, scopeIdentity } from './consistency.js';

/** Compare explicitly named button groups by the number of pages showing each style. */
export function analyzeAcrossPages(pages, { baselines = [] } = {}) {
  if (!Array.isArray(pages) || pages.length < 2) throw new Error('Cross-page comparison requires at least two captured pages.');
  const scopes = new Set();
  const buckets = new Map();
  let skippedObservations = 0;
  for (const [index, page] of pages.entries()) {
    const scope = page.scope;
    if (!scope?.url || !Number.isInteger(scope.viewport?.width) || !Number.isInteger(scope.viewport?.height) || !scope.theme || !scope.browser?.version || !Array.isArray(page.observations)) throw new Error('Cross-page comparison requires page, viewport, theme, and browser context.');
    const pixelRatio = scope.pixelRatio ?? 2;
    const context = { viewport: scope.viewport, theme: scope.theme, pixelRatio, browser: scope.browser };
    const contextParts = [scope.viewport.width, scope.viewport.height, scope.theme, scope.browser.engine, scope.browser.version];
    if (scope.actions?.length) contextParts.push(['actions', scope.actions]);
    if (pixelRatio !== 2) contextParts.push(['pixelRatio', pixelRatio]);
    const contextKey = JSON.stringify(contextParts);
    const pageKey = scopeIdentity(scope.url);
    const scopeKey = JSON.stringify([pageKey, contextKey]);
    if (scopes.has(scopeKey)) throw new Error('Cross-page comparison cannot distinguish duplicate route, viewport, and theme scopes.');
    scopes.add(scopeKey);
    for (const observation of page.observations) {
      const group = observation.group;
      const style = normalizeButtonStyle(observation.style);
      if (!style || !['page-provided group', 'configured group'].includes(group?.familyEvidence) || !['page-provided variant', 'configured variant'].includes(group?.variantEvidence)) { skippedObservations++; continue; }
      const groupKey = JSON.stringify([contextKey, group.family, group.variant, group.type]);
      if (!buckets.has(groupKey)) buckets.set(groupKey, { group, context, pages: new Set(), styles: new Map() });
      const bucket = buckets.get(groupKey);
      bucket.pages.add(pageKey);
      const styleKey = JSON.stringify(style);
      if (!bucket.styles.has(styleKey)) bucket.styles.set(styleKey, { style, pages: new Set(), observations: [] });
      const styleBucket = bucket.styles.get(styleKey);
      styleBucket.pages.add(pageKey);
      styleBucket.observations.push({ page: index + 1, url: scope.url, observation: observation.id, source: observation.source || { status: 'unresolved' } });
    }
  }
  const visibilityIncompletePages = pages.filter((page) => !Number.isInteger(page.counts?.possiblyBlocked) || page.counts.possiblyBlocked < 0 || !Number.isInteger(page.counts?.visibilityUnverified) || page.counts.visibilityUnverified < 0 || page.counts.possiblyBlocked > 0 || page.counts.visibilityUnverified > 0).length;
  const styleIncompletePages = pages.filter((page) => !Number.isInteger(page.counts?.missingStyle) || page.counts.missingStyle < 0 || page.counts.missingStyle > 0).length;
  const counts = { multiPageGroups: 0, comparableGroups: 0, undersampledGroups: 0, tiedGroups: 0, ambiguousGroups: 0, repeatedMinorityGroups: 0, skippedObservations, visibilityIncompletePages, styleIncompletePages };
  const findings = [];
  const baselinesUsed = [];
  for (const [groupKey, bucket] of buckets) {
    if (bucket.pages.size < 2) continue;
    counts.multiPageGroups++;
    const styles = [...bucket.styles.values()].sort((a, b) => b.pages.size - a.pages.size);
    const approved = baselines.find((entry) => entry.id === baselineRuleId({ url: '*', viewport: bucket.context.viewport, theme: bucket.context.theme, pixelRatio: bucket.context.pixelRatio }, bucket.group));
    let reference;
    let candidates;
    if (approved) {
      const style = normalizeButtonStyle(approved.style);
      if (!style) throw new Error('Approved cross-page baseline has invalid style values.');
      reference = styles.find((entry) => JSON.stringify(entry.style) === JSON.stringify(style)) || { style, pages: new Set(), observations: [] };
      candidates = styles.filter((entry) => JSON.stringify(entry.style) !== JSON.stringify(style));
      baselinesUsed.push(approved.id);
    } else {
      if (bucket.pages.size < 3 || styles[0].pages.size < 2) { counts.undersampledGroups++; continue; }
      if (styles.length > 1 && styles[0].pages.size === styles[1].pages.size) { counts.tiedGroups++; continue; }
      if (styles[0].pages.size <= bucket.pages.size / 2) { counts.ambiguousGroups++; continue; }
      reference = styles[0];
      candidates = styles.slice(1);
      counts.repeatedMinorityGroups += candidates.filter((style) => style.pages.size > 1).length;
    }
    counts.comparableGroups++;
    for (const candidate of candidates) {
      const differences = BUTTON_STYLE_FIELDS.flatMap(([property, label]) => reference.style[property] === candidate.style[property] ? [] : [{ property, label, common: reference.style[property], observed: candidate.style[property] }]);
      if (!differences.length) continue;
      const selected = candidate.observations[0];
      const source = selected.source;
      const anchor = decisionAnchorFor(source, candidate.observations.length);
      const id = createHash('sha256').update(JSON.stringify(['cross-page-v1', groupKey, [...bucket.pages].sort(), reference.style, candidate.style, decisionAnchorIdentity(anchor) || [scopeIdentity(selected.url), selected.observation]])).digest('hex').slice(0, 16);
      findings.push({ id, kind: 'cross-page-button-style-outlier', evidence: approved ? 'approved cross-page baseline' : bucket.pages.size < 5 ? 'small cross-page sample' : 'cross-page frequency', reference: approved ? 'approved' : 'inferred', group: bucket.group, context: bucket.context, common: { pageCount: reference.pages.size, count: reference.observations.length, example: reference.observations[0] || null }, outlier: { pageCount: candidate.pages.size, count: candidate.observations.length, example: selected }, differences, ...(anchor ? { decisionAnchor: anchor } : {}) });
    }
  }
  const coverage = counts.comparableGroups === 0 ? 'insufficient' : counts.undersampledGroups || counts.tiedGroups || counts.ambiguousGroups || counts.visibilityIncompletePages || counts.styleIncompletePages ? 'partial' : 'observed';
  return { format: 'ui-sheet/cross-page-v1', findingIdentity: 'ui-sheet/cross-page-finding-v5', coverage, counts, findings, baselinesUsed };
}
