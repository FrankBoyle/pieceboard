import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeButtonConsistency, baselineRuleId } from '../src/consistency.js';
import { analyzeAcrossPages } from '../src/cross-page.js';

const style = { backgroundColor: 'rgb(0, 0, 255)', backgroundImage: 'none', opacity: '1', filter: 'none', color: 'white', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'blue', borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: 'blue', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'blue', borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: 'blue', borderTopLeftRadius: '8px', borderTopRightRadius: '8px', borderBottomRightRadius: '8px', borderBottomLeftRadius: '8px', fontFamily: 'Arial', fontSize: '16px', fontWeight: '400', fontStyle: 'normal', lineHeight: 'normal', letterSpacing: 'normal', textTransform: 'none', textDecorationLine: 'none', paddingTop: '8px', paddingRight: '8px', paddingBottom: '8px', paddingLeft: '8px', boxShadow: 'none' };
function page(url, radius = '8px', source = { status: 'unresolved' }) {
  const button = { tag: 'button', index: 0, visible: true, visibilityEvidence: 'clear', type: 'button', family: 'save actions', variant: 'primary', style: { ...style, borderTopLeftRadius: radius }, source };
  const analysis = analyzeButtonConsistency([button], { url, viewport: { width: 1440, height: 900 }, theme: 'light' });
  analysis.scope.browser = { engine: 'chromium', version: '120.0' };
  return analysis;
}

test('compares a deviation repeated across minority pages without inventing a singleton anchor', () => {
  const pages = Array.from({ length: 7 }, (_, index) => page(`https://example.test/${index}`, index < 5 ? '8px' : '2px'));
  const result = analyzeAcrossPages(pages);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].outlier.pageCount, 2);
  assert.equal(result.findings[0].outlier.count, 2);
  assert.equal(result.findings[0].decisionAnchor, undefined);
  assert.equal(result.counts.repeatedMinorityGroups, 1);
  assert.equal(result.coverage, 'observed');
});

test('does not infer a cross-page reference from a plurality without a majority', () => {
  const pages = ['8px', '8px', '2px', '3px', '4px'].map((radius, index) => page(`https://example.test/${index}`, radius));
  const result = analyzeAcrossPages(pages);
  assert.equal(result.findings.length, 0);
  assert.equal(result.counts.ambiguousGroups, 1);
  assert.equal(result.coverage, 'insufficient');
});

test('finds an explicit group whose rare style occurs on one of three pages', () => {
  const pages = [page('http://localhost:3000/a'), page('http://localhost:3000/b'), page('http://localhost:3000/c', '3px', { status: 'likely', file: 'src/C.jsx', line: 9 })];
  const result = analyzeAcrossPages(pages);
  assert.equal(result.coverage, 'observed');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].common.pageCount, 2);
  assert.equal(result.findings[0].outlier.example.page, 3);
  assert.equal(result.findings[0].differences[0].observed, '3px');
  assert.deepEqual(result.findings[0].decisionAnchor, { file: 'src/C.jsx', line: 9 });
  const movedPort = pages.map((entry) => ({ ...entry, scope: { ...entry.scope, url: entry.scope.url.replace('3000', '4000') } }));
  assert.equal(analyzeAcrossPages(movedPort).findings[0].id, result.findings[0].id);
});

test('allows a manually linked source to anchor a cross-page review', () => {
  const pages = [page('https://example.test/a'), page('https://example.test/b'), page('https://example.test/c', '3px', { status: 'manual', file: 'src/C.jsx', line: 9 })];
  assert.deepEqual(analyzeAcrossPages(pages).findings[0].decisionAnchor, { file: 'src/C.jsx', line: 9 });
});

test('a uniquely matched static ID keeps cross-page identity when its line moves', () => {
  const source = { status: 'likely', file: 'src/C.jsx', line: 9, method: 'unique ID and tag', elementId: 'save-c' };
  const result = (entry) => analyzeAcrossPages([page('https://example.test/a'), page('https://example.test/b'), page('https://example.test/c', '3px', entry)]).findings[0];
  assert.equal(result(source).id, result({ ...source, line: 25 }).id);
  assert.notEqual(result(source).id, result({ ...source, elementId: 'different' }).id);
});

