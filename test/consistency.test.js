import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeButtonConsistency, baselineRuleId, isComparableFilter, normalizeButtonStyle } from '../src/consistency.js';

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
const button = (index, changes = {}) => ({ tag: 'button', index, visible: true, visibilityEvidence: 'clear', type: 'button', classes: ['button', 'primary'], style: { ...baseStyle }, ...changes });

test('flags a rare appearance with the exact differences and counts all occurrences', () => {
  const items = [button(0), button(1), button(2, { style: { ...baseStyle, borderTopLeftRadius: '3px' }, source: { status: 'likely', file: 'src/Settings.jsx', line: 42, method: 'unique ID and tag' } })];
  const result = analyzeButtonConsistency(items, { url: 'https://example.test/settings' });
  assert.equal(result.counts.seen, 3);
  assert.equal(result.counts.eligible, 3);
  assert.equal(result.observations.length, 3);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].status, 'possible difference');
  assert.equal(result.findings[0].evidence, 'small sample');
  assert.equal(result.findings[0].common.count, 2);
  assert.equal(result.findings[0].outlier.count, 1);
  assert.deepEqual(result.findings[0].differences, [{ property: 'borderTopLeftRadius', label: 'Top-left radius', common: '8px', observed: '3px' }]);
  assert.equal(result.observations[2].source.file, 'src/Settings.jsx');
  assert.equal(result.findings[0].id, analyzeButtonConsistency(items, { url: 'https://example.test/settings' }).findings[0].id);
});

test('scopes otherwise identical finding and baseline identities to capture density', () => {
  const items = [button(0), button(1), button(2, { style: { ...baseStyle, borderTopLeftRadius: '3px' }, source: { status: 'likely', file: 'src/Settings.jsx', line: 42 } })];
  const normal = analyzeButtonConsistency(items, { url: 'https://example.test/settings' });
  const dense = analyzeButtonConsistency(items, { url: 'https://example.test/settings', pixelRatio: 4 });
  assert.notEqual(normal.findings[0].id, dense.findings[0].id);
  assert.equal(baselineRuleId({ ...normal.scope, pixelRatio: undefined }, normal.findings[0].group), baselineRuleId(normal.scope, normal.findings[0].group));
  assert.notEqual(baselineRuleId(normal.scope, normal.findings[0].group), baselineRuleId(dense.scope, dense.findings[0].group));
});

test('separates intentional variants and excludes hidden, disabled and stateful controls', () => {
  const items = [
    button(0), button(1),
    button(2, { classes: ['button', 'danger'], style: { ...baseStyle, backgroundColor: 'rgb(220,0,0)' } }),
    button(3, { classes: ['button'], text: 'Delete record', style: { ...baseStyle, backgroundColor: 'rgb(220,0,0)' } }),
    button(4, { visible: false }), button(5, { disabled: true }), button(6, { stateful: true }),
    button(7, { role: 'tab' }), button(8, { style: {} }),
  ];
  const result = analyzeButtonConsistency(items);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.counts, { seen: 9, eligible: 4, hidden: 1, disabled: 1, otherRole: 1, stateful: 1, possiblyBlocked: 0, visibilityUnverified: 0, missingStyle: 1, comparable: 0, undersampled: 4, tied: 0, ambiguous: 0, repeatedMinority: 0 });
  assert.equal(result.observations.some((item) => JSON.stringify(item).includes('Delete record')), false, 'page text is not persisted in observation metadata');
});

test('excludes possibly blocked controls and counts unverified visibility', () => {
  const result = analyzeButtonConsistency([button(0), button(1, { visibilityEvidence: 'possibly-blocked' }), button(2, { visibilityEvidence: 'unverified' })]);
  assert.equal(result.counts.seen, 3);
  assert.equal(result.counts.eligible, 2);
  assert.equal(result.counts.possiblyBlocked, 1);
  assert.equal(result.counts.visibilityUnverified, 1);
  assert.deepEqual(result.observations.map((entry) => entry.visibilityEvidence), ['clear', 'unverified']);
});

