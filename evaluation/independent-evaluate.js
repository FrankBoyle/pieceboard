import { validateBrowserCases } from './browser-evaluate.js';

export const frozenIndependentArtifacts = Object.freeze({
  commit: '8ab0e0d',
  files: Object.freeze({
    'evaluation/independent-button-cases.json': '749dc401bd075bdab1292955b80a026e668ecd4928ab49d82afa76dcb8fb91f3',
    'evaluation/independent-review.md': '5276c71c46e48e2e5ab7a4087ccc9f401a9506ddaf8ba92f42a33e3c6215b03b',
  }),
});

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;');
const validViewport = (value) => value && ['width', 'height'].every((key) => Number.isInteger(value[key]) && value[key] > 0);

export function validateIndependentCases(data) {
  validateBrowserCases(data);
  if (typeof data.setId !== 'string' || !data.setId || !validViewport(data.captureDefaults?.viewport) || !['light', 'dark'].includes(data.captureDefaults?.colorScheme) || !Number.isInteger(data.captureDefaults?.pixelRatio) || data.captureDefaults.pixelRatio < 1 || data.captureDefaults.pixelRatio > 4) throw new Error('Invalid independent evaluation defaults.');
  for (const sample of data.cases) {
    if (!['scored', 'unscorable'].includes(sample.scoring) || (sample.scoring === 'unscorable' && (typeof sample.unscorableReason !== 'string' || !sample.unscorableReason.trim() || sample.expected.length))) throw new Error(`Invalid scoring policy: ${sample.id}.`);
    if (sample.viewport !== undefined && !validViewport(sample.viewport)) throw new Error(`Invalid viewport: ${sample.id}.`);
    if (sample.buttons.some((button) => ['group', 'variant'].some((key) => button[key] !== undefined && (typeof button[key] !== 'string' || !button[key].trim())))) throw new Error(`Invalid comparison hint: ${sample.id}.`);
    if (sample.interactions !== undefined && (!Array.isArray(sample.interactions) || sample.interactions.some((action) => !action || !['focus', 'hover'].includes(action.type) || !Number.isInteger(action.button) || action.button < 0 || action.button >= sample.buttons.length))) throw new Error(`Invalid interaction: ${sample.id}.`);
  }
  return data;
}

/** Construct the frozen suite's declared comparison hints and real source lines. */
export function independentBrowserFixture(sample) {
  const lines = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Separately authored synthetic button evaluation</title>',
    '<style>body{margin:24px}.button{background-color:#245ce0;color:#fff;border:1px solid #245ce0;border-radius:8px;font:600 16px/24px Arial,sans-serif;padding:8px 16px;margin:4px}',
    ...sample.css.split(/\r?\n/),
    '</style></head><body><main>',
  ];
  const sourceLines = [];
  for (const [index, button] of sample.buttons.entries()) {
    const attributes = [
      `id="evaluation-${index}"`,
      `type="${button.type || 'button'}"`,
      `class="button primary${button.classes ? ` ${escapeHtml(button.classes)}` : ''}"`,
    ];
    if (button.group !== undefined) attributes.push(`data-ui-sheet-group="${escapeHtml(button.group)}"`);
    if (button.variant !== undefined) attributes.push(`data-ui-sheet-variant="${escapeHtml(button.variant)}"`);
    if (button.role !== undefined) attributes.push(`role="${escapeHtml(button.role)}"`);
    if (button.disabled) attributes.push('disabled');
    if (button.hidden) attributes.push('hidden');
    if (Object.hasOwn(button, 'pressed')) attributes.push(`aria-pressed="${button.pressed ? 'true' : 'false'}"`);
    sourceLines.push(lines.length + 1);
    // Escape line breaks as character references to retain one source line per button.
    const label = escapeHtml(button.label || `Save ${index + 1}`);
    lines.push(`<button ${attributes.join(' ')}>${label}</button>`);
  }
  lines.push('</main></body></html>');
  return { html: lines.join('\n'), sourceLines };
}

export function independentCaptureOptions(data, sample) {
  return {
    viewport: { ...(sample.viewport || data.captureDefaults.viewport) },
    colorScheme: sample.colorScheme || data.captureDefaults.colorScheme,
    pixelRatio: data.captureDefaults.pixelRatio,
    actions: (sample.interactions || []).map((action) => ({ kind: action.type, selector: `#evaluation-${action.button}` })),
  };
}

