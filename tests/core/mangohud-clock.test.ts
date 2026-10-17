import { expect, it } from "vitest";
import { parse, sniff } from "../../src/core/parsers/mangohud.ts";
import { analyzeCapture } from "../../src/core/analysis.ts";
import { buildJsonReport } from "../../src/core/report.ts";
import { DEFAULT_STUTTER_OPTIONS } from "../../src/core/metrics.ts";
import { slowEpisodes } from "../../src/core/episodes.ts";
import { readFileSync } from "node:fs";

const header = "fps,frametime,cpu_load,elapsed\n";

it("refuses periodic snapshots that cover 300 ms instead of inventing a 40 ms capture", () => {
  const sampled = header + "100,10,40,0\n100,10,40,100000000\n100,10,40,200000000\n100,10,40,300000000\n";
  expect(() => parse(sampled)).toThrow(/0.300000 s of elapsed intervals versus 0.030000 s of frame durations/);
  expect(() => parse(sampled)).toThrow(/log_interval=0/);
});

it("also refuses repeated snapshots that overcount elapsed time", () => {
  const duplicateSamples = header + "10,100,40,0\n10,100,40,10000000\n10,100,40,20000000\n10,100,40,30000000\n";
  expect(() => parse(duplicateSamples)).toThrow(/0.030000 s of elapsed intervals versus 0.300000 s/);
});

it("uses adjacent usable records and excludes the first frame before the elapsed span", () => {
  const text = "os,cpu,gpu,ram,kernel,driver,cpuscheduler\nLinux,CPU,GPU,16,6,1,schedutil\n" + header +
    "10,100,40,10000000000\n100,10,40,10010000000\n25,40,40,10050000000\n100,10,40,10060000000\n";
  expect(sniff(text).confidence).toBeGreaterThan(0.9);
  const source = parse(text);
  expect(source.meta.timingEvidence).toMatchObject({ status: "compatible", comparedIntervals: 3 });
  expect(source.meta.timingEvidence!.observedSpanSec).toBeCloseTo(0.06, 12);
  expect(source.meta.timingEvidence!.recordedFrameSpanSec).toBeCloseTo(0.06, 12);
  expect([...source.sourceLine!]).toEqual([4, 5, 6, 7]);
  const result = analyzeCapture(source);
  expect(result.summary.durationSec).toBeCloseTo(0.16, 12);
  const exported = buildJsonReport(result.series, result.summary, DEFAULT_STUTTER_OPTIONS, undefined, result.selection);
  expect(exported.source.timingEvidence?.note).toContain("do not prove every frame");
});

it("keeps insufficient or missing clock coverage explicitly unverified", () => {
  for (const text of [
    header + "100,10,40,10000000\n100,10,40,20000000\n",
    header + "100,10,40,NA\n100,10,40,NA\n100,10,40,NA\n100,10,40,NA\n",
    "fps,frametime,cpu_load\n100,10,40\n100,10,40\n100,10,40\n100,10,40\n",
    header + "100,10,40,10000000\n100,bad,40,20000000\n100,10,40,30000000\n100,10,40,40000000\n",
  ]) expect(parse(text).meta.timingEvidence?.status).toBe("unverified");
});

it("does not accept a joined or reversed logging clock as continuous evidence", () => {
  expect(() => parse(header + "100,10,40,100000000\n100,10,40,50000000\n")).toThrow(/goes backwards/);
});

it("does not let a missing block disappear in whole-capture totals", () => {
  const text = readFileSync("studies/mangohud-local-clock/fixtures/removed-block.csv", "utf8");
  const series = parse(text);
  const analysis = analyzeCapture(series);
  expect(analysis.summary.pacingCoverage).toEqual({ observedPairs: 24, gapBoundaries: 1 });
  expect(analysis.summary.masdMs).toBe(0);
  expect(analysis.summary.durationSec).toBeCloseTo(2.52, 12);
  expect(slowEpisodes(analysis).map(e => [e.frameCount, e.startsAfterGap, e.endsBeforeGap])).toEqual([
    [10, false, true], [16, true, false],
  ]);
  const evidence = series.meta.timingEvidence!;
  expect(evidence).toMatchObject({ status: "unverified", comparedIntervals: 25,
    discontinuousIntervals: 1, omittedWitnesses: 0,
    witnesses: [{ fromSourceLine: 11, toSourceLine: 12, elapsedMs: 480, frameTimeMs: 120 }] });
  // The aggregate discrepancy is only 17%, well within the retained refusal threshold.
  expect(evidence.observedSpanSec! / evidence.recordedFrameSpanSec!).toBeLessThan(1.2);
  const exported = buildJsonReport(analysis.series, analysis.summary, DEFAULT_STUTTER_OPTIONS, undefined, analysis.selection);
  expect(exported.analysis.continuity.gaps).toEqual([{ beforeFrame: 11, sourceLine: 12 }]);
  exported.source.timingEvidence!.witnesses[0]!.elapsedMs = -1;
  expect(evidence.witnesses[0]!.elapsedMs).toBe(480);
});

it("splits long and short clock contradictions even when their totals exactly cancel", () => {
  const text = header + "100,10,40,0\n100,10,40,100000000\n10,100,40,110000000\n100,10,40,120000000\n";
  const series = parse(text);
  expect([...series.gapBefore!]).toEqual([0, 1, 1, 0]);
  expect(series.meta.timingEvidence).toMatchObject({ status: "unverified", discontinuousIntervals: 2 });
  expect(series.meta.timingEvidence!.observedSpanSec).toBeCloseTo(series.meta.timingEvidence!.recordedFrameSpanSec!, 12);
  expect(analyzeCapture(series).summary.pacingCoverage).toEqual({ observedPairs: 1, gapBoundaries: 2 });
});

it("requires both the absolute and relative thresholds and still checks short captures", () => {
  const pair = (ms: number, elapsedMs: number) => parse(header + `100,${ms},40,0\n100,${ms},40,${elapsedMs * 1e6}\n`);
  for (const [ms, elapsed] of [[10, 19], [1, 10], [100, 150], [10, 20]]) {
    expect(pair(ms!, elapsed!).meta.timingEvidence!.discontinuousIntervals).toBe(0);
  }
  expect(pair(10, 21).meta.timingEvidence!.discontinuousIntervals).toBe(1);
  expect(pair(100, 10).meta.timingEvidence!.discontinuousIntervals).toBe(1);
});

it("does not compare clocks across absent clocks or rejected records", () => {
  for (const middle of ["100,10,40,NA", "100,bad,40,100000000", "shifted,100,10,40,100000000"]) {
    const series = parse(header + `100,10,40,0\n${middle}\n100,10,40,200000000\n100,10,40,210000000\n`);
    expect(series.meta.timingEvidence!.discontinuousIntervals).toBe(0);
    expect(series.meta.timingEvidence!.witnesses).toEqual([]);
  }
});

it("bounds witness retention without dropping gap coordinates or their total", () => {
  const rows = Array.from({ length: 21 }, (_, i) => i % 2 === 0
    ? `10,100,40,${i * 55e6}` : `100,10,40,${(i - 1) * 55e6 + 100e6}`);
  const series = parse(header + rows.join("\n"));
  expect(series.meta.timingEvidence).toMatchObject({ discontinuousIntervals: 20, omittedWitnesses: 15 });
  expect(series.meta.timingEvidence!.witnesses).toHaveLength(5);
  expect([...series.gapBefore!].filter(Boolean)).toHaveLength(20);
});
