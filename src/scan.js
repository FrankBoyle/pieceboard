import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { parse as parseHtml } from 'parse5';
import PhpParser from 'php-parser';
import { readProjectConfig } from './config.js';
import { isTokenSourceDeclaration, isTokenSourceFile } from './token-baselines.js';

const traverse = traverseModule.default || traverseModule;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const IMAGE_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.nuxt', '.ui-sheet']);
const SKIP_UNLESS_SELECTED = new Set(['uploads', 'storage', 'data', 'database', 'tmp', 'temp', 'output', 'outputs', 'artifacts', 'evidence']);
// Content paragraphs and generic layout wrappers are intentionally excluded:
// the inventory should center reusable interface pieces, not page copy.
const INTRINSIC = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'header', 'aside', 'nav', 'footer']);
const UI_ROLES = new Set(['tab', 'tablist', 'tabpanel', 'button', 'checkbox', 'radio', 'switch', 'combobox', 'listbox', 'option', 'textbox', 'searchbox', 'navigation', 'banner', 'menu', 'menuitem']);
const TEMPLATE_EXTENSIONS = new Set(['.html', '.htm', '.php']);
const SOURCE_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 1024 * 1024;
const slash = (p) => p.split(path.sep).join('/');
const rel = (root, file) => slash(path.relative(root, file));
const isImage = (file) => Object.hasOwn(IMAGE_TYPES, path.extname(file).toLowerCase());
const isFont = (file) => FONT_EXTENSIONS.has(path.extname(file).toLowerCase());

const inside = (dir, candidate) => {
  const relative = path.relative(dir, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

async function listFiles(root, outputDir, includes, excludes) {
  const files = [];
  const requested = (file) => !includes.length || includes.some((selected) => inside(selected, file));
  const relevant = (dir) => !includes.length || includes.some((selected) => inside(selected, dir) || inside(dir, selected));
  async function visit(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (excludes.some((selected) => inside(selected, file))) continue;
      if (entry.isDirectory()) {
        const explicitlySelected = includes.some((selected) => inside(file, selected));
        const normallySkipped = SKIP_UNLESS_SELECTED.has(entry.name.toLowerCase()) || entry.name.startsWith('.');
        if (!SKIP_DIRS.has(entry.name) && (!normallySkipped || explicitlySelected) && file !== outputDir && relevant(file)) await visit(file);
      } else if (entry.isFile() && requested(file) && !(dir === outputDir && ['index.html', 'ui-sheet.json'].includes(entry.name))) {
        files.push(file);
      }
      // Symlinks are intentionally not followed.
    }
  }
  await visit(root);
  return files;
}

async function findWorkspacePackages(root, files, excludes) {
  // Read only package manifests on ancestors of the explicitly selected files.
  const directories = new Set();
  for (const file of files) {
    for (let dir = path.dirname(file); inside(root, dir); dir = path.dirname(dir)) {
      directories.add(dir);
      if (dir === root) break;
    }
  }
  const packages = new Map();
  for (const dir of directories) {
    if (excludes.some((selected) => inside(selected, path.join(dir, 'package.json')))) continue;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
      if (typeof manifest.name === 'string' && manifest.exports) packages.set(manifest.name, packages.has(manifest.name) ? null : { dir, exports: manifest.exports });
    } catch { /* A missing or invalid manifest is not a source scan error. */ }
  }
  return packages;
}

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const condition of ['source', 'development', 'import', 'default']) {
    const found = exportTarget(value[condition]);
    if (found) return found;
  }
  return null;
}

function maskPhp(source) {
  // Tokenization does not execute PHP. Keep offsets and line breaks for the HTML parser.
  const tokens = new PhpParser().tokenGetAll(source);
  const masked = tokens.map((token) => {
    const text = Array.isArray(token) ? token[1] : token;
    return Array.isArray(token) && token[0] === 'T_INLINE_HTML' ? text : text.replace(/[^\r\n]/g, ' ');
  }).join('');
  if (masked.length !== source.length) throw new Error('PHP tokenizer could not preserve source positions');
  return masked;
}

