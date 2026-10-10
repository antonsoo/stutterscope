import { describe, expect, it } from "vitest";
import { analyzeCapture, readAnalysisRange, selectFrames } from "../../src/core/analysis.ts";
import { slowEpisodes } from "../../src/core/episodes.ts";
import { parse } from "../../src/core/parsers/generic.ts";
import { parse as parsePresentMon } from "../../src/core/parsers/presentmon2.ts";
import { parseStreaming } from "../../src/core/parsers/generic.ts";
import { detectStutter } from "../../src/core/metrics.ts";

const mapping = { valueColumn: "frame_ms", valueKind: "frametime_ms" as const };
const source = () => parse(`frame_ms\n${Array(10).fill(10).join("\n")}\n\nbad\n200\n${Array(10).fill(10).join("\n")}\n80\n90\n${Array(10).fill(10).join("\n")}\n`, mapping);

describe("actual interval analysis", () => {
  it("keeps the whole boundary frame, original CSV position, and full-stream detection context", () => {
    const original = source();
    const result = analyzeCapture(original, undefined, { startSec: 0.11, endSec: 0.311 });
    expect([...result.series.frameTimeMs]).toEqual([200, 10]);
    expect([...result.series.sourceLine!]).toEqual([14, 15]);
    expect(result.selection).toMatchObject({ firstFrameIndex: 10, lastFrameIndex: 11, excludedBefore: 10, excludedAfter: 21 });
    expect(result.selection.startSec).toBeCloseTo(0.1, 12);
    expect(result.summary.durationSec).toBeCloseTo(0.21, 12);
    expect(result.summary.averageFps).toBeCloseTo(2 / 0.21, 12);
    expect(result.summary.percentilesMs.p99).toBeCloseTo(198.1, 12);
    expect(result.summary.stutter.stutterEventCount).toBe(1);
    expect(result.summary.stutter.totalStutterTimeMs).toBe(200);
    // Re-detecting the isolated two-frame interval would erase this known hitch's stutter flag.
    expect(detectStutter(result.series.frameTimeMs).stutterEventCount).toBe(0);
    const episode = slowEpisodes(result)[0]!;
    expect(episode).toMatchObject({ firstFrame: 11, lastFrame: 11, longestFrame: 11, firstSourceLine: 14, lastSourceLine: 14, stutterFrames: 1, hitchFrames: 1, totalTimeMs: 200, touchesSelectionStart: true });
    expect(original.frameCount).toBe(33);
    expect(original.frameTimeMs[0]).toBe(10);
    expect(result.series.meta.skippedRows).toBe(1);
  });

  it("partitions adjacent ranges without losing or double-counting boundary frames", () => {
    const s = parse("frame_ms\n0\n125\n0\n125\n250\n0\n500\n", mapping);
    const a = analyzeCapture(s, undefined, { startSec: 0, endSec: 0.25 });
    const b = analyzeCapture(s, undefined, { startSec: 0.25, endSec: null });
    expect([...a.series.sourceLine!, ...b.series.sourceLine!]).toEqual([...s.sourceLine!]);
    expect([...a.series.frameTimeMs]).toEqual([0, 125, 0, 125]);
    expect([...b.series.frameTimeMs]).toEqual([250, 0, 500]);
    expect(b.summary.durationSec).toBe(0.75);
    expect(b.summary.averageFps).toBe(4);
    expect([...b.series.timeSec]).toEqual([0.5, 0.5, 1]);
    expect(b.summary.masdMs).toBe(375);
  });

  it("does not lose a decimal boundary frame to accumulated floating-point rounding", () => {
    const s = parse(`frame_ms\n${"10\n".repeat(101)}`, mapping);
    expect(selectFrames(s, { startSec: 0, endSec: 1 }).series.frameCount).toBe(100);
    expect(selectFrames(s, { startSec: 1, endSec: null }).selection.firstFrameIndex).toBe(100);
  });

  it("filters optional channels and line references after choosing a process", () => {
    const s = parsePresentMon("Application,ProcessID,SwapChainAddress,FrameTime,CPUBusy,GPUBusy,DisplayLatency,DisplayedTime\n" +
      "game,7,x,125,20,40,12,1\nother,8,y,5,3,2,4,NA\n" +
      "game,7,x,250,80,20,33,NA\ngame,7,x,125,10,30,18,1\n", "stream.csv");
    const result = analyzeCapture(s, undefined, { startSec: 0.125, endSec: 0.375 });
    expect(result.series.frameCount).toBe(1);
    expect(result.series.meta.selectedStream).toBe("7:x");
    expect([...result.series.sourceLine!]).toEqual([4]);
    expect(result.summary.dropped?.droppedCount).toBe(1);
    expect(result.summary.boundShare?.cpuBoundFraction).toBe(1);
    expect(result.summary.latency?.p99).toBe(33);
    expect(result.summary.averageFps).toBe(4);
    expect(Number.isNaN(result.summary.masdMs)).toBe(true);
  });

  it("refuses empty and invalid ranges instead of producing a report of zeros", () => {
    for (const range of [{ startSec: 2, endSec: null }, { startSec: 0.11, endSec: 0.12 }, { startSec: -1, endSec: 1 }, { startSec: NaN, endSec: 1 }, { startSec: 1, endSec: 1 }, { startSec: 1, endSec: Infinity }]) {
      expect(() => analyzeCapture(source(), undefined, range)).toThrow(RangeError);
    }
    expect(() => readAnalysisRange("", "1")).toThrow();
    expect(readAnalysisRange("0.25", "")).toEqual({ startSec: 0.25, endSec: null });
    expect(selectFrames(source(), { startSec: 0, endSec: 100 }).selection.requested?.endSec).toBe(100);
  });

  it("reports adjacent flagged records as one episode with precise evidence and no cause", () => {
    const result = analyzeCapture(source());
    const episodes = slowEpisodes(result);
    expect(episodes).toHaveLength(2);
    expect(episodes[1]).toMatchObject({ firstFrame: 22, lastFrame: 23, frameCount: 2, stutterFrames: 2, hitchFrames: 2, longestFrame: 23, longestFrameMs: 90, totalTimeMs: 170, firstSourceLine: 25, lastSourceLine: 26 });
  });

  it("retains physical CSV lines across CRLF, blank lines, bad rows and streaming", async () => {
    const text = "frame_ms\r\n10\r\n\r\nbad\r\n30\r\n";
    const streamed = await parseStreaming(new Blob([text]), mapping, "source.csv");
    expect([...streamed.sourceLine!]).toEqual([2, 5]);
    const cumulative = parse("time\n0\n10\nbad\n20\n5\n30", { valueColumn: "time", valueKind: "timestamp_ms_cumulative" });
    expect([...cumulative.sourceLine!]).toEqual([3, 7]);
    expect([...cumulative.frameTimeMs]).toEqual([10, 25]);
  });

  it("skips finite input values that overflow when converted to frame milliseconds", () => {
    for (const [valueKind, value, good] of [["fps", "1e-320", "100"], ["frametime_s", "1e308", "0.01"]] as const) {
      const result = parse(`value\n${value}\n${good}\n`, { valueColumn: "value", valueKind });
      expect([...result.frameTimeMs]).toEqual([10]);
      expect([...result.sourceLine!]).toEqual([3]);
      expect(result.meta.skippedRows).toBe(1);
    }
  });
});
