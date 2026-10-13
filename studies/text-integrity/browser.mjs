import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const { values: args } = parseArgs({ options: {
  build: { type: 'string', default: 'dist' }, output: { type: 'string' }, after: { type: 'boolean', default: false },
} });
const build = resolve(args.build);
const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(await readFile(join(here, 'cases.json')));
await mkdir(args.output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function report(page) {
  // Browsers throttle rapid automatic downloads; model a deliberate export.
  await page.waitForTimeout(300);
  const pending = page.waitForEvent('download');
  await page.locator('#export-json-btn').click();
  const result = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  delete result.generatedAt; // Export time changes; source, metrics and analysis must not.
  return result;
}
async function settled(page, name) {
  await expect(page.locator('.run-meta strong')).toHaveText(name);
  await expect(page.locator('#apply-settings-btn')).toBeEnabled();
}
const results = [];
for (const [engine, driver] of Object.entries({ chromium, firefox })) {
  const browser = await driver.launch();
  try {
    for (const width of [1440, 375]) {
      const server = createServer(async (request, response) => {
        const relative = new URL(request.url, 'http://localhost').pathname.replace(/^\/stutterscope\//, '') || 'index.html';
        const path = resolve(build, relative);
        if (!path.startsWith(build + '/')) { response.writeHead(404).end(); return; }
        try {
          const bytes = await readFile(path);
          response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(path)] ?? 'application/octet-stream');
          response.end(bytes);
        } catch { response.writeHead(404).end(); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const context = await browser.newContext({ viewport: { width, height: 1050 }, colorScheme: width === 1440 ? 'dark' : 'light' });
      const page = await context.newPage();
      const errors = [], external = [], late = [], reads = [], assets = {};
      let offline = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.csp = []; addEventListener('securitypolicyviolation', event => window.csp.push(event.violatedDirective)); });
      page.on('request', request => {
        if (!/^https?:/.test(request.url())) return;
        const url = new URL(request.url());
        if (url.origin !== origin) external.push(url.href);
        if (offline) late.push({ path: url.pathname, type: request.resourceType() });
      });
      page.on('response', response => {
        if (offline || response.status() !== 200) return;
        const path = new URL(response.url()).pathname.replace(/^\/stutterscope\//, '') || 'index.html';
        reads.push(response.body().then(async bytes => {
          assert.equal(sha(bytes), sha(await readFile(join(build, path))));
          assets[path] = { bytes: bytes.length, sha256: sha(bytes) };
        }));
      });
      try {
        await page.goto(origin + '/stutterscope/');
        await page.evaluate(() => document.fonts.ready);
        await Promise.all(reads);
        await new Promise(resolve => server.close(resolve));
        await context.setOffline(true);
        offline = true;
        const controlPath = join(here, 'fixtures/utf8-names.csv');
        await page.locator('#file-input').setInputFiles(controlPath);
        await settled(page, 'utf8-names.csv');
        const control = await report(page);
        assert.ok(Math.abs(control.metrics.averageFps - 100) < 1e-10);
        const observations = [];
        let previous = control;
        for (const specimen of cases) {
          console.log(engine, width, specimen.id);
          await page.locator('#file-input').setInputFiles(join(here, specimen.file));
          let exported, alert;
          if (args.after && specimen.expected === 'rejected') {
            await expect(page.getByRole('alert')).toContainText('Invalid UTF-');
            await expect(page.locator('#apply-settings-btn')).toBeEnabled();
            alert = await page.getByRole('alert').innerText();
            exported = await report(page);
            assert.deepEqual(exported, previous);
          } else {
            await settled(page, specimen.file.split('/').at(-1));
            exported = await report(page);
            if (specimen.expected === 'parsed') {
              assert.equal(exported.metrics.frameCount, specimen.frames);
              assert.equal(exported.source.streams.length, specimen.streams);
              assert.equal(exported.source.application, specimen.application);
            }
          }
          observations.push({ id: specimen.id, rejected: Boolean(alert), alert,
            file: exported.source.fileName, frames: exported.metrics.frameCount,
            averageFps: exported.metrics.averageFps, source: exported.source, reportSha256: sha(JSON.stringify(exported)) });
          previous = exported;
          if (specimen.id === 'legacy-names') {
            await page.evaluate(() => scrollTo(0, 0));
            await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)));
            await page.screenshot({ path: join(args.output, `${engine}-${width}.png`) });
          }
        }
        // A failed comparison import must leave the prior single-run export intact.
        if (args.after) {
          const previous = await report(page);
          const chooser = page.waitForEvent('filechooser');
          await page.locator('#add-compare-btn').click();
          await (await chooser).setFiles(join(here, 'fixtures/utf8-late-damage.csv'));
          await expect(page.getByRole('alert')).toContainText('Invalid UTF-8');
          await expect(page.locator('#apply-settings-btn')).toBeEnabled();
          assert.deepEqual(await report(page), previous);
          await page.locator('#file-input').setInputFiles(controlPath);
          await settled(page, 'utf8-names.csv');
          assert.deepEqual(await report(page), control);
        }
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(axe.violations, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        assert.deepEqual(late.filter(request => request.type !== 'font'), []);
        assert.deepEqual(await page.evaluate(() => window.csp), []);
        results.push({ engine, version: browser.version(), width, observations, control,
          assets, pageErrors: errors, externalRequests: external, lateRequests: late, axeViolations: [], overflow: false });
      } finally {
        if (server.listening) await new Promise(resolve => server.close(resolve));
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
await writeFile(join(args.output, 'observations.json'), JSON.stringify({ after: args.after, cases: results }, null, 2) + '\n');
console.log(`${results.length} offline browser workflows; ${cases.length} specimens each`);
