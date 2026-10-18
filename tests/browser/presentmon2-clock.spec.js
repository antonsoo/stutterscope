import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function download(page, selector, json = false) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const text = await readFile(await (await pending).path(), "utf8");
  return json ? JSON.parse(text) : text;
}

for (const width of [1440, 375]) test(`native PresentMon 2.x clocks and CPU-only streams survive offline exports at ${width}px`, async ({ page, context }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("./");
  await context.setOffline(true);
  for (const kind of ["filtered", "qpc-ms-filtered"]) {
    const name = `test_case_5-${kind}.csv`;
    await page.locator("#file-input").setInputFiles(`studies/presentmon2-clock/fixtures/${name}`);
    await expect(page.locator(".run-meta strong")).toHaveText(name);
    await expect(page.locator(".timing-note summary")).toContainText("83 native clock discontinuities");
    await page.locator(".timing-note summary").click();
    await expect(page.locator(".timing-note")).toContainText("earlier row's FrameTime");
    const report = await download(page, "#export-json-btn", true);
    expect(report.source.format).toBe("presentmon2");
    expect(report.source.skippedRows).toBe(0);
    expect(report.metrics.pacingCoverage).toEqual({ observedPairs: 90, gapBoundaries: 83 });
    expect(report.metrics.masdMs).toBeCloseTo(0.31720222222222233, 12);
    expect(report.source.presentClockEvidence).toMatchObject({ frameTimeReference: "fromSourceLine",
      clockColumn: kind === "filtered" ? "CPUStartTime" : "CPUStartQPCTime" });
    expect(report.analysis.continuity.gaps).toHaveLength(83);
    const markdown = await download(page, "#export-md-btn");
    expect(markdown).toContain("90 adjacent pairs; 83 gaps between analyzed frames");
    expect(markdown).toContain("earlier CSV row's FrameTime");
    await page.locator("#hitch-input").fill("100");
    await page.locator("#apply-settings-btn").click();
    await expect(page.locator("#settings-status")).toContainText("hitch > 100");
    const recomputed = await download(page, "#export-json-btn", true);
    expect(recomputed.source.presentClockEvidence).toEqual(report.source.presentClockEvidence);
    expect(recomputed.metrics.pacingCoverage).toEqual(report.metrics.pacingCoverage);
    if (kind === "filtered") {
      await page.locator(".timing-note summary").click();
      await page.screenshot({ path: testInfo.outputPath(`presentmon2-${width}.png`), fullPage: true, animations: "disabled" });
    }
  }
  await page.locator("#file-input").setInputFiles("studies/presentmon2-clock/fixtures/test_case_5-no-gpu.csv");
  await expect(page.locator(".run-meta strong")).toHaveText("test_case_5-no-gpu.csv");
  await expect(page.locator("#stream-select-a")).toBeVisible();
  const cpuOnly = await download(page, "#export-json-btn", true);
  expect(cpuOnly.source.format).toBe("presentmon2");
  expect(cpuOnly.source.application).toBe("PresentBench.exe");
  expect(cpuOnly.metrics.frameCount).toBe(757);
  expect(cpuOnly.metrics.averageFps).toBeCloseTo(166.33642185131478, 10);
  expect(cpuOnly.metrics.telemetryCoverage.dropped).toBe(null);
  const compositor = cpuOnly.source.streams.find(s => s.application === "dwm.exe");
  await page.locator("#stream-select-a").selectOption(compositor.id);
  await expect.poll(async () => (await download(page, "#export-json-btn", true)).source.stream).toBe(compositor.id);
  const other = await download(page, "#export-json-btn", true);
  expect(other.metrics.frameCount).toBe(compositor.frameCount);
  await page.locator("#stream-select-a").selectOption(cpuOnly.source.stream);
  await expect.poll(async () => (await download(page, "#export-json-btn", true)).source.stream).toBe(cpuOnly.source.stream);
  expect((await download(page, "#export-json-btn", true)).metrics).toEqual(cpuOnly.metrics);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
