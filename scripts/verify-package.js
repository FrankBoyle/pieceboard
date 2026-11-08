import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check with npm run test:package.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-package-'));
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const packed = JSON.parse(runNpm(['pack', '--json', '--pack-destination', tmp], repo));
  const tarball = path.join(tmp, packed[0].filename);
  const included = new Set(packed[0].files.map((entry) => entry.path));
  for (const file of ['src/layout-audit.js', 'src/layout-check.js', 'docs/layout-checks.md', 'schemas/layout-v1.schema.json', 'schemas/layout-pages-v1.schema.json', 'schemas/layout-check-v1.schema.json', 'scripts/demo-layout.js', 'examples/layout-review/index.html', 'examples/layout-review/approved-mark.svg', 'examples/layout-review/ui-sheet.config.json']) assert.ok(included.has(file), `package is missing ${file}`);
  for (const file of ['src/token-baselines.js', 'docs/token-contracts.md', 'schemas/token-source-v1.schema.json', 'schemas/tokens-v1.schema.json', 'schemas/token-baselines-v1.schema.json', 'schemas/token-check-v1.schema.json']) assert.ok(included.has(file), `package is missing ${file}`);
  for (const file of ['SECURITY.md', 'CHANGELOG.md', 'docs/privacy.md', 'schemas/finding-locations-v1.schema.json', 'schemas/element-appearances-v1.schema.json', 'schemas/element-locations-v1.schema.json', 'src/finding-locations.js', 'src/element-queries.js', 'docs/images/ui-groups.png']) assert.ok(included.has(file), `package is missing ${file}`);
  for (const file of ['schemas/report-v1.schema.json', 'schemas/check-v1.schema.json', 'schemas/elements-v1.schema.json', 'schemas/baselines-v4.schema.json', 'schemas/element-baselines-v2.schema.json', 'schemas/error-v1.schema.json', 'docs/schema.md', 'docs/element-groups.md', 'scripts/demo-elements.js', 'examples/ui-groups/index.html', 'scripts/evaluate-independent.js', 'evaluation/independent-button-cases.json']) assert.ok(included.has(file), `package is missing ${file}`);
  for (const file of ['README.md', 'PROJECT_PLAN.md', 'vite.js', 'docs/data-format.md', 'docs/images/pieceboard-logo.png', 'docs/images/pieceboard-logo.svg', 'docs/images/pieceboard-mark.svg', 'docs/images/button-review.png', 'docs/images/button-zoom.png', 'docs/images/approve-appearance.png', 'docs/images/cross-page.png', 'evaluation/README.md', 'evaluation/browser-holdout.json', 'evaluation/browser-evaluate.js', 'evaluation/results/browser-fe560ff.json', 'examples/button-review/index.html', 'examples/cross-page/profile.html', 'scripts/evaluate-browser.js', 'scripts/evaluate-public-source.js']) assert.ok(included.has(file), `package is missing ${file}`);
  for (const file of ['src/launcher.js', 'src/launcher/index.html', 'src/launcher/app.js', 'src/launcher/style.css', 'docs/agent-quickstart.md']) assert.ok(included.has(file), `package is missing ${file}`);
  for (const file of ['src/site-discovery.js', 'schemas/site-scan-v1.schema.json']) assert.ok(included.has(file), `package is missing ${file}`);
  for (const file of ['src/choice-board.js', 'src/choice-board-viewer.js', 'src/choice-board.css']) assert.ok(included.has(file), `package is missing ${file}`);
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const packageVersion = manifest.version;
  assert.equal(manifest.publishConfig?.tag, 'latest', 'releases must default to the main npm package');
  const readme = await fs.readFile(path.join(repo, 'README.md'), 'utf8');
  assert.ok(readme.includes(`src="https://raw.githubusercontent.com/FrankBoyle/pieceboard/v${packageVersion}/docs/images/pieceboard-logo.png"`), 'npm README must display this release\'s logo');
  assert.equal([...included].some((file) => file.startsWith('.ui-sheet') || file.startsWith('node_modules/')), false, 'local reports, browser state, and dependencies are not packed');
  const demoExamples = new Set(['button-review', 'cross-page', 'harbor', 'layout-review', 'ui-groups']);
  assert.equal([...included].filter((file) => file.startsWith('examples/')).every((file) => demoExamples.has(file.split('/')[1])), true, 'only the explicitly shipped demo projects are packed');
  for (const [label, source] of [['checkout', repo], ['tarball', tarball]]) {
    const consumer = path.join(tmp, `consumer-${label}`);
    await fs.mkdir(consumer);
    await fs.writeFile(path.join(consumer, 'package.json'), '{"name":"ui-sheet-consumer-smoke","private":true}');
    await fs.writeFile(path.join(consumer, 'App.jsx'), 'export function App() { return <button>Go</button>; }');
    await fs.writeFile(path.join(consumer, 'theme.css'), ':root { --accent: #123456; }');
    runNpm(['install', '--save-dev', '--ignore-scripts', '--no-audit', '--no-fund', source], consumer);
    assert.match(runNpm(['exec', '--', 'pieceboard', '--help'], consumer), /--site/);
    await fs.access(path.join(consumer, 'node_modules', 'pieceboard', 'docs', 'images', 'button-review.png'));
    await fs.access(path.join(consumer, 'node_modules', 'pieceboard', 'docs', 'images', 'pieceboard-mark.svg'));
    await fs.access(path.join(consumer, 'node_modules', 'pieceboard', 'docs', 'images', 'pieceboard-logo.svg'));
    const vitePlugin = await import(pathToFileURL(path.join(consumer, 'node_modules', 'pieceboard', 'vite.js')).href);
    assert.equal(typeof vitePlugin.uiSheetSource, 'function');
    const launcherModule = await import(pathToFileURL(path.join(consumer, 'node_modules', 'pieceboard', 'src', 'launcher.js')).href);
    const launcher = await launcherModule.startLauncher({ workspace: consumer });
    try {
      const page = await fetch(launcher.url);
      assert.equal(page.status, 200);
      const setupHtml = await page.text();
      assert.match(setupHtml, /Choose what to look at/);
      assert.match(setupHtml, /What would you like help with\?/);
      assert.match(setupHtml, /Make button labels searchable/);
      assert.equal((await fetch(new URL('app.js', launcher.url))).status, 200);
    } finally { await launcher.close(); }
    runNpm(['exec', '--', 'pieceboard', 'scan', '.'], consumer);
    assert.equal(JSON.parse(await fs.readFile(path.join(consumer, '.ui-sheet', '.ui-sheet-scan.json'), 'utf8')).status, 'completed');
    const report = JSON.parse(await fs.readFile(path.join(consumer, '.ui-sheet', 'ui-sheet.json'), 'utf8'));
    assert.ok(report.items.some((entry) => entry.name === '<button>'));
    const reportHtml = await fs.readFile(path.join(consumer, '.ui-sheet', 'index.html'), 'utf8');
    assert.match(reportHtml, /id="focus-review"/, 'the installed package must include focused review');
    const mark = await fs.readFile(path.join(consumer, 'node_modules', 'pieceboard', 'docs', 'images', 'pieceboard-mark.svg'), 'utf8');
    const logo = await fs.readFile(path.join(consumer, 'node_modules', 'pieceboard', 'docs', 'images', 'pieceboard-logo.png'));
    const embeddedMark = mark.replace('<svg ', '<svg class="brand-mark" aria-hidden="true" ')
      .replace('href="pieceboard-logo.png"', `href="data:image/png;base64,${logo.toString('base64')}"`);
    assert.ok(reportHtml.includes(embeddedMark), 'report must embed the exact packaged logo inside its compact mark');
    const catalog = JSON.parse(runNpm(['exec', '--', 'ui-sheet', 'catalog', '.ui-sheet', '--kind', 'components', '--search', 'button'], consumer));
    assert.ok(catalog.entries.some((entry) => entry.name === '<button>'));
    const tokens = JSON.parse(runNpm(['exec', '--', 'ui-sheet', 'tokens', '.ui-sheet', '--name', '--accent'], consumer));
    assert.equal(tokens.total, 1);
    runNpm(['exec', '--', 'ui-sheet', 'token-baseline', '.ui-sheet', '--file', 'approved-tokens.json', '--declaration', tokens.entries[0].id, '--reason', 'Package smoke approval'], consumer);
    const tokenCheck = JSON.parse(runNpm(['exec', '--', 'ui-sheet', 'check-tokens', '.ui-sheet', '--file', 'approved-tokens.json', '--json', '--strict-coverage', '--fail-on-findings'], consumer));
    assert.equal(tokenCheck.matched, 1);
    assert.equal(tokenCheck.coverage, 'observed');
    runNpm(['exec', '--', 'ui-sheet', 'install-skill', '--agent', 'codex'], consumer);
    await fs.access(path.join(consumer, '.agents', 'skills', 'ui-consistency', 'SKILL.md'));
    await fs.writeFile(path.join(consumer, 'preview.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
    await fs.writeFile(path.join(consumer, 'choices.json'), JSON.stringify({ title: 'Choose a style', choices: [{ question: 'Which?', options: [{ label: 'First', image: 'preview.png' }, { label: 'Second' }] }] }));
    runNpm(['exec', '--', 'pieceboard', 'choices', '--manifest', 'choices.json', '--out', 'choices.html'], consumer);
    assert.match(await fs.readFile(path.join(consumer, 'choices.html'), 'utf8'), /Choose an observed option/);
    await fs.writeFile(path.join(consumer, 'previews.json'), JSON.stringify({ previews: [{ item: 'component:HTML#button', image: 'preview.png', source: { file: 'App.jsx', line: 1 }, label: 'Example' }] }));
    runNpm(['exec', '--', 'ui-sheet', 'add-previews', '.ui-sheet', '--manifest', 'previews.json'], consumer);
    const updated = JSON.parse(await fs.readFile(path.join(consumer, '.ui-sheet', 'ui-sheet.json'), 'utf8'));
    assert.equal(updated.captureSummary.captured, 1);
  }
  console.log('Installed and ran Pieceboard from both the checkout and a package tarball.');
} finally {
  // Only remove the exact temporary directory created by this check.
  const relative = path.relative(os.tmpdir(), tmp);
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && relative.startsWith('ui-sheet-package-')) {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
