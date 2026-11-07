import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { capturePage } from '../src/capture.js';
import { scanProject } from '../src/scan.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');

test('keeps browser state and resource URLs out of measured report data and masks synthetic field pixels', { skip: !browserPath, timeout: 90000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-sheet-privacy-'));
  t.after(async () => {
    const actual = await fs.realpath(root), temp = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp); assert.ok(path.basename(actual).startsWith('ui-sheet-privacy-'));
    await fs.rm(actual, { recursive: true, force: true });
  });
  const source = '<!doctype html><main>' + Array.from({ length: 4 }, (_, index) => `<input id="field-${index}" class="field${index === 3 ? ' resource' : ''}" aria-label="Field ${index}"><button id="action-${index}" class="button${index === 3 ? ' resource' : ''}">Save ${index}</button>`).join('\n') + '</main>';
  await fs.writeFile(path.join(root, 'index.html'), source);
  let value = 'SYNTHETIC_FIELD_VALUE_A', pages = 0, cookieSeen = false;
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/asset')) { response.writeHead(404); response.end(); return; }
    pages++; cookieSeen ||= request.headers.cookie?.includes('SYNTHETIC_COOKIE') || false;
    const css = '<style>body{padding:24px}.field,.button{font:16px Arial;padding:8px;border:1px solid blue;border-radius:8px;margin:4px;background:white;color:blue}.field.resource{background-image:url("/asset?token=SYNTHETIC_BACKGROUND")}.button.resource{filter:url("/asset?token=SYNTHETIC_FILTER#effect")}</style>';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(source.replace('<main>', css + '<main>').replace('<input', `<input value="${value}"`));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const storageState = { cookies: [{ name: 'demo', value: 'SYNTHETIC_COOKIE', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [{ origin, localStorage: [{ name: 'demo', value: 'SYNTHETIC_STORAGE' }] }] };
  const options = { browserPath, storageState, maskSelectors: ['.field'], elementGroups: [{ selector: '.field', family: 'fields', type: 'inputs' }] };
  const first = await scanProject(root);
  await capturePage(first, `${origin}/?session=SYNTHETIC_QUERY`, options);
  assert.equal(first.consistency.counts.missingStyle, 1);
  assert.equal(first.elementConsistency.pages[0].counts.missingStyle, 1);
  assert.equal(first.consistency.counts.eligible, 3);
  assert.equal(first.elementConsistency.pages[0].counts.eligible, 3);
  assert.equal(cookieSeen, true, 'the supplied synthetic state was actually used');
  assert.ok(pages > 0);
  const serialized = JSON.stringify(first);
  for (const canary of ['SYNTHETIC_COOKIE', 'SYNTHETIC_STORAGE', 'SYNTHETIC_QUERY', 'SYNTHETIC_BACKGROUND', 'SYNTHETIC_FILTER', value]) assert.equal(serialized.includes(canary), false, canary);
  const masked = first.elementConsistency.pages[0].previews['input:0'];
  assert.ok(masked?.image, 'a real masked input preview was captured');
  value = 'SYNTHETIC_FIELD_VALUE_B';
  const second = await scanProject(root);
  await capturePage(second, origin, options);
  assert.equal(second.elementConsistency.pages[0].previews['input:0'].image, masked.image, 'changing masked field pixels does not change the captured image');
});