test('does not select a common style from a tie and normalizes equivalent browser values', () => {
  const equivalent = { ...baseStyle, backgroundColor: 'rgba(37, 99, 235, 1)' };
  const uncommon = { ...baseStyle, borderTopLeftRadius: '3px' };
  const result = analyzeButtonConsistency([button(0), button(1, { style: equivalent }), button(2, { style: uncommon }), button(3, { style: uncommon })]);
  assert.equal(result.findings.length, 0, 'two equally common appearances do not imply a baseline');
  assert.equal(result.observations[0].style.backgroundColor, result.observations[1].style.backgroundColor);
});

test('detects a different border on any side while ignoring invisible side colors and styles', () => {
  const outlier = { ...baseStyle, borderBottomWidth: '3px', borderBottomStyle: 'dashed', borderLeftColor: 'red' };
  const result = analyzeButtonConsistency([button(0), button(1), button(2, { style: outlier })]);
  assert.deepEqual(result.findings[0].differences.map((entry) => entry.property), ['borderBottomWidth', 'borderBottomStyle', 'borderLeftColor']);
  const invisible = { ...baseStyle, borderBottomWidth: '0px', borderBottomStyle: 'none', borderBottomColor: 'red' };
  const alsoInvisible = { ...invisible, borderBottomStyle: 'dashed', borderBottomColor: 'blue' };
  const equal = analyzeButtonConsistency([button(0, { style: invisible }), button(1, { style: invisible }), button(2, { style: alsoInvisible })]);
  assert.equal(equal.findings.length, 0);
  assert.equal(equal.observations[2].style.borderBottomColor, 'not visible');
  assert.equal(equal.observations[2].style.borderBottomStyle, 'not visible');
});

test('compares gradients and text styling while excluding image URLs from measured styles', () => {
  const different = { ...baseStyle, backgroundImage: 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))', fontStyle: 'italic', textTransform: 'uppercase', textDecorationLine: 'underline' };
  const result = analyzeButtonConsistency([button(0), button(1), button(2, { style: different })]);
  assert.deepEqual(result.findings[0].differences.map((entry) => entry.property), ['backgroundImage', 'fontStyle', 'textTransform', 'textDecorationLine']);
  for (const backgroundImage of ['url("https://example.test/secret")', 'linear-gradient(red, blue), url(https://example.test/secret)', 'linear-gradient(red, blue), image-set("secret" 1x)']) {
    const unsafe = analyzeButtonConsistency([button(0), button(1), button(2, { style: { ...baseStyle, backgroundImage } })]);
    assert.equal(unsafe.counts.missingStyle, 1);
    assert.equal(JSON.stringify(unsafe).includes('secret'), false);
  }
});

test('measures opacity and safe visual filters without treating zero as a length', () => {
  const result = analyzeButtonConsistency([button(0), button(1), button(2, { style: { ...baseStyle, opacity: '.35', filter: 'blur(1.5px)' } })]);
  assert.equal(result.findingIdentity, 'ui-sheet/button-finding-v6');
  assert.deepEqual(result.findings[0].differences, [
    { property: 'opacity', label: 'Opacity', common: '1', observed: '0.35' },
    { property: 'filter', label: 'Visual filter', common: 'none', observed: 'blur(1.5px)' },
  ]);
  assert.equal(normalizeButtonStyle({ ...baseStyle, opacity: '0' }).opacity, '0');
  assert.equal(normalizeButtonStyle({ ...baseStyle, opacity: '1.0' }).opacity, '1');
  assert.equal(normalizeButtonStyle({ ...baseStyle, opacity: '1e-7' }).opacity, '1e-7');
  for (const opacity of ['-0.1', '1.1', '35%', '1px', 'NaN', 'Infinity', '', '0x1']) assert.equal(normalizeButtonStyle({ ...baseStyle, opacity }), null, opacity);
  for (const filter of ['none', 'blur(1.5px)', 'brightness(0.8) contrast(120%)', 'hue-rotate(90deg) saturate(2)', 'drop-shadow(rgb(0, 0, 0) 0px 1px 2px)', 'drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.3))', 'drop-shadow(color(display-p3 0.1 0.2 0.3 / 0.5) 0px 1px 2px)']) assert.equal(isComparableFilter(filter), true, filter);
  for (const filter of ['blur(5)', 'blur(-1px)', 'hue-rotate(3)', 'brightness(-1)', 'drop-shadow(rgb(0 0 0) 1px 2px rgb(1 1 1))', 'drop-shadow(0px 1px -2px)', 'drop-shadow(rgb(0deg 0 0) 1px 2px)']) assert.equal(isComparableFilter(filter), false, filter);
});

