import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readCheckedReport } from './scan-status.js';

const FORMAT = 'ui-sheet/token-baselines-v1';
const SOURCE_FORMAT = 'ui-sheet/token-source-v1';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RULES = 1000;
const LOCK_FORMAT = 'ui-sheet/token-baseline-lock-v1';
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const text = (value, maximum, nonempty = false) => typeof value === 'string'
  && value.length <= maximum && (!nonempty || value.trim().length > 0);
const tokenName = (value) => text(value, 2000) && value.startsWith('--') && value.length > 2 && !/[\x00-\x1f\x7f]/.test(value);
const sourceFile = (value) => text(value, 4096, true) && /\.css$/i.test(value)
  && !/[\\:\x00-\x1f\x7f]/.test(value) && !value.split('/').some((part) => !part || part === '.' || part === '..');

function validContext(context) {
  return Array.isArray(context) && context.length <= 128 && context.every((entry) => (
    keys(entry, ['type', 'selector']) && entry.type === 'rule' && text(entry.selector, 16384, true)
  ) || (
    keys(entry, ['type', 'name', 'params']) && entry.type === 'at-rule'
      && text(entry.name, 2000, true) && text(entry.params, 16384)
  ));
}

function validScope(value) {
  return sourceFile(value.file) && tokenName(value.token) && validContext(value.context);
}

/** Shared producer/consumer bounds for representable token source evidence. */
export function isTokenSourceFile(value) {
  return sourceFile(value);
}

export function isTokenSourceDeclaration(declaration) {
  return keys(declaration, ['token', 'value', 'important', 'file', 'line', 'column', 'context'])
    && validScope(declaration) && text(declaration.value, 131072) && typeof declaration.important === 'boolean'
    && Number.isSafeInteger(declaration.line) && declaration.line >= 1
    && Number.isSafeInteger(declaration.column) && declaration.column >= 1;
}

// Values and line positions deliberately do not identify a declaration. A move
// can retain an approval, but duplicate declarations in its scope are ambiguous.
function declarationId(declaration) {
  const context = declaration.context.map((entry) => entry.type === 'rule'
    ? { type: 'rule', selector: entry.selector }
    : { type: 'at-rule', name: entry.name, params: entry.params });
  const scope = { file: declaration.file, token: declaration.token, context };
  return `token:${createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0, 24)}`;
}

function validateSource(source) {
  if (!keys(source, ['format', 'files', 'declarations']) || source.format !== SOURCE_FORMAT
      || !Array.isArray(source.files) || !Array.isArray(source.declarations)) throw new Error('Token source evidence is invalid or unsupported. Run a new source scan.');
  const files = new Map();
  for (const entry of source.files) {
    if (!keys(entry, ['file', 'status']) || !sourceFile(entry.file)
        || !['scanned', 'failed'].includes(entry.status) || files.has(entry.file)) throw new Error('Token source files are invalid or duplicated. Run a new source scan.');
    files.set(entry.file, entry.status);
  }
  const byId = new Map();
  for (const declaration of source.declarations) {
    if (!isTokenSourceDeclaration(declaration) || files.get(declaration.file) !== 'scanned') throw new Error('Token declarations contain invalid or incomplete source evidence. Run a new source scan.');
    const id = declarationId(declaration);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(declaration);
  }
  return { files, byId };
}

async function readTokenReport(reportDir) {
  const checked = await readCheckedReport(reportDir);
  if (checked.data.format !== 'ui-sheet/v1') throw new Error('The report is not a supported Pieceboard report. Run a new source scan.');
  return { ...checked, source: checked.data.tokenSource === undefined ? null : validateSource(checked.data.tokenSource) };
}

