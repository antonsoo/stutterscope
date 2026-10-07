// A controlled requestAnimationFrame capture, not a game/GPU benchmark.
// Usage: node scripts/capture-browser-workload.mjs --out /tmp/stutterscope-capture
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out") throw new Error("Usage: node scripts/capture-browser-workload.mjs --out <directory>");
const out = resolve(args[1]);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const captures = [];
try {
  for (const mode of ["a", "b"]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.setContent('<!doctype html><html><head><title>Controlled animation workload</title></head><body style="margin:0;background:#101513"><canvas width="960" height="540"></canvas></body></html>');
    const startedAt = new Date().toISOString();
    const captured = await page.evaluate(async (mode) => {
      const canvas = document.querySelector("canvas");
      const context = canvas.getContext("2d");
      const rows = [];
      const blocks = [];
      const scheduled = [{ at: 250, duration: 350, phase: "warmup" },
        ...(mode === "a" ? [2200, 4000, 5800, 7600].map((at) => ({ at, duration: 120, phase: "scene" })) : []),
        { at: 9300, duration: 250, phase: "tail" }];
      let first;
      let previous;
      let nextBlock = 0;
      let work = 0;
      await new Promise((done) => {
        const tick = (time) => {
          first ??= time;
          const elapsed = time - first;
          if (previous !== undefined) rows.push([rows.length + 1, time - previous, elapsed, elapsed < 1500 ? "warmup" : elapsed <= 8500 ? "scene" : "tail"]);
          previous = time;
          context.fillStyle = "#101513";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = mode === "a" ? "#7cffb2" : "#ffb454";
          for (let i = 0; i < 80; i++) {
            const x = (elapsed / 3 + i * 61) % canvas.width;
            context.fillRect(x, 20 + (i % 12) * 42, 16, 16);
          }
          if (elapsed >= 10000) { done(); return; }
          const block = scheduled[nextBlock];
          if (block && elapsed >= block.at) {
            const start = performance.now();
            do { for (let i = 0; i < 5000; i++) work += Math.sin(i + work % 11); } while (performance.now() - start < block.duration);
            blocks.push({ scheduledAtMs: block.at, targetBlockingMs: block.duration, observedBlockingMs: performance.now() - start, phase: block.phase, afterFrame: rows.length });
            nextBlock++;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { rows, blocks, work };
    }, mode);
    const csv = "frame,frame_time_ms,elapsed_ms,phase\n" + captured.rows.map(([frame, ms, elapsed, phase]) => `${frame},${ms.toFixed(9)},${elapsed.toFixed(9)},${phase}`).join("\n") + "\n";
    const file = `controlled-${mode}.csv`;
    await writeFile(join(out, file), csv);
    captures.push({ file, sha256: createHash("sha256").update(csv).digest("hex"), startedAt, frames: captured.rows.length, blocks: captured.blocks });
    await page.close();
  }
  await writeFile(join(out, "capture.json"), JSON.stringify({
    kind: "controlled-browser-capture", version: 1,
    description: "Actual requestAnimationFrame intervals in a headless Chromium animation. Both runs have deliberate warmup and tail blocking; A also has four deliberate 120 ms blocks during the scene. This measures this local browser experiment, not hardware gains or game presentation.",
    browser: browser.version(), headless: true, node: process.version,
    system: { platform: os.platform(), release: os.release(), architecture: os.arch(), logicalCpus: os.cpus().length },
    scriptSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
    suggestedInterval: { startSec: 1.5, endSec: 8.5 }, captures,
  }, null, 2) + "\n");
  console.log(`Captured ${captures.map((capture) => `${capture.file}: ${capture.frames} frames`).join("; ")}`);
} finally { await browser.close(); }
