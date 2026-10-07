import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = `${root}src/cli/index.ts`;
const a = `${root}examples/controlled-browser/controlled-a.csv`;
const b = `${root}examples/controlled-browser/controlled-b.csv`;
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

it("compares independently selected intervals and includes both sources and every episode", () => {
  const result = run("compare", a, b, "--start", "1.5", "--end", "8.5", "--a-start", "2.2", "--a-end", "2.34", "--json");
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout) as { kind: string; runs: Record<string, { source: { frameCount: number }; metrics: { frameCount: number; averageFps: number; stutter: { stutterEventCount: number } }; analysis: { selection: { requested: { startSec: number; endSec: number } } }; episodes: { firstSourceLine: number }[] }> };
  expect(report.kind).toBe("comparison");
  expect(report.runs.a!.source.frameCount).toBe(543);
  expect(report.runs.a!.metrics.frameCount).toBe(2);
  expect(report.runs.a!.metrics.averageFps).toBeCloseTo(2 / 0.1333, 9);
  expect(report.runs.a!.episodes[0]?.firstSourceLine).toBe(115);
  expect(report.runs.b!.metrics.frameCount).toBe(420);
  expect(report.runs.b!.episodes).toHaveLength(0);
  expect(report.runs.a!.analysis.selection.requested).toEqual({ startSec: 2.2, endSec: 2.34 });
  expect(report.runs.b!.analysis.selection.requested).toEqual({ startSec: 1.5, endSec: 8.5 });
});

it("summary retains its existing summary field while exposing interval and line evidence", () => {
  const result = run("summary", a, "--start", "1.5", "--end", "8.5", "--events", "--json");
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout) as { summary: { frameCount: number }; episodes: { firstSourceLine: number }[]; analysis: { selection: { firstFrameIndex: number } } };
  expect(report.summary.frameCount).toBe(396);
  expect(report.analysis.selection.firstFrameIndex).toBe(70);
  expect(report.episodes.map((episode) => episode.firstSourceLine)).toEqual([115, 217, 319, 421]);
});

it.each([
  ["compare", a],
  ["compare", a, b, a],
  ["compare", a, b, "--a-start", "-1"],
  ["compare", a, b, "--b-start", "20"],
  ["compare", a, b, "--b-end", "NaN"],
  ["summary", a, "--start", ""],
  ["summary", a, "--start", "2", "--end", "1"],
  ["summary", a, "--a-start", "1"],
])("invalid comparison/range fails before writing a misleading report: %j", (...args) => {
  const result = run(...args);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toMatch(/\n\s+at /);
});
