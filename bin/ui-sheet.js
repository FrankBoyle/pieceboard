#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { scanProject } from '../src/scan.js';
import { writeReport } from '../src/report.js';
import { beginReportScan } from '../src/scan-status.js';
import { observePage } from '../src/observe.js';
import { capturePage } from '../src/capture.js';
import { addPreviews } from '../src/manual-previews.js';
import { applyDecisions, setDecision } from '../src/decisions.js';
import { checkReport, compareChecks } from '../src/check.js';
import { catalogReport } from '../src/catalog.js';
import { installSkill } from '../src/install-skill.js';
import { readStorageState, saveBrowserState } from '../src/auth.js';
import { initProject, readProjectConfig } from '../src/config.js';
import { ensureDistinctBaselineScopes, readBaselines, setBaseline } from '../src/baselines.js';
import { listAppearances } from '../src/appearances.js';
import { parseViewport, validateColorScheme, validateMaskSelectors, validatePixelRatio } from '../src/context.js';
import { inspectSourceRevision } from '../src/provenance.js';
import { locateButtons } from '../src/locations.js';
import { analyzeAcrossPages } from '../src/cross-page.js';
import { readElementBaselines, setElementBaseline } from '../src/element-baselines.js';
import { listElementAppearances, locateElements } from '../src/element-queries.js';
import { listFindingLocations } from '../src/finding-locations.js';
import { listTokens, setTokenBaseline, checkTokens } from '../src/token-baselines.js';
import { checkLayout } from '../src/layout-check.js';
import { DEFAULT_RESPONSIVE_VIEWPORTS, validateResponsiveViewports } from '../src/responsive-audit.js';
import { startLauncher, openLauncher } from '../src/launcher.js';
import { writeChoiceBoard } from '../src/choice-board.js';

