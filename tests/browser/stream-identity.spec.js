import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = (name) => fileURLToPath(new URL(`../../studies/stream-identity/fixtures/${name}.csv`, import.meta.url));
async function report(page) {
  const download = page.waitForEvent('download');
  await page.locator('#export-json-btn').click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}

for (const width of [1440, 375]) {
  test(`application identity and missing cells survive offline worker selection at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./');
    await context.setOffline(true);
    await page.locator('#file-input').setInputFiles(fixture('mixed-default'));
    await expect(page.locator('#stream-select-a')).toBeVisible();
    await expect(page.locator('#stream-select-a')).toHaveValue('app:["game.exe","0x1"]');
    const game = await report(page);
    expect(game.source.application).toBe('game.exe');
    expect(game.metrics).toMatchObject({ frameCount: 3, averageFps: 100, masdMs: 0, stutter: { stutterEventCount: 0 } });
    await page.locator('#stream-select-a').selectOption('app:["dwm.exe","0x1"]');
    await expect(page.locator('#tile-grid-a')).toContainText('25.0');
    const compositor = await report(page);
    expect(compositor.source.application).toBe('dwm.exe');
    expect(compositor.metrics).toMatchObject({ frameCount: 2, averageFps: 25, masdMs: 0 });
    await page.locator('#stream-select-a').selectOption('app:["game.exe","0x1"]');
    await expect(page.locator('#tile-grid-a')).toContainText('100.0');
    expect((await report(page)).metrics).toEqual(game.metrics);
    if (process.env.STUTTERSCOPE_IDENTITY_EVIDENCE) {
      await mkdir(process.env.STUTTERSCOPE_IDENTITY_EVIDENCE, { recursive: true });
      await page.locator('#trace-chart').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
      await page.screenshot({ path: `${process.env.STUTTERSCOPE_IDENTITY_EVIDENCE}/${testInfo.project.name}-${width}.png`, fullPage: true });
    }
    await page.locator('#file-input').setInputFiles(fixture('blank-pid'));
    await expect(page.locator('.warn-note summary')).toContainText('1 row');
    await page.locator('.warn-note summary').click();
    await expect(page.locator('.warn-note')).toContainText('line 3: missing ProcessID');
    const missing = await report(page);
    expect(missing.metrics).toMatchObject({ frameCount: 2, masdMs: null, pacingCoverage: { observedPairs: 0, gapBoundaries: 1 } });
    expect(missing.episodes.map(e => e.firstSourceLine)).toEqual([2, 4]);
    await page.locator('#file-input').setInputFiles(fixture('all-unidentified'));
    await expect(page.getByRole('alert')).toContainText('missing Application');
    await page.locator('#file-input').setInputFiles(fixture('mixed-presentmon1'));
    await expect(page.locator('#stream-select-a')).toBeVisible();
    const pm1 = await report(page);
    expect(pm1.source.format).toBe('presentmon1');
    expect(pm1.metrics).toMatchObject({ frameCount: 3, averageFps: 100, masdMs: 0 });
    await page.locator('#file-input').setInputFiles(fixture('mixed-default'));
    await expect(page.locator('#stream-select-a')).toBeVisible();
    expect((await report(page)).metrics).toEqual(game.metrics);
    if (process.env.STUTTERSCOPE_IDENTITY_EVIDENCE) {
      await writeFile(`${process.env.STUTTERSCOPE_IDENTITY_EVIDENCE}/${testInfo.project.name}-${width}.json`, JSON.stringify({ game, compositor, missing, pm1, errors }, null, 2) + '\n');
    }
    expect(errors).toEqual([]);
  });
}
