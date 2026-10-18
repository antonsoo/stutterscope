import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parsers/presentmon2.ts";
import { detectFormat } from "../../src/core/parsers/index.ts";
import { computeMetricsSummary } from "../../src/core/metrics.ts";
import { analyzeCapture } from "../../src/core/analysis.ts";

const native = (file: string) => readFileSync(new URL(`../../studies/presentmon2-clock/fixtures/${file}`, import.meta.url), "utf8");
const header = (column = "CPUStartTime") => `Application,ProcessID,SwapChainAddress,${column},FrameTime,CPUBusy,CPUWait\n`;
const row = (time: string, frame = "10.0000", pid = "42") => `game.exe,${pid},0x1,${time},${frame},1,1\n`;

describe("PresentMon 2.x CPU-start continuity", () => {
  for (const clock of ["CPUStartTime", "CPUStartQPCTime"]) {
    it(`${clock} compares elapsed starts to the EARLIER FrameTime`, () => {
      const series = parse(header(clock) + row("1000.0000", "10.0000")
        + row("1010.0000", "30.0000") + row("1040.0000", "5.0000"));
      expect(Array.from(series.gapBefore!)).toEqual([0, 0, 0]);
      // A long later frame cannot hide a lost interval after the earlier frame.
      const filtered = parse(header(clock) + row("1000.0000", "10.0000") + row("1030.0000", "100.0000"));
      expect(Array.from(filtered.gapBefore!)).toEqual([0, 1]);
      expect(filtered.meta.presentClockEvidence).toMatchObject({ clockColumn: clock,
        frameTimeReference: "fromSourceLine", witnesses: [{ fromSourceLine: 2, toSourceLine: 3, frameTimeMs: 10 }] });
    });
  }

  it("keeps interleaved CPU starts in separate streams and respects missing anchors", () => {
    const series = parse(header() + row("1000.0000") + row("2000.0000", "10.0000", "43")
      + row("1010.0000") + row("2030.0000", "10.0000", "43") + row("1020.0000"));
    expect(Array.from(series.gapBefore!)).toEqual([0, 0, 0]);
    const other = parse(header() + row("1000.0000") + row("2000.0000", "10.0000", "43")
      + row("1010.0000") + row("2030.0000", "10.0000", "43"), "capture.csv", { stream: "43" });
    expect(Array.from(other.gapBefore!)).toEqual([0, 1]);
    const missing = parse(header() + row("1000.0000") + row("NA") + row("3000.0000") + row("3010.0000"));
    expect(Array.from(missing.gapBefore!)).toEqual([0, 0, 0, 0]);
  });

  it("allows written rounding, detects reversal and leaves unsupported clocks unscaled", () => {
    const coarse = parse(header() + row("0", "0.1000") + row("1", "0.1000"));
    expect(Array.from(coarse.gapBefore!)).toEqual([0, 0]);
    const reversed = parse(header() + row("1000.0000") + row("900.0000"));
    expect(reversed.meta.presentClockEvidence?.witnesses[0]?.kind).toBe("reversed_clock");
    for (const clock of ["CPUStartQPC", "CPUStartDateTime", "TimeInSeconds"]) {
      const series = parse(header(clock) + row("1000000") + row("2000000"));
      expect(Array.from(series.gapBefore!)).toEqual([0, 0]);
      expect(series.meta.presentClockGaps).toBeUndefined();
    }
  });

  it("does not select one of two conflicting supported clock columns", () => {
    const series = parse("Application,CPUStartTime,CPUStartQPCTime,FrameTime,CPUBusy,CPUWait\n"
      + "game.exe,1000.0000,1000.0000,10,1,1\ngame.exe,2000.0000,1010.0000,10,1,1\n");
    expect(Array.from(series.gapBefore!)).toEqual([0, 0]);
  });

  it("splits rolling context and episodes at a forward-duration contradiction", () => {
    const series = parse(header() + row("1000.0000", "60.0000") + row("1200.0000", "120.0000"));
    const analysis = analyzeCapture(series);
    expect(analysis.summary.pacingCoverage).toEqual({ observedPairs: 0, gapBoundaries: 1 });
    expect(analysis.summary.masdMs).toBeNaN();
    expect(analysis.summary.stutter.hitchCount).toBe(2);
  });

  for (const clock of ["default", "qpc-ms"]) {
    it(`matches original native trace ordinals for ${clock}, with retained distributions unchanged`, () => {
      const complete = parse(native(`test_case_5-${clock}.csv`));
      const filteredName = clock === "default" ? "filtered" : "qpc-ms-filtered";
      const filtered = parse(native(`test_case_5-${filteredName}.csv`));
      const reference = computeMetricsSummary(complete);
      const summary = computeMetricsSummary(filtered);
      expect(reference.pacingCoverage).toEqual({ observedPairs: 257, gapBoundaries: 0 });
      expect(summary.frameCount).toBe(174);
      expect(summary.pacingCoverage).toEqual({ observedPairs: 90, gapBoundaries: 83 });
      expect(summary.masdMs).toBeCloseTo(0.31720222222222233, 12);
      expect(filtered.meta.skippedRows).toBe(0);
    });
  }

  for (const trace of [1, 5]) {
    it(`recognizes native trace ${trace} with GPU/display/input tracking disabled`, () => {
      const text = native(`test_case_${trace}-no-gpu.csv`);
      expect(detectFormat(text).best.format).toBe("presentmon2");
      const series = parse(text);
      expect(series.meta.streams!.length).toBeGreaterThan(1);
      expect(series.meta.selectedStream).toBeDefined();
      expect(series.channels.gpuBusyMs).toBeUndefined();
      expect(series.channels.dropped).toBeUndefined();
      expect(series.channels.displayLatencyMs).toBeUndefined();
    });
  }
});
