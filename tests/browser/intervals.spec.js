import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import AxeBuilder from "@axe-core/playwright";

async function example(page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Open recorded comparison" }).click();
  await expect(page.locator("#interval-b .interval-applied")).toHaveText("Interval applied");
  await expect(page.locator("#apply-interval-a")).toBeEnabled();
}
async function report(page) {
  const download = page.waitForEvent("download");
  await page.locator("#export-json-btn").click();
  return JSON.parse(await readFile(await (await download).path(), "utf8"));
}
async function interval(page, slot, start, end) {
  await page.locator(`#interval-start-${slot}`).fill(String(start));
  await page.locator(`#interval-end-${slot}`).fill(end === null ? "" : String(end));
  await page.locator(`#interval-end-${slot}`).press("Enter");
  await expect(page.locator(`#interval-status-${slot}`)).toContainText("Actual coverage:");
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (new URL(request.url()).origin !== "http://127.0.0.1:4193") external.push(request.url()); });
  await page.exposeFunction("intervalBrowserEvidence", () => ({ errors, external }));
  await page.addInitScript(() => {
    window.intervalCsp = [];
    document.addEventListener("securitypolicyviolation", (event) => window.intervalCsp.push(event.violatedDirective));
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) {
        if (message.type === "recompute" && window.holdInterval) {
          window.holdInterval = false;
          window.heldIntervalWorker = this;
          window.releaseInterval = () => super.postMessage(message, ...rest);
          return;
        }
        if (message.type === "recompute" && window.failInterval) {
          window.failInterval = false;
          queueMicrotask(() => this.dispatchEvent(new ErrorEvent("error", { cancelable: true })));
          return;
        }
        super.postMessage(message, ...rest);
      }
      terminate() { this.wasTerminated = true; super.terminate(); }
    };
  });
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.intervalBrowserEvidence())).toEqual({ errors: [], external: [] });
  expect(await page.evaluate(() => window.intervalCsp)).toEqual([]);
});

test("recorded experiment opens both scene intervals, preserves evidence, and exports both runs offline", async ({ page, context }) => {
  await example(page);
  const result = await report(page);
  expect(result).toMatchObject({ schemaVersion: 4, kind: "comparison" });
  expect(result.runs.a.source.frameCount).toBe(543);
  expect(result.runs.a.metrics.frameCount).toBe(396);
  expect(result.runs.b.metrics.frameCount).toBe(420);
  expect(result.runs.a.analysis.selection.requested).toEqual({ startSec: 1.5, endSec: 8.5 });
  expect(result.runs.a.episodes.map((episode) => episode.firstSourceLine)).toEqual([115, 217, 319, 421]);
  expect(result.runs.b.episodes).toEqual([]);
  await page.locator("#inspect-episode-0").click();
  await expect(page.locator("#episode-detail .selected-episode")).toContainText("116.600");
  await expect(page.locator("#episode-detail .selected-episode")).toContainText("115");
  await context.setOffline(true);
  await interval(page, "a", 2.2, 2.34);
  await expect(page.locator("#interval-end-a")).toBeFocused();
  const small = await report(page);
  expect(small.runs.a.metrics.stutter.stutterEventCount).toBe(1);
  expect(small.runs.a.episodes[0].firstSourceLine).toBe(115);
  expect(small.runs.b.metrics).toEqual(result.runs.b.metrics);
  const md = page.waitForEvent("download");
  await page.locator("#export-md-btn").click();
  const text = await readFile(await (await md).path(), "utf8");
  expect(text).toContain("## Run A"); expect(text).toContain("## Run B");
  expect(text).toContain("Requested 2.2 to 2.34 s"); expect(text).toContain("Requested 1.5 to 8.5 s");
});

test("viewing an episode does not change statistics; Analyze visible trace applies the viewed interval", async ({ page }) => {
  await example(page);
  const before = await report(page);
  await page.locator("#inspect-episode-1").click();
  await page.locator("#zoom-episode").click();
  expect((await report(page)).runs.a.metrics).toEqual(before.runs.a.metrics);
  await page.locator("#use-trace-interval").click();
  await expect.poll(async () => (await report(page)).runs.a.metrics.frameCount).toBeLessThan(before.runs.a.metrics.frameCount);
  const selected = await report(page);
  expect(selected.runs.a.episodes).toHaveLength(1);
  expect(selected.runs.a.episodes[0].firstSourceLine).toBe(217);
  await page.locator("#trace-run").selectOption("b");
  await expect(page.locator("#episode-inspector")).toContainText("No frames meet");
  await page.locator("#entire-capture-b").click();
  await expect(page.locator("#interval-b .interval-applied")).toHaveText("Entire capture");
  await expect(page.locator("#episode-inspector .episode-table tbody tr")).toHaveCount(2);
  expect((await report(page)).runs.a.metrics).toEqual(selected.runs.a.metrics);
});

