export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
export const DEFAULT_PIXEL_RATIO = 2;

export function validatePixelRatio(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4) throw new Error('Capture pixel ratio must be an integer from 1 to 4.');
  return value;
}

export function validateCaptureResolution(viewport, pixelRatio) {
  if (viewport.width * viewport.height * pixelRatio ** 2 > 33177600) throw new Error('Viewport and capture pixel ratio exceed the 33,177,600 device-pixel limit. Reduce the viewport or pixel ratio.');
}

export function validateViewport(viewport) {
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport) || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) || viewport.width < 1 || viewport.height < 1 || viewport.width > 4096 || viewport.height > 4096 || viewport.width * viewport.height > 8294400) {
    throw new Error('Viewport must have integer width and height from 1 to 4096 and at most 8,294,400 pixels.');
  }
  return { width: viewport.width, height: viewport.height };
}

export function parseViewport(input) {
  const match = /^(\d{1,4})x(\d{1,4})$/i.exec(input);
  if (!match) throw new Error('--viewport requires WIDTHxHEIGHT, for example 390x844.');
  return validateViewport({ width: Number(match[1]), height: Number(match[2]) });
}

export function validateColorScheme(value) {
  if (!['light', 'dark'].includes(value)) throw new Error('Color scheme must be light or dark.');
  return value;
}

export function validateMaskSelectors(value) {
  if (!Array.isArray(value) || value.length > 20 || value.some((selector) => typeof selector !== 'string' || !selector.trim() || selector.length > 200)) {
    throw new Error('Mask selectors must be an array of up to 20 nonempty CSS selectors, each at most 200 characters.');
  }
  return value.map((selector) => selector.trim());
}

export function validateButtonGroups(value) {
  const validHint = (hint) => typeof hint === 'string' && /^[a-z0-9][a-z0-9_. -]{0,79}$/i.test(hint.trim());
  if (!Array.isArray(value) || value.length > 50 || value.some((rule) => !rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.selector !== 'string' || !rule.selector.trim() || rule.selector.length > 200 || !validHint(rule.family) || (rule.variant !== undefined && !validHint(rule.variant)))) {
    throw new Error('Button groups must be an array of up to 50 rules with a CSS selector, family, and optional variant.');
  }
  return value.map((rule) => ({ selector: rule.selector.trim(), family: rule.family.trim().toLowerCase(), ...(rule.variant !== undefined ? { variant: rule.variant.trim().toLowerCase() } : {}) }));
}

export function validateSourceLinks(value) {
  const validPath = (file) => typeof file === 'string' && file.length > 0 && file.length <= 500 && !/[\\:\x00-\x1f\x7f]/.test(file) && !file.split('/').some((part) => !part || part === '.' || part === '..');
  if (!Array.isArray(value) || value.length > 50 || value.some((rule) => !rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.selector !== 'string' || !rule.selector.trim() || rule.selector.length > 200 || !validPath(rule.file) || !Number.isSafeInteger(rule.line) || rule.line < 1)) {
    throw new Error('Source links must be an array of up to 50 rules with a CSS selector, project-relative file, and positive line number. Use / as the path separator.');
  }
  return value.map((rule) => ({ selector: rule.selector.trim(), file: rule.file, line: rule.line }));
}

export function validateInventoryClasses(value) {
  const types = new Set(['tabs', 'sidebars', 'headers', 'buttons', 'dropdowns', 'selectors', 'inputs', 'navigation', 'headings', 'text', 'images']);
  if (!Array.isArray(value) || value.length > 50 || value.some((rule) => !rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.className !== 'string' || !/^-?[_a-zA-Z][_a-zA-Z0-9-]{0,79}$/.test(rule.className) || !types.has(rule.type))) {
    throw new Error('Inventory classes must be an array of up to 50 rules with an exact CSS class name and supported UI type.');
  }
  const keys = value.map((rule) => `${rule.className}\0${rule.type}`);
  if (new Set(keys).size !== keys.length) throw new Error('Inventory class rules must not contain duplicates.');
  return value.map(({ className, type }) => ({ className, type }));
}

/** Explicit selectors are required before comparing composed or custom UI. */
export function validateElementGroups(value) {
  const types = new Set(['inputs', 'dropdowns', 'selectors', 'tabs', 'headers', 'sidebars', 'navigation', 'headings', 'text']);
  const hint = (input) => typeof input === 'string' && /^[a-z0-9][a-z0-9_. -]{0,79}$/i.test(input.trim());
  if (!Array.isArray(value) || value.length > 50 || value.some((rule) => !rule || Array.isArray(rule) || typeof rule !== 'object' || typeof rule.selector !== 'string' || !rule.selector.trim() || rule.selector.length > 200 || !hint(rule.family) || !types.has(rule.type) || (rule.variant !== undefined && !hint(rule.variant)))) {
    throw new Error('Element groups must be an array of up to 50 rules with a CSS selector, family, supported UI type, and optional variant.');
  }
  return value.map((rule) => ({ selector: rule.selector.trim(), family: rule.family.trim().toLowerCase(), type: rule.type, ...(rule.variant !== undefined ? { variant: rule.variant.trim().toLowerCase() } : {}) }));
}

export function validateCaptureActions(value) {
  if (!Array.isArray(value) || value.length > 20 || value.some((action) => !action || Array.isArray(action) || !['focus', 'hover'].includes(action.kind) || typeof action.selector !== 'string' || !action.selector.trim() || action.selector.length > 200)) throw new Error('Capture actions must contain up to 20 explicit focus or hover actions with CSS selectors.');
  return value.map(({ kind, selector }) => ({ kind, selector: selector.trim() }));
}
