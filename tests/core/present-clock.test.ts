import { describe, expect, it } from "vitest";
import { PresentClock } from "../../src/core/present-clock.ts";
import * as presentmon1 from "../../src/core/parsers/presentmon1.ts";
import * as ocat from "../../src/core/parsers/ocat.ts";
import * as capframex from "../../src/core/parsers/capframex.ts";
import * as frameview from "../../src/core/parsers/frameview.ts";
import { computeMetricsSummary } from "../../src/core/metrics.ts";

describe("native clock evidence after present filtering", () => {
  it("checks the capture clock even when an edited native file has no stream columns", () => {
    const series = ocat.parse("TimeInSeconds,MsBetweenPresents\n1.000000,10\n1.030000,10\n");
    expect([...series.gapBefore!]).toEqual([0, 1]);
    expect(series.meta.presentClockGaps).toBe(1);
    expect(series.meta.presentClockEvidence?.witnesses[0]).toMatchObject({ fromSourceLine: 2, toSourceLine: 3 });
    expect(() => ocat.parse("TimeInSeconds,MsBetweenPresents\n1.0,10\n", "capture.csv", { stream: "42" }))
      .toThrow(/no present-stream identities/);
  });
  it("breaks adjacency on a missing present and a reversed clock, without a duration guess", () => {
    const clock = new PresentClock();
    expect(clock.keep(0, "1.000000", "10.0000")).toBe(false);
    expect(clock.keep(0, "1.010000", "10.0000")).toBe(false);
    expect(clock.keep(0, "1.030000", "10.0000")).toBe(true);
    expect(clock.keep(0, "0.010000", "10.0000")).toBe(true);
    expect(clock.keep(0, "0.020000", "10.0000")).toBe(false);
    expect(clock.count(0)).toBe(2);
  });

  it("allows the combined precision of both timestamps and the native frame duration", () => {
    const clock = new PresentClock();
    // True 16.7ms intervals can round to adjacent whole hundredths of a second.
    expect(clock.keep(0, "0.00", "16.7000")).toBe(false);
    expect(clock.keep(0, "0.02", "16.7000")).toBe(false);
    expect(clock.keep(0, "0.03", "16.7000")).toBe(false);
    expect(clock.keep(0, "0.07", "16.7000")).toBe(true);
    expect(clock.keep(1, "1.000000e0", "1e1")).toBe(false);
    expect(clock.keep(1, "1.010000e0", "1e1")).toBe(false);
    expect(clock.keep(1, "1.030000e0", "1e1")).toBe(true);
    // A coarse frame duration cannot erase independently known clock reversal.
    expect(clock.keep(2, "1.000000", "1e10")).toBe(false);
    expect(clock.keep(2, "0.000000", "1e10")).toBe(true);
  });

  it("keeps clocks separate for interleaved streams and restarts unavailable anchors", () => {
    const clock = new PresentClock();
    expect(clock.keep(0, "1.000000", "10.0000")).toBe(false);
    expect(clock.keep(1, "0.500000", "10.0000")).toBe(false);
    expect(clock.keep(0, "1.010000", "10.0000")).toBe(false);
    expect(clock.keep(0, "NA", "10.0000")).toBe(false);
    expect(clock.keep(0, "2.000000", "10.0000")).toBe(false);
    expect(clock.keep(0, "2.010000", "10.0000")).toBe(false);
    expect(clock.count(0)).toBe(0);
  });

  it("bounds witnesses while preserving the count and exact physical source coordinates", () => {
    const clock = new PresentClock();
    for (let i = 0; i < 9; i++) clock.keep(0, (1 + i * 0.02).toFixed(6), "10.0000", i + 2);
    const evidence = clock.evidence(0)!;
    expect(clock.count(0)).toBe(8);
    expect(evidence.omittedWitnesses).toBe(3);
    expect(evidence.witnesses).toHaveLength(5);
    expect(evidence.witnesses[0]).toMatchObject({ fromSourceLine: 2, toSourceLine: 3, frameTimeMs: 10, kind: "unaccounted_interval" });
    expect(evidence.witnesses[0]!.elapsedMs).toBeCloseTo(20, 10);
    expect(evidence.witnesses[0]!.allowanceMs).toBeCloseTo(0.00105, 10);
    evidence.witnesses[0]!.fromSourceLine = 999;
    expect(clock.evidence(0)!.witnesses[0]!.fromSourceLine).toBe(2);
  });

  for (const [format, parser] of [["presentmon1", presentmon1], ["ocat", ocat], ["capframex", capframex], ["frameview", frameview]] as const) {
    it(`${format} preserves retained durations but excludes cross-gap pacing and episode pairs`, () => {
      const ft = format === "presentmon1" ? "msBetweenPresents" : "MsBetweenPresents";
      const extra = format === "presentmon1" ? ",msInPresentAPI" : format === "frameview" ? ",GPU0Util(%)" : "";
      const prefix = format === "capframex" ? "//GameName=Controlled\n" : "";
      const input = prefix + `Application,ProcessID,SwapChainAddress,TimeInSeconds,${ft}${extra}\n`
        + ["1.000000", "1.010000", "1.040000", "1.050000"].map(t => `game.exe,42,0x1,${t},10.0000${extra ? ",1" : ""}`).join("\n");
      const series = parser.parse(input);
      expect(Array.from(series.frameTimeMs)).toEqual([10, 10, 10, 10]);
      expect(Array.from(series.gapBefore!)).toEqual([0, 0, 1, 0]);
      expect(series.meta).toMatchObject({ skippedRows: 0, presentClockGaps: 1 });
      expect(computeMetricsSummary(series).pacingCoverage).toEqual({ observedPairs: 2, gapBoundaries: 1 });
      expect(Array.from(series.timeSec)).toEqual([0.01, 0.02, 0.03, 0.04]);
    });
  }
});
