import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { writeReport } from '../src/report.js';

const browserPath = process.env.UI_SHEET_TEST_BROWSER || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '');
const cli = fileURLToPath(new URL('../bin/ui-sheet.js', import.meta.url));
const exec = promisify(execFile);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/5sAAAAASUVORK5CYII=', 'base64');

test('a portable choice board opens offline, records selections, and exports answers', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-choices-'));
  t.after(async () => { for (const file of ['a.png', 'input.json', 'review.html', 'answers.md', 'bad.json']) await fs.rm(path.join(dir, file), { force: true }); await fs.rmdir(dir); });
  await fs.writeFile(path.join(dir, 'a.png'), png);
  await fs.writeFile(path.join(dir, 'input.json'), JSON.stringify({ title: 'Compare <script>bad()</script>', introduction: 'Two real test examples', choices: [{ question: 'Which navigation?', context: 'Test captures', options: [{ label: 'One', image: 'a.png' }, { label: 'Two', description: 'Text example' }] }] }));
  await exec(process.execPath, [cli, 'choices', '--manifest', path.join(dir, 'input.json'), '--out', path.join(dir, 'review.html')]);
  await assert.rejects(exec(process.execPath, [cli, 'choices', '--manifest', path.join(dir, 'input.json'), '--out', path.join(dir, 'review.html')]));
  await fs.writeFile(path.join(dir, 'bad.json'), JSON.stringify({ title: 'Bad', choices: [{ question: 'Bad?', options: [{ label: 'One', image: '../outside.png' }, { label: 'Two' }] }] }));
  await assert.rejects(exec(process.execPath, [cli, 'choices', '--manifest', path.join(dir, 'bad.json'), '--out', path.join(dir, 'another.html')]));
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(dir, 'review.html')).href);
    assert.equal(await page.locator('input:checked').count(), 0);
    assert.match(await page.locator('h1').innerText(), /<script>bad/);
    assert.equal(await page.locator('.option img').count(), 1);
    await page.getByText('Choose B · Two').click();
    await page.locator('textarea').fill('Keep this one');
    await page.reload();
    assert.equal(await page.locator('input[value="B"]').isChecked(), true);
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download my answers' }).click();
    const download = await event; await download.saveAs(path.join(dir, 'answers.md'));
    const markdown = await fs.readFile(path.join(dir, 'answers.md'), 'utf8');
    assert.match(markdown, /Choice: B · Two/); assert.match(markdown, /Keep this one/); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('a captured finding appears as a clickable A/B choice before the inventory', { skip: !browserPath && 'Install Playwright Chromium or set UI_SHEET_TEST_BROWSER.' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pieceboard-report-choice-'));
  t.after(async () => { for (const file of ['index.html', 'ui-sheet.json', 'answers.md']) await fs.rm(path.join(dir, file), { force: true }); await fs.rmdir(dir); });
  const image = `data:image/png;base64,${png.toString('base64')}`;
  const data = { format: 'ui-sheet/v1', name: 'Demo', scannedFiles: 1, warnings: [], items: [], scanRunId: 'synthetic-test', consistency: {
    scope: { url: 'https://example.com/', viewport: { width: 1440, height: 900 }, pixelRatio: 2 },
    counts: { seen: 3, eligible: 3 }, observations: [{ id: 'button:0', source: { status: 'unresolved' } }, { id: 'button:2', source: { status: 'unresolved' } }],
    previews: { 'button:0': { image }, 'button:2': { image } }, appearances: [],
    findings: [{ id: '0123456789abcdef', evidence: 'small sample', group: { family: 'actions', variant: 'primary' }, total: 3, common: { count: 2, example: 'button:0' }, outlier: { count: 1, example: 'button:2' }, differences: [] }],
  } };
  await writeReport(data, dir);
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage({ acceptDownloads: true }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    assert.equal(await page.locator('#choice-review input[type=radio]').count(), 2);
    await page.locator('#choice-review input[value=b]').check();
    const event = page.waitForEvent('download'); await page.locator('#choice-review button').click();
    await (await event).saveAs(path.join(dir, 'answers.md'));
    assert.match(await fs.readFile(path.join(dir, 'answers.md'), 'utf8'), /Choice: B/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