function validateBaselines(data) {
  if (!keys(data, ['format', 'rules']) || data.format !== FORMAT
      || !Array.isArray(data.rules) || data.rules.length > MAX_RULES) throw new Error('Refusing to use a file that is not a supported Pieceboard token baseline file.');
  const ids = new Set();
  for (const rule of data.rules) {
    if (!keys(rule, ['id', 'token', 'file', 'context', 'value', 'important', 'reason', 'recordedAt'])
        || !validScope(rule) || !text(rule.value, 131072) || typeof rule.important !== 'boolean'
        || !text(rule.reason, 500, true) || !text(rule.recordedAt, 100, true)
        || !Number.isFinite(Date.parse(rule.recordedAt)) || rule.id !== declarationId(rule)
        || ids.has(rule.id)) throw new Error('Token baseline file contains an invalid or duplicate rule. It was not changed.');
    ids.add(rule.id);
  }
  return data;
}

async function baselineSnapshot(file, { allowMissing = false } = {}) {
  let stat;
  try { stat = await fs.lstat(file); }
  catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return { raw: null, data: { format: FORMAT, rules: [] } };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Token baseline file must be a regular file of at most 2 MB; symbolic links are not used.');
  const raw = await fs.readFile(file, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Token baseline file must be at most 2 MB.');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Token baseline file is not valid JSON. It was not changed.'); }
  return { raw, data: validateBaselines(data) };
}

function lockRecovery(file) {
  return `After verifying no token-baseline writer is running, remove ${JSON.stringify(file)} and retry.`;
}

async function acquireWriterLock(target) {
  const file = `${target}.lock`;
  const owner = randomUUID();
  let handle;
  try { handle = await fs.open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`A token approval is in progress or was interrupted. ${lockRecovery(file)}`);
    throw error;
  }
  try {
    const identity = await handle.stat();
    await handle.writeFile(JSON.stringify({ format: LOCK_FORMAT, owner }) + '\n');
    return { file, owner, dev: identity.dev, ino: identity.ino };
  } catch (error) {
    throw new Error(`Could not initialize the token approval lock; it was retained. ${lockRecovery(file)} ${error.message}`);
  } finally { await handle.close(); }
}

async function assertWriterLock(lock) {
  let stat;
  let marker;
  try {
    stat = await fs.lstat(lock.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096
        || stat.dev !== lock.dev || stat.ino !== lock.ino) throw new Error('Changed lock identity.');
    marker = JSON.parse(await fs.readFile(lock.file, 'utf8'));
  } catch {
    throw new Error(`The token approval lock changed; it was not removed. ${lockRecovery(lock.file)}`);
  }
  if (!keys(marker, ['format', 'owner']) || marker.format !== LOCK_FORMAT || marker.owner !== lock.owner) {
    throw new Error(`The token approval lock changed; it was not removed. ${lockRecovery(lock.file)}`);
  }
}

async function releaseWriterLock(lock) {
  await assertWriterLock(lock);
  await fs.unlink(lock.file);
}

/** Read explicit source-declaration contracts, without interpreting CSS values. */
export async function readTokenBaselines(file, options = {}) {
  return (await baselineSnapshot(file, options)).data;
}

