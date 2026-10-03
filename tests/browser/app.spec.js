import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import AxeBuilder from "@axe-core/playwright";

const fixture = fileURLToPath(new URL("../fixtures/presentmon2/sample.csv", import.meta.url));
const multi = fileURLToPath(new URL("../fixtures/presentmon2/multi-process.csv", import.meta.url));
const generic = { name: "custom.csv", mimeType: "text/csv", buffer: Buffer.from("frame_ms\n16\nbad\n32\n-3\n") };
const input = (page) => page.locator("#file-input");
const workspace = (page) => page.locator("#workspace-section");
const apply = (page) => page.getByRole("button", { name: "Apply settings", exact: true });

async function load(page, file = fixture) {
  await input(page).setInputFiles(file);
  await expect(workspace(page)).toBeVisible();
  await expect(page.locator("#status-area .progress-track")).toHaveCount(0);
}

async function compare(page, file = fixture) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Compare another run" }).click();
  await (await chooser).setFiles(file);
}

async function jsonReport(page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), "utf8"));
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4193") external.push(request.url());
  });
  await page.exposeFunction("browserEvidence", () => ({ errors, external }));
  await page.addInitScript(() => {
    window.policyViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.policyViolations.push(event.violatedDirective));
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      postMessage(request, ...rest) {
        if (request.type === "recompute" && window.delayRecomputeSlot === request.slot) {
          window.delayRecomputeSlot = null;
          window.heldRecomputeWorker = this;
          this.addEventListener("message", (event) => {
            if (event.data.requestId === request.requestId && event.data.type === "result") window.heldRecomputeDelivered = true;
          });
          window.releaseRecompute = () => super.postMessage(request, ...rest);
          return;
        }
        if (request.type === "parse" && window.delayNextSlot === request.slot) {
          window.delayNextSlot = null;
          window.heldWorker = this;
          window.releaseParse = () => super.postMessage(request, ...rest);
          return;
        }
        if (request.type === "recompute" && window.failRecomputeSlot === request.slot) {
          window.failRecomputeSlot = null;
          queueMicrotask(() => this.dispatchEvent(new ErrorEvent("error", { message: "test worker failure", cancelable: true })));
          return;
        }
        super.postMessage(request, ...rest);
      }
      terminate() {
        this.wasTerminated = true;
        super.terminate();
      }
    };
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.browserEvidence())).toEqual({ errors: [], external: [] });
  expect(await page.evaluate(() => window.policyViolations)).toEqual([]);
});

test("a newer import cancels its predecessor and exports only the selected capture", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => { window.delayNextSlot = "a"; });
  await input(page).setInputFiles(fixture);
  await expect.poll(() => page.evaluate(() => typeof window.releaseParse)).toBe("function");
  await load(page, multi);
  expect(await page.evaluate(() => window.heldWorker.wasTerminated)).toBe(true);
  await page.evaluate(() => window.releaseParse());
  await expect(page.locator(".run-meta strong")).toHaveText("multi-process.csv");
  expect((await jsonReport(page)).source.fileName).toBe("multi-process.csv");
});

test("cancelling the first import keeps the empty screen usable", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => { window.delayNextSlot = "a"; });
  await input(page).setInputFiles(fixture);
  await expect.poll(() => page.evaluate(() => typeof window.releaseParse)).toBe("function");
  await page.getByRole("button", { name: "Cancel import" }).click();
  expect(await page.evaluate(() => window.heldWorker.wasTerminated)).toBe(true);
  await expect(workspace(page)).toBeHidden();
  await expect(page.getByRole("status")).toContainText("import cancelled");
  await load(page);
});

test("New session retires an in-flight comparison and resets applied settings", async ({ page }) => {
  await page.goto("./");
  await load(page);
  await page.locator("#hitch-input").fill("25");
  await apply(page).click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 25 ms");
  await page.evaluate(() => { window.delayNextSlot = "b"; });
  await compare(page);
  await expect.poll(() => page.evaluate(() => typeof window.releaseParse)).toBe("function");
  await page.getByRole("button", { name: "New session" }).click();
  await expect(workspace(page)).toBeHidden();
  expect(await page.evaluate(() => window.heldWorker.wasTerminated)).toBe(true);
  await page.evaluate(() => window.releaseParse());
  await load(page);
  await expect(page.locator("#comparison-panel")).toHaveCount(0);
  await expect(page.locator("#hitch-input")).toHaveValue("50");
});

