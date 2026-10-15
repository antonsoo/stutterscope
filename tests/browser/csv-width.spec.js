import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = name => fileURLToPath(new URL(`../../studies/csv-width/fixtures/${name}.csv`, import.meta.url));
async function report(page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#export-json-btn').click();
  return JSON.parse(await readFile(await (await waiting).path(), 'utf8'));
}

for (const width of [1440, 375]) {
  test(`shifted CSV cells remain warnings and unknown boundaries offline at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./');
    await context.setOffline(true);
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.locator('#file-input').setInputFiles(fixture('presentmon2'));
    await expect(page.locator('.warn-note summary')).toContainText('1 row');
    await page.locator('.warn-note summary').click();
    await expect(page.locator('.warn-note')).toContainText('line 4: too many CSV fields');
    const direct = await report(page);
    expect(direct.metrics).toMatchObject({ frameCount: 4, averageFps: 100,
      stutter: { hitchCount: 0, stutterEventCount: 0 }, pacingCoverage: { observedPairs: 2, gapBoundaries: 1 } });
    expect(direct.source.skippedRows).toBe(1);
    expect(direct.episodes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.STUTTERSCOPE_WIDTH_EVIDENCE) {
      await mkdir(process.env.STUTTERSCOPE_WIDTH_EVIDENCE, { recursive: true });
      await page.screenshot({ path: `${process.env.STUTTERSCOPE_WIDTH_EVIDENCE}/${info.project.name}-${width}.png`, fullPage: true });
    }
    await page.locator('#file-input').setInputFiles(fixture('unknown-stream'));
    await expect(page.locator('#stream-select-a')).toBeVisible();
    const mixed = await report(page);
    expect(mixed.metrics.pacingCoverage).toMatchObject({ observedPairs: 0, gapBoundaries: 1 });
    expect(mixed.episodes.map(e => e.firstSourceLine)).toEqual([2, 5]);
    await page.locator('#stream-select-a').selectOption('43:0x1');
    await expect(page.locator('#tile-grid-a')).toContainText('9.5');
    const overlay = await report(page);
    expect(overlay.metrics).toMatchObject({ frameCount: 2, masdMs: null,
      pacingCoverage: { observedPairs: 0, gapBoundaries: 1 } });
    await page.locator('#file-input').setInputFiles(fixture('generic'));
    await page.getByRole('dialog').getByRole('button', { name: 'Parse', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('.warn-note summary')).toContainText('1 row');
    const generic = await report(page);
    expect(generic.metrics).toMatchObject({ frameCount: 4, averageFps: 100, stutter: { hitchCount: 0 } });
    expect(generic.source.warnings.join('\n')).toContain('too many CSV fields');
    expect(errors).toEqual([]);
    // Firefox may retry a same-origin font first used by the new report.
    // Analysis and downloads must not fetch any additional code or data.
    expect(requests.every(url => /^http:\/\/127\.0\.0\.1:4193\/stutterscope\/assets\/[^/]+\.woff2$/.test(url))).toBe(true);
    if (process.env.STUTTERSCOPE_WIDTH_EVIDENCE) {
      await writeFile(`${process.env.STUTTERSCOPE_WIDTH_EVIDENCE}/${info.project.name}-${width}.json`,
        JSON.stringify({ width, browser: info.project.name, offline_before_first_file: true, direct, mixed, overlay, generic, errors, requests }, null, 2) + '\n');
    }
  });
}
