import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

for (const width of [1440, 375]) {
  test(`missing timestamps remain missing in the worker and JSON export at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("./");
    for (const [name, frames, skipped] of [["missing", 562, 4], ["complete", 566, 0]]) {
      await page.locator("#file-input").setInputFiles(fileURLToPath(new URL(`../../studies/timestamp-gaps/${name}.csv`, import.meta.url)));
      await page.getByRole("button", { name: "Parse", exact: true }).click();
      await expect(page.locator("#workspace-section")).toBeVisible();
      if (skipped) {
        await expect(page.locator(".warn-note summary")).toContainText("4 rows were skipped");
        await page.locator(".warn-note summary").click();
        await expect(page.locator(".warn-note")).toContainText("line 154: cannot derive frame time");
      }
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export JSON", exact: true }).click();
      const report = JSON.parse(await readFile(await (await download).path(), "utf8"));
      expect(report.metrics.frameCount).toBe(frames);
      expect(report.metrics.stutter.hitchCount).toBe(2);
      expect(report.source.skippedRows).toBe(skipped);
      expect(report.episodes.map((episode) => episode.firstSourceLine)).toEqual([17, 541]);
    }
    expect(errors).toEqual([]);
  });
}
