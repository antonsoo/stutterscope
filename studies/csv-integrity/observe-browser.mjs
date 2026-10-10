// Capture the real production app; no DOM or worker responses are replaced.
// node studies/csv-integrity/observe-browser.mjs http://127.0.0.1:4198/stutterscope/ after
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [url, label] = process.argv.slice(2);
if (!url || !/^(before|after)$/.test(label ?? "")) throw new Error("Expected preview URL and before|after");
const assets = new URL("../../docs/assets/csv-integrity/", import.meta.url);
await mkdir(assets, { recursive: true });
const browser = await chromium.launch();
const observations = [];
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== new URL(url).origin) external.push(request.url());
    });
    await page.goto(url);
    await page.locator("#file-input").setInputFiles(fileURLToPath(new URL("./fixtures/presentmon2-duplicate.csv", import.meta.url)));
    await page.waitForFunction(() => {
      const workspace = document.querySelector("#workspace-section");
      return document.querySelector('[role="alert"]') || (workspace && !workspace.hidden);
    });
    const workspaceVisible = await page.locator("#workspace-section").isVisible();
    let exported = null;
    if (workspaceVisible) {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export JSON", exact: true }).click();
      exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)));
    });
    await page.screenshot({ path: fileURLToPath(new URL(`${label}-${width}.png`, assets)), fullPage: true });
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    observations.push({ width, workspaceVisible, alert: await page.getByRole("alert").allTextContents(),
      exported, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      axeViolations: audit.violations.map(({ id, impact, nodes }) => ({ id, impact, elements: nodes.map((n) => n.target) })), errors, external });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(new URL(`./results/browser-${label}.json`, import.meta.url), JSON.stringify({ label, browser: "Chromium", observations }, null, 2) + "\n");
console.log(JSON.stringify(observations.map(({ width, workspaceVisible, alert, exported, ...rest }) => ({ width, workspaceVisible, alert, fps: exported?.metrics.averageFps, ...rest }))));