function observationIndex(observation, sample) {
  const match = /:(\d+)$/.exec(observation.id);
  const index = match ? Number(match[1]) : -1;
  if (index < 0 || index >= sample.buttons.length) throw new Error(`Invalid observation index in ${sample.id}: ${observation.id}.`);
  return index;
}

const groupKey = (group) => JSON.stringify([group.family, group.variant, group.type]);

/** Expand a reported appearance to every matching observed control in its group. */
export function independentPredictions(sample, analysis) {
  const observations = new Map(analysis.observations.map((entry) => [entry.id, entry]));
  const predicted = new Set();
  for (const finding of analysis.findings) {
    const example = observations.get(finding.outlier.example);
    if (!example) throw new Error(`Missing outlier example in ${sample.id}.`);
    const key = groupKey(finding.group);
    const style = JSON.stringify(example.style);
    for (const observation of analysis.observations) {
      if (groupKey(observation.group) === key && JSON.stringify(observation.style) === style) predicted.add(observationIndex(observation, sample));
    }
  }
  return [...predicted].sort((a, b) => a - b);
}

/** This scorer never assigns accuracy labels to an unscorable diagnostic. */
export function scoreIndependentCase(sample, analysis, sourceFile, sourceLines, captureOptions) {
  const actualActions = (analysis.scope.actions || []).map(({ kind, selector }) => ({ kind, selector }));
  if (JSON.stringify(actualActions) !== JSON.stringify(captureOptions.actions)) throw new Error(`Capture did not verify the requested actions for ${sample.id}.`);
  if (analysis.counts.seen !== sample.buttons.length) throw new Error(`Unexpected button count for ${sample.id}.`);
  const predicted = independentPredictions(sample, analysis);
  const sourceChecks = analysis.observations.map((entry) => {
    const index = observationIndex(entry, sample);
    const matched = entry.source?.status === 'likely' && entry.source.method === 'unique ID and tag' && entry.source.file === sourceFile && entry.source.line === sourceLines[index];
    return { index, matched, expectedLine: sourceLines[index], actual: entry.source || null };
  }).sort((a, b) => a.index - b.index);
  const result = {
    id: sample.id,
    description: sample.description,
    scoring: sample.scoring,
    expected: sample.scoring === 'scored' ? [...sample.expected].sort((a, b) => a - b) : null,
    predicted,
    fixtureControls: sample.buttons.length,
    counts: analysis.counts,
    sourceMatches: sourceChecks.filter((entry) => entry.matched).length,
    sourceChecks,
    previewCoverage: analysis.previewCoverage,
    requestedContext: captureOptions,
    scope: analysis.scope,
    metrics: null,
  };
  if (sample.scoring === 'unscorable') {
    result.unscorableReason = sample.unscorableReason;
    return result;
  }
  const expected = new Set(sample.expected);
  const reported = new Set(predicted);
  const truePositiveIndexes = predicted.filter((index) => expected.has(index));
  const falsePositiveIndexes = predicted.filter((index) => !expected.has(index));
  const falseNegativeIndexes = result.expected.filter((index) => !reported.has(index));
  result.metrics = {
    tp: truePositiveIndexes.length,
    fp: falsePositiveIndexes.length,
    fn: falseNegativeIndexes.length,
    truePositiveIndexes,
    falsePositiveIndexes,
    falseNegativeIndexes,
  };
  return result;
}

export function summarizeIndependentScores(cases) {
  const scored = cases.filter((sample) => sample.scoring === 'scored');
  const totals = scored.reduce((all, sample) => ({ tp: all.tp + sample.metrics.tp, fp: all.fp + sample.metrics.fp, fn: all.fn + sample.metrics.fn }), { tp: 0, fp: 0, fn: 0 });
  return {
    format: 'ui-sheet/independent-browser-evaluation-result-v1',
    cases,
    scoredCases: scored.length,
    unscorableCases: cases.length - scored.length,
    scoredFixtureControls: scored.reduce((all, sample) => all + sample.fixtureControls, 0),
    labeledPositiveControls: scored.reduce((all, sample) => all + sample.expected.length, 0),
    totals,
    precision: totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : null,
    recall: totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : null,
  };
}
