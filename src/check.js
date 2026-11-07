import { scopeIdentity } from './consistency.js';
import { readCheckedReport } from './scan-status.js';
import { summarizeElementChecks } from './element-check.js';

/** Produce a compact, image-free summary suitable for people, agents and CI. */
export async function checkReport(reportDir) {
  const { data, scanStatus, pageProgress } = await readCheckedReport(reportDir);
  if (data.format !== 'ui-sheet/v1' || !data.consistency) throw new Error('The report has no button consistency analysis. Run a captured scan first.');
  const pages = data.consistency.pages || [data.consistency];
  if (!pages.length || pages.some((page) => !page.counts || !Array.isArray(page.findings) || !Array.isArray(page.observations))) throw new Error('The consistency analysis is incomplete or unsupported.');
  const sourceWarnings = Array.isArray(data.warnings) ? data.warnings.length : null;
  const summaries = [];
  const findings = [];
  for (const page of pages) {
    const counts = page.counts;
    const known = ['comparable', 'undersampled', 'tied', 'ambiguous', 'repeatedMinority'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0);
    const visibilityKnown = Number.isInteger(counts.possiblyBlocked) && counts.possiblyBlocked >= 0 && Number.isInteger(counts.visibilityUnverified) && counts.visibilityUnverified >= 0;
    const previews = page.previewCoverage;
    const previewKnown = previews && ['requested', 'attempted', 'captured', 'unavailable', 'omitted'].every((key) => Number.isInteger(previews[key]) && previews[key] >= 0)
      && previews.requested === previews.attempted + previews.omitted && previews.attempted === previews.captured + previews.unavailable;
    const instrumented = page.scope?.instrumentedSources === true;
    const instrumentation = page.instrumentation;
    const settingKnown = page.scope?.instrumentedSources === undefined || typeof page.scope.instrumentedSources === 'boolean';
    const instrumentationKnown = settingKnown && (!instrumented || (instrumentation && ['eligible', 'matched', 'missing', 'invalidOrOverridden'].every((key) => Number.isInteger(instrumentation[key]) && instrumentation[key] >= 0) && instrumentation.eligible === counts.eligible && instrumentation.eligible === instrumentation.matched + instrumentation.missing + instrumentation.invalidOrOverridden));
    const instrumentationIncomplete = !instrumentationKnown || (instrumented && (instrumentation.missing || instrumentation.invalidOrOverridden));
    const coverage = !known || counts.comparable === 0 ? 'insufficient' : page.findingIdentity !== 'ui-sheet/button-finding-v6' || scanStatus !== 'completed' || sourceWarnings === null || sourceWarnings > 0 || instrumentationIncomplete || !visibilityKnown || counts.possiblyBlocked || counts.visibilityUnverified || counts.undersampled || counts.tied || counts.ambiguous || counts.missingStyle || !previewKnown || previews.unavailable || previews.omitted ? 'partial' : 'observed';
    summaries.push({ url: page.scope?.url || '', viewport: page.scope?.viewport || null, theme: page.scope?.theme || 'unknown', pixelRatio: page.scope?.pixelRatio ?? 2, browser: page.scope?.browser || null, actions: page.scope?.actions || [], buttonGroups: page.scope?.buttonGroups || [], instrumentedSources: instrumented, instrumentation: instrumented && instrumentationKnown ? instrumentation : null, findingIdentity: page.findingIdentity || 'unknown', coverage, counts, previews: previewKnown ? previews : null });
    const observations = new Map(page.observations.map((observation) => [observation.id, observation]));
    for (const finding of page.findings) {
      const review = finding.review || null;
      const actionable = !['intentional', 'deferred', 'false-positive'].includes(review?.status);
      findings.push({ id: finding.id, kind: finding.kind, page: page.scope?.url || '', group: finding.group, evidence: finding.evidence, reference: finding.reference || 'inferred', commonCount: finding.common.count, outlierCount: finding.outlier.count, differences: finding.differences, source: observations.get(finding.outlier.example)?.source || { status: 'unresolved' }, anchored: Boolean(finding.decisionAnchor), review, actionable });
    }
  }
  const cross = data.crossPageConsistency;
  if (cross) {
    if (cross.format !== 'ui-sheet/cross-page-v1' || !['observed', 'partial', 'insufficient'].includes(cross.coverage) || !cross.counts || !Array.isArray(cross.findings)) throw new Error('The cross-page analysis is incomplete or unsupported.');
    for (const finding of cross.findings) {
      const review = finding.review || null;
      const actionable = !['intentional', 'deferred', 'false-positive'].includes(review?.status);
      findings.push({ id: finding.id, kind: finding.kind, page: finding.outlier.example.url, group: finding.group, evidence: finding.evidence, reference: finding.reference || 'inferred', commonCount: finding.common.count, outlierCount: finding.outlier.count, commonPageCount: finding.common.pageCount, outlierPageCount: finding.outlier.pageCount, differences: finding.differences, source: finding.outlier.example.source || { status: 'unresolved' }, anchored: Boolean(finding.decisionAnchor), review, actionable });
    }
  }
  const crossCoverage = cross && cross.findingIdentity !== 'ui-sheet/cross-page-finding-v5' && cross.coverage === 'observed' ? 'partial' : cross?.coverage;
  const elements = summarizeElementChecks(data, { scanStatus, sourceWarnings });
  findings.push(...elements.findings);
  const coverageValues = [...summaries.filter((page) => !elements.pages.length || page.counts.seen > 0).map((page) => page.coverage), ...elements.pages.map((page) => page.coverage), ...(cross ? [crossCoverage] : [])];
  const coverage = coverageValues.includes('insufficient') ? 'insufficient' : coverageValues.includes('partial') ? 'partial' : 'observed';
  const actionable = findings.filter((finding) => finding.actionable).length;
  return { format: 'ui-sheet/check-v1', result: actionable ? 'findings' : coverage !== 'observed' ? 'insufficient-evidence' : 'no-findings', coverage, scanStatus, ...(pageProgress ? { pageProgress } : {}), actionable, totalFindings: findings.length, sourceWarnings, sourceRevision: data.sourceRevision || null, ...(data.baselineSummary ? { baselines: data.baselineSummary } : {}), ...(data.elementBaselineSummary ? { elementBaselines: data.elementBaselineSummary } : {}), ...(data.decisionSummary ? { decisions: data.decisionSummary } : {}), ...(cross ? { crossPage: { findingIdentity: cross.findingIdentity, coverage: crossCoverage, counts: cross.counts } } : {}), ...(elements.pages.length ? { elementPages: elements.pages } : {}), pages: summaries, findings };
}

