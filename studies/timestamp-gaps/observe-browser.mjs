import { chromium, firefox } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const records = [];
const output = new URL('../../docs/assets/timestamp-gaps/', import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await browserType.launch();
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] ?? 'http://127.0.0.1:4194/stutterscope/');
    await page.locator('#file-input').setInputFiles(fileURLToPath(new URL('missing.csv', import.meta.url)));
    await page.getByRole('button', { name: 'Parse', exact: true }).click();
    await page.locator('.warn-note summary').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const report = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    assert.equal(report.metrics.frameCount, 562);
    assert.equal(report.metrics.stutter.hitchCount, 2);
    assert.equal(report.source.skippedRows, 4);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    const shot = `${name}-${width}.png`;
    await page.screenshot({ path: fileURLToPath(new URL(shot, output)), fullPage: true, animations: 'disabled' });
    records.push({ browser: name, version: browser.version(), width, errors, overflow,
      screenshot: `../../docs/assets/timestamp-gaps/${shot}`, report });
    await page.close();
  }
  await browser.close();
}
await writeFile(new URL('browsers.json', import.meta.url), JSON.stringify(records, null, 2) + '\n');
console.log(`${records.length} browser exports verified`);