function staticClassNames(value) {
  return typeof value === 'string' ? [...new Set(value.split(/\s+/).filter(Boolean))].sort() : [];
}

function jsxClassNames(attributes) {
  const attr = (attributes || []).find((entry) => entry.type === 'JSXAttribute' && entry.name.name === 'className');
  if (attr?.value?.type === 'StringLiteral') return staticClassNames(attr.value.value);
  if (attr?.value?.type === 'JSXExpressionContainer' && attr.value.expression.type === 'StringLiteral') return staticClassNames(attr.value.expression.value);
  return [];
}

function jsxStaticAttribute(attributes, name) {
  const attr = (attributes || []).find((entry) => entry.type === 'JSXAttribute' && entry.name.name === name);
  if (attr?.value?.type === 'StringLiteral') return attr.value.value;
  if (attr?.value?.type === 'JSXExpressionContainer' && attr.value.expression.type === 'StringLiteral') return attr.value.expression.value;
  return '';
}

function jsxStaticText(children) {
  const pieces = [];
  for (const child of children || []) {
    if (child.type === 'JSXText') pieces.push(child.value);
    else if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
      const nested = jsxStaticText(child.children);
      if (nested === null) return null;
      pieces.push(nested);
    } else if (child.type === 'JSXExpressionContainer' && ['StringLiteral', 'NumericLiteral'].includes(child.expression.type)) {
      pieces.push(String(child.expression.value));
    } else if (child.type !== 'JSXExpressionContainer' || child.expression.type !== 'JSXEmptyExpression') return null;
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

function nodeText(node) {
  if (node.nodeName === '#text') return node.value || '';
  if (['script', 'style', 'template'].includes(node.tagName)) return '';
  return (node.childNodes || []).map(nodeText).join(' ');
}

async function imageData(file) {
  if (!isImage(file)) return null;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > IMAGE_LIMIT) return null;
    return `data:${IMAGE_TYPES[path.extname(file).toLowerCase()]};base64,${(await fs.readFile(file)).toString('base64')}`;
  } catch { return null; }
}

function jsxName(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return `${jsxName(node.object)}.${jsxName(node.property)}`;
  return '';
}

function containsJsx(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  return Object.entries(node).some(([key, value]) => {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) return false;
    return Array.isArray(value) ? value.some(containsJsx) : value && typeof value === 'object' && containsJsx(value);
  });
}

function literalProps(attributes) {
  const values = [];
  for (const attr of attributes || []) {
    if (attr.type !== 'JSXAttribute' || !['variant', 'size', 'type', 'className'].includes(attr.name.name)) continue;
    const value = attr.value?.type === 'StringLiteral' ? attr.value.value
      : attr.value?.type === 'JSXExpressionContainer' && ['StringLiteral', 'NumericLiteral'].includes(attr.value.expression.type) ? attr.value.expression.value
        : attr.value === null ? true : null;
    if (value !== null) values.push(`${attr.name.name}=${JSON.stringify(value)}`);
  }
  return values.join(' · ');
}

