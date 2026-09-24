import { describe, expect, it } from "vitest";
import {
  averageFps,
  detectStutter,
  frameTimePercentiles,
  meanAbsoluteSuccessiveDifference,
  onePercentLow,
  pointOnePercentLow,
  sortedCopy,
  frameTimeHistogram,
  computeMetricsSummary,
  boundShare,
  droppedFrames,
} from "../../src/core/metrics.js";
import type { FrameSeries } from "../../src/core/types.js";

function seriesFromFrameTimes(frameTimeMs: number[], extra?: Partial<FrameSeries["channels"]>): FrameSeries {
  const ft = Float64Array.from(frameTimeMs);
  const timeSec = new Float64Array(ft.length);
  let acc = 0;
  for (let i = 0; i < ft.length; i++) {
    acc += ft[i]! / 1000;
    timeSec[i] = acc;
  }
  return {
    meta: { format: "generic", sourceFileName: "hand.csv", warnings: [], columns: [] },
    frameCount: ft.length,
    frameTimeMs: ft,
    timeSec,
    channels: extra ?? {},
  };
}

// [10, 10, 10, 40, 10] ms -> sum 80ms -> 5 frames / 0.08s = 62.5 fps.
const SPIKE = [10, 10, 10, 40, 10];

describe("averageFps", () => {
  it("is frames / total time, not the mean of per-frame fps", () => {
    const series = seriesFromFrameTimes(SPIKE);
    expect(averageFps(series)).toBeCloseTo(62.5, 10);

    // Mean of instantaneous fps would give (100+100+100+25+100)/5 = 85,
    // which is a materially different (and misleading) number.
    const meanInstant = (1000 / 10 + 1000 / 10 + 1000 / 10 + 1000 / 40 + 1000 / 10) / 5;
    expect(meanInstant).toBeCloseTo(85, 10);
    expect(averageFps(series)).not.toBeCloseTo(meanInstant, 1);
  });

  it("handles a steady capture", () => {
    const series = seriesFromFrameTimes([10, 10, 10, 10, 10]);
    expect(averageFps(series)).toBeCloseTo(100, 10);
  });
});

describe("frameTimePercentiles", () => {
  it("matches hand-computed linear-interpolation percentiles for [10,10,10,10,40]", () => {
    const sorted = sortedCopy(Float64Array.from(SPIKE)); // [10,10,10,10,40]
    const p = frameTimePercentiles(sorted);
    expect(p.p50).toBeCloseTo(10, 10);
    expect(p.p90).toBeCloseTo(28, 10); // index 3.6 -> 10 + 30*0.6
    expect(p.p95).toBeCloseTo(34, 10); // index 3.8 -> 10 + 30*0.8
    expect(p.p99).toBeCloseTo(38.8, 10); // index 3.96 -> 10 + 30*0.96
    expect(p.p999).toBeCloseTo(39.88, 10); // index 3.996 -> 10 + 30*0.996
  });
});

describe("1% / 0.1% lows", () => {
  it("computes both definitions and shows they can diverge", () => {
    const sorted = sortedCopy(Float64Array.from(SPIKE));
    const one = onePercentLow(sorted);
    expect(one.percentileMethodFps).toBeCloseTo(1000 / 38.8, 10);
    expect(one.meanOfSlowestMethodFps).toBeCloseTo(1000 / 40, 10);

    const pointOne = pointOnePercentLow(sorted);
    expect(pointOne.percentileMethodFps).toBeCloseTo(1000 / 39.88, 10);
    expect(pointOne.meanOfSlowestMethodFps).toBeCloseTo(1000 / 40, 10);
  });
});

describe("meanAbsoluteSuccessiveDifference", () => {
  it("is 0 for perfectly steady pacing", () => {
    expect(meanAbsoluteSuccessiveDifference(Float64Array.from([10, 10, 10, 10]))).toBe(0);
  });

  it("matches a hand-computed value for an uneven trace", () => {
    // |10-10| + |10-10| + |40-10| + |10-40| = 0+0+30+30 = 60, / 4 = 15
    expect(meanAbsoluteSuccessiveDifference(Float64Array.from(SPIKE))).toBeCloseTo(15, 10);
  });
});

describe("detectStutter", () => {
  it("flags a frame well above the local rolling median, not the ordinary ones", () => {
    const result = detectStutter(Float64Array.from(SPIKE), {
      windowRadius: 10,
      kMultiplier: 2.0,
      hitchThresholdMs: 50,
    });
    expect(Array.from(result.isStutter)).toEqual([0, 0, 0, 1, 0]);
    expect(result.stutterEventCount).toBe(1);
    expect(result.totalStutterTimeMs).toBeCloseTo(40, 10);
    expect(result.hitchCount).toBe(0); // 40ms < 50ms hitch threshold
  });

  it("counts hitches above the absolute threshold independently of k", () => {
    const result = detectStutter(Float64Array.from([10, 10, 10, 60, 10]), {
      windowRadius: 10,
      kMultiplier: 2.0,
      hitchThresholdMs: 50,
    });
    expect(result.hitchCount).toBe(1);
    expect(result.totalHitchTimeMs).toBeCloseTo(60, 10);
  });
});

describe("frameTimeHistogram", () => {
  it("buckets every frame exactly once", () => {
    const buckets = frameTimeHistogram(Float64Array.from(SPIKE), 4);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(SPIKE.length);
  });
});

describe("boundShare", () => {
  it("classifies each frame by whichever engine is busier", () => {
    const series = seriesFromFrameTimes([10, 10], {
      cpuBusyMs: Float64Array.from([6, 3]),
      gpuBusyMs: Float64Array.from([4, 8]),
    });
    const result = boundShare(series)!;
    expect(result.cpuBoundFrames).toBe(1);
    expect(result.gpuBoundFrames).toBe(1);
  });

  it("is null when CPU/GPU busy channels are unavailable", () => {
    expect(boundShare(seriesFromFrameTimes(SPIKE))).toBeNull();
  });
});

describe("droppedFrames", () => {
  it("counts dropped frames when the channel exists", () => {
    const series = seriesFromFrameTimes(SPIKE, { dropped: Uint8Array.from([0, 0, 1, 0, 0]) });
    const result = droppedFrames(series)!;
    expect(result.droppedCount).toBe(1);
    expect(result.droppedFraction).toBeCloseTo(0.2, 10);
  });

  it("is null when the format doesn't report dropped frames", () => {
    expect(droppedFrames(seriesFromFrameTimes(SPIKE))).toBeNull();
  });
});

describe("computeMetricsSummary", () => {
  it("assembles every metric without throwing on a minimal series", () => {
    const summary = computeMetricsSummary(seriesFromFrameTimes(SPIKE));
    expect(summary.frameCount).toBe(5);
    expect(summary.averageFps).toBeCloseTo(62.5, 10);
    expect(summary.dropped).toBeNull();
    expect(summary.boundShare).toBeNull();
    expect(summary.latency).toBeNull();
  });
});
