import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, sniff } from "../../src/core/parsers/presentmon.ts";
import { createParserFor, detectFormat } from "../../src/core/parsers/index.ts";
import { computeMetricsSummary } from "../../src/core/metrics.ts";
import { parseFileStreaming } from "../../src/core/stream.ts";

const native = (name: string) => readFileSync(new URL(`../../studies/presentmon-default/fixtures/${name}.csv`, import.meta.url), "utf8");
const header = "Application,ProcessID,SwapChainAddress,TimeInMs,MsBetweenPresents,MsCPUBusy,MsCPUWait,MsGPUBusy,MsUntilDisplayed\n";

describe("PresentMon default CSV metrics", () => {
  it("restores native telemetry without substituting CPU intervals for present durations", async () => {
    const text = native("trace5-default");
    expect(detectFormat(text).best.format).toBe("presentmon");
    const series = parse(text);
    const summary = computeMetricsSummary(series);
    expect(series.meta.selectedStream).toBe("24892:0x2A70D2CAC00");
    expect([...series.frameTimeMs.slice(0, 3)]).toEqual([11.0622, 11.0083, 10.9918]);
    expect([...series.channels.cpuBusyMs!.slice(0, 3)]).toEqual([10.5535, 10.4814, 10.4295]);
    expect(summary.frameCount).toBe(258);
    expect(summary.telemetryCoverage).toEqual({ dropped: null,
      cpuGpuBusy: { observedFrames: 258, unknownFrames: 0 },
      displayLatency: { observedFrames: 174, unknownFrames: 84 } });
    expect(summary.latency!.meanMs).toBeCloseTo(22.654643103448276, 12);
    // NA latency is missing latency, not a fabricated categorical drop outcome.
    expect(series.channels.dropped).toBeUndefined();
    expect(await parseFileStreaming(new Blob([text]), createParserFor("presentmon"), "capture.csv"))
      .toEqual(parse(text, "capture.csv"));
  });

  for (const variant of ["filtered", "qpc-ms-filtered"]) {
    it(`${variant} matches removed native ordinals with both clock/duration directions`, () => {
      const series = parse(native(`trace5-${variant}`));
      const summary = computeMetricsSummary(series);
      expect(summary.pacingCoverage).toEqual({ observedPairs: 90, gapBoundaries: 83 });
      expect(series.meta.presentClockEvidence).toMatchObject(variant === "filtered"
        ? { clockColumn: "TimeInMs", frameTimeReference: "toSourceLine" }
        : { clockColumn: "CPUStartQPCTimeInMs", frameTimeReference: "fromSourceLine", frameTimeColumn: "MsBetweenAppStart" });
      expect(summary.frameCount).toBe(174);
      expect(summary.averageFps).toBeCloseTo(88.50634254762356, 11);
      expect(series.meta.skippedRows).toBe(0);
    });
  }

  it("recognizes CPU-only native output and untouched upstream default fixtures", () => {
    const cpu = parse(native("trace5-cpu-only"));
    expect(cpu.channels.cpuBusyMs).toHaveLength(cpu.frameCount);
    expect(cpu.channels.gpuBusyMs).toBeUndefined();
    expect(cpu.channels.displayLatencyMs).toBeUndefined();
    for (const name of ["upstream-trace1", "upstream-trace5"]) {
      const text = native(name);
      expect(detectFormat(text).best.format).toBe("presentmon");
      expect(parse(text).meta.presentClockGaps).toBeUndefined(); // raw QPC has no known frequency
    }
  });

  it("uses exact header names and preserves the other native dialects", () => {
    expect(sniff("MsBetweenPresents,MsCPUBusy,MsCPUWaitExtra\n").confidence).toBe(0);
    expect(sniff("\"MsBetweenPresents,MsCPUBusy,MsCPUWait\"\n").confidence).toBe(0);
    expect(detectFormat(native("trace5-v2")).best.format).toBe("presentmon2");
    expect(detectFormat("Application,TimeInSeconds,MsBetweenPresents,Dropped\n").best.format).toBe("ocat");
  });

  it("keeps partial telemetry in place across rejected rows and unknown cells", () => {
    const series = parse(header + "game.exe,42,0x1,1000.0000,10,3,1,NA,NA\n"
      + "game.exe,42,0x1,1010.0000,bad,999,999,999,999\n"
      + "game.exe,42,0x1,1020.0000,10,4,1,2,7\n"
      + "game.exe,42,0x1,1030.0000,10,NA,1,2,\n");
    expect([...series.channels.cpuBusyMs!]).toEqual([3, 4, NaN]);
    expect([...series.channels.gpuBusyMs!]).toEqual([NaN, 2, 2]);
    expect([...series.channels.displayLatencyMs!]).toEqual([NaN, 7, NaN]);
    expect([...series.sourceLine!]).toEqual([2, 4, 5]);
    expect([...series.gapBefore!]).toEqual([0, 1, 0]);
    expect(computeMetricsSummary(series).telemetryCoverage).toEqual({ dropped: null,
      cpuGpuBusy: { observedFrames: 1, unknownFrames: 2 },
      displayLatency: { observedFrames: 1, unknownFrames: 2 } });
  });

  it("does not interpret an ambiguous TimeInSeconds header as a known unit", () => {
    const text = "Application,TimeInSeconds,MsBetweenPresents,MsCPUBusy,MsCPUWait\n"
      + "game.exe,1000.0000,10,1,1\ngame.exe,1010.0000,10,1,1\n";
    expect(parse(text).meta.presentClockGaps).toBeUndefined();
    expect([...parse(text).gapBefore!]).toEqual([0, 0]);
  });
});
