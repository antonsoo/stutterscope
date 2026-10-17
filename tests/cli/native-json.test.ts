import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const fixture = fileURLToPath(new URL("../fixtures/capframex-json/session.json", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

describe("native JSON CLI workflows", () => {
  it("selects one saved recording and reports source indices in both terminal and JSON output", () => {
    const result = run("summary", fixture, "--capture-run", "1", "--events", "--json");
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { source: { nativeCapture: { selectedRun: number } }; summary: { frameCount: number }; episodes: Array<{ firstSourceSample: number }> };
    expect(report.source.nativeCapture.selectedRun).toBe(1);
    expect(report.summary.frameCount).toBe(5);
    expect(report.episodes.map(e => e.firstSourceSample)).toEqual([1, 3]);
    const terminal = run("summary", fixture, "--events");
    expect(terminal.stdout).toContain("Native recording 1 of 2");
    expect(terminal.stdout).toContain("JSON sample indices (zero-based)");
  });

  it("compares independent recordings from the same saved session with separate interval settings", () => {
    const result = run("compare", fixture, fixture, "--a-capture-run", "1", "--b-capture-run", "2", "--a-start", "0.11", "--a-end", "0.31", "--json");
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { runs: { a: { source: { nativeCapture: { selectedRun: number } }; metrics: { frameCount: number } }; b: { source: { nativeCapture: { selectedRun: number } }; metrics: { frameCount: number; averageFps: number } } } };
    expect(report.runs.a.source.nativeCapture.selectedRun).toBe(1);
    expect(report.runs.a.metrics.frameCount).toBe(2);
    expect(report.runs.b.source.nativeCapture.selectedRun).toBe(2);
    expect(report.runs.b.metrics.frameCount).toBe(4);
    expect(report.runs.b.metrics.averageFps).toBe(50);
  });

  it("refuses invalid run selection and mixing run/process selectors without producing a report", () => {
    for (const args of [["--capture-run", "3"], ["--capture-run", "0"], ["--stream", "scene.exe"]]) {
      const result = run("summary", fixture, ...args, "--json");
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/capture-run/);
    }
  });
});
