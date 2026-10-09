import { describe, expect, it } from "vitest";
import { parseTextSync, parseFileStreaming } from "../../src/core/stream.ts";
import { createParserFor, presentmon2 } from "../../src/core/parsers/index.ts";
import { analyzeCapture } from "../../src/core/analysis.ts";
import { computeMetricsSummary } from "../../src/core/metrics.ts";
import type { SourceFormat } from "../../src/core/types.ts";

const header = "Application,ProcessID,SwapChainAddress,FrameTime,CPUBusy,GPUBusy,DisplayedTime,DisplayLatency";
const partial = `${header}\ngame,1,0x1,16,2,8,16,10\ngame,1,0x1,16,NA,NA,NA,NA\ngame,1,0x1,16,,,broken,\ngame,1,0x1,16,,,,\n`;

describe("optional telemetry coverage", () => {
  it("keeps usable frame times while excluding unknown outcomes from every denominator", async () => {
    const series = presentmon2.parse(partial);
    const streamed = await parseFileStreaming(new Blob([partial]), presentmon2.createParser(), "partial.csv");
    expect(streamed.channels).toEqual(series.channels);
    expect(Array.from(series.channels.dropped!)).toEqual([0, 1, 2, 2]);
    expect(Array.from(series.sourceLine!)).toEqual([2, 3, 4, 5]);
    const summary = computeMetricsSummary(series);
    expect(summary.averageFps).toBe(62.5);
    expect(series.meta.skippedRows).toBe(0);
    expect(summary.dropped).toEqual({ droppedCount: 1, observedFrames: 2, droppedFraction: 0.5 });
    expect(summary.telemetryCoverage).toEqual({
      dropped: { observedFrames: 2, unknownFrames: 2 },
      cpuGpuBusy: { observedFrames: 1, unknownFrames: 3 },
      displayLatency: { observedFrames: 1, unknownFrames: 3 },
    });
    expect(summary.boundShare?.gpuBoundFraction).toBe(1);
    expect(summary.latency).toMatchObject({ p99: 10, observedFrames: 1 });

    const unknown = analyzeCapture(series, undefined, { startSec: 0.032, endSec: null }).summary;
    expect(unknown.frameCount).toBe(2);
    expect(unknown.dropped).toBeNull();
    expect(unknown.boundShare).toBeNull();
    expect(unknown.latency).toBeNull();
    expect(Object.values(unknown.telemetryCoverage)).toEqual(
      Array.from({ length: 3 }, () => ({ observedFrames: 0, unknownFrames: 2 })),
    );
  });

  it.each<SourceFormat>(["presentmon1", "ocat", "capframex", "frameview", "generic"])(
    "%s treats a missing column differently from partially observed flags", (format) => {
      const column = format === "presentmon1" ? "msBetweenPresents" : "MsBetweenPresents";
      const mapping = { valueColumn: column, valueKind: "frametime_ms" as const, droppedColumn: "Dropped" };
      const parser = () => createParserFor(format, mapping);
      const absent = parseTextSync(`Application,ProcessID,${column}\ngame,1,16\n`, parser(), "no-flag.csv");
      expect(absent.channels.dropped).toBeUndefined();
      expect(computeMetricsSummary(absent).telemetryCoverage.dropped).toBeNull();
      const csv = `Application,ProcessID,${column},Dropped\ngame,1,16,1\ngame,1,16,\ngame,1,16,broken\ngame,1,16,0\n`;
      const series = parseTextSync(csv, parser(), "partial.csv");
      expect(computeMetricsSummary(series).dropped).toMatchObject({ droppedCount: 1, droppedFraction: 0.5, observedFrames: 2 });
    },
  );

  it("does not attribute another process's observations to the selected stream", () => {
    const other = Array.from({ length: 8 }, () => "overlay,2,0x2,16,2,8,NA,30").join("\n");
    const series = presentmon2.parse(partial + other, "multi.csv", { stream: "1:0x1" });
    expect(series.frameCount).toBe(4);
    expect(computeMetricsSummary(series).dropped?.droppedFraction).toBe(0.5);
    expect(computeMetricsSummary(series).telemetryCoverage.displayLatency?.observedFrames).toBe(1);
  });

  it("distinguishes explicit zero from negative, non-finite and missing durations", () => {
    const csv = `${header}\ngame,1,0x1,16,0,0,0,0\ngame,1,0x1,16,-1,4,-2,-3\ngame,1,0x1,16,Infinity,4,N/A,Infinity\n`;
    const summary = computeMetricsSummary(presentmon2.parse(csv));
    expect(summary.dropped).toMatchObject({ droppedCount: 0, observedFrames: 1 });
    expect(summary.latency).toMatchObject({ meanMs: 0, p99: 0, observedFrames: 1 });
    expect(summary.telemetryCoverage.cpuGpuBusy).toEqual({ observedFrames: 1, unknownFrames: 2 });
  });
});
