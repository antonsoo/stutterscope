import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect, firefox } from "@playwright/test";

const { values } = parseArgs({ options: {
  url: { type: "string", default: "https://antonsoo.github.io/stutterscope/" },
  out: { type: "string" }, screenshots: { type: "string" },
} });
assert(values.out, "--out is required");
const results = [];
const fixtures = [
  ["missing-timestamps", new URL("../timestamp-gaps/missing.csv", import.meta.url)],
  ["partial-telemetry", new URL("../../examples/telemetry/controlled-partial-presentmon2.csv", import.meta.url)],
];
for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 375]) {
      for (const [name, fixture] of fixtures) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = [], external = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (new URL(request.url()).origin !== new URL(values.url).origin) external.push(request.url());
        });
        await page.goto(values.url);
        const input = await readFile(fixture);
        await page.locator("#file-input").setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: input });
        if (name === "missing-timestamps") await page.getByRole("button", { name: "Parse", exact: true }).click();
        await expect(page.locator("#workspace-section")).toBeVisible();
        const pending = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export JSON", exact: true }).click();
        const report = JSON.parse(await readFile(await (await pending).path(), "utf8"));
        if (name === "missing-timestamps") {
          assert.equal(report.metrics.frameCount, 562);
          assert.equal(report.metrics.stutter.hitchCount, 2);
          assert.equal(report.source.skippedRows, 4);
          assert.deepEqual(report.episodes.map((episode) => episode.firstSourceLine), [17, 541]);
          await page.locator(".warn-note summary").click();
          await expect(page.locator(".warn-note")).toContainText("line 154: cannot derive frame time");
        } else {
          assert.equal(report.metrics.frameCount, 4);
          assert.deepEqual(report.metrics.dropped, { droppedCount: 1, observedFrames: 2, droppedFraction: 0.5 });
          assert.deepEqual(report.metrics.telemetryCoverage.dropped, { observedFrames: 2, unknownFrames: 2 });
          await expect(page.locator("#secondary-table-a")).toContainText("2/4 frames observed");
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        if (values.screenshots && engine === "chromium") {
          await mkdir(values.screenshots, { recursive: true });
          await page.screenshot({ path: join(values.screenshots, `${name}-${width}.png`), fullPage: true, animations: "disabled" });
        }
        results.push({ engine, width, name, inputSha256: createHash("sha256").update(input).digest("hex"),
          inputBytes: input.length, report, errors, external, overflow });
        await page.close();
      }
    }
  } finally { await browser.close(); }
}
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify({ checkedAt: new Date().toISOString(), url: values.url, results }, null, 2) + "\n");
console.log(`${results.length} hosted worker imports and JSON exports verified.`);
