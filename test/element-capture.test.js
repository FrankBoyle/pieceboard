import test from 'node:test';
import assert from 'node:assert/strict';
import { captureElementPreviews } from '../src/element-capture.js';
import { BUTTON_STYLE_FIELDS, normalizeButtonStyle } from '../src/consistency.js';

const style = Object.fromEntries(BUTTON_STYLE_FIELDS.map(([key]) => [key, ['backgroundImage', 'filter'].includes(key) ? 'none' : key === 'opacity' ? '1' : '1px']));
function fixture() {
  const original = { tag: 'input', index: 0, configured: { selector: '.field', family: 'fields', type: 'inputs', variant: 'default' }, id: '', text: '', state: 'valid', nativeType: 'text', type: 'text', role: '', placeholder: 'Original field', ariaLabel: '', classes: ['field'], visible: true, visibilityEvidence: 'clear', manualSelectorMatches: true, style };
  const analysis = { findings: [], appearances: [{ example: 'input:0' }], observations: [{ id: 'input:0', style: normalizeButtonStyle(style), source: { status: 'likely', file: 'form.html', line: 1 } }], counts: { seen: 1, omitted: 0 }, coverage: 'observed' };
  return { original, analysis, snapshot: { elements: [original], omitted: 0 } };
}

test('a replaced control cannot inherit a preview attributed through old source attributes', async () => {
  for (const change of [{ placeholder: 'Replacement field' }, { ariaLabel: 'New label' }, { nativeType: 'search' }, { type: 'search' }, { role: 'combobox' }, { classes: ['field', 'replacement'] }, { manualSelectorMatches: false }]) {
    const { original, analysis, snapshot } = fixture();
    let screenshots = 0;
    const page = { locator() { return { nth() { return { async scrollIntoViewIfNeeded() {}, async screenshot() { screenshots++; return Buffer.from('unexpected'); } }; } }; }, async evaluate() { return { elements: [{ ...original, ...change }] }; } };
    await captureElementPreviews(page, [original.configured], snapshot, analysis);
    assert.equal(screenshots, 0, JSON.stringify(change));
    assert.equal(analysis.previewCoverage.unavailable, 1);
    assert.equal(analysis.coverage, 'partial');
  }
});

test('captures the unchanged control and combines independent omission counts', async () => {
  const { original, analysis, snapshot } = fixture();
  analysis.counts.omitted = 2;
  snapshot.omitted = 5;
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
  const page = { locator() { return { nth() { return { async scrollIntoViewIfNeeded() {}, async screenshot() { return image; } }; } }; }, async evaluate() { return { elements: [original] }; } };
  await captureElementPreviews(page, [original.configured], snapshot, analysis);
  assert.equal(analysis.previewCoverage.captured, 1);
  assert.equal(analysis.previews['input:0'].width, 1);
  assert.equal(analysis.counts.omitted, 7);
  assert.equal(analysis.counts.seen, 6);
  assert.equal(analysis.coverage, 'partial');
});
