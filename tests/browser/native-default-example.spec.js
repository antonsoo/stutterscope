import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

async function downloaded(page, selector, json = false) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const raw = await readFile(await (await pending).path(), "utf8");
  return json ? JSON.parse(raw) : raw;
}

for (const width of [1440, 375]) test(`native default example link and landing action at ${width}px`, async ({ page, context, browserName }) => {
  const errors = [], offlineRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.exampleCsp = [];
    document.addEventListener("securitypolicyviolation", event => window.exampleCsp.push(event.violatedDirective));
  });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("./?example=presentmon-default");
  await expect(page.locator(".run-meta strong")).toHaveText("trace5-filtered.csv");
  await page.evaluate(async () => {
    await document.fonts.load('12px "JetBrains Mono"', "0123456789");
    await document.fonts.ready;
  });
  await context.setOffline(true);
  const observe = request => { if (/^https?:/.test(request.url())) offlineRequests.push(request.url()); };
  page.on("request", observe);
  const report = await downloaded(page, "#export-json-btn", true);
  expect(report.source.format).toBe("presentmon");
  expect(report.source.application).toBe("PresentBench.exe");
  expect(report.metrics.frameCount).toBe(174);
  expect(report.metrics.pacingCoverage).toEqual({ observedPairs: 90, gapBoundaries: 83 });
  expect(report.metrics.telemetryCoverage.cpuGpuBusy).toEqual({ observedFrames: 174, unknownFrames: 0 });
  expect(report.metrics.telemetryCoverage.displayLatency).toEqual({ observedFrames: 174, unknownFrames: 0 });
  const markdown = await downloaded(page, "#export-md-btn");
  expect(markdown).toContain("90 adjacent pairs; 83 gaps");
  await expect(page.locator("#secondary-table-a")).toContainText("174/174 frames observed");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.exampleCsp)).toEqual([]);
  expect(offlineRequests.filter(url => !new URL(url).pathname.startsWith("/stutterscope/fonts/"))).toEqual([]);
  if (process.env.NATIVE_DEFAULT_EXAMPLE_EVIDENCE) {
    const output = process.env.NATIVE_DEFAULT_EXAMPLE_EVIDENCE;
    await mkdir(output, { recursive: true });
    const stem = `${browserName}-${width}`;
    await page.screenshot({ path: `${output}/${stem}.png`, fullPage: true, animations: "disabled" });
    await writeFile(`${output}/${stem}.json`, JSON.stringify({ url: page.url(), report, markdown,
      errors, offlineRequests, csp: await page.evaluate(() => window.exampleCsp) }, null, 2) + "\n");
  }
  page.off("request", observe);
  await context.setOffline(false);
  await page.locator("#new-session-btn").click();
  await expect(page.locator(".captured-example")).toContainText(["Recorded browser experiment", "Filtered native presents", "Native PresentMon 2.6 telemetry"]);
  await page.getByRole("button", { name: "Open native PresentMon 2.6", exact: true }).click();
  await expect(page.locator(".run-meta strong")).toHaveText("trace5-filtered.csv");
  expect((await downloaded(page, "#export-json-btn", true)).metrics).toEqual(report.metrics);
  // Its predecessor remains a different native file, not a renumbered capture.
  await page.goto("./?example=filtered-presents");
  await expect(page.locator(".run-meta strong")).toHaveText("filtered-presents.csv");
  const older = await downloaded(page, "#export-json-btn", true);
  expect(older.metrics.frameCount).toBe(175);
  expect(older.metrics.pacingCoverage).toEqual({ observedPairs: 91, gapBoundaries: 83 });
  expect(errors).toEqual([]);
});
