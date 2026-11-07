import fs from 'node:fs/promises';
import path from 'node:path';

/** Group observed button styles without including screenshot data. */
export function summarizeAppearances(observations) {
  const grouped = new Map();
  for (const observation of observations) {
    const group = observation.group;
    const key = JSON.stringify([group.family, group.variant, group.type, observation.style]);
    if (!grouped.has(key)) grouped.set(key, { group, count: 0, example: observation.id, style: observation.style, source: observation.source || { status: 'unresolved' } });
    grouped.get(key).count++;
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.example.localeCompare(b.example));
}

/** Summarize observed appearances without including screenshot data. */
export async function listAppearances(reportDir, { page = 1, limit = 50 } = {}) {
  if (!Number.isInteger(page) || page < 1) throw new Error('Page must be a positive integer.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Limit must be between 1 and 200.');
  const data = JSON.parse(await fs.readFile(path.join(path.resolve(reportDir), 'ui-sheet.json'), 'utf8'));
  if (data.format !== 'ui-sheet/v1' || !data.consistency) throw new Error('The report has no button consistency analysis.');
  const pages = data.consistency.pages || [data.consistency];
  const selected = pages[page - 1];
  if (!selected || !Array.isArray(selected.observations)) throw new Error('Page is not present in the report.');
  const all = summarizeAppearances(selected.observations);
  return { format: 'ui-sheet/appearances-v1', page, pageCount: pages.length, scope: selected.scope, totalAppearances: all.length, truncated: all.length > limit, appearances: all.slice(0, limit) };
}
