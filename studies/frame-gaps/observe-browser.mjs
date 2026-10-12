// Real file imports, worker recomputation and downloads. Pass --verify for repaired behavior.
import { chromium, firefox } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const [url, directory, ...flags] = process.argv.slice(2);
const verify = flags.includes('--verify');
const out = resolve(directory);
await mkdir(out, { recursive: true });
const records = [];
async function report(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#export-json-btn').click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}
async function load(page, name, generic = true) {
  await page.locator('#file-input').setInputFiles(fileURLToPath(new URL(`fixtures/${name}.csv`, import.meta.url)));
  if (generic) {
    await page.locator('#map-column').selectOption('frame_time_ms');
    await page.locator('#map-kind').selectOption('frametime_ms');
    await page.getByRole('button', { name: 'Parse', exact: true }).click();
  }
  await page.waitForFunction(name => document.querySelector('.run-meta strong')?.textContent === name + '.csv' && !document.querySelector('#apply-settings-btn')?.disabled, name);
  await page.locator('#workspace-section').waitFor({ state: 'visible' });
  await page.locator('#apply-settings-btn').waitFor({ state: 'visible' });
}
for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await type.launch();
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: width === 1440 ? 'dark' : 'light' });
    const page = await context.newPage();
    const errors = [], external = [], offlineRequests = [];
    let offline = false;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => {
      if (!/^https?:/.test(req.url())) return;
      if (new URL(req.url()).origin !== new URL(url).origin) external.push(req.url());
      if (offline) offlineRequests.push(req.url());
    });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await context.setOffline(true);
    offline = true;
    await load(page, 'hitches');
    const first = await report(page);
    await page.locator('#inspect-episode-0').click();
    const pacing = await page.locator('#tile-grid-a .tile').filter({ hasText: 'PACING' }).innerText();
    const screenshot = `${name}-${width}.png`;
    await page.locator('#workspace-section').screenshot({ path: join(out, screenshot), animations: 'disabled' });
    const observations = { first, pacing };
    if (name === 'chromium' && width === 1440) {
      const pending = page.waitForEvent('download');
      await page.locator('#export-png-btn').click();
      observations.card = 'report-card.png';
      await (await pending).saveAs(join(out, observations.card));
    }
    if (verify) {
      assert.equal(first.metrics.masdMs, null);
      assert.equal(first.metrics.stutter.hitchCount, 2);
      assert.equal(first.episodes.length, 2);
      assert.match(pacing, /No observed pairs/);
      assert.match(await page.locator('#episode-detail').innerText(), /source gap/i);
      // Recompute must use cached continuity, not just the initial parse result.
      await page.locator('#hitch-input').fill('100');
      await page.locator('#apply-settings-btn').click();
      await page.waitForFunction(() => document.querySelector('#settings-status')?.textContent.includes('hitch > 100'));
      observations.recomputed = await report(page);
      assert.equal(observations.recomputed.metrics.stutter.hitchCount, 1);
      assert.equal(observations.recomputed.metrics.masdMs, null);
      await page.locator('#interval-start-a').fill('0.06');
      await page.locator('#interval-end-a').fill('');
      await page.locator('#apply-interval-a').click();
      await page.waitForFunction(() => document.querySelector('#interval-status-a')?.textContent.includes('Actual coverage:'));
      observations.selected = await report(page);
      assert.equal(observations.selected.metrics.frameCount, 1);
      assert.deepEqual(observations.selected.analysis.continuity.gaps, [{ beforeFrame: 2, sourceLine: 4 }]);
      await page.locator('#entire-capture-a').click();
      await page.waitForFunction(() => document.querySelector('#interval-a .interval-applied')?.textContent === 'Entire capture');
      observations.restored = await report(page);
      assert.equal(observations.restored.metrics.pacingCoverage.gapBoundaries, 1);
      await page.locator('#hitch-input').fill('50');
      await page.locator('#apply-settings-btn').click();
      await page.waitForFunction(() => document.querySelector('#settings-status')?.textContent.includes('hitch > 50'));
      await load(page, 'regime');
      observations.regime = await report(page);
      assert.equal(observations.regime.metrics.masdMs, 0);
      assert.equal(observations.regime.metrics.stutter.stutterEventCount, 0);
      assert.equal(observations.regime.metrics.stutter.hitchCount, 1);
      await load(page, 'interleaved', false);
      observations.game = await report(page);
      assert.equal(observations.game.source.stream, '1:0x1');
      assert.equal(observations.game.metrics.masdMs, 60);
      assert.equal(observations.game.metrics.pacingCoverage.gapBoundaries, 1);
      await page.locator('#stream-select-a').selectOption('2:0x2');
      await page.waitForFunction(() => document.querySelector('#stream-select-a')?.value === '2:0x2' && !document.querySelector('#apply-settings-btn')?.disabled && document.querySelector('#tile-grid-a')?.textContent.includes('No observed pairs'));
      observations.overlay = await report(page);
      assert.equal(observations.overlay.source.stream, '2:0x2');
      assert.equal(observations.overlay.metrics.masdMs, null);
      // The browser carries the same report and gap provenance into Markdown.
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Markdown/ }).click();
      observations.markdown = await readFile(await (await pending).path(), 'utf8');
      assert.match(observations.markdown.replaceAll("\\", ""), /Pacing \(MASD, ms\) \| Unavailable/);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.deepEqual(offlineRequests.filter(url => !url.endsWith('.woff2')), []);
    records.push({ browser: name, version: browser.version(), width, errors, external, offlineRequests, overflow, screenshot, observations });
    await context.close();
  }
  await browser.close();
}
await writeFile(join(out, 'browsers.json'), JSON.stringify(records, null, 2) + '\n');
console.log(`${records.length} offline browser flows retained`);
