import { analyzeButtonConsistency, baselineRuleId } from '../src/consistency.js';

const baseStyle = {
  backgroundColor: 'rgb(37, 99, 235)', backgroundImage: 'none', color: 'rgb(255, 255, 255)', opacity: '1', filter: 'none',
  borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(37, 99, 235)',
  borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: 'rgb(37, 99, 235)',
  borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'rgb(37, 99, 235)',
  borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: 'rgb(37, 99, 235)',
  borderTopLeftRadius: '8px', borderTopRightRadius: '8px', borderBottomRightRadius: '8px', borderBottomLeftRadius: '8px',
  fontFamily: 'Arial, sans-serif', fontSize: '16px', fontWeight: '600', fontStyle: 'normal', lineHeight: '24px', letterSpacing: 'normal', textTransform: 'none', textDecorationLine: 'none',
  paddingTop: '8px', paddingRight: '16px', paddingBottom: '8px', paddingLeft: '16px', boxShadow: 'none',
};

/** Score observation identities against explicit synthetic labels. */
export function evaluateButtons(dataset) {
  if (dataset?.format !== 'ui-sheet/button-evaluation-v1' || !Array.isArray(dataset.cases)) throw new Error('Invalid evaluation data.');
  const ids = new Set();
  const cases = dataset.cases.map((sample) => {
    if (!sample.id || ids.has(sample.id) || !Array.isArray(sample.buttons) || !Array.isArray(sample.expected) || sample.expected.some((index) => !Number.isInteger(index) || index < 0 || index >= sample.buttons.length) || new Set(sample.expected).size !== sample.expected.length) throw new Error('Invalid evaluation case.');
    ids.add(sample.id);
    const buttons = sample.buttons.map((button, index) => {
      const style = { ...baseStyle };
      for (const field of ['color', 'backgroundColor', 'fontSize']) if (button[field]) style[field] = button[field];
      if (button.radius) for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']) style[corner] = button.radius;
      return { tag: 'button', index, visible: true, type: 'button', family: 'actions', variant: button.variant || 'primary', classes: ['button'], style, ...(button.disabled ? { disabled: true } : {}), ...(button.sizeHint ? { sizeHint: button.sizeHint } : {}) };
    });
    const scope = { url: 'https://evaluation.invalid/', viewport: { width: 1440, height: 900 }, theme: 'light' };
    const group = { family: 'actions', variant: 'primary', type: 'button' };
    const baselines = sample.approvedDefault ? [{ id: baselineRuleId(scope, group), style: baseStyle }] : [];
    const analysis = analyzeButtonConsistency(buttons, { ...scope, baselines });
    const predicted = new Set();
    for (const finding of analysis.findings) {
      const example = analysis.observations.find((observation) => observation.id === finding.outlier.example);
      for (const observation of analysis.observations) {
        if (observation.group.family === finding.group.family && observation.group.variant === finding.group.variant && observation.group.type === finding.group.type && JSON.stringify(observation.style) === JSON.stringify(example.style)) predicted.add(Number(observation.id.split(':')[1]));
      }
    }
    const expected = new Set(sample.expected);
    const tp = [...predicted].filter((index) => expected.has(index)).length;
    const fp = [...predicted].filter((index) => !expected.has(index)).length;
    const fn = [...expected].filter((index) => !predicted.has(index)).length;
    return { id: sample.id, description: sample.description, expected: [...expected].sort((a, b) => a - b), predicted: [...predicted].sort((a, b) => a - b), tp, fp, fn };
  });
  const totals = cases.reduce((all, item) => ({ tp: all.tp + item.tp, fp: all.fp + item.fp, fn: all.fn + item.fn }), { tp: 0, fp: 0, fn: 0 });
  return { format: 'ui-sheet/button-evaluation-result-v1', cases, totals, precision: totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : null, recall: totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : null };
}