/** List the declarations actually read from CSS, with duplicate scopes marked. */
export async function listTokens(reportDir, { name, file, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Token list limit must be an integer from 1 to 200.');
  if (name !== undefined && !tokenName(name)) throw new Error('Token name must begin with --.');
  if (file !== undefined && !sourceFile(file)) throw new Error('Token source file must be a project-relative CSS path.');
  const { data, scanStatus, source } = await readTokenReport(reportDir);
  const declarations = (data.tokenSource?.declarations || [])
    .filter((entry) => (name === undefined || entry.token === name) && (file === undefined || entry.file === file))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return {
    format: 'ui-sheet/tokens-v1', scanStatus, sourceStatus: source ? 'available' : 'missing',
    total: declarations.length, truncated: declarations.length > limit,
    entries: declarations.slice(0, limit).map((declaration) => {
      const id = declarationId(declaration);
      return { id, ...declaration, ambiguous: source.byId.get(id).length !== 1 };
    }),
  };
}

/** Approve one unambiguous declaration in the last completed source scan. */
export async function setTokenBaseline(reportDir, { file, declarationId: selectedId, reason } = {}) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('A token baseline file is required.');
  if (typeof selectedId !== 'string' || !/^token:[a-f0-9]{24}$/.test(selectedId)) throw new Error('Select a token declaration ID from the tokens command.');
  if (!text(reason, 500, true)) throw new Error('A reason of 1–500 characters is required.');
  const { data, scanStatus, source } = await readTokenReport(reportDir);
  if (scanStatus !== 'completed' || !source) throw new Error('Approve tokens from a completed current source scan. Run a new scan first.');
  const declarations = source.byId.get(selectedId) || [];
  if (declarations.length !== 1) throw new Error('The declaration ID must identify exactly one unambiguous source declaration.');
  const declaration = declarations[0];
  if (!Array.isArray(data.warnings) || data.warnings.some((warning) => warning?.file === declaration.file)) throw new Error('The selected token file has incomplete warning evidence. Run a successful source scan before approval.');
  const target = path.resolve(file);
  const lock = await acquireWriterLock(target);
  const temporary = path.join(path.dirname(target), `.ui-sheet-token-baseline-${randomUUID()}.tmp`);
  try {
    // Lock before the first read: a reread immediately before rename is not a
    // compare-and-swap and can otherwise acknowledge two conflicting writers.
    const snapshot = await baselineSnapshot(target, { allowMissing: true });
    const rule = {
      id: selectedId, token: declaration.token, file: declaration.file, context: structuredClone(declaration.context),
      value: declaration.value, important: declaration.important, reason: reason.trim(), recordedAt: new Date().toISOString(),
    };
    const index = snapshot.data.rules.findIndex((entry) => entry.id === rule.id);
    if (index < 0) snapshot.data.rules.push(rule);
    else snapshot.data.rules[index] = rule;
    validateBaselines(snapshot.data);
    const serialized = JSON.stringify(snapshot.data, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new Error('Token baseline file would exceed the 2 MB limit.');
    await fs.writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
    const current = await baselineSnapshot(target, { allowMissing: true });
    if (current.raw !== snapshot.raw) throw new Error('Token baseline file changed during approval. Run the command again.');
    await assertWriterLock(lock);
    if (snapshot.raw === null) {
      // Creating a new file must not replace one that appeared concurrently.
      await fs.link(temporary, target);
    } else await fs.rename(temporary, target);
    return { id: rule.id, file: target };
  } finally {
    try { await fs.rm(temporary, { force: true }); }
    finally { await releaseWriterLock(lock); }
  }
}

/** Compare exact declaration values in the last report, not effective CSS. */
export async function checkTokens(reportDir, { file } = {}) {
  const baselines = await readTokenBaselines(file);
  const { data, scanStatus, source } = await readTokenReport(reportDir);
  const findings = baselines.rules.map((rule) => {
    const declarations = source?.byId.get(rule.id) || [];
    const scanned = source?.files.get(rule.file) === 'scanned';
    const status = !scanned ? 'unscanned' : declarations.length === 0 ? 'missing'
      : declarations.length > 1 ? 'ambiguous'
        : declarations[0].value === rule.value && declarations[0].important === rule.important ? 'matched' : 'changed';
    return {
      id: rule.id, token: rule.token, file: rule.file, context: structuredClone(rule.context), status,
      approved: { value: rule.value, important: rule.important },
      current: declarations.map(({ value, important, line, column }) => ({ value, important, line, column })),
    };
  });
  const counts = Object.fromEntries(['matched', 'changed', 'missing', 'ambiguous', 'unscanned']
    .map((status) => [status, findings.filter((finding) => finding.status === status).length]));
  const complete = source && scanStatus === 'completed' && Array.isArray(data.warnings) && data.warnings.length === 0
    && !counts.ambiguous && !counts.unscanned;
  return {
    format: 'ui-sheet/token-check-v1', scanStatus,
    coverage: findings.length === 0 ? 'insufficient' : complete ? 'observed' : 'partial',
    total: findings.length, ...counts, findings,
  };
}
