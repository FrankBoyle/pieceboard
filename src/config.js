import fs from 'node:fs/promises';
import path from 'node:path';
import { validateButtonGroups, validateCaptureActions, validateColorScheme, validateElementGroups, validateInventoryClasses, validateMaskSelectors, validatePixelRatio, validateSourceLinks, validateViewport } from './context.js';
import { validateLayoutChecks } from './layout-audit.js';
import { validateResponsiveViewports } from './responsive-audit.js';

export async function readProjectConfig(root) {
  const file = path.join(root, 'ui-sheet.config.json');
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  try {
    const config = JSON.parse(raw);
    if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('expected a JSON object');
    for (const key of ['include', 'exclude', 'pages']) {
      if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].length > 20 || config[key].some((entry) => typeof entry !== 'string' || !entry.trim()))) throw new Error(`${key} must be an array of up to 20 nonempty strings`);
    }
    for (const key of ['decisions', 'baseline', 'elementBaseline']) {
      if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key].trim())) throw new Error(`${key} must be a nonempty path`);
    }
    if (config.viewport !== undefined) config.viewport = validateViewport(config.viewport);
    if (config.colorScheme !== undefined) config.colorScheme = validateColorScheme(config.colorScheme);
    if (config.pixelRatio !== undefined) config.pixelRatio = validatePixelRatio(config.pixelRatio);
    if (config.responsiveViewports !== undefined) config.responsiveViewports = validateResponsiveViewports(config.responsiveViewports);
    if (config.maskSelectors !== undefined) config.maskSelectors = validateMaskSelectors(config.maskSelectors);
    if (config.buttonGroups !== undefined) config.buttonGroups = validateButtonGroups(config.buttonGroups);
    if (config.elementGroups !== undefined) config.elementGroups = validateElementGroups(config.elementGroups);
    if (config.layoutChecks !== undefined) config.layoutChecks = validateLayoutChecks(config.layoutChecks);
    if (config.layoutMedia !== undefined && !['screen', 'print'].includes(config.layoutMedia)) throw new Error('layoutMedia must be screen or print');
    if (config.sourceLinks !== undefined) config.sourceLinks = validateSourceLinks(config.sourceLinks);
    if (config.inventoryClasses !== undefined) config.inventoryClasses = validateInventoryClasses(config.inventoryClasses);
    if (config.instrumentedSources !== undefined && typeof config.instrumentedSources !== 'boolean') throw new Error('instrumentedSources must be a boolean');
    if (config.captureTimeoutMs !== undefined && (!Number.isSafeInteger(config.captureTimeoutMs) || config.captureTimeoutMs < 1000 || config.captureTimeoutMs > 900000)) throw new Error('captureTimeoutMs must be an integer from 1000 to 900000 milliseconds');
    if (config.pageActions !== undefined) {
      if (!Array.isArray(config.pageActions) || config.pageActions.length > 20 || config.pageActions.some((entry) => !entry || typeof entry.page !== 'string' || !entry.page.trim())) throw new Error('pageActions must contain up to 20 explicit page URLs and action lists');
      const seen = new Set();
      config.pageActions = config.pageActions.map((entry) => {
        const url = new URL(entry.page);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(entry.page)) throw new Error('pageActions require unique HTTP(S) URLs without embedded credentials');
        seen.add(entry.page);
        return { page: entry.page, actions: validateCaptureActions(entry.actions) };
      });
    }
    return config;
  } catch (error) { throw new Error(`Invalid ui-sheet.config.json: ${error.message}`); }
}

export async function initProject(projectDir) {
  const root = path.resolve(projectDir);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Project path must be a directory.');
  const source = await fs.stat(path.join(root, 'src')).catch(() => null);
  const config = { name: path.basename(root), include: source?.isDirectory() ? ['src'] : [], pages: [] };
  const file = path.join(root, 'ui-sheet.config.json');
  try { await fs.writeFile(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Refusing to overwrite an existing ui-sheet.config.json.'); throw error; }
  return { file, config };
}
