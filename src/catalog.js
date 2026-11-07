import fs from 'node:fs/promises';
import path from 'node:path';

const KINDS = new Set(['components', 'colors', 'typography', 'assets', 'tokens']);

/** Return compact source references without embedding screenshots or previews. */
export async function catalogReport(reportDir, { kind = '', search = '', id = '', limit = 50 } = {}) {
  if (kind && !KINDS.has(kind)) throw new Error('Unknown catalog kind.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Catalog limit must be between 1 and 200.');
  if (typeof search !== 'string' || search.length > 200 || typeof id !== 'string' || id.length > 500) throw new Error('Invalid catalog search or ID.');
  const data = JSON.parse(await fs.readFile(path.join(path.resolve(reportDir), 'ui-sheet.json'), 'utf8'));
  if (data.format !== 'ui-sheet/v1' || !Array.isArray(data.items)) throw new Error('The output directory does not contain a Pieceboard report.');
  const query = search.trim().toLowerCase();
  const filtered = data.items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (id && item.id !== id) return false;
    const text = [item.name, item.kind, item.subtype, item.source, item.value, ...(item.definitions || []).map((entry) => entry.file), ...(item.usages || []).map((entry) => `${entry.file} ${entry.detail || ''}`)].join(' ').toLowerCase();
    return text.includes(query);
  });
  const entries = filtered.slice(0, limit).map((item) => {
    const usageLimit = id ? 100 : 10;
    return {
      id: item.id, name: item.name, kind: item.kind, subtype: item.subtype, source: item.source,
      ...(item.value ? { value: item.value } : {}),
      definitions: item.definitions || [],
      usageCount: (item.usages || []).length,
      usages: (item.usages || []).slice(0, usageLimit).map(({ file, line, detail }) => ({ file, line, detail })),
      usagesTruncated: (item.usages || []).length > usageLimit,
      previewAvailable: Boolean(item.preview || item.captures?.length),
    };
  });
  return { format: 'ui-sheet/catalog-v1', name: data.name, generatedAt: data.generatedAt, scanScope: data.scanScope || [], total: filtered.length, truncated: filtered.length > limit, entries };
}
