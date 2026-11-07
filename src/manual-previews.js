import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeReport } from './report.js';

function imageType(file, bytes) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (ext === '.webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

function safePage(input) {
  if (input == null || input === '') return '';
  let url;
  try { url = new URL(input); } catch { throw new Error('Preview page must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Preview page must be an HTTP(S) URL without embedded credentials.');
  return `${url.origin}${url.pathname}`;
}

function previewElement(input) {
  if (input == null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Preview element must be an object with tag, role, or type.');
  const element = {};
  for (const [key, value] of Object.entries(input)) {
    if (!['tag', 'role', 'type'].includes(key) || typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/i.test(value)) throw new Error('Preview element supports simple tag, role, and type values only.');
    element[key] = value.toLowerCase();
  }
  if (!Object.keys(element).length) throw new Error('Preview element must include a tag, role, or type.');
  return element;
}

function captureMetadata(input, bytes) {
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  const metadata = { role: null, school: null, viewportWidth: null, viewportHeight: null, capturedAt: null, screenshotSha256: actualHash, servedSha: null };
  if (input == null) return metadata;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Capture metadata must be an object.');
  const allowed = new Set(Object.keys(metadata));
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unknown capture metadata field: ${key}`);
  for (const key of ['role', 'school']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 200) throw new Error(`Capture metadata ${key} must be a non-empty string of at most 200 characters.`);
      metadata[key] = input[key].trim();
    }
  }
  for (const key of ['viewportWidth', 'viewportHeight']) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 10000) throw new Error(`Capture metadata ${key} must be an integer from 1 to 10000.`);
      metadata[key] = input[key];
    }
  }
  if (input.capturedAt !== undefined) {
    const parsed = typeof input.capturedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.capturedAt) ? new Date(input.capturedAt) : null;
    if (!parsed || !Number.isFinite(parsed.getTime()) || ![input.capturedAt, `${input.capturedAt.slice(0, -1)}.000Z`].includes(parsed.toISOString())) throw new Error('Capture metadata capturedAt must be a valid UTC ISO timestamp.');
    metadata.capturedAt = parsed.toISOString();
  }
  if (input.screenshotSha256 !== undefined) {
    if (typeof input.screenshotSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(input.screenshotSha256) || input.screenshotSha256.toLowerCase() !== actualHash) throw new Error('Capture metadata screenshotSha256 must match the supplied image SHA-256.');
    metadata.screenshotSha256 = actualHash;
  }
  if (input.servedSha !== undefined) {
    if (typeof input.servedSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(input.servedSha)) throw new Error('Capture metadata servedSha must be a 40- or 64-character hexadecimal revision.');
    metadata.servedSha = input.servedSha.toLowerCase();
  }
  return metadata;
}

/** Attach manually captured images to verified inventory locations, without importing browser credentials. */
export async function addPreviews(reportDir, manifestFile) {
  const directory = path.resolve(reportDir);
  const manifestPath = path.resolve(manifestFile);
  const data = JSON.parse(await fs.readFile(path.join(directory, 'ui-sheet.json'), 'utf8'));
  if (data.format !== 'ui-sheet/v1' || !Array.isArray(data.items)) throw new Error('The output directory does not contain a Pieceboard report.');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.previews) || !manifest.previews.length || manifest.previews.length > 100) throw new Error('The manifest must contain between 1 and 100 previews.');
  const prepared = [];
  for (const preview of manifest.previews) {
    const item = data.items.find((candidate) => candidate.id === preview.item);
    if (!item) throw new Error(`Unknown inventory item: ${preview.item}`);
    if (!preview.source || typeof preview.source.file !== 'string' || !Number.isInteger(preview.source.line) || preview.source.line < 1) throw new Error(`A source file and line are required for ${preview.item}.`);
    if (![...item.definitions, ...item.usages].some((location) => location.file === preview.source.file && location.line === preview.source.line)) throw new Error(`Source location is not present in the inventory for ${preview.item}.`);
    if (typeof preview.image !== 'string' || !preview.image) throw new Error(`An image path is required for ${preview.item}.`);
    const imagePath = path.resolve(path.dirname(manifestPath), preview.image);
    const stat = await fs.stat(imagePath);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`Preview must be a file no larger than 1 MB: ${preview.image}`);
    const bytes = await fs.readFile(imagePath);
    const type = imageType(imagePath, bytes);
    if (!type) throw new Error(`Preview must be a valid PNG, JPEG, or WebP image: ${preview.image}`);
    const element = previewElement(preview.element);
    const metadata = captureMetadata(preview.captureMetadata, bytes);
    prepared.push({ item, capture: { image: `data:${type};base64,${bytes.toString('base64')}`, file: preview.source.file, line: preview.source.line, method: 'provided screenshot; source link selected manually', page: safePage(preview.page), captureMetadata: metadata, ...(element ? { element } : {}), ...(typeof preview.label === 'string' ? { label: preview.label.slice(0, 100) } : {}) } });
  }
  let added = 0;
  const addedPages = new Map();
  for (const { item, capture } of prepared) {
    if (!item.captures) item.captures = [];
    const existing = item.captures.find((entry) => entry.image === capture.image && entry.file === capture.file && entry.line === capture.line);
    if (existing) {
      if (capture.element) existing.element = capture.element;
      existing.captureMetadata = capture.captureMetadata;
      continue;
    }
    item.captures.push(capture);
    added++;
    const page = capture.page || 'Provided images';
    addedPages.set(page, (addedPages.get(page) || 0) + 1);
  }
  const prior = data.captureSummary || { captured: 0 };
  const pages = prior.pages || (prior.url ? [{ url: prior.url, captured: prior.captured || 0 }] : []);
  for (const [url, count] of addedPages) {
    const existing = pages.find((page) => page.url === url);
    if (existing) existing.captured += count;
    else pages.push({ url, captured: count });
  }
  data.captureSummary = { ...prior, captured: (prior.captured || 0) + added, pages };
  await writeReport(data, directory);
  return { added, total: data.captureSummary.captured };
}
