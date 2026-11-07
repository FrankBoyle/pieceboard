import { parse } from 'parse5';

const MAX_BYTES = 2 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function pageUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('--page must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('--page must be an HTTP(S) URL without embedded credentials.');
  url.hash = '';
  return url;
}

/** Compare one fetched HTML response with static source IDs, conservatively. */
export function matchPageHtml(data, html, inputUrl, { append = false } = {}) {
  const url = pageUrl(inputUrl);
  // Query strings can contain private values; never include them in the report.
  const displayUrl = `${url.origin}${url.pathname}`;
  const pageIds = new Map();
  const visit = (node) => {
    if (node.tagName) {
      const id = (node.attrs || []).find((attr) => attr.name === 'id')?.value;
      if (id) {
        if (!pageIds.has(id)) pageIds.set(id, []);
        pageIds.get(id).push(node.tagName);
      }
    }
    for (const child of node.childNodes || []) visit(child);
    // Do not count inert <template> contents as page elements.
  };
  visit(parse(html));
  const sourceIds = new Map();
  for (const item of data.items) {
    if (!append) delete item.pageMatches;
    for (const usage of item.usages) {
      if (!usage.element?.id || !usage.element?.tag) continue;
      if (!sourceIds.has(usage.element.id)) sourceIds.set(usage.element.id, []);
      sourceIds.get(usage.element.id).push({ item, usage });
    }
  }
  let matches = 0;
  for (const [id, sources] of sourceIds) {
    const page = pageIds.get(id);
    if (sources.length !== 1 || page?.length !== 1 || page[0] !== sources[0].usage.element.tag) continue;
    const { item, usage } = sources[0];
    if (!item.pageMatches) item.pageMatches = [];
    item.pageMatches.push({ file: usage.file, line: usage.line, detail: `<${usage.element.tag} id=${JSON.stringify(id)}> · ${displayUrl}` });
    matches++;
  }
  const observation = { url: displayUrl, matchingSourceLocations: matches, method: 'unique-id-and-tag' };
  data.observedPages = append ? [...(data.observedPages || []), observation] : [observation];
  return data;
}

/** Fetch a page without cookies or script execution. Cross-origin redirects are rejected. */
export async function observePage(data, inputUrl, fetchImpl = fetch, options = {}) {
  const original = pageUrl(inputUrl);
  let current = original;
  let response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { accept: 'text/html,application/xhtml+xml' } });
    if (!REDIRECTS.has(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === 5) throw new Error('Page redirect limit exceeded or missing Location header.');
    const next = pageUrl(new URL(location, current).href);
    if (next.origin !== original.origin) throw new Error('Page redirects to another origin; provide the final URL explicitly.');
    current = next;
  }
  if (!response.ok) throw new Error(`Page request failed with HTTP ${response.status}.`);
  const type = response.headers.get('content-type') || '';
  if (!/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(type)) throw new Error('Page did not return HTML.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new Error('Page response exceeds the 2 MB limit.');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > MAX_BYTES) throw new Error('Page response exceeds the 2 MB limit.');
    chunks.push(chunk);
  }
  return matchPageHtml(data, Buffer.concat(chunks).toString('utf8'), current.href, options);
}