test('excludes unsafe, malformed, oversized or missing filter evidence without retaining its payload', () => {
  for (const filter of ['url("https://example.test/secret")', 'blur(1px) url(https://example.test/secret)', 'blur(1px) image-set("secret" 1x)', 'blur(secret)', 'unknown(1)', 'blur(1px', 'blur(1px) trailing', 'drop-shadow(rgb(e e e) 0px 1px 2px)', 'blur(1px) '.repeat(300), 'blur(1px) \\url(secret)']) {
    const result = analyzeButtonConsistency([button(0), button(1), button(2, { style: { ...baseStyle, filter } })]);
    assert.equal(result.counts.missingStyle, 1, filter);
    assert.equal(result.observations.length, 2);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  for (const property of ['filter', 'opacity']) {
    const oldStyle = { ...baseStyle }; delete oldStyle[property];
    assert.equal(normalizeButtonStyle(oldStyle), null, `missing ${property} must not become a presumed default`);
  }
});

test('reports every repeated minority occurrence against a true majority without inventing a source anchor', () => {
  const items = Array.from({ length: 8 }, (_, index) => button(index, index < 6 ? {} : { style: { ...baseStyle, opacity: '.35' }, source: { status: 'likely', file: 'src/Controls.jsx', line: index + 1 } }));
  const result = analyzeButtonConsistency(items);
  assert.equal(result.counts.comparable, 8);
  assert.equal(result.counts.repeatedMinority, 2);
  assert.equal(result.counts.ambiguous, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].common.count, 6);
  assert.equal(result.findings[0].outlier.count, 2);
  assert.equal(result.findings[0].decisionAnchor, undefined);
  assert.deepEqual(result.observations.slice(6).map((entry) => entry.source.line), [7, 8]);
});

test('keeps a plurality without a majority ambiguous until an approved reference is supplied', () => {
  const items = [button(0), button(1), button(2), button(3, { style: { ...baseStyle, filter: 'blur(1px)' } }), button(4, { style: { ...baseStyle, filter: 'blur(1px)' } }), button(5, { style: { ...baseStyle, opacity: '.35' } }), button(6, { style: { ...baseStyle, opacity: '.35' } })];
  const scope = { url: 'https://example.test/settings', viewport: { width: 1440, height: 900 }, theme: 'light' };
  const inferred = analyzeButtonConsistency(items, scope);
  assert.equal(inferred.counts.ambiguous, 7);
  assert.equal(inferred.counts.comparable, 0);
  assert.equal(inferred.findings.length, 0);
  const rule = { id: baselineRuleId(scope, inferred.observations[0].group), style: baseStyle };
  const approved = analyzeButtonConsistency(items, { ...scope, baselines: [rule] });
  assert.equal(approved.counts.ambiguous, 0);
  assert.equal(approved.counts.comparable, 7);
  assert.equal(approved.findings.length, 2);
  assert.deepEqual(approved.findings.map((entry) => entry.outlier.count), [2, 2]);
  assert.ok(approved.findings.every((entry) => entry.reference === 'approved' && !entry.decisionAnchor));
  const oldReference = { ...baseStyle }; delete oldReference.filter;
  assert.throws(() => analyzeButtonConsistency(items, { ...scope, baselines: [{ ...rule, style: oldReference }] }), /invalid style/);
});

