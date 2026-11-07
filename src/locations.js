import fs from 'node:fs/promises';
import path from 'node:path';

/** List observed occurrences on selected pages without including screenshot data. */
export async function locateButtons(reportDir, { family, variant, limit = 50 } = {}) {
  if (typeof family !== 'string' || !family.trim() || family.length > 200) throw new Error('A button family of up to 200 characters is required.');
  if (variant !== undefined && (typeof variant !== 'string' || !variant.trim() || variant.length > 200)) throw new Error('Variant must be a nonempty string of up to 200 characters.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Limit must be between 1 and 200.');
  const data = JSON.parse(await fs.readFile(path.join(path.resolve(reportDir), 'ui-sheet.json'), 'utf8'));
  if (data.format !== 'ui-sheet/v1' || !data.consistency) throw new Error('The report has no button consistency analysis.');
  const pages = data.consistency.pages || [data.consistency];
  if (!pages.length || pages.some((page) => !Array.isArray(page.observations))) throw new Error('The button observations are incomplete.');
  const wantedFamily = family.trim().toLowerCase();
  const wantedVariant = variant?.trim().toLowerCase();
  const locations = [];
  const matchingPages = new Set();
  for (const [index, page] of pages.entries()) {
    for (const observation of page.observations) {
      if (observation.group?.family !== wantedFamily || (wantedVariant && observation.group?.variant !== wantedVariant)) continue;
      matchingPages.add(index);
      locations.push({ page: index + 1, url: page.scope?.url || '', viewport: page.scope?.viewport || null, theme: page.scope?.theme || 'unknown', observation: observation.id, group: observation.group, source: observation.source || { status: 'unresolved' }, previewAvailable: Boolean(page.previews?.[observation.id]?.image) });
    }
  }
  return { format: 'ui-sheet/locations-v1', family: wantedFamily, variant: wantedVariant || null, pagesVisited: pages.length, matchingPages: matchingPages.size, total: locations.length, truncated: locations.length > limit, locations: locations.slice(0, limit) };
}
