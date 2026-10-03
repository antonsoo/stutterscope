// Serve the production build first. All captures use explicitly synthetic inputs.
import { chromium, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../docs/assets/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.argv[2] ?? "http://127.0.0.1:4194/stutterscope/");
  await page.getByRole("button", { name: "PresentMon 2.x", exact: true }).click();
  await expect(page.locator(".run-meta strong")).toHaveText("presentmon2-synthetic-demo.csv");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/hero.png`, fullPage: true, animations: "disabled" });

  const frames = Array.from({ length: 7969 }, (_, i) => i === 1000 || i === 5000 ? "36" : (8 + (i % 61) / 15).toFixed(3));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Compare another run" }).click();
  await (await chooser).setFiles({
    name: "smoother-synthetic.csv", mimeType: "text/csv",
    buffer: Buffer.from(`frame_time_ms\n${frames.join("\n")}\n`),
  });
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page.locator("#comparison-table")).toContainText("smoother-synthetic.csv");
  await page.screenshot({ path: `${output}/comparison.png`, fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true, animations: "disabled" });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  await (await download).saveAs(`${output}/report-card.png`);
  expect(errors).toEqual([]);
  console.log("Captured desktop, comparison, mobile, and report-card images with no page errors.");
} finally {
  await browser.close();
}
