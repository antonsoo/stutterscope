// node studies/presentmon2-clock/cached-entry.mjs OUTPUT
// Serve the exact prior entry document to a fresh browser while its immutable
// assets come from their canonical public URLs. This is a stale-document control,
// not a claim that the older bundle contains the new PresentMon corrections.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox } from '@playwright/test';
const output = process.argv[2];
if (!output) throw new Error('Supply OUTPUT');
const prior = '9ab31330afeff1055aeb8086ca26a1421a078641';
const baseURL = 'https://antonsoo.github.io/stutterscope/';
const response = await fetch(`https://raw.githubusercontent.com/antonsoo/stutterscope/${prior}/index.html`);
assert.equal(response.status, 200);
const html = await response.text();
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    const context = await browser.newContext();
    await context.route(baseURL, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    const page = await context.newPage(), errors = [], scripts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', item => { if (new URL(item.url()).pathname.endsWith('.js')) scripts.push({ url: item.url(), status: item.status() }); });
    await page.goto(baseURL);
    await context.setOffline(true);
    await page.locator('#file-input').setInputFiles(new URL('./fixtures/test_case_1-default.csv', import.meta.url).pathname);
    await page.waitForFunction(() => document.querySelector('.run-meta strong')?.textContent === 'test_case_1-default.csv');
    const pending = page.waitForEvent('download');
    await page.locator('#export-json-btn').click();
    const bytes = await readFile(await (await pending).path());
    const report = JSON.parse(bytes);
    assert.equal(report.source.format, 'presentmon2');
    assert.ok(Number.isSafeInteger(report.metrics.frameCount) && report.metrics.frameCount > 0);
    assert.deepEqual(errors, []);
    assert.ok(scripts.some(item => item.url.endsWith('/assets/index-Ds7-16Zz.js') && item.status === 200));
    results.push({ engine, browserVersion: browser.version(), offlineImport: true,
      format: report.source.format, frames: report.metrics.frameCount,
      downloadSha256: createHash('sha256').update(bytes).digest('hex'), scripts, errors });
  } finally { await browser.close(); }
}
await writeFile(output, JSON.stringify({ checkedAtUtc: new Date().toISOString(),
  scope: 'Prior entry document substituted locally; actual canonical public asset requests, native complete-capture import and JSON download after disconnection. The old bundle retains its original analysis behavior.',
  priorDeployment: prior, htmlSha256: createHash('sha256').update(html).digest('hex'), results }, null, 2) + '\n');
console.log(`${results.length} cached-entry browser workflows passed`);
