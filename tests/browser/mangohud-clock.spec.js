import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function download(page, selector, json = false) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const contents = await readFile(await (await pending).path(), "utf8");
  return json ? JSON.parse(contents) : contents;
}

for (const width of [1440, 375]) test(`local MangoHud clock gaps survive offline analysis and downloads at ${width}px`, async ({ page, context }, testInfo) => {
  const errors = [];
  const external = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== "http://127.0.0.1:4193") external.push(request.url()); });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("./");
  await context.setOffline(true);
  await page.locator("#file-input").setInputFiles("studies/mangohud-local-clock/fixtures/removed-block.csv");
  await expect(page.locator(".run-meta strong")).toHaveText("removed-block.csv");
  await page.locator(".timing-note summary").click();
  await expect(page.locator(".timing-note")).toContainText("1 local elapsed/frame-duration disagreement");
  await expect(page.locator(".episode-table tbody tr")).toHaveCount(2);
  await page.locator("#inspect-episode-1").click();
  await expect(page.locator(".episode-detail")).toContainText("A source gap interrupts this episode");
  await expect(page.locator(".frame-evidence")).toContainText("Gap before");
  const report = await download(page, "#export-json-btn", true);
  expect(report.metrics.pacingCoverage).toEqual({ observedPairs: 24, gapBoundaries: 1 });
  expect(report.metrics.masdMs).toBe(0);
  expect(report.source.timingEvidence).toMatchObject({ status: "unverified", discontinuousIntervals: 1,
    witnesses: [{ fromSourceLine: 11, toSourceLine: 12, elapsedMs: 480, frameTimeMs: 120 }] });
  expect(report.episodes).toHaveLength(2);
  expect(report.analysis.continuity.gaps).toEqual([{ beforeFrame: 11, sourceLine: 12 }]);
  const markdown = await download(page, "#export-md-btn");
  expect(markdown).toContain("1 local elapsed/frame-duration disagreement");
  expect(markdown).toContain("24 adjacent pairs; 1 gaps between analyzed frames");
  await page.screenshot({ path: testInfo.outputPath(`mangohud-${width}.png`), fullPage: true, animations: "disabled" });
  await page.locator("#hitch-input").fill("100");
  await page.locator("#apply-settings-btn").click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 100");
  const recomputed = await download(page, "#export-json-btn", true);
  expect(recomputed.episodes).toHaveLength(1);
  expect(recomputed.metrics.masdMs).toBe(0);
  expect(recomputed.source.timingEvidence).toEqual(report.source.timingEvidence);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
