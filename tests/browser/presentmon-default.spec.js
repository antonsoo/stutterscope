import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

const evidenceDir = process.env.PRESENTMON_DEFAULT_EVIDENCE_DIR ?? "docs/assets/presentmon-default";

async function download(page, selector, json = false) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const text = await readFile(await (await pending).path(), "utf8");
  return json ? JSON.parse(text) : text;
}

for (const width of [1440, 375]) test(`PresentMon default native telemetry and both clocks survive offline exports at ${width}px`, async ({ page, context, browserName }) => {
  const errors = [], requests = [], csp = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.captureCspViolations = [];
    document.addEventListener("securitypolicyviolation", event => window.captureCspViolations.push(event.violatedDirective));
  });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("./");
  await page.evaluate(async () => {
    await document.fonts.load('12px "JetBrains Mono"', "0123456789");
    await document.fonts.ready;
  });
  await context.setOffline(true);
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  const receipts = [];
  for (const variant of ["default", "filtered", "qpc-ms-filtered", "cpu-only"]) {
    const name = `trace5-${variant}.csv`;
    await page.locator("#file-input").setInputFiles(`studies/presentmon-default/fixtures/${name}`);
    await expect(page.locator(".run-meta strong")).toHaveText(name);
    const report = await download(page, "#export-json-btn", true);
    expect(report.source.format).toBe("presentmon");
    expect(report.source.application).toBe("PresentBench.exe");
    expect(report.source.skippedRows).toBe(0);
    expect(report.metrics.dropped).toBeNull();
    expect(report.metrics.telemetryCoverage.dropped).toBeNull();
    if (variant === "default") {
      expect(report.metrics.frameCount).toBe(258);
      expect(report.metrics.telemetryCoverage.cpuGpuBusy).toEqual({ observedFrames: 258, unknownFrames: 0 });
      expect(report.metrics.telemetryCoverage.displayLatency).toEqual({ observedFrames: 174, unknownFrames: 84 });
      expect(report.metrics.latency.meanMs).toBeCloseTo(22.654643103448276, 11);
      await expect(page.locator("#secondary-table-a")).toContainText("174/258 frames observed");
    } else if (variant === "cpu-only") {
      expect(report.metrics.frameCount).toBe(379);
      expect(report.metrics.boundShare).toBeNull();
      expect(report.metrics.latency).toBeNull();
    } else {
      expect(report.metrics.pacingCoverage).toEqual({ observedPairs: 90, gapBoundaries: 83 });
      expect(report.source.presentClockEvidence).toMatchObject(variant === "filtered"
        ? { clockColumn: "TimeInMs", frameTimeReference: "toSourceLine" }
        : { clockColumn: "CPUStartQPCTimeInMs", frameTimeReference: "fromSourceLine", frameTimeColumn: "MsBetweenAppStart" });
      await expect(page.locator(".timing-note summary")).toContainText("83 native clock discontinuities");
      const markdown = await download(page, "#export-md-btn");
      expect(markdown).toContain("90 adjacent pairs; 83 gaps between analyzed frames");
      if (variant === "qpc-ms-filtered") {
        expect(markdown).toContain("earlier CSV row's MsBetweenAppStart");
        await page.locator(".timing-note summary").click();
        await expect(page.locator(".timing-note")).toContainText("earlier row's MsBetweenAppStart");
        const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(audit.violations).toEqual([]);
        if (process.env.UPDATE_PRESENTMON_DEFAULT_EVIDENCE) {
          await mkdir(evidenceDir, { recursive: true });
          await page.screenshot({ path: `${evidenceDir}/${browserName}-${width}.png`, fullPage: true, animations: "disabled" });
        }
      }
      receipts.push({ variant, report, markdown });
    }
    const compositor = report.source.streams.find(s => s.application === "dwm.exe");
    await page.locator("#stream-select-a").selectOption(compositor.id);
    await expect.poll(async () => (await download(page, "#export-json-btn", true)).source.stream).toBe(compositor.id);
    expect((await download(page, "#export-json-btn", true)).metrics.frameCount).toBe(compositor.frameCount);
    await page.locator("#stream-select-a").selectOption(report.source.stream);
    await expect.poll(async () => (await download(page, "#export-json-btn", true)).source.stream).toBe(report.source.stream);
    expect((await download(page, "#export-json-btn", true)).metrics).toEqual(report.metrics);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator("#file-input").setInputFiles("studies/presentmon-default/fixtures/trace5-filtered.csv");
  await expect(page.locator(".run-meta strong")).toHaveText("trace5-filtered.csv");
  await page.locator("#interval-start-a").fill("0.2");
  await page.locator("#interval-end-a").fill("0.8");
  await page.locator("#apply-interval-a").click();
  await expect(page.locator("#interval-a .interval-applied")).toHaveText("Interval applied");
  const interval = await download(page, "#export-json-btn", true);
  expect(interval.source.frameCount).toBe(174);
  expect(interval.source.presentClockGaps).toBe(83);
  expect(interval.metrics.frameCount).toBeGreaterThan(1);
  expect(interval.metrics.frameCount).toBeLessThan(174);
  expect(interval.metrics.telemetryCoverage.cpuGpuBusy.observedFrames).toBe(interval.metrics.frameCount);
  const selection = interval.analysis.selection;
  expect(selection.firstFrameIndex).toBeGreaterThan(0);
  expect(interval.analysis.continuity.gaps.every(g => g.beforeFrame > selection.firstFrameIndex && g.beforeFrame <= selection.lastFrameIndex + 1)).toBe(true);
  await page.locator("#hitch-input").fill("100");
  await page.locator("#apply-settings-btn").click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 100");
  const recomputed = await download(page, "#export-json-btn", true);
  expect(recomputed.analysis.selection).toEqual(interval.analysis.selection);
  expect(recomputed.source.presentClockEvidence).toEqual(interval.source.presentClockEvidence);
  expect(recomputed.metrics.telemetryCoverage).toEqual(interval.metrics.telemetryCoverage);
  receipts.push({ variant: "interval", report: recomputed });
  csp.push(...await page.evaluate(() => window.captureCspViolations));
  expect(csp).toEqual([]);
  expect(errors).toEqual([]);
  // Firefox can request another weight of the same local font after import.
  // No data/API request or external origin is allowed while working offline.
  const assets = new URL("assets/", page.url());
  expect(requests.every(url => {
    const request = new URL(url);
    return request.origin === assets.origin && request.pathname.startsWith(assets.pathname)
      && /^[^/]+\.woff2$/.test(request.pathname.slice(assets.pathname.length));
  })).toBe(true);
  if (process.env.UPDATE_PRESENTMON_DEFAULT_EVIDENCE) await writeFile(`${evidenceDir}/${browserName}-${width}.json`, JSON.stringify({ receipts, errors, requests, csp }, null, 2) + "\n");
});

test("the new format's sample link loads a labelled synthetic capture", async ({ page }) => {
  await page.goto("./");
  await page.locator('.sample-link[data-format="presentmon"]').click();
  await expect(page.locator(".run-meta strong")).toHaveText("presentmon-synthetic-demo.csv");
  const report = await download(page, "#export-json-btn", true);
  expect(report.source.format).toBe("presentmon");
  expect(report.source.application).toBe("stutterscope-synthetic-demo.exe");
  expect(report.metrics.frameCount).toBe(7969);
  expect(report.metrics.pacingCoverage.gapBoundaries).toBe(0);
});
