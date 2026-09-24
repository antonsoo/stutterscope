/**
 * Cross-checks the TypeScript metrics library against `scripts/oracle.py`,
 * which computes the same quantities with numpy from the same synthetic
 * frame-time trace (committed at tests/fixtures/oracle/). See that script
 * for how to regenerate the fixtures.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  averageFps,
  frameTimePercentiles,
  meanAbsoluteSuccessiveDifference,
  onePercentLow,
  pointOnePercentLow,
  sortedCopy,
} from "../../src/core/metrics.js";
import type { FrameSeries } from "../../src/core/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const oracleDir = join(here, "..", "fixtures", "oracle");

interface OracleExpected {
  frameCount: number;
  durationSec: number;
  averageFps: number;
  percentilesMs: { p50: number; p90: number; p95: number; p99: number; p999: number };
  onePercentLow: { percentileMethodFps: number; meanOfSlowestMethodFps: number };
  pointOnePercentLow: { percentileMethodFps: number; meanOfSlowestMethodFps: number };
  masdMs: number;
}

function loadFrameTimes(): Float64Array {
  const csv = readFileSync(join(oracleDir, "frametimes.csv"), "utf-8");
  const lines = csv.trim().split("\n").slice(1); // skip header
  return Float64Array.from(lines.map(Number));
}

function loadExpected(): OracleExpected {
  return JSON.parse(readFileSync(join(oracleDir, "expected.json"), "utf-8")) as OracleExpected;
}

function seriesFrom(frameTimeMs: Float64Array): FrameSeries {
  const timeSec = new Float64Array(frameTimeMs.length);
  let acc = 0;
  for (let i = 0; i < frameTimeMs.length; i++) {
    acc += frameTimeMs[i]! / 1000;
    timeSec[i] = acc;
  }
  return {
    meta: { format: "generic", sourceFileName: "oracle.csv", warnings: [], columns: [] },
    frameCount: frameTimeMs.length,
    frameTimeMs,
    timeSec,
    channels: {},
  };
}

const REL_TOL = 1e-9;

function expectCloseRelative(actual: number, expected: number, label: string): void {
  const diff = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  expect(diff / scale, `${label}: actual=${actual} expected=${expected}`).toBeLessThan(REL_TOL);
}

describe("metrics vs. numpy oracle", () => {
  const frameTimeMs = loadFrameTimes();
  const expected = loadExpected();
  const series = seriesFrom(frameTimeMs);
  const sorted = sortedCopy(frameTimeMs);

  it("agrees on frame count and duration", () => {
    expect(series.frameCount).toBe(expected.frameCount);
    expectCloseRelative(series.timeSec[series.timeSec.length - 1]!, expected.durationSec, "durationSec");
  });

  it("agrees on average FPS", () => {
    expectCloseRelative(averageFps(series), expected.averageFps, "averageFps");
  });

  it("agrees on frame-time percentiles (linear interpolation)", () => {
    const p = frameTimePercentiles(sorted);
    expectCloseRelative(p.p50, expected.percentilesMs.p50, "p50");
    expectCloseRelative(p.p90, expected.percentilesMs.p90, "p90");
    expectCloseRelative(p.p95, expected.percentilesMs.p95, "p95");
    expectCloseRelative(p.p99, expected.percentilesMs.p99, "p99");
    expectCloseRelative(p.p999, expected.percentilesMs.p999, "p999");
  });

  it("agrees on 1% low under both definitions", () => {
    const result = onePercentLow(sorted);
    expectCloseRelative(result.percentileMethodFps, expected.onePercentLow.percentileMethodFps, "1% percentile");
    expectCloseRelative(
      result.meanOfSlowestMethodFps,
      expected.onePercentLow.meanOfSlowestMethodFps,
      "1% mean-of-slowest",
    );
  });

  it("agrees on 0.1% low under both definitions", () => {
    const result = pointOnePercentLow(sorted);
    expectCloseRelative(
      result.percentileMethodFps,
      expected.pointOnePercentLow.percentileMethodFps,
      "0.1% percentile",
    );
    expectCloseRelative(
      result.meanOfSlowestMethodFps,
      expected.pointOnePercentLow.meanOfSlowestMethodFps,
      "0.1% mean-of-slowest",
    );
  });

  it("agrees on mean absolute successive difference", () => {
    expectCloseRelative(meanAbsoluteSuccessiveDifference(frameTimeMs), expected.masdMs, "masdMs");
  });
});
