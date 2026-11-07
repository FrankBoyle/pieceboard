import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

function text(value, name, limit, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) throw new Error(`${name} must be ${optional ? 'at most' : '1 to'} ${limit} characters.`);
  return value.trim();
}

async function imageData(root, input, total) {
  if (input === undefined || input === '') return '';
  if (typeof input !== 'string' || path.isAbsolute(input) || input.includes('\0')) throw new Error('Each image must be a relative file path beside the manifest.');
  const resolved = await fs.realpath(path.resolve(root, input));
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Images must stay inside the manifest folder.');
  const info = await fs.stat(resolved);
  if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('Each image must be a file no larger than 8 MB.');
  total.size += info.size;
  if (total.size > 48 * 1024 * 1024) throw new Error('Images cannot exceed 48 MB in total.');
  const bytes = await fs.readFile(resolved);
  const mime = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
    : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : '';
  if (!mime) throw new Error('Images must be PNG, JPEG, or WebP files.');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** Generate one portable, offline A/B review from deliberately paired examples. */
export async function writeChoiceBoard(manifestPath, outputPath) {
  const manifest = path.resolve(manifestPath);
  const contents = await fs.readFile(manifest, 'utf8');
  if (Buffer.byteLength(contents) > 1024 * 1024) throw new Error('The choices file must be smaller than 1 MB.');
  let input;
  try { input = JSON.parse(contents); } catch { throw new Error('The choices file must contain valid JSON.'); }
  if (!input || typeof input !== 'object' || !Array.isArray(input.choices) || !input.choices.length || input.choices.length > 50) throw new Error('Provide between 1 and 50 choices.');
  const root = await fs.realpath(path.dirname(manifest));
  const total = { size: 0 };
  const choices = [];
  for (const [index, item] of input.choices.entries()) {
    if (!item || !Array.isArray(item.options) || item.options.length !== 2) throw new Error(`Choice ${index + 1} must have exactly two options.`);
    const options = [];
    for (const option of item.options) {
      if (!option || typeof option !== 'object') throw new Error(`Choice ${index + 1} has an invalid option.`);
      options.push({ label: text(option.label, 'Option label', 200), description: text(option.description, 'Option description', 1000, true), image: await imageData(root, option.image, total) });
    }
    choices.push({ question: text(item.question, 'Question', 240), context: text(item.context, 'Context', 1500, true), options });
  }
  const data = { title: text(input.title, 'Title', 120), introduction: text(input.introduction, 'Introduction', 1500, true), choices };
  data.storageKey = `pieceboard:board:${createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 24)}`;
  const [css, js] = await Promise.all([fs.readFile(new URL('./choice-board.css', import.meta.url), 'utf8'), fs.readFile(new URL('./choice-board-viewer.js', import.meta.url), 'utf8')]);
  const serialized = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>Pieceboard visual choices</title><style>${css}</style></head><body><main><header><p class="eyebrow">PIECEBOARD · THIS OR THAT</p><h1 id="title"></h1><p id="introduction"></p><p>Choose A or B for each question. Add an optional note, then download your answers to share them.</p></header><form id="choices"></form><section class="finish"><button id="download" type="button">Download my answers</button><p id="status" role="status">Your answers stay on this device until you download and share them.</p></section></main><script>window.__CHOICES__=${serialized};</script><script>${js}</script></body></html>`;
  await fs.writeFile(path.resolve(outputPath), html, { encoding: 'utf8', flag: 'wx' });
  return { output: path.resolve(outputPath), choices: choices.length };
}