/** Compare only compatible, source-anchored finding identities. */
export function compareChecks(current, previous) {
  function keys(result) {
    const scopes = new Set();
    for (const page of result.pages) {
      if (!page.url || !Number.isInteger(page.viewport?.width) || !Number.isInteger(page.viewport?.height) || !page.theme || page.theme === 'unknown' || page.browser?.engine !== 'chromium' || !page.browser?.version || page.findingIdentity !== 'ui-sheet/button-finding-v6') {
        throw new Error('Cannot compare reports without matching page, viewport, theme, browser version, and current finding identity context. Regenerate both reports.');
      }
      const key = JSON.stringify([scopeIdentity(page.url), page.viewport.width, page.viewport.height, page.theme, page.pixelRatio ?? 2, page.browser.engine, page.browser.version, page.findingIdentity, page.instrumentedSources === true, page.actions || [], page.buttonGroups || []]);
      if (scopes.has(key)) throw new Error('Cannot compare reports with duplicate page scopes.');
      scopes.add(key);
    }
    return [...scopes].sort();
  }
  if (JSON.stringify(keys(current)) !== JSON.stringify(keys(previous))) throw new Error('Cannot compare reports with different pages, viewports, themes, capture pixel ratios, browser versions, or source-instrumentation settings.');
  const elementContexts = (result) => (result.elementPages || []).map((page) => {
    if (page.findingIdentity !== 'ui-sheet/element-finding-v2' || page.browser?.engine !== 'chromium' || !page.browser?.version) throw new Error('Regenerate configured element reports with current comparison and browser context.');
    return JSON.stringify([scopeIdentity(page.url), page.viewport, page.theme, page.pixelRatio, page.browser, page.actions || [], page.elementGroups || [], page.instrumentedSources === true]);
  }).sort();
  if (JSON.stringify(elementContexts(current)) !== JSON.stringify(elementContexts(previous))) throw new Error('Cannot compare reports with different configured element contexts.');
  if (Boolean(current.crossPage) !== Boolean(previous.crossPage) || (current.crossPage && (current.crossPage.findingIdentity !== 'ui-sheet/cross-page-finding-v5' || previous.crossPage.findingIdentity !== current.crossPage.findingIdentity))) throw new Error('Cannot compare reports with different cross-page analysis settings or identity versions.');
  for (const result of [current, previous]) {
    const ids = result.findings.map((finding) => finding.id);
    if (new Set(ids).size !== ids.length) throw new Error('Cannot compare reports with duplicate finding IDs.');
  }
  const known = new Set(previous.findings.filter((finding) => finding.anchored).map((finding) => finding.id));
  const newFindings = current.findings.filter((finding) => finding.actionable && finding.anchored && !known.has(finding.id));
  const unverifiable = current.findings.filter((finding) => finding.actionable && !finding.anchored).length;
  const unverifiablePrevious = previous.findings.filter((finding) => !finding.anchored).length;
  const incomplete = current.coverage !== 'observed' || previous.coverage !== 'observed' || unverifiable > 0 || unverifiablePrevious > 0;
  return {
    status: incomplete ? 'incomplete' : newFindings.length ? 'new-findings' : 'no-new-findings',
    newActionable: newFindings.length,
    newFindingIds: newFindings.map((finding) => finding.id),
    unverifiable,
    unverifiablePrevious,
    currentCoverage: current.coverage,
    previousCoverage: previous.coverage,
  };
}