function looksLikeColor(name, value) {
  return /color|colour|background|surface|accent|border|foreground|(^|-)bg($|-)/i.test(name)
    || /^(#[\da-f]{3,8}\b|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\()/i.test(value.trim());
}

function safeDocs(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

/** Scan a project without running its code. Results are static clues, not a complete dependency graph. */
export async function scanProject(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : path.join(root, '.ui-sheet');
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Project directory does not exist: ${root}`);
  const config = await readProjectConfig(root);
  const includes = [];
  for (const requested of options.includePaths?.length ? options.includePaths : (config.include || [])) {
    if (typeof requested !== 'string' || !requested || path.isAbsolute(requested)) throw new Error('Include paths must be relative to the project.');
    const selected = path.resolve(root, requested);
    if (!inside(root, selected)) throw new Error(`Include path is outside the project: ${requested}`);
    const selectedStat = await fs.lstat(selected).catch(() => null);
    if (!selectedStat || selectedStat.isSymbolicLink()) throw new Error(`Include path does not exist or is a symlink: ${requested}`);
    includes.push(selected);
  }
  const excludes = [];
  const additionalExclusions = options.excludePaths || [];
  if (!Array.isArray(additionalExclusions) || additionalExclusions.length > 20) throw new Error('Exclude paths must be an array of up to 20 paths.');
  for (const requested of [...(config.exclude || []), ...additionalExclusions]) {
    if (typeof requested !== 'string' || !requested || path.isAbsolute(requested)) throw new Error('Exclude paths must be relative to the project.');
    const selected = path.resolve(root, requested);
    if (!inside(root, selected) || selected === root) throw new Error('Exclude paths must be inside the project and cannot be the project root.');
    const selectedStat = await fs.lstat(selected).catch(() => null);
    if (!selectedStat || selectedStat.isSymbolicLink()) throw new Error(`Exclude path does not exist or is a symlink: ${requested}`);
    if (!excludes.includes(selected)) excludes.push(selected);
  }
  const files = await listFiles(root, outputDir, includes, excludes);
  const fileSet = new Set(files);
  const workspacePackages = await findWorkspacePackages(root, files, excludes);
  const warnings = [];
  const ambiguousPackageWarnings = new Set();
  const items = new Map();
  const cssClasses = new Map();
  const sourceIdCounts = new Map();
  const sourceHashes = new Map();
  const tokenSource = { format: 'ui-sheet/token-source-v1', files: [], declarations: [] };
  const countSourceId = (id) => { if (id) sourceIdCounts.set(id, (sourceIdCounts.get(id) || 0) + 1); };
  // A simple configured class can safely classify static markup as UI. More
  // complex selectors are matched only in the browser, without guessing source.
  const groupClasses = (config.elementGroups || []).flatMap((rule) => /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]{0,79})$/.test(rule.selector) ? [{ className: rule.selector.slice(1), type: rule.type }] : []);
  const inventoryRules = [...(config.inventoryClasses || []), ...groupClasses].filter((rule, index, rules) => rules.findIndex((candidate) => candidate.className === rule.className && candidate.type === rule.type) === index);
  const inventoryTypes = (classes) => inventoryRules.filter((rule) => classes.includes(rule.className));
  let scannedFiles = 0;

  function item(id, defaults) {
    if (!items.has(id)) items.set(id, { id, ...defaults, usages: [], definitions: [] });
    return items.get(id);
  }
  function addLocation(list, location) {
    if (!list.some((entry) => entry.file === location.file && entry.line === location.line && entry.column === location.column && entry.detail === location.detail)) list.push(location);
  }
  function modulePath(from, source) {
    if (!source.startsWith('.')) {
      const parts = source.split('/');
      const packageName = source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const workspace = workspacePackages.get(packageName);
      if (workspace === null && !ambiguousPackageWarnings.has(packageName)) {
        ambiguousPackageWarnings.add(packageName);
        warnings.push({ file: rel(root, from), message: `Multiple selected workspace packages share the name ${packageName}; this import remains unresolved.` });
      }
      if (workspace) {
        const subpath = parts.slice(source.startsWith('@') ? 2 : 1).join('/');
        const key = subpath ? `./${subpath}` : '.';
        const exports = workspace.exports;
        const target = exportTarget(typeof exports === 'string' ? (key === '.' ? exports : null) : exports[key]);
        if (target && target.startsWith('./')) {
          const resolved = path.resolve(workspace.dir, target);
          if (inside(workspace.dir, resolved) && fileSet.has(resolved)) return rel(root, resolved);
        }
      }
      return `package:${source}`;
    }
    const base = path.resolve(path.dirname(from), source);
    const candidates = [base, ...['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'].map((ext) => base + ext), ...['.tsx', '.ts', '.jsx', '.js'].map((ext) => path.join(base, `index${ext}`))];
    const resolved = candidates.find((candidate) => fileSet.has(candidate));
    return resolved ? rel(root, resolved) : `unresolved:${slash(path.relative(root, base))}`;
  }
  function component(module, exported, name, subtype = 'Component') {
    return item(`component:${module}#${exported}`, { name, kind: 'components', subtype, source: module });
  }
  function addClasses(entry, classes) {
    if (classes.length) entry.classNames = [...new Set([...(entry.classNames || []), ...classes])].sort();
  }
  const previewPaths = new Set(Object.values(config.components || {}).flatMap((value) => value && typeof value.preview === 'string' ? [path.resolve(root, value.preview)] : []));
  for (const file of files) {
    if ((!isImage(file) && !isFont(file)) || previewPaths.has(file)) continue;
    const relative = rel(root, file);
    const asset = item(`asset:${relative}`, { name: path.basename(file), kind: isFont(file) ? 'typography' : 'assets', subtype: isFont(file) ? 'Font file' : 'Image asset', source: relative, preview: null });
    addLocation(asset.definitions, { file: relative, line: 1, detail: '' });
    if (isImage(file)) asset.preview = await imageData(file);
  }
  function assetReference(from, value, line) {
    if (typeof value !== 'string' || /^(?:https?:|data:|#|\/\/)/i.test(value)) return;
    const clean = value.split(/[?#]/)[0];
    if (!isImage(clean) && !isFont(clean)) return;
    let decoded = clean;
    try { decoded = decodeURIComponent(clean); } catch { /* keep original */ }
    const candidates = decoded.startsWith('/')
      ? [path.join(root, 'public', decoded.slice(1)), path.join(root, decoded.slice(1))]
      : [path.resolve(path.dirname(from), decoded)];
    const found = candidates.find((candidate) => fileSet.has(candidate));
    if (!found) return;
    const asset = items.get(`asset:${rel(root, found)}`);
    if (asset) addLocation(asset.usages, { file: rel(root, from), line: line || 1, detail: '' });
  }
  function token(name) {
    return item(`token:${name}`, { name, kind: 'tokens', subtype: 'CSS custom property', source: '', value: '' });
  }
  function tokenReferences(value, from, line) {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      addLocation(token(match[1]).usages, { file: rel(root, from), line: line || 1, detail: '' });
    }
  }

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext) && ext !== '.css' && !TEMPLATE_EXTENSIONS.has(ext)) continue;
    const relative = rel(root, file);
    const tokenFile = ext === '.css' && isTokenSourceFile(relative) ? { file: relative, status: 'failed' } : null;
    if (tokenFile) tokenSource.files.push(tokenFile);
    else if (ext === '.css') warnings.push({ file: relative, message: 'Token source evidence cannot represent this CSS file path; its token scopes remain unscanned.' });
    try {
      const stat = await fs.stat(file);
      if (stat.size > SOURCE_LIMIT) throw new Error('File exceeds the 2 MB source limit');
      const source = await fs.readFile(file, 'utf8');
      if (ext === '.jsx' || ext === '.tsx') sourceHashes.set(relative, createHash('sha256').update(source).digest('hex'));
      scannedFiles++;
      if (options.onScannedFile) options.onScannedFile(relative);
      if (ext === '.css') {
        const tree = postcss.parse(source, { from: file });
        const declarations = [];
        let unsupportedTokenLine;
        tree.walkRules((rule) => {
          try {
            const names = new Set();
            selectorParser((selectors) => selectors.walkClasses((node) => names.add(node.value))).processSync(rule.selector);
            for (const name of names) {
              if (!cssClasses.has(name)) cssClasses.set(name, []);
              addLocation(cssClasses.get(name), { file: relative, line: rule.source?.start?.line || 1, detail: rule.selector });
            }
          } catch { /* Unsupported selector syntax is omitted from class links. */ }
        });
        tree.walkDecls((decl) => {
          const line = decl.source?.start?.line || 1;
          if (decl.prop.startsWith('--')) {
            if (tokenFile && unsupportedTokenLine === undefined) {
              const context = [];
              for (let ancestor = decl.parent; ancestor; ancestor = ancestor.parent) {
                if (ancestor.type === 'rule') context.push({ type: 'rule', selector: ancestor.selector });
                else if (ancestor.type === 'atrule') context.push({ type: 'at-rule', name: ancestor.name, params: ancestor.params });
              }
              context.reverse();
              const declaration = { token: decl.prop, value: decl.value, important: decl.important === true, file: relative, line, column: decl.source?.start?.column || 1, context };
              if (isTokenSourceDeclaration(declaration)) declarations.push(declaration);
              else unsupportedTokenLine = line;
            }
            const entry = token(decl.prop);
            if (!entry.value) entry.value = decl.value;
            if (looksLikeColor(decl.prop, decl.value)) entry.kind = 'colors';
            else if (/font|typeface/i.test(decl.prop)) entry.kind = 'typography';
            if (!entry.source) entry.source = relative;
            addLocation(entry.definitions, { file: relative, line, detail: `${decl.parent?.selector || decl.parent?.name || 'CSS'}: ${decl.value}` });
          }
          if (decl.prop.toLowerCase() === 'font-family') {
            const font = item(`font-family:${decl.value}`, { name: decl.value, kind: 'typography', subtype: 'CSS font family', source: relative, value: decl.value });
            addLocation(font.usages, { file: relative, line, detail: decl.parent?.selector || decl.parent?.name || '' });
          }
          tokenReferences(decl.value, file, line);
          for (const match of decl.value.matchAll(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi)) assetReference(file, match[2].trim(), line);
        });
        // Keep the static inventory when token evidence cannot fit the public
        // contract, but never publish a partial set of this file's declarations.
        if (unsupportedTokenLine !== undefined) warnings.push({ file: relative, message: `Token source evidence at line ${unsupportedTokenLine} is unsupported or exceeds declaration/context limits; no token declarations from this file were recorded.` });
        else if (tokenFile) {
          for (const declaration of declarations) tokenSource.declarations.push(declaration);
          tokenFile.status = 'scanned';
        }
      } else if (TEMPLATE_EXTENSIONS.has(ext)) {
        const html = ext === '.php' ? maskPhp(source) : source;
        const tree = parseHtml(html, { sourceCodeLocationInfo: true });
        const visit = (node) => {
          const tag = node.tagName;
          const attrs = Object.fromEntries((node.attrs || []).map((attr) => [attr.name, attr.value]));
          const attrLocation = node.sourceCodeLocation?.attrs || {};
          const isStatic = (name) => {
            const pos = attrLocation[name];
            return !pos || !source.slice(pos.startOffset, pos.endOffset).includes('<?');
          };
          const classes = isStatic('class') ? staticClassNames(attrs.class) : [];
          const configuredTypes = inventoryTypes(classes);
          if (tag && node.sourceCodeLocation && isStatic('id')) countSourceId(attrs.id);
          const roleAttr = (node.attrs || []).find((attr) => attr.name === 'role');
          const roleLocation = node.sourceCodeLocation?.attrs?.role;
          const staticRole = roleAttr && (!roleLocation || !source.slice(roleLocation.startOffset, roleLocation.endOffset).includes('<?')) ? roleAttr.value : '';
          if (tag && node.sourceCodeLocation && (INTRINSIC.has(tag) || tag.includes('-') || (['div', 'span'].includes(tag) && UI_ROLES.has(staticRole)) || configuredTypes.length)) {
            const key = classes.length ? `${tag}.${classes.join('.')}` : tag;
            const name = classes.length ? `<${tag}> · ${classes.join(' ')}` : `<${tag}>`;
            const entry = component('HTML', key, name, 'HTML element');
            addClasses(entry, classes);
            const details = [];
            if (classes.length) details.push(`class=${JSON.stringify(classes.join(' '))}`);
            if (attrs.id && isStatic('id')) details.push(`id=${JSON.stringify(attrs.id)}`);
            if (attrs.type && isStatic('type')) details.push(`type=${JSON.stringify(attrs.type)}`);
            const text = nodeText(node).replace(/\s+/g, ' ').trim();
            const label = (isStatic('aria-label') && attrs['aria-label']) || (isStatic('placeholder') && attrs.placeholder) || text;
            if (label) details.push(`label=${JSON.stringify(label.slice(0, 100))}`);
            const element = { tag, ...(attrs.id && isStatic('id') ? { id: attrs.id } : {}), ...(staticRole ? { role: staticRole } : {}), ...(attrs.type && isStatic('type') ? { type: attrs.type } : {}), ...(classes.length ? { classes } : {}), ...(configuredTypes.length ? { inventoryTypes: configuredTypes } : {}), ...(text && text.length <= 500 ? { text } : {}), ...(attrs.placeholder && isStatic('placeholder') ? { placeholder: attrs.placeholder } : {}), ...(attrs['aria-label'] && isStatic('aria-label') ? { ariaLabel: attrs['aria-label'] } : {}), ...(tag === 'img' && attrs.src && isStatic('src') ? { src: attrs.src } : {}) };
            addLocation(entry.usages, { file: relative, line: node.sourceCodeLocation.startLine, column: node.sourceCodeLocation.startCol, detail: details.join(' · '), element });
            if (attrs.src && isStatic('src')) assetReference(file, attrs.src, node.sourceCodeLocation.startLine);
            if (attrs.href && isStatic('href')) assetReference(file, attrs.href, node.sourceCodeLocation.startLine);
          }
          for (const child of node.childNodes || []) visit(child);
          if (node.content) visit(node.content);
        };
        visit(tree);
      } else {
        const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', ...(ext === '.ts' || ext === '.tsx' ? ['typescript'] : []), 'decorators-legacy', 'importAttributes'] });
        const defaultNames = new Set();
        for (const node of ast.program.body) {
          if (node.type === 'ExportDefaultDeclaration' && node.declaration?.id?.name) defaultNames.add(node.declaration.id.name);
          if (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'Identifier') defaultNames.add(node.declaration.name);
        }
        traverse(ast, {
          FunctionDeclaration(p) {
            const name = p.node.id?.name;
            if (!name || !/^[A-Z]/.test(name) || !containsJsx(p.node.body)) return;
            if (!(p.parentPath.isProgram() || p.parentPath.parentPath?.isProgram())) return;
            const entry = component(relative, defaultNames.has(name) ? 'default' : name, name);
            addLocation(entry.definitions, { file: relative, line: p.node.loc?.start.line || 1, detail: '' });
          },
          VariableDeclarator(p) {
            const name = p.node.id?.name;
            if (!name || !/^[A-Z]/.test(name) || !['ArrowFunctionExpression', 'FunctionExpression'].includes(p.node.init?.type) || !containsJsx(p.node.init.body)) return;
            if (!(p.parentPath.parentPath.isProgram() || p.parentPath.parentPath.parentPath?.isProgram())) return;
            const entry = component(relative, defaultNames.has(name) ? 'default' : name, name);
            addLocation(entry.definitions, { file: relative, line: p.node.loc?.start.line || 1, detail: '' });
          },
          JSXOpeningElement(p) {
            const tag = jsxName(p.node.name);
            if (!tag) return;
            countSourceId(jsxStaticAttribute(p.node.attributes, 'id'));
            const rootName = tag.split('.')[0];
            let entry;
            if (/^[a-z]/.test(tag) && !tag.includes('.')) {
              const role = jsxStaticAttribute(p.node.attributes, 'role');
              if (!INTRINSIC.has(tag) && !tag.includes('-') && !(['div', 'span'].includes(tag) && UI_ROLES.has(role)) && !inventoryTypes(jsxClassNames(p.node.attributes)).length) return;
              entry = component('HTML', tag, `<${tag}>`, 'HTML element');
            } else {
              const binding = p.scope.getBinding(rootName);
              const bindingPath = binding?.path;
              let module = relative;
              let exported = defaultNames.has(rootName) ? 'default' : tag;
              let name = tag;
              if (bindingPath?.isImportSpecifier() || bindingPath?.isImportDefaultSpecifier() || bindingPath?.isImportNamespaceSpecifier()) {
                module = modulePath(file, bindingPath.parent.source.value);
                if (bindingPath.isImportSpecifier()) exported = bindingPath.node.imported.name || bindingPath.node.imported.value;
                else if (bindingPath.isImportDefaultSpecifier()) exported = 'default';
                else exported = tag.split('.').slice(1).join('.') || '*';
                if (exported !== 'default' && exported !== '*') name = exported;
              }
              entry = component(module, exported, name);
            }
            addClasses(entry, jsxClassNames(p.node.attributes));
            let element;
            if (/^[a-z]/.test(tag) && !tag.includes('.')) {
              const id = jsxStaticAttribute(p.node.attributes, 'id');
              const src = tag === 'img' ? jsxStaticAttribute(p.node.attributes, 'src') : '';
              const placeholder = jsxStaticAttribute(p.node.attributes, 'placeholder');
              const ariaLabel = jsxStaticAttribute(p.node.attributes, 'aria-label');
              const role = jsxStaticAttribute(p.node.attributes, 'role');
              const type = jsxStaticAttribute(p.node.attributes, 'type');
              const classes = jsxClassNames(p.node.attributes);
              const configuredTypes = inventoryTypes(classes);
              const text = jsxStaticText(p.parentPath.node.children);
              element = { tag, ...(id ? { id } : {}), ...(role ? { role } : {}), ...(type ? { type } : {}), ...(classes.length ? { classes } : {}), ...(configuredTypes.length ? { inventoryTypes: configuredTypes } : {}), ...(text && text.length <= 500 ? { text } : {}), ...(placeholder ? { placeholder } : {}), ...(ariaLabel ? { ariaLabel } : {}), ...(src ? { src } : {}) };
            }
            addLocation(entry.usages, { file: relative, line: p.node.loc?.start.line || 1, column: (p.node.loc?.start.column ?? 0) + 1, detail: literalProps(p.node.attributes), ...(element ? { element } : {}) });
          },
          StringLiteral(p) {
            const line = p.node.loc?.start.line || 1;
            assetReference(file, p.node.value, line);
            tokenReferences(p.node.value, file, line);
          },
        });
      }
    } catch (error) {
      warnings.push({ file: relative, message: error.message.split('\n')[0] });
    }
  }

  for (const entry of items.values()) {
    if (entry.kind === 'components') {
      if (entry.classNames?.length) {
        entry.styleReferences = [];
        for (const name of entry.classNames) {
          for (const location of cssClasses.get(name) || []) addLocation(entry.styleReferences, location);
        }
        entry.styleReferences.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      }
      const override = config.components?.[entry.name];
      if (override && typeof override === 'object') {
        if (typeof override.description === 'string') entry.description = override.description;
        entry.docs = safeDocs(override.docs);
        if (typeof override.preview === 'string') {
          const previewPath = path.resolve(root, override.preview);
          const inside = path.relative(root, previewPath);
          if (inside && !inside.startsWith('..') && !path.isAbsolute(inside) && fileSet.has(previewPath)) entry.preview = await imageData(previewPath);
          if (!entry.preview) warnings.push({ file: 'ui-sheet.config.json', message: `Preview for ${entry.name} is missing, outside the project, unsupported, or over 1 MB.` });
        }
      }
    }
    entry.usages.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || (a.column || 0) - (b.column || 0));
    entry.definitions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }

  const result = {
    format: 'ui-sheet/v1',
    name: typeof config.name === 'string' && config.name.trim() ? config.name.trim() : path.basename(root),
    generatedAt: new Date().toISOString(),
    scannedFiles,
    scanScope: includes.map((selected) => rel(root, selected) || '.'),
    sourceExclusions: excludes.length,
    warnings,
    tokenSource,
    items: [...items.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
  };
  // Internal evidence for this scan only; do not serialize IDs from otherwise
  // uncollected page elements into the report.
  Object.defineProperty(result, '_sourceIdCounts', { value: sourceIdCounts, enumerable: false });
  Object.defineProperty(result, '_sourceHashes', { value: sourceHashes, enumerable: false });
  return result;
}