test("removing comparison cancels an in-flight process switch", async ({ page }) => {
  await page.goto("./");
  await load(page);
  await compare(page, multi);
  await expect(page.locator("#stream-select-b")).toBeVisible();
  const other = await page.locator("#stream-select-b").evaluate((select) => [...select.options].find((option) => option.value !== select.value).value);
  await page.evaluate(() => { window.delayNextSlot = "b"; });
  await page.locator("#stream-select-b").selectOption(other);
  await expect.poll(() => page.evaluate(() => typeof window.releaseParse)).toBe("function");
  await page.getByRole("button", { name: "Remove comparison" }).click();
  expect(await page.evaluate(() => window.heldWorker.wasTerminated)).toBe(true);
  await page.evaluate(() => window.releaseParse());
  await expect(page.locator("#comparison-panel")).toHaveCount(0);
  await expect(apply(page)).toBeEnabled();
});

for (const failure of ["manifest-http", "manifest-json", "download-http"]) {
  test(`sample ${failure} errors are visible and can retry`, async ({ page }) => {
    let first = true;
    const pattern = failure === "download-http" ? "**/presentmon2-synthetic-demo.csv" : "**/samples/manifest.json";
    await page.route(pattern, async (route) => {
      if (!first) return route.continue();
      first = false;
      await route.fulfill({ status: failure === "manifest-json" ? 200 : 503, body: "Unavailable" });
    });
    await page.goto("./");
    await page.getByRole("button", { name: "PresentMon 2.x", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not load the sample");
    await page.getByRole("button", { name: "Retry import" }).click();
    await expect(page.locator(".run-meta strong")).toHaveText("presentmon2-synthetic-demo.csv");
  });
}

test("a delayed sample download cannot supersede a chosen local capture", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let arrived = false;
  await page.route("**/samples/manifest.json", async (route) => {
    arrived = true;
    await gate;
    await route.fulfill({ json: [{ format: "presentmon2", file: "presentmon2-synthetic-demo.csv" }] });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "PresentMon 2.x", exact: true }).click();
  await expect.poll(() => arrived).toBe(true);
  await load(page);
  release();
  await expect(page.locator(".run-meta strong")).toHaveText("sample.csv");
  expect((await jsonReport(page)).source.fileName).toBe("sample.csv");
});

test("worker startup failure is actionable and Retry import creates a healthy worker", async ({ page }) => {
  let first = true;
  await page.route("**/parse.worker-*.js", async (route) => {
    if (!first) return route.continue();
    first = false;
    await route.fulfill({ contentType: "text/javascript", body: 'throw new Error("Injected startup failure");' });
  });
  await page.goto("./");
  await input(page).setInputFiles(fixture);
  await expect(page.getByRole("alert")).toContainText("worker stopped unexpectedly");
  await page.getByRole("button", { name: "Retry import" }).click();
  await expect(workspace(page)).toBeVisible();
});

test("settings validate without changing reports and apply on keyboard submission", async ({ page }) => {
  await page.goto("./");
  await load(page);
  await page.locator("#radius-input").fill("2.5");
  await apply(page).click();
  await expect(page.getByRole("alert")).toContainText("whole number");
  expect((await jsonReport(page)).analysis.stutterOptions.windowRadius).toBe(10);
  await page.locator("#radius-input").fill("3");
  await page.locator("#hitch-input").fill("501");
  await apply(page).click();
  await expect(page.getByRole("alert")).toContainText("between 5 and 500");
  await page.locator("#hitch-input").fill("25");
  await page.locator("#hitch-input").press("Enter");
  await expect(page.locator("#settings-status")).toContainText("hitch > 25 ms");
  await expect(page.locator("#hitch-input")).toBeFocused();
  const report = await jsonReport(page);
  expect(report.analysis.stutterOptions).toEqual({ kMultiplier: 2, windowRadius: 3, hitchThresholdMs: 25 });
  expect(report.metrics.stutter.hitchCount).toBe(1);
});

test("a failure updating B preserves both reports and retry restores its cached source", async ({ page }) => {
  await page.goto("./");
  await load(page);
  await compare(page);
  await expect(page.locator("#comparison-panel")).toBeVisible();
  await page.evaluate(() => { window.failRecomputeSlot = "b"; });
  await page.locator("#hitch-input").fill("25");
  await apply(page).click();
  await expect(page.getByRole("alert")).toContainText("Settings were not applied");
  await expect(page.locator("#comparison-table")).toContainText("Hitches (>50ms)");
  expect((await jsonReport(page)).analysis.stutterOptions.hitchThresholdMs).toBe(50);
  await apply(page).click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 25 ms");
  await expect(page.locator("#comparison-table")).toContainText("Hitches (>25ms)");
  expect((await jsonReport(page)).metrics.stutter.hitchCount).toBe(1);
});

test("mapping can be cancelled with Escape; exports retain mapping and skipped-row evidence", async ({ page }) => {
  await page.goto("./");
  await input(page).setInputFiles(generic);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(workspace(page)).toBeHidden();
  await input(page).setInputFiles(generic);
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(workspace(page)).toBeVisible();
  await expect(page.locator(".warn-note summary")).toContainText("Run A: 2 rows were skipped");
  const report = await jsonReport(page);
  expect(report.source.skippedRows).toBe(2);
  expect(report.source.warnings).toHaveLength(2);
  expect(report.source.genericMapping).toEqual({ valueColumn: "frame_ms", valueKind: "frametime_ms" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Markdown", exact: true }).click();
  const markdown = await readFile(await (await download).path(), "utf8");
  expect(markdown).toContain("Skipped rows: 2");
  expect(markdown).toContain("Column: frame\\_ms. Interpretation: frametime_ms.");
  await compare(page, generic);
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page.locator(".warn-note summary").last()).toContainText("Run B: 2 rows were skipped");
});

test("an in-flight settings result cannot overwrite a comparison loaded afterward", async ({ page }) => {
  await page.goto("./");
  await load(page);
  await page.evaluate(() => { window.delayRecomputeSlot = "a"; });
  await page.locator("#hitch-input").fill("25");
  await apply(page).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseRecompute)).toBe("function");
  await compare(page);
  await expect(page.locator("#comparison-panel")).toBeVisible();
  await page.evaluate(() => window.releaseRecompute());
  await expect.poll(() => page.evaluate(() => window.heldRecomputeDelivered)).toBe(true);
  await expect(page.locator("#comparison-table")).toContainText("Hitches (>50ms)");
  expect((await jsonReport(page)).analysis.stutterOptions.hitchThresholdMs).toBe(50);
  await expect(page.locator("#hitch-input")).toHaveValue("25");
  await apply(page).click();
  await expect(page.locator("#comparison-table")).toContainText("Hitches (>25ms)");
});

