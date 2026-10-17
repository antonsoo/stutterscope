// Replay the public application after disconnecting; compare real downloads to an installed CLI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "@playwright/test";

const [base, output, cli] = process.argv.slice(2);
assert(base && output && cli, "browser.mjs URL OUTPUT_DIRECTORY INSTALLED_CLI");
await mkdir(output, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = [];
for (const [engine, type] of [["chromium", chromium], ["firefox", firefox]]) {
  const browser = await type.launch();
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(), errors = [], late = [], external = [];
    let offline = false;
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (!/^https?:/.test(request.url())) return;
      if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
      if (offline) late.push(request.url());
    });
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await context.setOffline(true); offline = true;
    const flows = [];
    async function load(name) {
      await page.locator("#file-input").setInputFiles(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
      await page.waitForFunction(filename => document.querySelector(".run-meta strong")?.textContent === filename && !document.querySelector("#apply-settings-btn")?.disabled, name);
    }
    async function downloaded(name, flags = []) {
      const source = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
      const process = spawnSync(globalThis.process.execPath, [cli, "summary", source, "--json", "--events", ...flags], { encoding: "utf8" });
      assert.equal(process.status, 0, process.stderr);
      const expected = JSON.parse(process.stdout);
      const pending = page.waitForEvent("download"); await page.locator("#export-json-btn").click();
      const bytes = await readFile(await (await pending).path()), actual = JSON.parse(bytes);
      for (const field of ["source", "analysis", "episodes"]) assert.deepEqual(actual[field], expected[field]);
      assert.deepEqual(actual.metrics, expected.summary);
      const file = `${engine}-${width}-${flows.length}.json`;
      await writeFile(resolve(output, file), bytes);
      flows.push({ name, flags, file, sha256: hash(bytes), matchesInstalledCli: true });
      return actual;
    }
    await load("complete.csv");
    assert.equal((await downloaded("complete.csv")).episodes.length, 1);
    await load("removed-block.csv");
    const report = await downloaded("removed-block.csv");
    assert.deepEqual(report.metrics.pacingCoverage, { observedPairs: 24, gapBoundaries: 1 });
    assert.equal(report.metrics.masdMs, 0); assert.equal(report.episodes.length, 2);
    await page.locator(".timing-note summary").click();
    assert.match(await page.locator(".timing-note").textContent(), /1 local elapsed\/frame-duration disagreement/);
    await page.locator("#inspect-episode-1").click();
    assert.match(await page.locator(".frame-evidence").textContent(), /Gap before/);
    const pendingMd = page.waitForEvent("download"); await page.locator("#export-md-btn").click();
    const markdown = await readFile(await (await pendingMd).path());
    assert.match(markdown.toString(), /24 adjacent pairs; 1 gaps between analyzed frames/);
    await writeFile(resolve(output, `${engine}-${width}.md`), markdown);
    const pendingPng = page.waitForEvent("download"); await page.locator("#export-png-btn").click();
    const png = await readFile(await (await pendingPng).path());
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    await writeFile(resolve(output, `${engine}-${width}-card.png`), png);
    await page.screenshot({ path: resolve(output, `${engine}-${width}.png`), fullPage: true, animations: "disabled" });
    await page.locator("#hitch-input").fill("100"); await page.locator("#apply-settings-btn").click();
    await page.waitForFunction(() => document.querySelector("#settings-status")?.textContent.includes("hitch > 100"));
    assert.equal((await downloaded("removed-block.csv", ["--hitch-ms", "100"])).episodes.length, 1);
    await page.locator("#interval-start-a").fill("0.6"); await page.locator("#apply-interval-a").click();
    await page.waitForFunction(() => document.querySelector("#interval-a .interval-applied")?.textContent === "Interval applied");
    await downloaded("removed-block.csv", ["--hitch-ms", "100", "--start", "0.6"]);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const dataRequests = late.filter(url => !new URL(url).pathname.endsWith(".woff2"));
    assert(fits); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(dataRequests, []);
    receipt.push({ engine, browserVersion: browser.version(), width, base, flows,
      markdown: { bytes: markdown.length, sha256: hash(markdown) }, png: { bytes: png.length, sha256: hash(png) },
      noPageOverflow: fits, pageErrors: errors, externalRequests: external, httpRequestsAfterDisconnect: late,
      nonFontHttpRequestsAfterDisconnect: dataRequests });
    await context.close();
  }
  await browser.close();
}
await writeFile(resolve(output, "browser.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt.map(r => ({ engine: r.engine, width: r.width, matchingDownloads: r.flows.length }))));
