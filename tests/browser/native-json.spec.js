import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

const fixture = "tests/fixtures/capframex-json/session.json";
async function report(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#export-json-btn").click();
  return JSON.parse(await readFile(await (await pending).path(), "utf8"));
}

for (const width of [1440, 375]) test(`native JSON recordings, indices, intervals and paired reports work offline at ${width}px`, async ({ page, context }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("./");
  await context.setOffline(true);
  await expect(page.locator("#file-input")).toHaveAttribute("accept", /\.json/);
  await page.locator("#file-input").setInputFiles(fixture);
  await expect(page.locator("#capture-run-a")).toHaveValue("1");
  let value = await report(page);
  expect(value.metrics.frameCount).toBe(5);
  expect(value.episodes.map(e => e.firstSourceSample)).toEqual([1, 3]);
  expect(value.analysis.continuity.gaps).toEqual([{ beforeFrame: 3, sourceLine: null, sourceSample: 3 }]);
  await page.locator("#inspect-episode-1").click();
  await expect(page.locator("#episode-detail")).toContainText("native JSON indices 3");
  await expect(page.locator("#episode-detail")).toContainText("Runs[0].CaptureData.MsBetweenPresents");
  await expect(page.locator("#episode-detail thead")).toContainText("JSON index");
  await page.locator("#interval-start-a").fill("0.11");
  await page.locator("#interval-end-a").fill("0.31");
  await page.locator("#apply-interval-a").click();
  await expect(page.locator("#interval-evidence-a")).toContainText("3 frames excluded");
  value = await report(page);
  expect(value.metrics.frameCount).toBe(2);
  expect(value.episodes[0].firstSourceSample).toBe(3);
  await page.locator("#capture-run-a").selectOption("2");
  await expect(page.locator("#interval-start-a")).toHaveValue("0");
  await expect(page.locator("#capture-run-a")).toHaveValue("2");
  value = await report(page);
  expect(value.metrics.frameCount).toBe(4);
  expect(value.metrics.averageFps).toBe(50);
  expect(value.source.nativeCapture.selectedRun).toBe(2);
  expect(value.source.nativeCapture.frameTimePath).toBe("Runs[1].CaptureData.MsBetweenPresents");
  const choose = page.waitForEvent("filechooser");
  await page.locator("#add-compare-btn").click();
  await (await choose).setFiles(fixture);
  await expect(page.locator("#capture-run-b")).toHaveValue("1");
  value = await report(page);
  expect(value.runs.a.source.nativeCapture.selectedRun).toBe(2);
  expect(value.runs.a.metrics.frameCount).toBe(4);
  expect(value.runs.b.source.nativeCapture.selectedRun).toBe(1);
  expect(value.runs.b.metrics.frameCount).toBe(5);
  const mdDownload = page.waitForEvent("download");
  await page.locator("#export-md-btn").click();
  const md = await readFile(await (await mdDownload).path(), "utf8");
  expect(md).toContain("Native recording: 2 of 2");
  expect(md).toContain("Native recording: 1 of 2");
  await page.locator("#hitch-input").fill("120");
  await page.locator("#apply-settings-btn").click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 120");
  value = await report(page);
  expect(value.runs.a.source.nativeCapture.selectedRun).toBe(2);
  expect(value.runs.b.source.nativeCapture.selectedRun).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("an ambiguous native replacement retains the last completed report and can recover offline", async ({ page, context }) => {
  await page.goto("./"); await context.setOffline(true);
  await page.locator("#file-input").setInputFiles(fixture);
  await expect(page.locator("#capture-run-a")).toHaveValue("1");
  await page.locator("#file-input").setInputFiles({ name: "ambiguous.json", mimeType: "application/json", buffer: Buffer.from('{"Info":{},"Runs":[],"Runs":[{"CaptureData":{"MsBetweenPresents":[99]}}]}') });
  await expect(page.locator("#status-area")).toContainText("duplicate JSON member");
  expect((await report(page)).metrics.frameCount).toBe(5);
  await page.locator("#capture-run-a").selectOption("2");
  await expect(page.locator("#capture-run-a")).toHaveValue("2");
  expect((await report(page)).metrics.averageFps).toBe(50);
});

test("a damaged second recording cannot relabel the retained first recording", async ({ page, context }) => {
  const source = JSON.parse(await readFile(fixture, "utf8"));
  source.Runs[1].CaptureData.Dropped = [false];
  await page.goto("./"); await context.setOffline(true);
  await page.locator("#file-input").setInputFiles({ name: "damaged-second.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.locator("#capture-run-a")).toHaveValue("1");
  await page.locator("#capture-run-a").selectOption("2");
  await expect(page.locator("#status-area")).toContainText("Cannot align frame evidence");
  await expect(page.locator("#capture-run-a")).toHaveValue("1");
  let value = await report(page);
  expect(value.source.nativeCapture.selectedRun).toBe(1);
  expect(value.metrics.frameCount).toBe(5);
  await page.locator("#hitch-input").fill("120"); await page.locator("#apply-settings-btn").click();
  await expect(page.locator("#settings-status")).toContainText("hitch > 120");
  value = await report(page);
  expect(value.source.nativeCapture.selectedRun).toBe(1);
});
