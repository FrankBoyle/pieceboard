import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_STATE_BYTES = 2 * 1024 * 1024;

function pageUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Sign-in requires a valid HTTP(S) page URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Sign-in requires an HTTP(S) URL without embedded credentials.');
  url.hash = '';
  return url;
}

function stateForSite(state, url) {
  const hostname = url.hostname.toLowerCase();
  const cookies = (state.cookies || []).filter((cookie) => {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    return domain && (hostname === domain || hostname.endsWith(`.${domain}`));
  });
  const origins = (state.origins || []).filter((entry) => {
    try { return new URL(entry.origin).origin === url.origin; } catch { return false; }
  });
  return { cookies, origins };
}

/** Load an explicitly supplied Playwright state without logging its contents. */
export async function readStorageState(file) {
  try {
    const target = path.resolve(file);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_STATE_BYTES) throw new Error('invalid file');
    const state = JSON.parse(await fs.readFile(target, 'utf8'));
    if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('invalid state');
    return state;
  } catch {
    throw new Error('Could not read a valid Playwright storage-state file of at most 2 MB.');
  }
}

/** Open a dedicated browser for the user to sign in, then save only this origin's state. */
export async function saveBrowserState(inputUrl, outputFile, options = {}) {
  const url = pageUrl(inputUrl);
  if (!outputFile || typeof options.waitForUser !== 'function') throw new Error('An output path and interactive sign-in are required.');
  const target = path.resolve(outputFile);
  try { await fs.lstat(target); throw new Error('Refusing to overwrite an existing browser-state file.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const chromium = options.browserType || (await import('playwright')).chromium;
  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: false, ...(options.browserPath ? { executablePath: options.browserPath } : {}) });
    } catch {
      throw new Error('Could not start the sign-in browser. Install Playwright Chromium or supply --browser.');
    }
    const context = await browser.newContext(options.storageState ? { storageState: stateForSite(options.storageState, url) } : {});
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await options.waitForUser();
    if (new URL(page.url()).origin !== url.origin) throw new Error('Return to the requested site before saving browser state.');
    const { cookies, origins } = stateForSite(await context.storageState({ indexedDB: true }), url);
    if (!cookies.length && !origins.length) throw new Error('No reusable browser state was found for the requested site.');
    const serialized = JSON.stringify({ cookies, origins }, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) throw new Error('Browser state exceeds the 2 MB limit.');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, serialized, { flag: 'wx', mode: 0o600 });
    return { path: target, origin: url.origin };
  } finally {
    if (browser) await browser.close();
  }
}
