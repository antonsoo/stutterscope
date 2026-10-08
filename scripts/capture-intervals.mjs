// Serve the production build first; these screenshots use the retained measured capture.
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}docs/assets`;
const evidenceDir = `${root}docs/verification`;
const url = process.argv[2] ?? "http://127.0.0.1:4194/stutterscope/";
await mkdir(output, { recursive: true });
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch();
const assets = [];
const errors = [];
const externalRequests = [];
const cspViolations = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(url).origin) externalRequests.push(request.url());
  });
  await page.exposeFunction("recordCsp", (directive) => cspViolations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => window.recordCsp(event.violatedDirective)));
  await page.goto(url);
  await page.getByRole("button", { name: "Open recorded comparison" }).click();
  await expect(page.locator("#interval-b .interval-applied")).toHaveText("Interval applied");
  await page.evaluate(() => document.fonts.ready);

  async function remember(file) {
    assets.push({ file, sha256: sha256(await readFile(`${output}/${file}`)) });
  }
  async function download(selector, file) {
    const pending = page.waitForEvent("download");
    await page.locator(selector).click();
    const result = await pending;
    await result.saveAs(file);
    return readFile(file, "utf8");
  }
  // Compare all report fields with the compiled CLI; only generation time can differ.
  const exported = JSON.parse(await download("#export-json-btn", `${evidenceDir}/interval-browser-report.json`));
  const cli = JSON.parse(execFileSync(process.execPath, [
    `${root}dist-cli/cli/index.js`, "compare",
    `${root}examples/controlled-browser/controlled-a.csv`, `${root}examples/controlled-browser/controlled-b.csv`,
    "--start", "1.5", "--end", "8.5", "--json",
  ], { encoding: "utf8" }));
  const withoutTimes = (value) => JSON.parse(JSON.stringify(value, (key, item) => key === "generatedAt" ? undefined : item));
  expect(withoutTimes(exported)).toEqual(withoutTimes(cli));
  await download("#export-md-btn", `${evidenceDir}/interval-browser-report.md`);
  await download("#export-png-btn", `${output}/interval-report-card.png`);
  await remember("interval-report-card.png");

  const comparison = await page.locator("#comparison-panel").boundingBox();
  await page.screenshot({ path: `${output}/interval-comparison.png`, clip: { x: 0, y: 0, width: 1440, height: Math.ceil(comparison.y + comparison.height + 24) }, animations: "disabled" });
  await remember("interval-comparison.png");
  await page.locator("#inspect-episode-0").click();
  await page.evaluate(() => scrollTo(0, 0));
  const traceTop = await page.locator(".chart-panel").first().boundingBox();
  await page.evaluate((top) => scrollTo(0, top), traceTop.y);
  const trace = await page.locator(".chart-panel").first().boundingBox();
  const inspector = await page.locator("#episode-inspector").boundingBox();
  await page.screenshot({ path: `${output}/interval-evidence.png`, clip: { x: trace.x, y: trace.y, width: trace.width, height: Math.ceil(inspector.y + inspector.height - trace.y) }, animations: "disabled" });
  await remember("interval-evidence.png");

  await page.setViewportSize({ width: 375, height: 1000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await page.locator(".interval-panel").screenshot({ path: `${output}/interval-mobile.png`, animations: "disabled" });
  await remember("interval-mobile.png");
  await page.locator("#episode-inspector").screenshot({ path: `${output}/interval-evidence-mobile.png`, animations: "disabled" });
  await remember("interval-evidence-mobile.png");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#new-session-btn").click();
  await page.getByRole("button", { name: "MangoHud", exact: true }).click();
  await expect(page.locator(".timing-note summary")).toContainText("assume per-frame logging");
  await page.locator(".timing-note summary").click();
  await page.locator(".timing-note").screenshot({ path: `${output}/mangohud-clock-note.png`, animations: "disabled" });
  await remember("mangohud-clock-note.png");
  await download("#export-png-btn", `${output}/mangohud-clock-card.png`);
  await remember("mangohud-clock-card.png");

  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
  const result = { capturedAt: new Date().toISOString(), browser: browser.version(), node: process.version,
    source: "Retained controlled browser experiment; MangoHud images use the labeled synthetic sample.",
    browserCliReportsMatch: true, errors, externalRequests, cspViolations, assets };
  await writeFile(`${evidenceDir}/interval-screenshots.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
