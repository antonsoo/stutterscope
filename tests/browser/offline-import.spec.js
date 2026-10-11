import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const telemetry = fileURLToPath(new URL("../../examples/telemetry/controlled-partial-presentmon2.csv", import.meta.url));
const missing = fileURLToPath(new URL("../../studies/timestamp-gaps/missing.csv", import.meta.url));
const invalid = fileURLToPath(new URL("../../studies/csv-integrity/fixtures/presentmon2-duplicate.csv", import.meta.url));

async function report(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  return JSON.parse(await readFile(await (await pending).path(), "utf8"));
}

test("first local import, comparison, replacement and exports work after disconnecting", async ({ page, context }, testInfo) => {
  const errors = [], afterDisconnect = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.offlinePolicyViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.offlinePolicyViolations.push(event.violatedDirective));
  });
  // A fresh browser context has no warm worker cache. Disconnect before the
  // first file, rather than only testing an already parsed capture offline.
  await page.goto("./");
  await context.setOffline(true);
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) afterDisconnect.push({ url: request.url(), type: request.resourceType() });
  });
  await page.locator("#file-input").setInputFiles(telemetry);
  await expect(page.locator("#workspace-section")).toBeVisible();
  const initial = await report(page);
  expect(initial.metrics.dropped).toEqual({ droppedCount: 1, observedFrames: 2, droppedFraction: 0.5 });

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Compare another run" }).click();
  await (await chooser).setFiles(missing);
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page.locator("#interval-b")).toBeVisible();
  const compared = await report(page);
  expect(compared.kind).toBe("comparison");
  expect(compared.runs.a.metrics).toEqual(initial.metrics);
  expect(compared.runs.b.metrics.frameCount).toBe(562);
  expect(compared.runs.b.episodes.map((episode) => episode.firstSourceLine)).toEqual([17, 541]);

  await page.locator("#interval-start-a").fill("0.032");
  await page.locator("#apply-interval-a").click();
  await expect(page.locator("#interval-a .interval-applied")).toHaveText("Interval applied");
  const selected = await report(page);
  expect(selected.runs.a.metrics.frameCount).toBe(2);
  expect(selected.runs.a.metrics.dropped).toBeNull();
  expect(selected.runs.b.metrics).toEqual(compared.runs.b.metrics);

  // New session terminates both workers. A later import must start another
  // worker with no network, including after a rejected local input.
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page.locator("#file-input").setInputFiles(invalid);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.locator("#file-input").setInputFiles(telemetry);
  await expect(page.locator("#workspace-section")).toBeVisible();
  expect((await report(page)).metrics).toEqual(initial.metrics);
  const markdown = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Markdown", exact: true }).click();
  expect(await readFile(await (await markdown).path(), "utf8")).toContain("50.0% of observed");
  // Font subsets can load lazily for newly displayed glyphs. Their offline
  // fallback is cosmetic; parsing, recomputation and exports need no HTTP.
  expect(afterDisconnect.filter((request) => request.type !== "font")).toEqual([]);
  expect(afterDisconnect.every((request) => new URL(request.url).origin === new URL(page.url()).origin)).toBe(true);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.offlinePolicyViolations)).toEqual([]);
  await testInfo.attach("offline-evidence", {
    contentType: "application/json",
    body: JSON.stringify({
      engine: testInfo.project.name, initial: initial.metrics,
      comparison: { a: compared.runs.a.metrics, b: compared.runs.b.metrics },
      selected: { a: selected.runs.a.metrics, b: selected.runs.b.metrics },
      newSessionReplacementMatches: true, malformedInputRejected: true,
      markdownDownloaded: true, requestsAfterDisconnect: afterDisconnect,
      pageErrors: errors, cspViolations: [],
    }, null, 2),
  });
});
