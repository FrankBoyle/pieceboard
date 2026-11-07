/** Keep configured-family evidence in the same compact CI result as buttons. */
export function summarizeElementChecks(data, { scanStatus, sourceWarnings }) {
  if (!data.elementConsistency) return { pages: [], findings: [] };
  const analyses = data.elementConsistency.pages;
  if (data.elementConsistency.format !== 'ui-sheet/element-pages-v1' || !Array.isArray(analyses) || !analyses.length) throw new Error('Configured element analysis is incomplete or unsupported.');
  const pages = [], findings = [];
  for (const analysis of analyses) {
    if (analysis.format !== 'ui-sheet/elements-v1' || !Array.isArray(analysis.observations) || !Array.isArray(analysis.findings) || !analysis.counts) throw new Error('Configured element analysis is incomplete or unsupported.');
    const counts = analysis.counts;
    const keys = ['seen', 'eligible', 'hidden', 'possiblyBlocked', 'visibilityUnverified', 'missingStyle', 'missingState', 'omitted', 'comparable', 'undersampled', 'tied', 'ambiguous', 'repeatedMinority'];
    const known = keys.every((key) => Number.isInteger(counts[key]) && counts[key] >= 0);
    const previews = analysis.previewCoverage;
    const previewKnown = previews && ['requested', 'attempted', 'captured', 'unavailable', 'omitted'].every((key) => Number.isInteger(previews[key]) && previews[key] >= 0) && previews.requested === previews.attempted + previews.omitted && previews.attempted === previews.captured + previews.unavailable;
    const markers = analysis.instrumentation;
    const instrumented = analysis.scope?.instrumentedSources === true;
    const sourceIncomplete = instrumented && (!markers || markers.eligible !== counts.eligible || markers.matched !== counts.eligible);
    const coverage = !known || !counts.comparable ? 'insufficient' : analysis.coverage !== 'observed' || analysis.findingIdentity !== 'ui-sheet/element-finding-v2' || scanStatus !== 'completed' || sourceWarnings === null || sourceWarnings > 0 || sourceIncomplete || !previewKnown || previews.unavailable || previews.omitted || keys.slice(3).filter((key) => !['comparable', 'repeatedMinority'].includes(key)).some((key) => counts[key] > 0) ? 'partial' : 'observed';
    pages.push({ ...analysis.scope, findingIdentity: analysis.findingIdentity || 'unknown', coverage, counts, previews: previewKnown ? previews : null });
    const observations = new Map(analysis.observations.map((entry) => [entry.id, entry]));
    for (const finding of analysis.findings) {
      const review = finding.review || null;
      findings.push({ id: finding.id, kind: finding.kind, page: analysis.scope?.url || '', group: finding.group, evidence: finding.evidence, reference: finding.reference || 'inferred', commonCount: finding.common.count, outlierCount: finding.outlier.count, differences: finding.differences, source: observations.get(finding.outlier.example)?.source || { status: 'unresolved' }, anchored: Boolean(finding.decisionAnchor), review, actionable: !['intentional', 'deferred', 'false-positive'].includes(review?.status) });
    }
  }
  return { pages, findings };
}
