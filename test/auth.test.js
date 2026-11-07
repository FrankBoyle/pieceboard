import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readStorageState, saveBrowserState } from '../src/auth.js';
import { capturePage } from '../src/capture.js';

test('saves only state for the requested site after user-led sign-in', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-auth-'));
  const file = path.join(root, 'state.json');
  t.after(async () => { await fs.rm(file, { force: true }); await fs.rmdir(root); });
  let waited = false;
  let closed = false;
  let launchOptions;
  const state = { cookies: [
    { name: 'session', value: 'synthetic-session', domain: '.example.test', path: '/' },
    { name: 'unrelated', value: 'synthetic-other', domain: 'other.test', path: '/' },
  ], origins: [
    { origin: 'https://app.example.test', localStorage: [{ name: 'demo', value: 'synthetic-local' }] },
    { origin: 'https://other.test', localStorage: [] },
  ] };
  const browserType = { async launch(options) { launchOptions = options; return {
    async newContext() { return { async newPage() { return { async goto() {}, url: () => 'https://app.example.test/dashboard' }; }, async storageState() { return state; } }; },
    async close() { closed = true; },
  }; } };
  await saveBrowserState('https://app.example.test/dashboard', file, { browserType, waitForUser: async () => { waited = true; } });
  const saved = await readStorageState(file);
  assert.equal(launchOptions.headless, false);
  assert.equal(waited, true);
  assert.equal(closed, true);
  assert.equal(saved.cookies.length, 1);
  assert.equal(saved.origins.length, 1);
  assert.equal(JSON.stringify(saved).includes('synthetic-other'), false);
  await assert.rejects(saveBrowserState('https://app.example.test/', file, { browserType, waitForUser: async () => {} }), /Refusing to overwrite/);
});

test('rejects invalid state without exposing its contents and closes on an unfinished sign-in', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-auth-'));
  const file = path.join(root, 'state.json');
  t.after(async () => { await fs.rm(file, { force: true }); await fs.rmdir(root); });
  await fs.writeFile(file, 'synthetic-secret-not-json');
  await assert.rejects(readStorageState(file), (error) => /valid Playwright/.test(error.message) && !error.message.includes('synthetic-secret'));
  await fs.rm(file);
  let closed = false;
  const browserType = { async launch() { return { async newContext() { return { async newPage() { return { async goto() {}, url: () => 'https://other.test/' }; } }; }, async close() { closed = true; } }; } };
  await assert.rejects(saveBrowserState('https://example.test/', file, { browserType, waitForUser: async () => {} }), /Return to the requested site/);
  assert.equal(closed, true);
  await assert.rejects(fs.access(file));
});

test('passes explicit browser state to capture without storing it in the report', async () => {
  const storageState = { cookies: [{ name: 'session', value: 'synthetic-secret', domain: 'example.test', path: '/' }], origins: [] };
  let contextOptions;
  const page = { async goto() { return { ok: () => true }; }, url: () => 'https://example.test/', async waitForLoadState() {}, async evaluate() { return []; } };
  const browserType = { async launch() { return { async newContext(options) { contextOptions = options; return { async newPage() { return page; } }; }, async close() {} }; } };
  const data = { items: [] };
  await capturePage(data, 'https://example.test/', { browserType, storageState });
  assert.equal(contextOptions.storageState, storageState);
  assert.equal(JSON.stringify(data).includes('synthetic-secret'), false);
});