async function configuredProjectFile(root, input, label) {
  const realRoot = await fs.realpath(root);
  const realFile = await fs.realpath(path.resolve(root, input));
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Configured ${label} must be inside the project.`);
  return realFile;
}

const help = `Pieceboard — a visual inventory for your UI

Usage:
  pieceboard start [--workspace directory] [--browser path] [--no-open]
  pieceboard choices --manifest choices.json --out review.html
  pieceboard scan [project-directory] [--out output-directory] [--include path ...] [--exclude path ...] [--page URL ...] [--capture] [--responsive] [--responsive-viewport WIDTHxHEIGHT ...] [--cross-page] [--viewport WIDTHxHEIGHT] [--color-scheme light|dark] [--pixel-ratio 1|2|3|4] [--mask-selector CSS ...] [--browser path] [--storage-state file] [--baseline file] [--decisions file]
  pieceboard init [project-directory]
  pieceboard auth --url URL --out state.json [--browser path]
  pieceboard add-previews report-directory --manifest previews.json
  pieceboard decision report-directory --file decisions.json --finding ID --status STATUS --reason TEXT
  pieceboard baseline report-directory --file baselines.json (--finding ID --example common|outlier | --observation ID [--page N] [--cross-page]) --reason TEXT
  pieceboard element-baseline report-directory --file element-baselines.json --observation TAG:INDEX [--page N] [--cross-page] --reason TEXT
  pieceboard check report-directory [--json] [--fail-on-findings] [--strict-coverage] [--previous report-directory] [--fail-on-new]
  pieceboard tokens report-directory [--name TOKEN] [--file source.css] [--limit N]
  pieceboard token-baseline report-directory --file token-baselines.json --declaration ID --reason TEXT
  pieceboard check-tokens report-directory --file token-baselines.json [--json] [--fail-on-findings] [--strict-coverage]
  pieceboard check-layout report-directory [--json] [--fail-on-findings] [--strict-coverage]
  pieceboard catalog report-directory [--kind KIND] [--search TEXT] [--id ID] [--limit N]
  pieceboard appearances report-directory [--page N] [--limit N]
  pieceboard element-appearances report-directory [--page N] [--limit N]
  pieceboard locations report-directory --family NAME [--variant NAME] [--limit N]
  pieceboard element-locations report-directory --family NAME [--variant NAME] [--type TYPE] [--limit N]
  pieceboard finding-locations report-directory --finding ID [--side common|outlier] [--limit N]
  pieceboard install-skill --agent codex|claude [--project directory]
  pieceboard --help

Scans JSX/TSX, HTML/PHP templates, CSS, images, and fonts without running them.
start opens a local page for choosing projects and creating a report.
choices creates a portable A/B review from deliberately paired examples.
The legacy ui-sheet command remains available for existing integrations.
The default project is the current directory; the default output is .ui-sheet.
Repeat --include to scan only specific files or directories within the project.
Repeat --exclude to omit additional project-relative files or directories.
Repeat --page to compare static element IDs with selected public HTML pages.
--capture takes real screenshots from the page using an isolated browser session.
--responsive inspects each selected page at multiple widths for possible overflow, clipped text, and overlapping text.
Repeat --responsive-viewport WIDTHxHEIGHT to choose sizes for the responsive audit.
--cross-page compares explicitly grouped button appearances across selected pages.
--viewport and --color-scheme select the browser context for captured scans.
--pixel-ratio selects capture density from 1 to 4; the default is 2.
--mask-selector masks matching elements in screenshots; repeat for multiple CSS selectors.
--browser optionally selects a Chromium-compatible browser executable.
add-previews attaches screenshots captured separately, including in a signed-in session.
decision records an intentional, needs-fix, deferred, or false-positive review.
--decisions reapplies a decision file to a new captured report.
baseline approves one observed appearance for a page or explicit cross-page group, viewport, and theme.
--baseline uses approved appearances in a new captured scan.
--element-baseline supplies a separate approved reference file for configured UI groups.
check summarizes a captured report for people, coding agents, or CI.
tokens lists source CSS declarations with separate selector and at-rule contexts.
token-baseline approves one unambiguous declaration from a completed source scan.
check-tokens compares explicit source declarations, without resolving the CSS cascade.
check-layout summarizes configured spacing, text clearance, gaps, and logo-source checks.
catalog returns compact, image-free source references as JSON.
appearances returns observed button styles and examples as image-free JSON.
locations lists observed instances of a button family across selected pages.
install-skill copies the bundled instructions into a project without overwriting an existing skill.
auth opens a separate browser for user-led sign-in and saves the selected site's state locally.
--storage-state explicitly supplies that state for captured scans.
init creates a project configuration without overwriting an existing one.
`;

async function main(args) {
  const helpRequested = args.some((argument, index) => ['--help', '-h'].includes(argument)
    && !(args[0] === 'tokens' && index > 0 && args[index - 1] === '--name'));
  if (args.length === 0 || helpRequested) {
    console.log(help);
    return;
  }
  if (args[0] === 'choices') {
    const values = {};
    for (let i = 1; i < args.length; i++) {
      const option = args[i];
      if (!['--manifest', '--out'].includes(option) || values[option] || !args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`Unknown, repeated, or incomplete choices option: ${option}`);
      values[option] = args[++i];
    }
    if (!values['--manifest'] || !values['--out']) throw new Error('choices requires --manifest and --out.');
    const result = await writeChoiceBoard(values['--manifest'], values['--out']);
    console.log(`Created ${result.choices} A/B choice(s). Open ${result.output}`);
    return;
  }
  if (args[0] === 'start') {
    let workspace;
    let browserPath;
    let noOpen = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--no-open' && !noOpen) noOpen = true;
      else if (args[i] === '--workspace' && !workspace && args[i + 1] && !args[i + 1].startsWith('-')) workspace = path.resolve(args[++i]);
      else if (args[i] === '--browser' && !browserPath && args[i + 1] && !args[i + 1].startsWith('-')) browserPath = path.resolve(args[++i]);
      else throw new Error(`Unknown or repeated start option: ${args[i]}`);
    }
    if (!workspace) {
      const manifest = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
      workspace = manifest?.name === 'pieceboard' ? path.dirname(process.cwd()) : process.cwd();
    }
    const launcher = await startLauncher({ workspace, browserPath });
    console.log(`Pieceboard is running on your computer. Open ${launcher.url}`);
    console.log('Press Ctrl+C in this terminal when you are finished.');
    if (!noOpen) openLauncher(launcher.url);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      console.log('Closing Pieceboard after any active scan finishes…');
      await launcher.close();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return;
  }
  if (args[0] === 'check-layout') {
    let reportDir;
    const flags = new Set();
    for (const argument of args.slice(1)) {
      if (['--json', '--fail-on-findings', '--strict-coverage'].includes(argument)) {
        if (flags.has(argument)) throw new Error(`${argument} can be supplied once.`);
        flags.add(argument);
      } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${argument}`);
      else reportDir = argument;
    }
    if (!reportDir) throw new Error('check-layout requires a report directory.');
    const result = await checkLayout(reportDir);
    if (flags.has('--json')) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.counts.rules} layout check(s): ${result.counts.passed} passed, ${result.counts.findings} findings, ${result.counts.incomplete} incomplete. Coverage: ${result.coverage}.`);
    if (flags.has('--strict-coverage') && result.coverage !== 'observed') process.exitCode = 2;
    else if (flags.has('--fail-on-findings') && result.counts.findings) process.exitCode = 1;
    return;
  }
  if (['tokens', 'token-baseline', 'check-tokens'].includes(args[0])) {
    const command = args[0];
    const options = command === 'tokens' ? { '--name': 'name', '--file': 'file', '--limit': 'limit' }
      : command === 'token-baseline' ? { '--file': 'file', '--declaration': 'declarationId', '--reason': 'reason' }
        : { '--file': 'file' };
    const flags = command === 'check-tokens' ? new Set(['--json', '--fail-on-findings', '--strict-coverage']) : new Set();
    const values = {};
    const selectedFlags = new Set();
    let reportDir;
    for (let i = 1; i < args.length; i++) {
      const argument = args[i];
      if (Object.hasOwn(options, argument)) {
        const key = options[argument];
        // Custom property names start with --; consume the value of --name explicitly.
        if (!args[i + 1] || (key !== 'name' && args[i + 1].startsWith('-')) || values[key] !== undefined) throw new Error(`${argument} requires one value.`);
        values[key] = args[++i];
      } else if (flags.has(argument)) {
        if (selectedFlags.has(argument)) throw new Error(`${argument} can be supplied once.`);
        selectedFlags.add(argument);
      } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${argument}`);
      else reportDir = argument;
    }
    if (!reportDir) throw new Error(`${command} requires a report directory.`);
    if (command === 'tokens') {
      if (values.limit !== undefined) {
        if (!/^\d+$/.test(values.limit)) throw new Error('--limit must be an integer between 1 and 200.');
        values.limit = Number(values.limit);
      }
      console.log(JSON.stringify(await listTokens(reportDir, values), null, 2));
    } else if (command === 'token-baseline') {
      if (!values.file || !values.declarationId || !values.reason) throw new Error('token-baseline requires --file, --declaration, and --reason.');
      const result = await setTokenBaseline(reportDir, values);
      console.log(`Recorded approved token declaration ${result.id}. Run a new source scan, then check-tokens to compare it.`);
    } else {
      if (!values.file) throw new Error('check-tokens requires --file token-baselines.json.');
      const result = await checkTokens(reportDir, values);
      if (selectedFlags.has('--json')) console.log(JSON.stringify(result, null, 2));
      else console.log(`${result.total} approved token declaration(s): ${result.matched} matched, ${result.changed} changed, ${result.missing} missing, ${result.ambiguous} ambiguous, ${result.unscanned} unscanned. Coverage: ${result.coverage}.`);
      if (selectedFlags.has('--strict-coverage') && result.coverage !== 'observed') process.exitCode = 2;
      else if (selectedFlags.has('--fail-on-findings') && result.changed + result.missing > 0) process.exitCode = 1;
    }
    return;
  }
  if (args[0] === 'add-previews') {
    let reportDir;
    let manifest;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--manifest') {
        if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--manifest requires a JSON file.');
        manifest = args[++i];
      } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${args[i]}`);
      else reportDir = args[i];
    }
    if (!reportDir || !manifest) throw new Error('add-previews requires a report directory and --manifest.');
    const result = await addPreviews(reportDir, manifest);
    console.log(`Added ${result.added} previews; the sheet now contains ${result.total}.`);
    console.log(`Open ${path.join(path.resolve(reportDir), 'index.html')}`);
    return;
  }
  if (args[0] === 'decision') {
    let reportDir;
    const values = {};
    const options = { '--file': 'file', '--finding': 'findingId', '--status': 'status', '--reason': 'reason' };
    for (let i = 1; i < args.length; i++) {
      if (Object.hasOwn(options, args[i])) {
        const key = options[args[i]];
        if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${args[i]} requires a value.`);
        if (values[key] !== undefined) throw new Error(`${args[i]} can be supplied once.`);
        values[key] = args[++i];
      } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${args[i]}`);
      else reportDir = args[i];
    }
    if (!reportDir || !values.file || !values.findingId || !values.status || !values.reason) throw new Error('decision requires a report directory, --file, --finding, --status, and --reason.');
    const result = await setDecision(reportDir, values);
    console.log(`Recorded ${result.status} for finding ${result.findingId}.`);
    console.log(`Updated ${path.join(path.resolve(reportDir), 'index.html')}`);
    return;
  }
  if (args[0] === 'baseline' || args[0] === 'element-baseline') {
    const elementApproval = args[0] === 'element-baseline';
    let reportDir;
    const values = {};
    const options = { '--file': 'file', '--finding': 'findingId', '--example': 'example', '--observation': 'observationId', '--page': 'pageIndex', '--reason': 'reason' };
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--cross-page') {
        if (values.crossPage) throw new Error('--cross-page can be supplied once.');
        values.crossPage = true;
      } else if (Object.hasOwn(options, args[i])) {
        const key = options[args[i]];
        if (!args[i + 1] || args[i + 1].startsWith('-') || values[key] !== undefined) throw new Error(`${args[i]} requires one value.`);
        values[key] = args[++i];
      } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${args[i]}`);
      else reportDir = args[i];
    }
    if (!reportDir || !values.file || !values.reason || (!values.findingId && !values.observationId)) throw new Error('baseline requires a report directory, --file, a finding or observation, and --reason.');
    if (values.pageIndex !== undefined) {
      if (!/^\d+$/.test(values.pageIndex)) throw new Error('--page must be a positive integer.');
      values.pageIndex = Number(values.pageIndex);
    }
    if (elementApproval && (!values.observationId || values.findingId || values.example)) throw new Error('element-baseline requires an observed configured element ID, without --finding or --example.');
    const result = elementApproval ? await setElementBaseline(reportDir, values) : await setBaseline(reportDir, values);
    console.log(`Recorded approved appearance ${result.id}. Run a new scan with ${elementApproval ? '--element-baseline' : '--baseline'} to apply it.`);
    return;
  }
  if (args[0] === 'check') {
    let reportDir;
    let json = false;
    let failOnFindings = false;
    let strictCoverage = false;
    let previousDir;
    let failOnNew = false;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--json') json = true;
      else if (arg === '--fail-on-findings') failOnFindings = true;
      else if (arg === '--strict-coverage') strictCoverage = true;
      else if (arg === '--fail-on-new') failOnNew = true;
      else if (arg === '--previous') {
        if (!args[i + 1] || args[i + 1].startsWith('-') || previousDir) throw new Error('--previous requires one report directory.');
        previousDir = args[++i];
      }
      else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${arg}`);
      else reportDir = arg;
    }
    if (!reportDir) throw new Error('check requires a report directory.');
    if (failOnNew && !previousDir) throw new Error('--fail-on-new requires --previous.');
    const result = await checkReport(reportDir);
    if (previousDir) result.comparison = compareChecks(result, await checkReport(previousDir));
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.actionable} unreviewed or needs-fix finding(s) across ${result.pages.length} page(s). Coverage: ${result.coverage}.`);
      if (result.coverage !== 'observed') console.log('Some source, group, or preview evidence is incomplete; see the JSON summary or visual report.');
      if (result.scanStatus !== 'completed') console.log('The report has no verified scan completion record; regenerate it with the CLI.');
      if (result.pages.some((page) => page.findingIdentity !== 'ui-sheet/button-finding-v6') || (result.crossPage && result.crossPage.findingIdentity !== 'ui-sheet/cross-page-finding-v5')) console.log('The report uses older comparison measurements; regenerate it before relying on coverage.');
      if (result.sourceWarnings === null) console.log('Source warning information is missing; regenerate the report.');
      else if (result.sourceWarnings) console.log(`${result.sourceWarnings} source scan warning(s); see the visual report for details.`);
      if (result.decisions?.stale) console.log(`${result.decisions.stale} saved decision(s) no longer match this report.`);
      if (result.comparison) console.log(`${result.comparison.newActionable} new actionable finding(s). Comparison: ${result.comparison.status}; ${result.comparison.unverifiable} current and ${result.comparison.unverifiablePrevious} previous unanchored finding(s) cannot be compared reliably.`);
    }
    if (strictCoverage && result.coverage !== 'observed') process.exitCode = 2;
    else if (failOnNew && result.comparison.status === 'incomplete') process.exitCode = 2;
    else if (failOnNew && result.comparison.newActionable) process.exitCode = 1;
    else if (failOnFindings && result.actionable) process.exitCode = 1;
    return;
  }
  if (args[0] === 'catalog') {
    let reportDir;
    const values = {};
    const options = { '--kind': 'kind', '--search': 'search', '--id': 'id', '--limit': 'limit' };
    for (let i = 1; i < args.length; i++) {
      if (Object.hasOwn(options, args[i])) {
        const key = options[args[i]];
        if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${args[i]} requires a value.`);
        if (values[key] !== undefined) throw new Error(`${args[i]} can be supplied once.`);
        values[key] = args[++i];
      } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${args[i]}`);
      else reportDir = args[i];
    }
    if (!reportDir) throw new Error('catalog requires a report directory.');
    if (values.limit !== undefined) {
      if (!/^\d+$/.test(values.limit)) throw new Error('--limit must be an integer between 1 and 200.');
      values.limit = Number(values.limit);
    }
    console.log(JSON.stringify(await catalogReport(reportDir, values), null, 2));
    return;
  }
  if (args[0] === 'finding-locations') {
    let reportDir;
    const values = {};
    const options = { '--finding': 'findingId', '--side': 'side', '--limit': 'limit' };
    for (let i = 1; i < args.length; i++) {
      if (Object.hasOwn(options, args[i])) {
        const key = options[args[i]];
        if (!args[i + 1] || args[i + 1].startsWith('-') || values[key] !== undefined) throw new Error(`${args[i]} requires one value.`);
        values[key] = args[++i];
      } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${args[i]}`);
      else reportDir = args[i];
    }
    if (!reportDir || !values.findingId) throw new Error('finding-locations requires a report and --finding ID.');
    if (values.limit !== undefined) {
      if (!/^\d+$/.test(values.limit)) throw new Error('--limit must be a positive integer.');
      values.limit = Number(values.limit);
    }
    console.log(JSON.stringify(await listFindingLocations(reportDir, values), null, 2));
    return;
  }
  if (args[0] === 'appearances' || args[0] === 'element-appearances') {
    let reportDir;
    const values = {};
    const options = { '--page': 'page', '--limit': 'limit' };
    for (let i = 1; i < args.length; i++) {
      if (Object.hasOwn(options, args[i])) {
        const key = options[args[i]];
        if (!args[i + 1] || !/^\d+$/.test(args[i + 1]) || values[key] !== undefined) throw new Error(`${args[i]} requires one positive integer.`);
        values[key] = Number(args[++i]);
      } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${args[i]}`);
      else reportDir = args[i];
    }
    if (!reportDir) throw new Error('appearances requires a report directory.');
    console.log(JSON.stringify(await (args[0] === 'element-appearances' ? listElementAppearances : listAppearances)(reportDir, values), null, 2));
    return;
  }
  if (args[0] === 'locations' || args[0] === 'element-locations') {
    let reportDir;
    const values = {};
    const options = { '--family': 'family', '--variant': 'variant', '--limit': 'limit' };
    if (args[0] === 'element-locations') options['--type'] = 'type';
    for (let i = 1; i < args.length; i++) {
      if (Object.hasOwn(options, args[i])) {
        const key = options[args[i]];
        if (!args[i + 1] || args[i + 1].startsWith('-') || values[key] !== undefined) throw new Error(`${args[i]} requires one value.`);
        values[key] = args[++i];
      } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
      else if (reportDir) throw new Error(`Unexpected argument: ${args[i]}`);
      else reportDir = args[i];
    }
    if (!reportDir || !values.family) throw new Error('locations requires a report directory and --family.');
    if (values.limit !== undefined) {
      if (!/^\d+$/.test(values.limit)) throw new Error('--limit must be between 1 and 200.');
      values.limit = Number(values.limit);
    }
    console.log(JSON.stringify(await (args[0] === 'element-locations' ? locateElements : locateButtons)(reportDir, values), null, 2));
    return;
  }
  if (args[0] === 'install-skill') {
    let agent;
    let project = '.';
    let projectSet = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--agent') {
        if (!args[i + 1] || args[i + 1].startsWith('-') || agent) throw new Error('--agent requires one value.');
        agent = args[++i];
      } else if (args[i] === '--project') {
        if (!args[i + 1] || args[i + 1].startsWith('-') || projectSet) throw new Error('--project requires one directory.');
        project = args[++i];
        projectSet = true;
      } else throw new Error(`Unknown option: ${args[i]}`);
    }
    if (!agent) throw new Error('install-skill requires --agent codex or claude.');
    const result = await installSkill(project, agent);
    console.log(`${result.installed ? 'Installed' : 'Already installed'}: ${result.path}`);
    return;
  }
  if (args[0] === 'auth') {
    const values = {};
    const options = { '--url': 'url', '--out': 'out', '--browser': 'browserPath' };
    for (let i = 1; i < args.length; i++) {
      if (!Object.hasOwn(options, args[i])) throw new Error(`Unknown option: ${args[i]}`);
      const key = options[args[i]];
      if (!args[i + 1] || args[i + 1].startsWith('-') || values[key] !== undefined) throw new Error(`${args[i]} requires one value.`);
      values[key] = args[++i];
    }
    if (!values.url || !values.out) throw new Error('auth requires --url and --out.');
    if (!process.stdin.isTTY) throw new Error('auth requires an interactive terminal so you can sign in yourself.');
    const result = await saveBrowserState(values.url, values.out, {
      browserPath: values.browserPath ? path.resolve(values.browserPath) : undefined,
      waitForUser: async () => {
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try { await prompt.question('Sign in in the opened browser, return to the requested site, then press Enter here. '); }
        finally { prompt.close(); }
      },
    });
    console.log(`Saved browser state for ${result.origin} to ${result.path}. Keep this file private and out of version control.`);
    return;
  }
  if (args[0] === 'init') {
    if (args.length > 2 || args[1]?.startsWith('-')) throw new Error('init accepts at most one project directory.');
    const result = await initProject(args[1] || '.');
    console.log(`Created ${result.file}. Add page URLs before using --capture.`);
    return;
  }
  if (args[0] !== 'scan') throw new Error(`Unknown command: ${args[0]}\n\n${help}`);
  let project;
  let output;
  const pages = [];
  let capture = false;
  let responsive = false;
  const responsiveViewports = [];
  let crossPage = false;
  let browserPath;
  let decisionFile;
  let storageStateFile;
  let baselineFile;
  let elementBaselineFile;
  let viewport;
  let colorScheme;
  let pixelRatio;
  const maskSelectors = [];
  const includes = [];
  const excludes = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--out') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--out requires a directory.');
      output = args[++i];
    } else if (args[i] === '--include') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--include requires a project-relative path.');
      includes.push(args[++i]);
    } else if (args[i] === '--exclude') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--exclude requires a project-relative path.');
      if (excludes.length >= 20) throw new Error('--exclude accepts at most 20 paths.');
      excludes.push(args[++i]);
    } else if (args[i] === '--page') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--page requires an HTTP(S) URL.');
      const page = args[++i];
      if (pages.includes(page)) throw new Error('The same --page cannot be supplied twice.');
      pages.push(page);
    } else if (args[i] === '--capture') {
      capture = true;
    } else if (args[i] === '--responsive') {
      if (responsive) throw new Error('--responsive can be supplied once.');
      responsive = true;
    } else if (args[i] === '--responsive-viewport') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--responsive-viewport requires WIDTHxHEIGHT.');
      responsiveViewports.push(parseViewport(args[++i]));
      validateResponsiveViewports(responsiveViewports);
    } else if (args[i] === '--cross-page') {
      crossPage = true;
    } else if (args[i] === '--viewport') {
      if (!args[i + 1] || viewport) throw new Error('--viewport requires one WIDTHxHEIGHT value.');
      viewport = parseViewport(args[++i]);
    } else if (args[i] === '--color-scheme') {
      if (!args[i + 1] || colorScheme) throw new Error('--color-scheme requires one value.');
      colorScheme = validateColorScheme(args[++i]);
    } else if (args[i] === '--pixel-ratio') {
      if (!args[i + 1] || pixelRatio !== undefined || !/^[1-4]$/.test(args[i + 1])) throw new Error('--pixel-ratio requires one integer from 1 to 4.');
      pixelRatio = validatePixelRatio(Number(args[++i]));
    } else if (args[i] === '--mask-selector') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--mask-selector requires a CSS selector.');
      maskSelectors.push(args[++i]);
      validateMaskSelectors(maskSelectors);
    } else if (args[i] === '--browser') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--browser requires an executable path.');
      browserPath = path.resolve(args[++i]);
    } else if (args[i] === '--decisions') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--decisions requires a JSON file.');
      if (decisionFile) throw new Error('--decisions can be supplied once.');
      decisionFile = path.resolve(args[++i]);
    } else if (args[i] === '--storage-state') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--storage-state requires a JSON file.');
      if (storageStateFile) throw new Error('--storage-state can be supplied once.');
      storageStateFile = path.resolve(args[++i]);
    } else if (args[i] === '--baseline') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--baseline requires a JSON file.');
      if (baselineFile) throw new Error('--baseline can be supplied once.');
      baselineFile = path.resolve(args[++i]);
    } else if (args[i] === '--element-baseline') {
      if (!args[i + 1] || args[i + 1].startsWith('-') || elementBaselineFile) throw new Error('--element-baseline requires one JSON file.');
      elementBaselineFile = path.resolve(args[++i]);
    } else if (args[i].startsWith('-')) {
      throw new Error(`Unknown option: ${args[i]}`);
    } else if (project) {
      throw new Error(`Unexpected argument: ${args[i]}`);
    } else project = args[i];
  }
  const root = path.resolve(project || '.');
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new Error('The project path must be a directory.');
  const out = path.resolve(output || path.join(root, '.ui-sheet'));
  const run = await beginReportScan(out);
  let data;
  try {
    const config = await readProjectConfig(root);
    if (capture && !pages.length) pages.push(...(config.pages || []));
    if (new Set(pages).size !== pages.length) throw new Error('The same page cannot be supplied twice.');
    if (pages.length > 20) throw new Error('Select at most 20 pages per scan.');
    if (capture && !pages.length) throw new Error('--capture requires --page or configured pages.');
    if (responsive && !capture) throw new Error('--responsive requires --capture.');
    if (responsiveViewports.length && !responsive) throw new Error('--responsive-viewport requires --responsive.');
    const selectedResponsiveViewports = responsive ? validateResponsiveViewports(responsiveViewports.length ? responsiveViewports : config.responsiveViewports || DEFAULT_RESPONSIVE_VIEWPORTS, pixelRatio ?? config.pixelRatio ?? 2) : null;
    if (crossPage && (!capture || pages.length < 2)) throw new Error('--cross-page requires --capture and at least two selected pages.');
    if (browserPath && !capture) throw new Error('--browser requires --capture.');
    if (decisionFile && !capture) throw new Error('--decisions requires --capture.');
    if (storageStateFile && !capture) throw new Error('--storage-state requires --capture.');
    if (baselineFile && !capture) throw new Error('--baseline requires --capture.');
    if (elementBaselineFile && !capture) throw new Error('--element-baseline requires --capture.');
    if (viewport && !capture) throw new Error('--viewport requires --capture.');
    if (colorScheme && !capture) throw new Error('--color-scheme requires --capture.');
    if (pixelRatio !== undefined && !capture) throw new Error('--pixel-ratio requires --capture.');
    if (maskSelectors.length && !capture) throw new Error('--mask-selector requires --capture.');
    if (capture && !decisionFile && config.decisions) decisionFile = await configuredProjectFile(root, config.decisions, 'decisions');
    if (capture && !baselineFile && config.baseline) baselineFile = await configuredProjectFile(root, config.baseline, 'baseline');
    if (capture && !elementBaselineFile && config.elementBaseline) elementBaselineFile = await configuredProjectFile(root, config.elementBaseline, 'element baseline');
    await run.planPages(pages.length);
    const scannedSourcePaths = [];
    data = await scanProject(root, { outputDir: out, includePaths: includes, excludePaths: excludes, onScannedFile: (file) => scannedSourcePaths.push(file) });
    data.sourceRevision = await inspectSourceRevision(root, { sourcePaths: scannedSourcePaths });
    const storageState = storageStateFile ? await readStorageState(storageStateFile) : undefined;
    const baseline = baselineFile ? await readBaselines(baselineFile) : null;
    const elementBaseline = elementBaselineFile ? await readElementBaselines(elementBaselineFile) : null;
    if (!storageStateFile) for (const [index, page] of pages.entries()) {
      await run.startPage(index + 1, 'observe');
      await observePage(data, page, undefined, { append: index > 0 });
      await run.completePage(index + 1, 'observe');
    }
    if (capture) for (const [index, page] of pages.entries()) {
      await run.startPage(index + 1, 'capture');
      await capturePage(data, page, { browserPath, storageState, viewport: viewport || config.viewport, colorScheme: colorScheme || config.colorScheme, pixelRatio: pixelRatio ?? config.pixelRatio, maskSelectors: maskSelectors.length ? maskSelectors : config.maskSelectors, buttonGroups: config.buttonGroups, elementGroups: config.elementGroups, layoutChecks: config.layoutChecks, layoutMedia: config.layoutMedia, responsiveViewports: selectedResponsiveViewports, sourceLinks: config.sourceLinks, instrumentedSources: config.instrumentedSources, captureTimeoutMs: config.captureTimeoutMs, actions: config.pageActions?.find((entry) => entry.page === page)?.actions, baselines: baseline?.rules, elementBaselines: elementBaseline?.rules, append: index > 0 });
      await run.completePage(index + 1, 'capture');
    }
    if (crossPage) data.crossPageConsistency = analyzeAcrossPages(data.consistency.pages || [data.consistency], { baselines: baseline?.rules || [] });
    if (baseline) {
      const analyses = data.consistency.pages || [data.consistency];
      ensureDistinctBaselineScopes(analyses);
      const used = new Set([...analyses.flatMap((page) => page.baselinesUsed || []), ...(data.crossPageConsistency?.baselinesUsed || [])]);
      data.baselineSummary = { applied: used.size, unmatched: baseline.rules.length - used.size };
    }
    if (decisionFile) await applyDecisions(data, decisionFile);
    if (elementBaseline) {
      const used = new Set((data.elementConsistency?.pages || []).flatMap((page) => page.baselinesUsed || []));
      data.elementBaselineSummary = { applied: used.size, unmatched: elementBaseline.rules.length - used.size };
    }
    data.scanRunId = run.runId;
    data.scanProgress = run.getPageProgress();
    await writeReport(data, out);
    await run.finish('completed');
  } catch (error) {
    try { await run.finish('failed'); }
    catch { throw new Error(`${error.message} The scan status could not be finalized; after verifying no scan is running, remove .ui-sheet-scan.lock and run the scan again.`); }
    throw error;
  }
  console.log(`Found ${data.items.length} items across ${data.scannedFiles} source files.`);
  if (data.observedPages?.length) console.log(`Found ${data.observedPages.reduce((total, page) => total + page.matchingSourceLocations, 0)} possible matches across ${data.observedPages.length} page(s).`);
  if (data.captureSummary) console.log(`Captured ${data.captureSummary.captured} source-linked inventory preview(s).`);
  if (data.consistency) {
    const analyses = data.consistency.pages || [data.consistency];
    console.log(`Compared ${analyses.reduce((total, page) => total + page.counts.eligible, 0)} eligible buttons; found ${analyses.reduce((total, page) => total + page.findings.length, 0)} possible difference(s).`);
    console.log(`Captured ${analyses.reduce((total, page) => total + (page.previewCoverage?.captured || 0), 0)} button appearance preview(s) for consistency review.`);
  }
  if (data.decisionSummary) console.log(`Applied ${data.decisionSummary.applied} review decision(s); ${data.decisionSummary.stale} no longer match.`);
  if (data.elementConsistency) console.log(`Compared ${data.elementConsistency.pages.reduce((total, page) => total + page.counts.eligible, 0)} eligible configured elements; found ${data.elementConsistency.pages.reduce((total, page) => total + page.findings.length, 0)} possible difference(s).`);
  if (data.layoutAudit) console.log(`Ran ${data.layoutAudit.pages.reduce((total, page) => total + page.counts.rules, 0)} explicit layout checks; found ${data.layoutAudit.pages.reduce((total, page) => total + page.counts.findings, 0)} rule violation(s) and ${data.layoutAudit.pages.reduce((total, page) => total + page.counts.incomplete, 0)} incomplete check(s).`);
  if (data.responsiveAudit) {
    const widths = data.responsiveAudit.pages.flatMap((page) => page.viewports);
    console.log(`Inspected ${widths.length} page/viewport combination(s); found ${widths.reduce((total, entry) => total + entry.findings.length, 0)} possible responsive issue(s); ${widths.filter((entry) => entry.coverage !== 'observed').length} inspection(s) incomplete or partial.`);
  }
  if (data.crossPageConsistency) console.log(`Compared ${data.crossPageConsistency.counts.comparableGroups} explicit group(s) across pages; found ${data.crossPageConsistency.findings.length} possible cross-page difference(s). Coverage: ${data.crossPageConsistency.coverage}.`);
  if (data.baselineSummary) console.log(`Applied ${data.baselineSummary.applied} approved baseline(s); ${data.baselineSummary.unmatched} were not matched in this scan.`);
  if (data.captureSummary && data.captureSummary.captured === 0) console.warn('No inventory previews matched the selected source. Button comparison previews may still be available.');
  console.log(`Open ${path.join(out, 'index.html')}`);
  if (data.warnings.length) {
    console.warn(`${data.warnings.length} file(s) could not be fully scanned; see the report for details.`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  const codes = { check: 'CHECK_FAILED', 'check-tokens': 'TOKEN_CHECK_FAILED', 'check-layout': 'LAYOUT_CHECK_FAILED' };
  if (Object.hasOwn(codes, process.argv[2]) && process.argv.includes('--json')) console.log(JSON.stringify({ format: 'ui-sheet/error-v1', error: { code: codes[process.argv[2]], message: error.message } }));
  else console.error(`Pieceboard: ${error.message}`);
  process.exitCode = 2;
});
