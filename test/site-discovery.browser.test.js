import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';
import { discoverSite, safeSiteUrl, displaySiteUrl, reserveSitePreview } from '../src/site-discovery.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');

test('site URL filtering keeps routes private and excludes actions and other origins', () => {
  const origin = 'https://example.test';
  assert.equal(safeSiteUrl(`${origin}/students?view=progress#record=one`, origin), `${origin}/students?view=progress#record=one`);
  assert.equal(safeSiteUrl(`${origin}/page#tasks`, origin), `${origin}/page#tasks`);
  for (const url of [`${origin}/logout`, `${origin}/api/delete?id=1`, `${origin}/page?action=save`, `${origin}/doc.pdf`, `${origin}/page?token=secret`, 'https://other.test/']) assert.equal(safeSiteUrl(url, origin), null);
  assert.equal(safeSiteUrl(`${origin}/api/%2564elete`, origin), null);
  assert.equal(displaySiteUrl(`${origin}/students?student=private#record=private`), `${origin}/students ?[parameters hidden] #[state hidden]`);
});

test('the site preview budget omits excess images without dropping findings', () => {
  const budget = { remaining: 10, omitted: 0 };
  assert.equal(reserveSitePreview(budget, 6), true);
  assert.equal(reserveSitePreview(budget, 5), false);
  assert.deepEqual(budget, { remaining: 4, omitted: 1 });
});

test('discovers a site without submitting forms or following destructive links', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const received = [];
  const server = http.createServer((request, response) => {
    received.push({ method: request.method, url: request.url });
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url === '/') response.end(`<a href="/alpha">Alpha</a><a href="/alpha#tasks">Alpha tasks state</a><a href="/beta?view=one">Beta</a><a href="#section">Jump</a><div id="section">Section</div><a href="/logout">Logout</a><a href="/delete">Delete</a><a href="https://outside.test/">Outside</a><iframe src="/frame"></iframe><form action="/send" method="post"><button>Send</button></form><script>fetch('/api/update',{method:'POST'}).catch(()=>{});fetch('/api/delete').catch(()=>{})</script>`);
    else if (request.url === '/alpha') response.end('<a href="/gamma">Gamma</a><a href="/">Home</a>');
    else response.end('<p>Test page</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await discoverSite(`${origin}/`, { browserPath, maxPages: 10 });
  assert.deepEqual(new Set(result.pages), new Set([`${origin}/`, `${origin}/alpha`, `${origin}/alpha#tasks`, `${origin}/beta?view=one`, `${origin}/frame`, `${origin}/gamma`]));
  assert.equal(result.truncated, false);
  assert.ok(result.blockedWrites >= 1);
  assert.ok(result.blockedNavigation >= 1);
  assert.ok(result.excluded.some(entry => entry.url.endsWith('/logout')));
  assert.ok(result.excluded.some(entry => entry.url.endsWith('/delete')));
  assert.equal(received.some(entry => entry.method === 'POST' || /^\/(logout|delete|api\/delete)/.test(entry.url)), false);
  const limited = await discoverSite(`${origin}/`, { browserPath, maxPages: 2 });
  assert.equal(limited.truncated, true);
  assert.equal(limited.pages.length + limited.failed.length, 2);
});
