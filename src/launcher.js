import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveBrowserState } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../bin/ui-sheet.js');
const launcherFiles = new Map([
  ['/', ['launcher/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['launcher/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['launcher/style.css', 'text/css; charset=utf-8']],
  ['/logo.png', ['../docs/images/pieceboard-logo.png', 'image/png']],
]);
const omittedDirectories = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'data', 'database', 'storage', 'uploads', 'output', 'outputs', 'artifacts', 'evidence', 'tmp', 'temp']);
const inside = (root, item) => {
  const relative = path.relative(root, item);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function bodyJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new RequestError(415, 'Use a JSON request.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new RequestError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new RequestError(400, 'The request is not valid JSON.'); }
}

function pageUrl(input) {
  if (typeof input !== 'string' || input.length > 4096) throw new RequestError(400, 'Enter a valid test page URL.');
  let url;
  try { url = new URL(input); } catch { throw new RequestError(400, 'Enter a valid test page URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new RequestError(400, 'Use an HTTP(S) URL without credentials.');
  return url;
}

async function isGitRoot(directory) {
  const stat = await fs.lstat(path.join(directory, '.git')).catch(() => null);
  return Boolean(stat && !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()));
}

function installedBrowsers() {
  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((root) => [
      { name: 'Microsoft Edge', path: path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'Google Chrome', path: path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    ]);
  }
  if (process.platform === 'darwin') return [
    { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
  ];
  return [
    { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
  ];
}

async function discover(input) {
  if (typeof input !== 'string' || input.length > 4096 || !path.isAbsolute(input)) throw new RequestError(400, 'Enter an absolute folder path.');
  let root;
  let entries;
  try {
    root = await fs.realpath(input);
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch { throw new RequestError(400, 'That folder could not be opened. Check its path and access.'); }
  const projects = [{ id: randomUUID(), name: path.basename(root) || root, relative: '.', root: true, git: await isGitRoot(root) }];
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !omittedDirectories.has(entry.name.toLowerCase()));
  directories.sort((a, b) => a.name.localeCompare(b.name));
  let truncated = false;
  for (const [index, entry] of directories.entries()) {
    if (index >= 2000 || projects.length >= 501) { truncated = true; break; }
    const project = path.join(root, entry.name);
    if (await isGitRoot(project)) projects.push({ id: randomUUID(), name: entry.name, relative: entry.name, root: false, git: true });
  }
  return { root, parent: path.dirname(root), projects, truncated };
}

async function selectedPaths(workspace, requested) {
  if (!workspace || !Array.isArray(requested) || !requested.length || requested.length > 50) throw new RequestError(400, 'Choose one or more projects.');
  const ids = new Set();
  const selected = [];
  for (const item of requested) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Array.isArray(item.paths) || item.paths.length > 30) throw new RequestError(400, 'Check the selected projects and paths.');
    ids.add(item.id);
    const project = workspace.projects.find((entry) => entry.id === item.id);
    if (!project) throw new RequestError(400, 'The project list changed. Find projects and select them again.');
    selected.push({ project, paths: item.paths });
  }
  if (selected.length > 1 && selected.some(({ project }) => project.root)) throw new RequestError(400, 'Choose the whole folder or projects inside it, not both.');
  const includes = [];
  for (const { project, paths } of selected) {
    const projectPath = path.resolve(workspace.root, project.relative);
    const realProject = await fs.realpath(projectPath).catch(() => '');
    const projectStat = await fs.lstat(projectPath).catch(() => null);
    if (!realProject || realProject !== projectPath || !projectStat?.isDirectory() || projectStat.isSymbolicLink()) throw new RequestError(400, 'A selected project is unavailable or changed. Find projects again.');
    for (const item of paths.length ? paths : ['.']) {
      if (typeof item !== 'string' || !item.trim() || item.length > 4096 || path.isAbsolute(item)) throw new RequestError(400, 'Use project-relative paths, one per line.');
      const target = path.resolve(projectPath, item.trim());
      if (!inside(projectPath, target)) throw new RequestError(400, 'A source path is outside its selected project.');
      const real = await fs.realpath(target).catch(() => '');
      if (!real || !inside(projectPath, real)) throw new RequestError(400, 'A source path is missing or outside its selected project.');
      let current = projectPath;
      for (const part of path.relative(projectPath, target).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        if ((await fs.lstat(current)).isSymbolicLink()) throw new RequestError(400, 'Source paths cannot contain symbolic links.');
      }
      const relative = path.relative(workspace.root, target) || '.';
      if (!includes.includes(relative)) includes.push(relative);
    }
  }
  if (includes.length > 100) throw new RequestError(400, 'Choose at most 100 source paths.');
  return includes;
}

/** Start a capability-protected, loopback-only local launcher. */
export async function startLauncher(options = {}) {
  const currentDirectory = path.resolve(options.cwd || process.cwd());
  const initialWorkspace = path.resolve(options.workspace || currentDirectory);
  const reportRoot = path.resolve(options.reportRoot || path.join(currentDirectory, '.ui-sheet', 'launcher-runs'));
  const authRoot = path.resolve(options.authRoot || path.join(currentDirectory, '.ui-sheet-auth'));
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let workspace;
  let currentJob;
  let auth;
  let stopping = false;
  const jobs = new Map();

  function publicAuth() {
    return auth ? { status: auth.status, message: auth.message || '' } : { status: 'none', message: '' };
  }
  function json(response, status, value) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    try {
      if (!origin || request.headers.host !== new URL(origin).host) throw new RequestError(403, 'Local access only.');
      const url = new URL(request.url, origin);
      const prefix = `/${token}`;
      if (!url.pathname.startsWith(`${prefix}/`)) throw new RequestError(404, 'Not found.');
      const route = url.pathname.slice(prefix.length);
      if (request.method !== 'GET' && (request.method !== 'POST' || request.headers.origin !== origin)) throw new RequestError(403, 'This request must come from the local launcher.');
      if (request.method === 'GET' && launcherFiles.has(route)) {
        const [filename, type] = launcherFiles.get(route);
        const data = await fs.readFile(path.resolve(here, filename));
        response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        response.writeHead(200, { 'content-type': type });
        response.end(data);
        return;
      }
      if (request.method === 'GET' && route === '/api/config') return json(response, 200, { workspace: initialWorkspace });
      if (request.method === 'POST' && route === '/api/projects') {
        if (currentJob?.status === 'running') throw new RequestError(409, 'Wait for the current scan to finish.');
        const body = await bodyJson(request);
        workspace = await discover(body.path);
        return json(response, 200, workspace);
      }
      if (request.method === 'GET' && route === '/api/auth') return json(response, 200, publicAuth());
      if (request.method === 'POST' && route === '/api/auth/start') {
        const body = await bodyJson(request);
        const url = pageUrl(body.page);
        if (auth && ['starting', 'waiting', 'saving'].includes(auth.status)) throw new RequestError(409, 'Finish or cancel the current sign-in first.');
        const session = { status: 'starting', origin: url.origin, path: path.join(authRoot, `launcher-${randomUUID()}.json`), message: 'Opening a separate sign-in browser.' };
        auth = session;
        const chromium = options.authBrowserType || (await import('playwright')).chromium;
        const monitoredBrowser = { async launch(launchOptions) {
          if (session.cancelled || stopping) throw new Error('Sign-in cancelled.');
          let browser;
          try { browser = await chromium.launch(launchOptions); }
          catch (firstError) {
            if (launchOptions.executablePath || session.cancelled || stopping) throw firstError;
            for (const candidate of options.fallbackBrowsers || installedBrowsers()) {
              if (session.cancelled || stopping) throw firstError;
              if (!(await fs.stat(candidate.path).catch(() => null))?.isFile()) continue;
              try {
                browser = await chromium.launch({ ...launchOptions, executablePath: candidate.path });
                session.browserPath = candidate.path;
                session.browserName = candidate.name;
                break;
              } catch { /* Try another installed browser in a fresh profile. */ }
            }
            if (!browser) throw firstError;
          }
          session.browser = browser;
          browser.once?.('disconnected', () => {
            if (session.status === 'waiting') session.cancel?.(new Error('The sign-in browser was closed. Start again.'));
          });
          if (session.cancelled || stopping) await browser.close();
          return browser;
        } };
        session.done = saveBrowserState(url.href, session.path, {
          browserType: monitoredBrowser,
          ...(options.browserPath ? { browserPath: options.browserPath } : {}),
          waitForUser: () => new Promise((resolve, reject) => {
            if (stopping || session.cancelled) { reject(new Error('Sign-in cancelled.')); return; }
            if (typeof session.browser?.isConnected === 'function' && !session.browser.isConnected()) { reject(new Error('The sign-in browser was closed. Start again.')); return; }
            session.status = 'waiting';
            session.message = `Sign in in the separate browser${session.browserName ? ` (${session.browserName})` : ''}, return to the test site, then choose “I’m signed in.”`;
            session.finish = resolve;
            session.cancel = reject;
          }),
        }).then(() => {
          session.status = 'ready';
          session.message = 'Test sign-in saved locally. Use it only for this test site.';
        }).catch((error) => {
          session.status = session.cancelled || stopping ? 'cancelled' : 'error';
          session.message = session.status === 'cancelled' ? 'Sign-in cancelled.' : error.message;
        });
        return json(response, 202, publicAuth());
      }
      if (request.method === 'POST' && route === '/api/auth/finish') {
        await bodyJson(request);
        if (!auth || auth.status !== 'waiting') throw new RequestError(409, 'There is no sign-in waiting to finish.');
        auth.status = 'saving';
        auth.message = 'Saving the test sign-in locally.';
        auth.finish();
        return json(response, 202, publicAuth());
      }
      if (request.method === 'POST' && route === '/api/auth/cancel') {
        await bodyJson(request);
        if (auth && ['starting', 'waiting'].includes(auth.status)) {
          auth.cancelled = true;
          auth.cancel?.(new Error('Sign-in cancelled.'));
          auth.browser?.close().catch(() => {});
        }
        return json(response, 202, publicAuth());
      }
      if (request.method === 'POST' && route === '/api/scan') {
        const body = await bodyJson(request);
        if (currentJob?.status === 'running') throw new RequestError(409, 'Wait for the current scan to finish.');
        if (typeof body.capture !== 'boolean' || typeof body.useAuth !== 'boolean') throw new RequestError(400, 'Check the capture options.');
        const selectedWorkspace = workspace;
        const includes = await selectedPaths(selectedWorkspace, body.projects);
        if (workspace !== selectedWorkspace) throw new RequestError(409, 'The project list changed. Select the projects again.');
        if (currentJob?.status === 'running') throw new RequestError(409, 'Wait for the current scan to finish.');
        const page = body.capture ? pageUrl(body.page) : null;
        if (body.useAuth && (!page || auth?.status !== 'ready' || page.origin !== auth.origin)) throw new RequestError(400, 'Sign in to the same test site before using its saved state.');
        const id = randomUUID();
        const output = path.join(reportRoot, id);
        const args = [cli, 'scan', selectedWorkspace.root, ...includes.flatMap((item) => ['--include', item]), '--out', output];
        if (page) args.push('--page', page.href, '--capture');
        if (body.useAuth) args.push('--storage-state', auth.path);
        const browserPath = options.browserPath || (body.useAuth ? auth.browserPath : undefined);
        if (page && browserPath) args.push('--browser', browserPath);
        const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const job = { id, output, status: 'running', message: 'Scanning your selection. This can take a little while.', child };
        currentJob = job;
        jobs.set(id, job);
        let diagnostic = '';
        child.stdout.on('data', (chunk) => { diagnostic = (diagnostic + chunk.toString()).slice(-6000); });
        child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk.toString()).slice(-6000); });
        job.done = new Promise((resolve) => {
          child.on('error', (error) => { job.status = 'error'; job.message = `Could not start the scan: ${error.message}`; resolve(); });
          child.on('close', async (code) => {
            if (job.status === 'running') {
              const status = await fs.readFile(path.join(output, '.ui-sheet-scan.json'), 'utf8').then(JSON.parse).catch(() => null);
              if (code === 0 && status?.status === 'completed') { job.status = 'complete'; job.message = 'Your sheet is ready. Check its warnings and capture context.'; }
              else { job.status = 'error'; job.message = diagnostic.trim() || 'The scan did not complete. Check the selected paths and try again.'; }
            }
            resolve();
          });
        });
        return json(response, 202, { id });
      }
      if (request.method === 'GET' && route === '/api/job') {
        if (!currentJob) return json(response, 200, { status: 'none' });
        const job = currentJob;
        return json(response, 200, { status: job.status, message: job.message, ...(job.status === 'complete' ? { report: `reports/${job.id}`, output: job.output } : {}) });
      }
      const reportMatch = /^\/reports\/([0-9a-f-]{36})$/.exec(route);
      if (request.method === 'GET' && reportMatch) {
        const job = jobs.get(reportMatch[1]);
        if (!job || job.status !== 'complete') throw new RequestError(404, 'Report not found.');
        const html = await fs.readFile(path.join(job.output, 'index.html'));
        response.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }
      throw new RequestError(404, 'Not found.');
    } catch (error) {
      if (!response.headersSent) json(response, error instanceof RequestError ? error.status : 500, { error: error instanceof RequestError ? error.message : 'Pieceboard could not complete that request.' });
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port || 0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/${token}/`,
    async close() {
      if (stopping) return;
      stopping = true;
      if (auth && ['starting', 'waiting'].includes(auth.status)) { auth.cancelled = true; auth.cancel?.(new Error('Sign-in cancelled.')); auth.browser?.close().catch(() => {}); }
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      await Promise.allSettled([currentJob?.done, auth?.done].filter(Boolean));
      await closed;
    },
  };
}

/** Ask the operating system to open the launcher; the printed URL remains a fallback. */
export function openLauncher(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}
