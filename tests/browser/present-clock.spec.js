import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function report(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#export-json-btn").click();
  return JSON.parse(await readFile(await (await pending).path(), "utf8"));
}

for (const width of [1440, 375]) test(`native clock gaps survive offline imports, recomputation and exports at ${width}px`, async ({ page, context }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("./");
  await context.setOffline(true);
  await page.locator("#file-input").setInputFiles("studies/present-clock/fixtures/frameview-native-excerpt.csv");
  await expect(page.locator(".run-meta strong")).toHaveText("frameview-native-excerpt.csv");
  await expect(page.locator(".timing-note summary")).toContainText("1 native clock discontinuity");
  let value = await report(page);
  expect(value.metrics.pacingCoverage).toEqual({ observedPairs: 3, gapBoundaries: 1 });
  expect(value.metrics.masdMs).toBeCloseTo(0.15833333333333333, 12);
  expect(value.source.skippedRows).toBe(0);
  expect(value.source.presentClockGaps).toBe(1);
  expect(value.source.presentClockEvidence.witnesses[0]).toMatchObject({ fromSourceLine: 3, toSourceLine: 4, frameTimeMs: 4.439 });
  await page.locator(".timing-note summary").click();
  await expect(page.getByRole("region", { name: "Run A native clock witnesses" })).toContainText("9.249");
  expect(value.analysis.continuity.gaps).toEqual([{ beforeFrame: 3, sourceLine: 4 }]);
  await page.locator("#file-input").setInputFiles("studies/present-clock/fixtures/presentmon1-hitches.csv");
  await expect(page.locator(".run-meta strong")).toHaveText("presentmon1-hitches.csv");
  value = await report(page);
  expect(value.metrics.masdMs).toBe(null);
  expect(value.episodes).toHaveLength(2);
  await page.locator("#hitch-input").fill("100");
  await page.locator("#apply-settings-btn").click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 100");
  value = await report(page);
  expect(value.metrics.masdMs).toBe(null);
  expect(value.episodes).toHaveLength(1);
  expect(value.analysis.continuity.gaps).toEqual([{ beforeFrame: 2, sourceLine: 3 }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("the attributed native example is keyboard reachable, retries a failed download and recomputes offline", async ({ page, context }) => {
  let attempts = 0;
  await page.route("**/native-filtering/filtered-presents.csv", route => ++attempts === 1
    ? route.fulfill({ status: 503, body: "Temporary controlled failure" }) : route.continue());
  await page.goto("./");
  await page.locator("#native-example-btn").focus();
  await expect(page.locator("#native-example-btn")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#status-area")).toContainText("HTTP 503");
  await expect(page.locator("#workspace-section")).toBeHidden();
  await page.getByRole("button", { name: "Retry import", exact: true }).click();
  await expect(page.locator(".run-meta strong")).toHaveText("filtered-presents.csv");
  await context.setOffline(true);
  await page.locator("#hitch-input").fill("100"); await page.locator("#apply-settings-btn").click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 100");
  const value = await report(page);
  expect(value.metrics.pacingCoverage).toEqual({ observedPairs: 91, gapBoundaries: 83 });
  expect(value.source.presentClockGaps).toBe(83);
  expect(value.source.skippedRows).toBe(0);
  await context.setOffline(false);
  await page.goto("./?example=filtered-presents");
  await expect(page.locator(".run-meta strong")).toHaveText("filtered-presents.csv");
  expect((await report(page)).metrics.pacingCoverage).toEqual({ observedPairs: 91, gapBoundaries: 83 });
});