test('does not compare separate configured families or submit and ordinary buttons', () => {
  const result = analyzeButtonConsistency([
    button(0, { family: 'toolbar' }), button(1, { family: 'toolbar' }),
    button(2, { family: 'dialog', style: { ...baseStyle, borderTopLeftRadius: '3px' } }),
    button(3, { family: 'toolbar', type: 'submit', style: { ...baseStyle, borderTopLeftRadius: '3px' } }),
  ]);
  assert.equal(result.findings.length, 0);
});

test('keeps outline and size variants separate from regular buttons', () => {
  const different = { ...baseStyle, backgroundColor: 'rgba(0,0,0,0)' };
  const result = analyzeButtonConsistency([
    button(0, { classes: ['btn', 'btn-primary'] }), button(1, { classes: ['btn', 'btn-primary'] }),
    button(2, { classes: ['btn', 'btn-outline-primary'], style: different }),
    button(3, { classes: ['btn', 'btn-primary', 'btn-sm'], style: { ...baseStyle, paddingTop: '4px' } }),
  ]);
  assert.equal(result.findings.length, 0);
  assert.equal(result.observations[2].group.variant, 'primary + outline');
  assert.equal(result.observations[3].group.variant, 'primary + small');
});

test('uses a shared container for otherwise unclassified buttons instead of comparing the whole page', () => {
  const different = { ...baseStyle, borderTopLeftRadius: '3px' };
  const separate = analyzeButtonConsistency([
    button(0, { classes: [], parentGroup: 'container 1' }), button(1, { classes: [], parentGroup: 'container 1' }),
    button(2, { classes: [], parentGroup: 'container 2', style: different }),
  ]);
  assert.equal(separate.findings.length, 0);
  const shared = analyzeButtonConsistency([
    button(0, { classes: [], parentGroup: 'container 1' }), button(1, { classes: [], parentGroup: 'container 1' }),
    button(2, { classes: [], parentGroup: 'container 1', style: different }),
  ]);
  assert.equal(shared.findings.length, 1);
  assert.equal(shared.findings[0].group.familyEvidence, 'shared container');
});

test('finding IDs survive local port changes but expire when the source, appearance, viewport, or theme changes', () => {
  const candidate = button(2, { style: { ...baseStyle, borderTopLeftRadius: '3px' }, source: { status: 'likely', file: 'src/Settings.jsx', line: 42 } });
  const items = [button(0), button(1), candidate];
  const first = analyzeButtonConsistency(items, { url: 'http://127.0.0.1:3000/settings' }).findings[0];
  const second = analyzeButtonConsistency(items, { url: 'http://localhost:4000/settings' }).findings[0];
  assert.equal(first.id, second.id);
  assert.deepEqual(first.decisionAnchor, { file: 'src/Settings.jsx', line: 42 });
  const moved = analyzeButtonConsistency([button(0), button(1), { ...candidate, source: { ...candidate.source, line: 43 } }], { url: 'http://localhost:4000/settings' }).findings[0];
  assert.notEqual(first.id, moved.id);
  const changed = analyzeButtonConsistency([button(0), button(1), { ...candidate, style: { ...candidate.style, borderTopLeftRadius: '4px' } }], { url: 'http://localhost:4000/settings' }).findings[0];
  assert.notEqual(first.id, changed.id);
  const mobile = analyzeButtonConsistency(items, { url: 'http://localhost:4000/settings', viewport: { width: 390, height: 844 } }).findings[0];
  const dark = analyzeButtonConsistency(items, { url: 'http://localhost:4000/settings', theme: 'dark' }).findings[0];
  assert.notEqual(first.id, mobile.id);
  assert.notEqual(first.id, dark.id);
});