test("bad ranges and worker failures retain results; retry and settings preserve each interval", async ({ page }) => {
  await example(page);
  const before = await report(page);
  await page.locator("#interval-start-a").fill("20");
  await page.locator("#interval-end-a").fill("");
  await page.locator("#apply-interval-a").click();
  await expect(page.locator("#interval-error-a")).toContainText("No frame ends");
  expect((await report(page)).runs.a.metrics).toEqual(before.runs.a.metrics);
  await page.locator("#interval-start-a").fill("2.2"); await page.locator("#interval-end-a").fill("2.34");
  await page.evaluate(() => { window.failInterval = true; });
  await page.locator("#apply-interval-a").click();
  await expect(page.locator("#interval-error-a")).toContainText("worker stopped");
  expect((await report(page)).runs.a.metrics).toEqual(before.runs.a.metrics);
  await page.locator("#apply-interval-a").click();
  await expect(page.locator("#interval-status-a")).toContainText("Requested 2.2–2.34");
  await page.locator("#hitch-input").fill("150"); await page.locator("#apply-settings-btn").click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 150");
  const changed = await report(page);
  expect(changed.runs.a.analysis.selection.requested).toEqual({ startSec: 2.2, endSec: 2.34 });
  expect(changed.runs.b.analysis.selection.requested).toEqual({ startSec: 1.5, endSec: 8.5 });
  expect(changed.runs.a.metrics.stutter.hitchCount).toBe(0);
  expect(changed.runs.a.metrics.stutter.stutterEventCount).toBe(1);
});

test("cancel and a replacement source cannot receive an obsolete interval result", async ({ page }) => {
  await example(page);
  const before = await report(page);
  await page.evaluate(() => { window.holdInterval = true; });
  await page.locator("#entire-capture-a").click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseInterval)).toBe("function");
  await page.locator("#cancel-analysis").click();
  expect(await page.evaluate(() => window.heldIntervalWorker.wasTerminated)).toBe(true);
  await page.evaluate(() => window.releaseInterval());
  expect((await report(page)).runs.a.metrics).toEqual(before.runs.a.metrics);
  await interval(page, "a", 2.2, 2.34);
  await page.evaluate(() => { window.holdInterval = true; window.releaseInterval = null; });
  await page.locator("#entire-capture-a").click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseInterval)).toBe("function");
  await page.locator("#file-input").setInputFiles({ name: "new.csv", mimeType: "text/csv", buffer: Buffer.from("frame_ms\n10\n10\n10\n") });
  await page.locator("#map-confirm").click();
  await expect(page.locator(".run-title")).toContainText("new.csv");
  await page.evaluate(() => window.releaseInterval());
  const result = await report(page);
  expect(result.runs.a.source.fileName).toBe("new.csv");
  expect(result.runs.a.analysis.selection.requested).toBe(null);
  expect(result.runs.a.metrics.frameCount).toBe(3);
});

test("episode pages bound the table while filters retain complete downloadable evidence", async ({ page }) => {
  await page.goto("./");
  const content = "frame_ms\n" + Array.from({ length: 2000 }, (_, i) => i % 20 === 10 ? "100" : "10").join("\n");
  await page.locator("#file-input").setInputFiles({ name: 'large-<script>.csv', mimeType: "text/csv", buffer: Buffer.from(content) });
  await page.locator("#map-confirm").click();
  await expect(page.locator(".episode-table tbody tr")).toHaveCount(20);
  await page.locator("#episodes-next").click();
  await expect(page.locator(".episode-paging [role=status]")).toHaveText("21–40 of 100");
  await page.locator("#inspect-episode-20").click();
  await expect(page.locator(".frame-evidence tbody tr")).toHaveCount(11);
  await page.locator("#episode-filter").selectOption("hitches");
  await page.locator("#episode-order").selectOption("worst");
  const result = await report(page);
  expect(result.episodes).toHaveLength(100);
  expect(result.source.fileName).toBe('large-<script>.csv');
  expect(result.metrics.stutter.stutterEventCount).toBe(100);
});

for (const width of [1440, 375, 320]) {
  test(`interval and source-evidence controls are accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await example(page);
    await page.locator("#inspect-episode-0").click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(results.violations).toEqual([]);
    expect(await page.locator("#interval-start-a").evaluate((element) => element.clientWidth)).toBeGreaterThan(65);
    await page.locator("#interval-start-a").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#interval-end-a")).toBeFocused();
  });
}

test("periodic MangoHud logging cannot replace the current report with misleading frame metrics", async ({ page }) => {
  await example(page);
  const before = await report(page);
  const csv = "fps,frametime,cpu_load,elapsed\n100,10,40,0\n100,10,40,100000000\n100,10,40,200000000\n100,10,40,300000000\n";
  await page.locator("#file-input").setInputFiles({ name: "periodic-mangohud.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.locator("#status-area [role=alert]")).toContainText("Recapture with log_interval=0");
  expect((await report(page)).runs.a.metrics).toEqual(before.runs.a.metrics);
  await page.locator("#new-session-btn").click();
  await page.getByRole("button", { name: "MangoHud", exact: true }).click();
  await expect(page.locator(".timing-note summary")).toContainText("assume per-frame logging");
  await page.locator(".timing-note summary").click();
  await expect(page.locator(".timing-note")).toContainText("matching clock spans do not prove every frame was logged");
  expect((await report(page)).source.timingEvidence.status).toBe("compatible");
});
