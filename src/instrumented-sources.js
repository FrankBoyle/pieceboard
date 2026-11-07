/** Match opted-in development markers only to the exact selected local source. */
export function applyInstrumentedSources(data, rendered, matches) {
  const locations = new Map();
  for (const item of data.items) {
    if (item.kind !== 'components') continue;
    for (const usage of item.usages || []) {
      if (!usage.element?.tag || !Number.isSafeInteger(usage.line) || !Number.isSafeInteger(usage.column)) continue;
      const key = JSON.stringify([usage.file, usage.line, usage.column, usage.element.tag]);
      if (!locations.has(key)) locations.set(key, []);
      locations.get(key).push({ item, usage });
    }
  }
  const byElement = new Map(matches.map((match) => [`${match.rendered.tag}:${match.rendered.index}`, match]));
  for (const element of rendered) {
    if (!element.visible || typeof element.sourceMarker !== 'string') continue;
    const elementKey = `${element.tag}:${element.index}`;
    // A stale or invalid marker must not quietly fall back to a weaker match.
    byElement.delete(elementKey);
    if (element.sourceMarker.length > 2048) continue;
    let marker;
    try { marker = JSON.parse(element.sourceMarker); } catch { continue; }
    if (!marker || Array.isArray(marker) || marker.v !== 1 || typeof marker.file !== 'string' || marker.file.length > 500 || !Number.isSafeInteger(marker.line) || marker.line < 1 || !Number.isSafeInteger(marker.column) || marker.column < 1 || !/^[a-f0-9]{64}$/.test(marker.sha256 || '')) continue;
    if (data._sourceHashes?.get(marker.file) !== marker.sha256) continue;
    const candidates = locations.get(JSON.stringify([marker.file, marker.line, marker.column, element.tag]));
    if (candidates?.length !== 1) continue;
    byElement.set(elementKey, { ...candidates[0], rendered: element, method: 'development source marker; local file hash matched', instrumentedHash: marker.sha256 });
  }
  return [...byElement.values()];
}