test('a uniquely matched static element ID survives line movement but not an ID or file change', () => {
  const source = { status: 'likely', file: 'src/Settings.jsx', line: 42, method: 'unique ID and tag', elementId: 'save-alerts' };
  const candidate = button(2, { style: { ...baseStyle, borderTopLeftRadius: '3px' }, source });
  const run = (updated) => analyzeButtonConsistency([button(0), button(1), { ...candidate, source: updated }], { url: 'https://example.test/settings' }).findings[0];
  const first = run(source);
  const moved = run({ ...source, line: 99 });
  assert.equal(first.id, moved.id);
  assert.deepEqual(moved.decisionAnchor, { file: 'src/Settings.jsx', line: 99, elementId: 'save-alerts' });
  assert.notEqual(first.id, run({ ...source, elementId: 'other' }).id);
  assert.notEqual(first.id, run({ ...source, file: 'src/Other.jsx' }).id);
  assert.notEqual(first.id, run({ ...source, status: 'manual' }).id, 'manual assertions do not inherit automatic ID stability');
  assert.notEqual(first.id, run({ ...source, method: 'unique text and tag' }).id, 'other matching methods do not inherit ID stability');
});

test('instrumented finding decisions expire when the source file fingerprint changes', () => {
  const source = { status: 'instrumented', file: 'src/App.tsx', line: 12, column: 7, sha256: 'a'.repeat(64) };
  const different = { ...baseStyle, borderTopLeftRadius: '3px' };
  const run = (updated) => analyzeButtonConsistency([button(0), button(1), button(2, { style: different, source: updated })]).findings[0];
  const first = run(source);
  assert.deepEqual(first.decisionAnchor, { file: source.file, line: source.line, column: source.column, sha256: source.sha256 });
  assert.notEqual(first.id, run({ ...source, sha256: 'b'.repeat(64) }).id);
  assert.equal(run({ ...source, sha256: '' }).decisionAnchor, undefined);
});

test('configured groups bring differently named components together with explicit evidence', () => {
  const items = [
    button(0, { classes: ['create-a-btn'] }),
    button(1, { classes: ['create-b-btn'] }),
    button(2, { classes: ['create-c-btn'], style: { ...baseStyle, borderTopLeftRadius: '3px' } }),
  ];
  assert.equal(analyzeButtonConsistency(items).findings.length, 0);
  const grouped = items.map((item) => ({ ...item, family: 'create actions', familyEvidence: 'configured group', variant: 'icon', variantEvidence: 'configured variant' }));
  const result = analyzeButtonConsistency(grouped);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].group.familyEvidence, 'configured group');
  assert.equal(result.findings[0].group.variantEvidence, 'configured variant');
});

test('an approved baseline takes precedence over the most common appearance', () => {
  const wrong = { ...baseStyle, borderTopLeftRadius: '3px' };
  const items = [button(0), button(1, { style: wrong }), button(2, { style: wrong })];
  const scope = { url: 'http://localhost:3000/settings', viewport: { width: 1440, height: 900 }, theme: 'light' };
  const group = analyzeButtonConsistency(items, scope).observations[0].group;
  const rule = { id: baselineRuleId(scope, group), style: baseStyle };
  const result = analyzeButtonConsistency(items, { ...scope, baselines: [rule] });
  assert.deepEqual(result.baselinesUsed, [rule.id]);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].reference, 'approved');
  assert.equal(result.findings[0].common.count, 1);
  assert.equal(result.findings[0].outlier.count, 2);
  assert.equal(result.findings[0].differences[0].common, '8px');
  assert.equal(result.findings[0].differences[0].observed, '3px');
  assert.equal(result.findings[0].decisionAnchor, undefined, 'a single-source decision must not suppress a group of different occurrences');
  const otherTheme = analyzeButtonConsistency(items, { ...scope, theme: 'dark', baselines: [rule] });
  assert.deepEqual(otherTheme.baselinesUsed, []);
  assert.equal(otherTheme.findings[0].reference, 'inferred');
});
