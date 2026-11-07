import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPageHtml, observePage } from '../src/observe.js';

function usage(file, id, tag = 'button') {
  return { file, line: 4, detail: '', element: { id, tag } };
}
function data() {
  return { items: [
    { name: 'save', usages: [usage('page.php', 'save')] },
    { name: 'duplicated in source', usages: [usage('one.php', 'shared'), usage('two.php', 'shared')] },
    { name: 'duplicated on page', usages: [usage('page.php', 'twice')] },
    { name: 'wrong tag', usages: [usage('page.php', 'other')] },
  ] };
}

test('matches unique IDs and tags, while excluding ambiguous or mismatched candidates', () => {
  const result = matchPageHtml(data(), '<button id="save">Save</button><button id="shared"></button><button id="twice"></button><button id="twice"></button><a id="other"></a>', 'https://example.com/page?token=private');
  assert.equal(result.items[0].pageMatches[0].file, 'page.php');
  assert.match(result.items[0].pageMatches[0].detail, /<button id="save">/);
  assert.ok(!JSON.stringify(result).includes('token=private'));
  assert.equal(result.observedPages[0].url, 'https://example.com/page');
  assert.equal(result.observedPages[0].matchingSourceLocations, 1);
  assert.equal(result.items[1].pageMatches, undefined);
  assert.equal(result.items[2].pageMatches, undefined);
  assert.equal(result.items[3].pageMatches, undefined);
});

test('fetches one HTML page without credentials and rejects unsafe redirects', async () => {
  let options;
  const fetchHtml = async (_url, request) => {
    options = request;
    return new Response('<button id="save">Save</button>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const result = await observePage(data(), 'https://example.com/', fetchHtml);
  assert.equal(result.observedPages[0].matchingSourceLocations, 1);
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.cookie, undefined);
  await assert.rejects(observePage(data(), 'file:///secret', fetchHtml), /HTTP\(S\)/);
  await assert.rejects(observePage(data(), 'https://user:password@example.com/', fetchHtml), /credentials/);
  await assert.rejects(observePage(data(), 'https://example.com/', async () => new Response(null, { status: 302, headers: { location: 'https://another.example/' } })), /another origin/);
  await assert.rejects(observePage(data(), 'https://example.com/', async () => new Response('{}', { headers: { 'content-type': 'application/json' } })), /did not return HTML/);
});

test('retains separately attributed source matches when checking multiple pages', () => {
  const result = data();
  matchPageHtml(result, '<button id="save">Save</button>', 'https://example.com/one');
  matchPageHtml(result, '<button id="save">Save</button>', 'https://example.com/two?secret=redacted', { append: true });
  assert.deepEqual(result.observedPages.map((page) => page.url), ['https://example.com/one', 'https://example.com/two']);
  assert.equal(result.items[0].pageMatches.length, 2);
  assert.match(result.items[0].pageMatches[0].detail, /\/one/);
  assert.match(result.items[0].pageMatches[1].detail, /\/two/);
  assert.equal(JSON.stringify(result).includes('secret=redacted'), false);
});
