import { expect, it } from "vitest";
import { parse, sniff } from "../../src/core/parsers/mangohud.ts";
import { analyzeCapture } from "../../src/core/analysis.ts";
import { buildJsonReport } from "../../src/core/report.ts";
import { DEFAULT_STUTTER_OPTIONS } from "../../src/core/metrics.ts";

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