test("New session cancels a pending settings calculation without resurrecting the report", async ({ page }) => {
  await page.goto("./");
  await load(page);
  await page.evaluate(() => { window.delayRecomputeSlot = "a"; });
  await apply(page).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseRecompute)).toBe("function");
  await page.getByRole("button", { name: "New session" }).click();
  expect(await page.evaluate(() => window.heldRecomputeWorker.wasTerminated)).toBe(true);
  await page.evaluate(() => window.releaseRecompute());
  await expect(workspace(page)).toBeHidden();
  await load(page);
  await expect(apply(page)).toBeEnabled();
});

test("redraw and reset release observers and global chart handlers", async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Map();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = (name, handler, options) => {
      if (["mousemove", "mouseup", "resize", "scroll"].includes(name)) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
      }
      add(name, handler, options);
    };
    window.removeEventListener = (name, handler, options) => {
      listeners.get(name)?.delete(handler);
      remove(name, handler, options);
    };
    const observers = new Set();
    const NativeObserver = ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      observe(...args) { observers.add(this); super.observe(...args); }
      disconnect() { observers.delete(this); super.disconnect(); }
    };
    window.chartResources = () => ({
      listeners: [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0),
      observers: observers.size,
    });
  });
  await page.goto("./");
  const baseline = await page.evaluate(() => window.chartResources());
  await load(page);
  const loaded = await page.evaluate(() => window.chartResources());
  await expect(page.getByRole("button", { name: "Choose file…", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "sample.csv" })).toBeVisible();
  expect(loaded.observers).toBe(4);
  for (const threshold of [25, 50, 75]) {
    await page.locator("#hitch-input").fill(String(threshold));
    await apply(page).click();
    await expect(page.locator("#settings-status")).toContainText(`hitch > ${threshold} ms`);
    expect(await page.evaluate(() => window.chartResources())).toEqual(loaded);
    await expect(page.locator(".uplot")).toHaveCount(3);
  }
  await page.getByRole("button", { name: "New session" }).click();
  expect(await page.evaluate(() => window.chartResources())).toEqual(baseline);
  await expect(page.getByRole("button", { name: "Choose file…", exact: true })).toBeVisible();
});

test("loaded plots resize from desktop to phone and back without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./");
  await load(page, multi);
  for (const width of [375, 1500]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator(".uplot").evaluateAll((plots) => plots.every((plot) => Math.abs(plot.clientWidth - plot.parentElement.clientWidth) <= 1))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

for (const width of [1280, 375]) {
  test(`production comparison is accessible at ${width}px and exports a PNG`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    await page.getByRole("button", { name: "PresentMon 2.x", exact: true }).click();
    await expect(workspace(page)).toBeVisible();
    await compare(page, multi);
    await expect(page.locator("#comparison-panel")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`comparison-${width}.png`), fullPage: true });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PNG", exact: true }).click();
    const png = await download;
    await png.saveAs(testInfo.outputPath("report-card.png"));
    expect((await readFile(await png.path())).subarray(1, 4).toString()).toBe("PNG");
  });
}
