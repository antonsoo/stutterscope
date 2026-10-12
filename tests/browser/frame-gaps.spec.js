import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function report(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#export-json-btn').click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}

test('source-gap evidence survives offline import, worker recomputation and interval restoration', async ({ page, context }) => {
  await page.goto('./');
  await context.setOffline(true);
  await page.locator('#file-input').setInputFiles(fileURLToPath(new URL('../../studies/frame-gaps/fixtures/hitches.csv', import.meta.url)));
  await page.locator('#map-column').selectOption('frame_time_ms');
  await page.locator('#map-kind').selectOption('frametime_ms');
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  const tile = page.locator('#tile-grid-a .tile').filter({ hasText: 'PACING' });
  await expect(tile).toContainText('No observed pairs');
  let r = await report(page);
  expect(r.metrics.masdMs).toBe(null);
  expect(r.episodes.map(e => e.frameCount)).toEqual([1, 1]);
  await page.locator('#hitch-input').fill('100');
  await page.locator('#apply-settings-btn').click();
  await expect(page.locator('#settings-status')).toContainText('hitch > 100');
  r = await report(page);
  expect(r.metrics.masdMs).toBe(null);
  expect(r.episodes.map(e => e.firstSourceLine)).toEqual([4]);
  await page.locator('#interval-start-a').fill('0.06');
  await page.locator('#apply-interval-a').click();
  await expect(page.locator('#interval-a .interval-applied')).toHaveText('Interval applied');
  r = await report(page);
  expect(r.analysis.continuity.gaps).toEqual([{ beforeFrame: 2, sourceLine: 4 }]);
  expect(r.metrics.frameCount).toBe(1);
  await page.locator('#entire-capture-a').click();
  await expect(page.locator('#interval-a .interval-applied')).toHaveText('Entire capture');
  r = await report(page);
  expect(r.metrics.pacingCoverage).toEqual({ observedPairs: 0, gapBoundaries: 1 });
});