test('cross-page coverage is partial when a page has unverified button visibility', () => {
  const pages = [page('https://example.test/a'), page('https://example.test/b'), page('https://example.test/c', '3px')];
  pages[2].counts.visibilityUnverified = 1;
  const result = analyzeAcrossPages(pages);
  assert.equal(result.findings.length, 1);
  assert.equal(result.counts.visibilityIncompletePages, 1);
  assert.equal(result.coverage, 'partial');
});

test('cross-page coverage is partial when a page excludes unsupported button styles', () => {
  const pages = [page('https://example.test/a'), page('https://example.test/b'), page('https://example.test/c', '3px')];
  pages[1].counts.missingStyle = 1;
  const result = analyzeAcrossPages(pages);
  assert.equal(result.findings.length, 1);
  assert.equal(result.counts.styleIncompletePages, 1);
  assert.equal(result.coverage, 'partial');
  delete pages[1].counts.missingStyle;
  assert.equal(analyzeAcrossPages(pages).coverage, 'partial');
});

test('does not guess a baseline from two pages or compare inferred groups', () => {
  const two = analyzeAcrossPages([page('https://example.test/a'), page('https://example.test/b', '3px')]);
  assert.equal(two.coverage, 'insufficient');
  assert.equal(two.findings.length, 0);
  const ungrouped = [page('https://example.test/a'), page('https://example.test/b'), page('https://example.test/c', '3px')];
  for (const entry of ungrouped) entry.observations[0].group.familyEvidence = 'component class';
  const result = analyzeAcrossPages(ungrouped);
  assert.equal(result.findings.length, 0);
  assert.equal(result.counts.skippedObservations, 3);
});

test('rejects ambiguous routes and keeps viewport and theme contexts separate', () => {
  assert.throws(() => analyzeAcrossPages([page('http://localhost:3000/a?one'), page('http://127.0.0.1:4000/a?two')]), /duplicate route/);
  const pages = [page('https://example.test/a'), page('https://example.test/b'), page('https://example.test/c', '3px')];
  pages[2].scope.theme = 'dark';
  assert.equal(analyzeAcrossPages(pages).findings.length, 0);
  pages[2].scope.theme = 'light';
  pages[2].scope.pixelRatio = 4;
  assert.equal(analyzeAcrossPages(pages).findings.length, 0, 'different pixel ratios are not compared');
});

test('an approved cross-page reference detects drift even when it is absent everywhere', () => {
  const pages = [page('https://example.test/a', '3px'), page('https://example.test/b', '3px'), page('https://example.test/c', '3px')];
  const scope = { url: '*', viewport: { width: 1440, height: 900 }, theme: 'light' };
  const group = pages[0].observations[0].group;
  const baseline = { id: baselineRuleId(scope, group), style };
  const result = analyzeAcrossPages(pages, { baselines: [baseline] });
  assert.deepEqual(result.baselinesUsed, [baseline.id]);
  assert.equal(result.findings[0].reference, 'approved');
  assert.equal(result.findings[0].common.example, null);
  assert.equal(result.findings[0].common.pageCount, 0);
  assert.equal(result.findings[0].outlier.pageCount, 3);
  assert.equal(result.findings[0].decisionAnchor, undefined);
});

test('applies a cross-page baseline only at its capture density', () => {
  const pages = [page('https://example.test/a', '3px'), page('https://example.test/b', '3px'), page('https://example.test/c', '3px')];
  for (const entry of pages) entry.scope.pixelRatio = 4;
  const scope = { url: '*', viewport: { width: 1440, height: 900 }, theme: 'light', pixelRatio: 4 };
  const group = pages[0].observations[0].group;
  const matching = { id: baselineRuleId(scope, group), style };
  const other = { id: baselineRuleId({ ...scope, pixelRatio: 2 }, group), style };
  assert.equal(analyzeAcrossPages(pages, { baselines: [other] }).findings.length, 0);
  assert.equal(analyzeAcrossPages(pages, { baselines: [matching] }).findings[0].reference, 'approved');
});
