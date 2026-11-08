import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { startLauncher } from '../src/launcher.js';

const bundled = chromium.executablePath();
const browserPath = process.env.UI_SHEET_TEST_BROWSER || '';
const browserAvailable = browserPath ? existsSync(browserPath) : existsSync(bundled);
const executable = browserPath ? { executablePath: browserPath } : {};

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-launcher-'));
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    const actual = await fs.realpath(root);
    const temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(actual) !== temporary || !path.basename(actual).startsWith('pieceboard-launcher-')) throw new Error('Unexpected temporary directory.');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const workspace = path.join(root, 'workspace');
  for (const name of ['Alpha', 'Beta', 'Unselected']) {
    await fs.mkdir(path.join(workspace, name, '.git'), { recursive: true });
    await fs.mkdir(path.join(workspace, name, 'src'));
    await fs.writeFile(path.join(workspace, name, 'src', 'index.html'), `<button id="${name.toLowerCase()}-button">${name} button</button>`);
    await fs.writeFile(path.join(workspace, name, 'outside.html'), `<button>${name} outside scope</button>`);
  }
  return { root, workspace, cleanup };
}

async function post(url, body, origin) {
  return fetch(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('launcher selects and scopes two repositories and opens the resulting sheet', { skip: !browserAvailable && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const { root, workspace, cleanup } = await fixture(t);
  const launcher = await startLauncher({ workspace, reportRoot: path.join(root, 'reports') });
  cleanup.push(() => launcher.close());
  const browser = await chromium.launch({ ...executable, headless: true });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(launcher.url);
  await page.getByText('Found 3 repositories.', { exact: false }).waitFor();
  if (process.env.PIECEBOARD_LAUNCHER_SCREENSHOT) await page.screenshot({ path: process.env.PIECEBOARD_LAUNCHER_SCREENSHOT, fullPage: true });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(accessibility.violations.map((entry) => ({ id: entry.id, nodes: entry.nodes.map((node) => node.target) })), []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  if (process.env.PIECEBOARD_LAUNCHER_SCREENSHOT) await page.screenshot({ path: process.env.PIECEBOARD_LAUNCHER_SCREENSHOT.replace(/\.png$/i, '-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /Create my sheet/ }).click();
  await page.getByText('Choose one or more projects.').waitFor();
  for (const name of ['Alpha', 'Beta']) {
    const project = page.locator('.project').filter({ hasText: `${name}Git repository` });
    await project.locator('input[type=checkbox]').check();
    await project.locator('summary').click();
    await project.locator('textarea').fill('src');
  }
  await page.getByRole('button', { name: /Create my sheet/ }).click();
  await page.getByRole('link', { name: /Open my sheet/ }).waitFor({ timeout: 60000 });
  const job = await (await fetch(new URL('api/job', launcher.url))).json();
  assert.equal(job.status, 'complete');
  const report = JSON.parse(await fs.readFile(path.join(job.output, 'ui-sheet.json'), 'utf8'));
  assert.deepEqual(new Set(report.scanScope), new Set(['Alpha/src', 'Beta/src']));
  assert.equal(report.scannedFiles, 2);
  assert.ok(report.items.some((item) => item.usages?.some((usage) => usage.file === 'Alpha/src/index.html')));
  assert.ok(!JSON.stringify(report).includes('Unselected outside scope'));
  const response = await fetch(new URL(job.report, launcher.url));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Pieceboard/);
  const reportPage = await context.newPage();
  const errors = [];
  reportPage.on('pageerror', (error) => errors.push(error.message));
  await reportPage.goto(new URL(job.report, launcher.url).href);
  await reportPage.getByRole('button', { name: /All pieces/ }).waitFor();
  await reportPage.locator('#search').fill('Alpha');
  assert.deepEqual(errors, []);
});

test('launcher discovers linked pages and opens a site review', { skip: !browserAvailable && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.', timeout: 120000 }, async (t) => {
  const { root, workspace, cleanup } = await fixture(t);
  const site = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta name="viewport" content="width=device-width"><h1>Test screen</h1>${request.url === '/' ? '<a href="/second">Second screen</a>' : ''}`);
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { site.closeAllConnections(); site.close(resolve); }));
  const launcher = await startLauncher({ workspace, reportRoot: path.join(root, 'reports'), browserPath: browserPath || bundled });
  cleanup.push(() => launcher.close());
  const browser = await chromium.launch({ ...executable, headless: true });
  cleanup.push(() => browser.close());
  const page = await browser.newPage();
  await page.goto(launcher.url);
  await page.getByText('Found 3 repositories.', { exact: false }).waitFor();
  await page.locator('.project').filter({ hasText: 'AlphaGit repository' }).locator('input[type=checkbox]').check();
  await page.getByLabel('Inspect a test site').check();
  await page.getByLabel('Test page URL').fill(`http://127.0.0.1:${site.address().port}/`);
  assert.equal(await page.getByLabel('Find and inspect linked pages').isChecked(), true);
  await page.getByLabel('Maximum pages').fill('2');
  await page.getByRole('button', { name: /Create my sheet/ }).click();
  await page.getByRole('link', { name: /Open my sheet/ }).waitFor({ timeout: 100000 });
  const job = await (await fetch(new URL('api/job', launcher.url))).json();
  const report = JSON.parse(await fs.readFile(path.join(job.output, 'ui-sheet.json'), 'utf8'));
  assert.equal(job.status, 'complete');
  assert.equal(report.siteScan.captured, 2);
  assert.equal(report.siteScan.incomplete, 0);
  const resultPage = await browser.newPage();
  await resultPage.goto(new URL(job.report, launcher.url).href);
  assert.match(await resultPage.locator('#site-review').innerText(), /2 pages inspected/);
});

test('launcher refuses cross-origin requests, forged projects, and paths outside a selected project', async (t) => {
  const { root, workspace, cleanup } = await fixture(t);
  const launcher = await startLauncher({ workspace, reportRoot: path.join(root, 'reports') });
  cleanup.push(() => launcher.close());
  const origin = new URL(launcher.url).origin;
  assert.equal((await fetch(new URL('/wrong-token/api/config', launcher.url))).status, 404);
  assert.equal((await post(new URL('api/projects', launcher.url), { path: workspace }, 'https://attacker.example')).status, 403);
  const projects = await (await post(new URL('api/projects', launcher.url), { path: workspace }, origin)).json();
  const alpha = projects.projects.find((project) => project.name === 'Alpha');
  const forged = await post(new URL('api/scan', launcher.url), { projects: [{ id: 'forged', paths: [] }], capture: false, useAuth: false }, origin);
  assert.equal(forged.status, 400);
  const traversal = await post(new URL('api/scan', launcher.url), { projects: [{ id: alpha.id, paths: ['../Beta'] }], capture: false, useAuth: false }, origin);
  assert.equal(traversal.status, 400);
  assert.match((await traversal.json()).error, /outside/);
  const host = new URL(launcher.url);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: host.port, path: host.pathname, headers: { host: `attacker.example:${host.port}` } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
});

test('launcher falls back to an installed browser in a separate test session', async (t) => {
  const { root, workspace, cleanup } = await fixture(t);
  const fallback = path.join(root, 'test-browser');
  await fs.writeFile(fallback, 'synthetic executable');
  const launches = [];
  let closed = false;
  const browserType = { async launch(options) {
    launches.push(options.executablePath || 'bundled');
    if (!options.executablePath) throw new Error('Bundled browser unavailable.');
    return {
      once() {},
      async newContext() { return {
        async newPage() { return { async goto() {}, url: () => 'https://example.test/dashboard' }; },
        async storageState() { return { cookies: [{ name: 'demo', value: 'synthetic', domain: 'example.test', path: '/' }], origins: [] }; },
      }; },
      async close() { closed = true; },
    };
  } };
  const launcher = await startLauncher({ workspace, reportRoot: path.join(root, 'reports'), authRoot: path.join(root, 'auth'), authBrowserType: browserType, fallbackBrowsers: [{ name: 'Example Browser', path: fallback }] });
  cleanup.push(() => launcher.close());
  const origin = new URL(launcher.url).origin;
  assert.equal((await post(new URL('api/auth/start', launcher.url), { page: 'https://example.test/dashboard' }, origin)).status, 202);
  async function waitFor(status) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await (await fetch(new URL('api/auth', launcher.url))).json();
      if (state.status === status) return state;
      await delay(25);
    }
    throw new Error(`Sign-in did not reach ${status}.`);
  }
  assert.match((await waitFor('waiting')).message, /Example Browser/);
  assert.equal((await post(new URL('api/auth/finish', launcher.url), {}, origin)).status, 202);
  await waitFor('ready');
  assert.deepEqual(launches, ['bundled', fallback]);
  assert.equal(closed, true);
});

test('launcher lets the user sign in separately and capture a synthetic authenticated page', { skip: !browserAvailable && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const { root, workspace, cleanup } = await fixture(t);
  const signedIn = '<!doctype html><title>Demo workspace</title><button id="alpha-button">Alpha button</button>';
  const login = '<!doctype html><title>Demo sign in</title><button id="login" onclick="document.cookie=\'demo_session=synthetic-private-cookie; Path=/\';location.reload()">Sign in</button>';
  const site = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end((request.headers.cookie || '').includes('demo_session=synthetic-private-cookie') ? signedIn : login);
  });
  await new Promise((resolve, reject) => { site.once('error', reject); site.listen(0, '127.0.0.1', resolve); });
  cleanup.push(() => new Promise((resolve) => site.close(resolve)));
  let signInBrowser;
  const authBrowserType = { async launch(options) {
    const headed = process.env.PIECEBOARD_LAUNCHER_HEADED_AUTH === '1';
    signInBrowser = await chromium.launch({ ...options, ...executable, headless: !headed, ...(headed ? { args: ['--window-position=-32000,-32000'] } : {}) });
    return signInBrowser;
  } };
  const launcher = await startLauncher({ workspace, reportRoot: path.join(root, 'reports'), authRoot: path.join(root, 'auth'), authBrowserType, ...(browserPath ? { browserPath } : {}) });
  cleanup.push(() => launcher.close());
  const browser = await chromium.launch({ ...executable, headless: true });
  cleanup.push(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(launcher.url);
  await page.getByText('Found 3 repositories.', { exact: false }).waitFor();
  await page.locator('.project').filter({ hasText: 'AlphaGit repository' }).locator('input[type=checkbox]').check();
  await page.locator('#capture').check();
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(accessibility.violations.map((entry) => ({ id: entry.id, nodes: entry.nodes.map((node) => node.target) })), []);
  await page.getByRole('button', { name: 'Open test sign-in' }).click();
  await page.getByText('Enter a valid test page URL.').waitFor();
  await page.locator('#page-url').fill(`http://127.0.0.1:${site.address().port}/dashboard`);
  await page.getByRole('button', { name: 'Open test sign-in' }).click();
  await page.getByRole('button', { name: 'I’m signed in' }).waitFor({ timeout: 30000 });
  await signInBrowser.close();
  await page.getByText('The sign-in browser was closed. Start again.').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Open test sign-in' }).click();
  await page.getByRole('button', { name: 'I’m signed in' }).waitFor({ timeout: 30000 });
  const signInPage = signInBrowser.contexts()[0].pages()[0];
  await signInPage.locator('#login').click();
  await signInPage.getByText('Alpha button').waitFor();
  await page.getByRole('button', { name: 'I’m signed in' }).click();
  await page.getByText('Use this test sign-in for the capture').waitFor();
  await page.getByRole('button', { name: /Create my sheet/ }).click();
  await page.getByRole('link', { name: /Open my sheet/ }).waitFor({ timeout: 60000 });
  const job = await (await fetch(new URL('api/job', launcher.url))).json();
  const report = JSON.parse(await fs.readFile(path.join(job.output, 'ui-sheet.json'), 'utf8'));
  assert.ok(report.captureSummary.captured > 0);
  assert.equal(JSON.stringify(report).includes('synthetic-private-cookie'), false);
});
