// node studies/native-json/browser.mjs BASE OUTPUT [--before] [--cli EXECUTABLE_JS]
// Fetch recordings with fetch.py first. No capture bytes are copied into results.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, firefox } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const [base, output, ...flags] = process.argv.slice(2);
assert(base && output, "BASE and OUTPUT are required");
const before = flags.includes("--before");
const cli = flags.includes("--cli") ? flags[flags.indexOf("--cli") + 1] : fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(output, { recursive: true });
const receipt = [];
for (const [engine, type] of [["chromium", chromium], ["firefox", firefox]]) {
  const browser = await type.launch();
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: "dark" });
    const page = await context.newPage();
    const errors = [], late = [], external = [], flows = [];
    let offline = false;
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (!/^https?:/.test(request.url())) return;
      if (offline) late.push(request.url());
      if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
    });
    await page.goto(base); await page.evaluate(() => document.fonts.ready);
    const appAssets = await page.evaluate(() => [...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map(el => el.src || el.href));
    await context.setOffline(true); offline = true;
    for (const item of manifest.files) {
      const path = fileURLToPath(new URL("./cache/" + item.file, import.meta.url));
      assert.equal(hash(await readFile(path)), item.sha256);
      const started = Date.now();
      await page.locator("#file-input").setInputFiles(path);
      const stem = `${engine}-${width}-${item.file.replace(/\.json$/, "")}`;
      if (before) {
        await page.waitForFunction(() => document.querySelector("#status-area")?.textContent.includes("Could not parse"));
        assert.equal(await page.locator("#workspace-section").isVisible(), false);
        const error = await page.locator("#status-area").innerText();
        assert.match(error, /CSV field|line is longer/);
        if (/Cyberpunk|exe-2/.test(item.file)) await page.locator("#dropzone-section").screenshot({ path: resolve(output, stem + ".png"), animations: "disabled" });
        flows.push({ file: item.file, sha256: item.sha256, imported: false, error });
      } else {
        await page.waitForFunction(filename => document.querySelector(".run-meta strong")?.textContent === filename && !document.querySelector("#apply-settings-btn")?.disabled, item.file, { timeout: 60_000 });
        const importMs = Date.now() - started;
        const run = spawnSync(process.execPath, [cli, "summary", path, "--json", "--events"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
        assert.equal(run.status, 0, run.stderr);
        const expected = JSON.parse(run.stdout);
        const pending = page.waitForEvent("download"); await page.locator("#export-json-btn").click();
        const bytes = await readFile(await (await pending).path()); const actual = JSON.parse(bytes);
        assert.equal(actual.schemaVersion, expected.schemaVersion);
        for (const key of ["source", "analysis", "episodes"]) assert.deepEqual(actual[key], expected[key], `${engine}/${item.file}/${key}`);
        assert.deepEqual(actual.metrics, expected.summary, `${engine}/${item.file}/metrics`);
        const reportFile = stem + "-report.json";
        await writeFile(resolve(output, reportFile), bytes);
        let screenshot, card;
        if (/Cyberpunk|exe-2/.test(item.file)) {
          screenshot = stem + ".png";
          await page.locator("#workspace-section").screenshot({ path: resolve(output, screenshot), animations: "disabled" });
          const pendingCard = page.waitForEvent("download"); await page.locator("#export-png-btn").click();
          card = stem + "-card.png"; await (await pendingCard).saveAs(resolve(output, card));
        }
        flows.push({ file: item.file, sha256: item.sha256, imported: true, importMs, completeCliParity: true,
          frames: actual.metrics.frameCount, averageFps: actual.metrics.averageFps, report: reportFile, reportSha256: hash(bytes), ...(screenshot ? { screenshot, card } : {}) });
      }
    }
    const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations;
    if (violations.length) await writeFile(resolve(output, `${engine}-${width}-axe.json`), JSON.stringify(violations, null, 2));
    const axe = violations.map(v => v.id);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const dataRequests = late.filter(url => !url.endsWith(".woff2"));
    assert.deepEqual(errors, []); assert.deepEqual(dataRequests, []); assert.deepEqual(external, []); assert.deepEqual(axe, []); assert(fits);
    receipt.push({ base, before, engine, browserVersion: browser.version(), width, appAssets, flows, errors, httpAfterDisconnect: late, dataRequestsAfterDisconnect: dataRequests, externalRequests: external, axeViolations: axe, noPageOverflow: fits });
    await context.close();
  }
  await browser.close();
}
await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(`${receipt.length} offline browser sessions; ${receipt.flatMap(r => r.flows).length} unmodified native-file imports`);
