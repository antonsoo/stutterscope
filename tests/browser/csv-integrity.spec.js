import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const fixture = (name) => fileURLToPath(new URL(`../../studies/csv-integrity/fixtures/${name}.csv`, import.meta.url));
const input = (page) => page.locator("#file-input");

async function report(page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), "utf8"));
}

for (const [name, message] of [
  ["presentmon2-duplicate", 'line 1: duplicate column "FrameTime" at columns 11 and 12'],
  ["quote-in-number", "line 3: CSV field 2: unexpected quote"],
  ["generic-duplicate", 'line 1: duplicate column "frame_ms" at columns 1 and 2'],
]) {
  test(`${name}: import refuses false metrics and a corrected capture can be exported`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("./");
    await input(page).setInputFiles(fixture(name));
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.locator("#workspace-section")).toBeHidden();
    await expect(page.locator("#mapping-dialog")).not.toBeVisible();
    // Retry must still refuse the same bytes rather than reuse partial worker state.
    await page.getByRole("button", { name: "Retry import" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await input(page).setInputFiles(fixture("quoted-commas-and-quotes"));
    await expect(page.locator("#workspace-section")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const exported = await report(page);
    expect(exported.source.fileName).toBe("quoted-commas-and-quotes.csv");
    expect(exported.metrics.frameCount).toBe(2);
    expect(exported.metrics.averageFps).toBeCloseTo(1000 / 55, 12);
    expect(exported.metrics.stutter.hitchCount).toBe(1);
    expect(errors).toEqual([]);
  });
}

test("a rejected replacement preserves the identity and export of the previous valid capture", async ({ page }) => {
  await page.goto("./");
  await input(page).setInputFiles(fixture("quoted-commas-and-quotes"));
  await expect(page.locator("#workspace-section")).toBeVisible();
  const before = await report(page);
  await input(page).setInputFiles(fixture("presentmon2-duplicate"));
  await expect(page.getByRole("alert")).toContainText('duplicate column "FrameTime"');
  await expect(page.locator(".run-meta strong")).toHaveText("quoted-commas-and-quotes.csv");
  const after = await report(page);
  // The export timestamp describes the new download, not a new analysis.
  delete before.generatedAt;
  delete after.generatedAt;
  expect(after).toEqual(before);
});
