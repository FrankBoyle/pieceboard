const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function validateBrowserCases(data) {
  if (data?.format !== 'ui-sheet/browser-evaluation-v1' || !Array.isArray(data.cases) || !data.cases.length) throw new Error('Invalid browser evaluation data.');
  const ids = new Set();
  for (const sample of data.cases) {
    if (!sample || typeof sample.id !== 'string' || !/^[a-z0-9-]+$/.test(sample.id) || ids.has(sample.id) || typeof sample.description !== 'string' || typeof sample.css !== 'string' || !Array.isArray(sample.buttons) || sample.buttons.length < 2 || !Array.isArray(sample.expected) || sample.expected.some((index) => !Number.isInteger(index) || index < 0 || index >= sample.buttons.length) || new Set(sample.expected).size !== sample.expected.length) throw new Error('Invalid browser evaluation case.');
    ids.add(sample.id);
    if (sample.buttons.some((button) => !button || typeof button !== 'object' || Array.isArray(button) || (button.classes !== undefined && (typeof button.classes !== 'string' || !/^[a-z0-9 _-]+$/i.test(button.classes))) || (button.label !== undefined && typeof button.label !== 'string') || (button.type !== undefined && !['button', 'submit'].includes(button.type)) || (button.role !== undefined && button.role !== 'tab') || ['disabled', 'hidden', 'pressed'].some((key) => button[key] !== undefined && typeof button[key] !== 'boolean'))) throw new Error('Invalid browser evaluation button.');
    if (sample.colorScheme !== undefined && !['light', 'dark'].includes(sample.colorScheme)) throw new Error('Invalid browser evaluation color scheme.');
  }
  return data;
}

/** Construct a small static page whose control source lines are known in advance. */
export function browserFixture(sample) {
  const lines = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Synthetic button evaluation</title>',
    '<style>body{margin:24px}.button{background-color:#245ce0;color:#fff;border:1px solid #245ce0;border-radius:8px;font:600 16px/24px Arial,sans-serif;padding:8px 16px;margin:4px}',
    ...sample.css.split(/\r?\n/),
    '</style></head><body><main>',
  ];
  const sourceLines = [];
  for (const [index, button] of sample.buttons.entries()) {
    sourceLines.push(lines.length + 1);
    lines.push(`<button id="evaluation-${index}" type="${button.type || 'button'}" class="button primary${button.classes ? ` ${escapeHtml(button.classes)}` : ''}"${button.role ? ` role="${button.role}"` : ''}${button.disabled ? ' disabled' : ''}${button.hidden ? ' hidden' : ''}${button.pressed ? ' aria-pressed="true"' : ''}>${escapeHtml(button.label || `Save ${index + 1}`)}</button>`);
  }
  lines.push('</main></body></html>');
  return { html: lines.join('\n'), sourceLines };
}

/** Score individual controls, including all occurrences of a reported appearance. */
export function scoreBrowserAnalysis(sample, analysis, sourceFile, sourceLines) {
  const predicted = new Set();
  for (const finding of analysis.findings) {
    const example = analysis.observations.find((entry) => entry.id === finding.outlier.example);
    if (!example) throw new Error('A finding has no corresponding observation.');
    for (const observation of analysis.observations) {
      if (observation.group.family === finding.group.family && observation.group.variant === finding.group.variant && observation.group.type === finding.group.type && JSON.stringify(observation.style) === JSON.stringify(example.style)) predicted.add(Number(observation.id.split(':')[1]));
    }
  }
  const expected = new Set(sample.expected);
  const tp = [...predicted].filter((index) => expected.has(index)).length;
  const fp = [...predicted].filter((index) => !expected.has(index)).length;
  const fn = [...expected].filter((index) => !predicted.has(index)).length;
  const sourceMatches = analysis.observations.filter((entry) => {
    const index = Number(entry.id.split(':')[1]);
    return entry.source?.status === 'likely' && entry.source.method === 'unique ID and tag' && entry.source.file === sourceFile && entry.source.line === sourceLines[index];
  }).length;
  return { id: sample.id, description: sample.description, expected: [...expected].sort((a, b) => a - b), predicted: [...predicted].sort((a, b) => a - b), tp, fp, fn, seen: analysis.counts.seen, eligible: analysis.counts.eligible, sourceMatches, previewCoverage: analysis.previewCoverage };
}

export function summarizeBrowserScores(cases) {
  const totals = cases.reduce((all, sample) => ({ tp: all.tp + sample.tp, fp: all.fp + sample.fp, fn: all.fn + sample.fn }), { tp: 0, fp: 0, fn: 0 });
  return { format: 'ui-sheet/browser-evaluation-result-v1', cases, totals, precision: totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : null, recall: totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : null };
}
