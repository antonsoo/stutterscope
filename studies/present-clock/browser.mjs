// node studies/present-clock/browser.mjs BASE OUT [--verify] [--cli EXECUTABLE_JS]
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, firefox } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const [base, output, ...flags] = process.argv.slice(2);
const verify = flags.includes("--verify");
const cli = flags.includes("--cli") ? flags[flags.indexOf("--cli") + 1] : fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const evidence = JSON.parse(await readFile(new URL(`./results/${verify ? "after" : "before"}.json`, import.meta.url), "utf8"));
const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8")).cases;
assert.deepEqual(await readFile(new URL("../../examples/native-filtering/filtered-presents.csv", import.meta.url)),
  await readFile(new URL("./fixtures/test_case_5_v1-exclude-dropped.csv", import.meta.url)));
await mkdir(output, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = [];
for (const [engine, type] of [["chromium", chromium], ["firefox", firefox]]) {
  const browser = await type.launch();
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: width === 1440 ? "dark" : "light" });
    const page = await context.newPage(), errors = [], late = [], external = [];
    let offline = false;
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (!/^https?:/.test(request.url())) return;
      if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
      if (offline) late.push(request.url());
    });
    await page.goto(base); await page.evaluate(() => document.fonts.ready);
    await context.setOffline(true); offline = true;
    const flows = [];
    async function load(name) {
      const capture = cases.find(c => c.name === name);
      await page.locator("#file-input").setInputFiles(fileURLToPath(new URL("./" + capture.file, import.meta.url)));
      await page.waitForFunction(filename => document.querySelector(".run-meta strong")?.textContent === filename && !document.querySelector("#apply-settings-btn")?.disabled, capture.file.split("/").at(-1));
      await page.locator("#workspace-section").waitFor({ state: "visible" });
    }
    async function downloaded(name, extra = [], filename) {
      const capture = cases.find(c => c.name === name);
      let expected = evidence.cases.find(c => c.name === name).report;
      if (extra.length) {
        const result = spawnSync(process.execPath, [cli, "summary", fileURLToPath(new URL("./" + capture.file, import.meta.url)), "--json", "--events", ...capture.options, ...extra], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr); expected = JSON.parse(result.stdout);
      }
      if (filename) expected = { ...expected, source: { ...expected.source, fileName: filename } };
      const pending = page.waitForEvent("download"); await page.locator("#export-json-btn").click();
      const bytes = await readFile(await (await pending).path()), actual = JSON.parse(bytes);
      assert.equal(actual.schemaVersion, expected.schemaVersion);
      for (const key of ["source", "analysis", "episodes"]) assert.deepEqual(actual[key], expected[key], name + ":" + key);
      assert.deepEqual(actual.metrics, expected.summary, name + ":metrics");
      const stem = `${engine}-${width}-${name}-${flows.length}`;
      await writeFile(resolve(output, stem + ".json"), bytes);
      flows.push({ name, options: extra, ...(filename ? { bundledAlias: filename } : {}), file: stem + ".json", sha256: hash(bytes), matchesCompleteCliReport: true });
      return actual;
    }
    await load("test_case_5_v1-exclude-dropped");
    const native = await downloaded("test_case_5_v1-exclude-dropped");
    await page.locator("#tile-grid-a").screenshot({ path: resolve(output, `${engine}-${width}-native.png`) });
    if (verify) {
      assert.deepEqual(native.metrics.pacingCoverage, { observedPairs: 91, gapBoundaries: 83 });
      await page.locator(".timing-note summary").filter({ hasText: "83 native clock discontinuities" }).click();
      assert.match(await page.getByRole("region", { name: "Run A native clock witnesses" }).textContent(), /e-\d+/);
      await page.locator(".timing-note").screenshot({ path: resolve(output, `${engine}-${width}-clock.png`) });
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.map(v => v.id), []);
    }
    const png = page.waitForEvent("download"); await page.locator("#export-png-btn").click();
    await (await png).saveAs(resolve(output, `${engine}-${width}-card.png`));
    const md = page.waitForEvent("download"); await page.locator("#export-md-btn").click();
    const markdown = await readFile(await (await md).path(), "utf8");
    if (verify) { assert.match(markdown, /83.*clock discontinuities/); assert.match(markdown, /e-\d+/); }
    await writeFile(resolve(output, `${engine}-${width}-native.md`), markdown);
    await load("frameview-native-excerpt"); await downloaded("frameview-native-excerpt");
    await load("presentmon1-hitches");
    const hitches = await downloaded("presentmon1-hitches");
    await page.locator("#inspect-episode-0").click();
    await page.locator("#workspace-section").screenshot({ path: resolve(output, `${engine}-${width}-hitches.png`) });
    if (verify) {
      assert.equal(hitches.metrics.masdMs, null); assert.equal(hitches.episodes.length, 2);
      await page.locator("#hitch-input").fill("100"); await page.locator("#apply-settings-btn").click();
      await page.waitForFunction(() => document.querySelector("#settings-status")?.textContent.includes("hitch > 100"));
      await downloaded("presentmon1-hitches", ["--hitch-ms", "100"]);
      await page.locator("#interval-start-a").fill("0.06"); await page.locator("#apply-interval-a").click();
      await page.waitForFunction(() => document.querySelector("#interval-a .interval-applied")?.textContent === "Interval applied");
      await downloaded("presentmon1-hitches", ["--hitch-ms", "100", "--start", ".06"]);
      await page.locator("#entire-capture-a").click();
      await page.waitForFunction(() => document.querySelector("#interval-a .interval-applied")?.textContent === "Entire capture");
      await downloaded("presentmon1-hitches", ["--hitch-ms", "100"]);
      await page.locator("#hitch-input").fill("50"); await page.locator("#apply-settings-btn").click();
      await page.waitForFunction(() => document.querySelector("#settings-status")?.textContent.includes("hitch > 50"));
    }
    await load("interleaved-game"); await downloaded("interleaved-game");
    await page.locator("#stream-select-a").selectOption("43:0x2");
    await page.waitForFunction(() => document.querySelector("#stream-select-a")?.value === "43:0x2" && !document.querySelector("#stream-select-a")?.disabled);
    await downloaded("interleaved-overlay");
    await load("coarse-clock"); await downloaded("coarse-clock");
    let builtinExample;
    if (verify) {
      // The bundled example intentionally needs its own local HTTP download.
      // Keep the earlier cold, first-import-after-disconnect proof separate.
      await context.setOffline(false); offline = false;
      await page.getByRole("button", { name: "New session", exact: true }).click();
      const example = page.locator(".captured-example").filter({ has: page.locator("#native-example-btn") });
      await example.screenshot({ path: resolve(output, `${engine}-${width}-example.png`) });
      await page.locator("#native-example-btn").focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector(".run-meta strong")?.textContent === "filtered-presents.csv" && !document.querySelector("#apply-settings-btn")?.disabled);
      await context.setOffline(true); offline = true;
      await downloaded("test_case_5_v1-exclude-dropped", [], "filtered-presents.csv");
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.map(v => v.id), []);
      builtinExample = true;
    }
    const violations = (await new AxeBuilder({ page }).analyze()).violations.map(v => v.id);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const dataRequests = late.filter(url => !url.endsWith(".woff2"));
    assert.deepEqual(violations, []); assert(fits); assert.deepEqual(errors, []); assert.deepEqual(dataRequests, []); assert.deepEqual(external, []);
    receipt.push({ engine, version: browser.version(), width, flows, recomputationAndIntervals: verify, streamSelection: true, coarseRecovery: true, builtinExample,
      axeViolations: violations, noPageOverflow: fits, errors, httpRequestsAfterDisconnect: late, nonFontHttpRequestsAfterDisconnect: dataRequests, externalRequests: external });
    await context.close();
  }
  await browser.close();
}
await writeFile(resolve(output, "browser.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt.map(v => ({ engine: v.engine, width: v.width, workflows: v.flows.length, coarseRecovery: v.coarseRecovery }))));
