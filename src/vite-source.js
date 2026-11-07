import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import MagicString from 'magic-string';

const traverse = traverseModule.default || traverseModule;
const MARKED_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'header', 'aside', 'nav', 'footer']);
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Opt-in, development-server-only source markers for supported JSX controls. */
export function uiSheetSource({ projectRoot } = {}) {
  if (projectRoot !== undefined && (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot))) throw new Error('Pieceboard projectRoot must be an absolute path.');
  let root;
  return {
    name: 'ui-sheet-source',
    enforce: 'pre',
    apply: 'serve',
    async configResolved(config) {
      root = undefined;
      if (config.command !== 'serve') return;
      root = await fs.realpath(projectRoot || config.root);
    },
    async transform(code, id) {
      if (!root || typeof code !== 'string' || Buffer.byteLength(code, 'utf8') > MAX_SOURCE_BYTES || typeof id !== 'string' || id.includes('?') || !/\.[jt]sx$/i.test(id)) return null;
      let file;
      try { file = await fs.realpath(id); } catch { return null; }
      const relative = path.relative(root, file);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).some((part) => part.toLowerCase() === 'node_modules')) return null;
      // If another transform changed the source first, its locations cannot be
      // safely claimed as locations in the current file on disk.
      let disk;
      try { disk = await fs.readFile(file, 'utf8'); } catch { return null; }
      if (disk !== code) return null;
      let ast;
      try { ast = parse(code, { sourceType: 'unambiguous', plugins: ['jsx', ...(/\.tsx$/i.test(file) ? ['typescript'] : []), 'decorators-legacy', 'importAttributes'] }); }
      catch { return null; }
      const hash = createHash('sha256').update(code).digest('hex');
      const sourceFile = relative.split(path.sep).join('/');
      const output = new MagicString(code);
      let inserted = 0;
      traverse(ast, {
        JSXOpeningElement(p) {
          const node = p.node;
          const tag = node.name.type === 'JSXIdentifier' ? node.name.name : '';
          if (!MARKED_TAGS.has(tag) || !node.loc || !Number.isInteger(node.end) || node.attributes.some((attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === 'data-ui-sheet-source')) return;
          const marker = JSON.stringify({ v: 1, file: sourceFile, line: node.loc.start.line, column: node.loc.start.column + 1, sha256: hash });
          const offset = node.end - (node.selfClosing ? 2 : 1);
          output.appendLeft(offset, ` data-ui-sheet-source={${JSON.stringify(marker)}}`);
          inserted++;
        },
      });
      return inserted ? { code: output.toString(), map: output.generateMap({ source: file, includeContent: false, hires: true }) } : null;
    },
  };
}
