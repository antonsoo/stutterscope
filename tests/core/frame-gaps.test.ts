import { describe, expect, it } from "vitest";
import * as generic from "../../src/core/parsers/generic.ts";
import * as pm1 from "../../src/core/parsers/presentmon1.ts";
import * as pm2 from "../../src/core/parsers/presentmon2.ts";
import * as frameview from "../../src/core/parsers/frameview.ts";
import * as ocat from "../../src/core/parsers/ocat.ts";
import * as capframex from "../../src/core/parsers/capframex.ts";
import * as mangohud from "../../src/core/parsers/mangohud.ts";
import { parseFileStreaming } from "../../src/core/stream.ts";
import { analyzeCapture } from "../../src/core/analysis.ts";
import { slowEpisodes } from "../../src/core/episodes.ts";
import { buildJsonReport } from "../../src/core/report.ts";
import { DEFAULT_STUTTER_OPTIONS } from "../../src/core/metrics.ts";
import { traceData } from "../../src/ui/traceData.ts";

const mapping = { valueColumn: "ms", valueKind: "frametime_ms" } as const;

describe("source interruptions survive analysis", () => {
  for (const [name, header, create] of [
    ["generic", "ms", () => generic.createParser(mapping)],
    ["presentmon1", "msBetweenPresents", pm1.createParser],
    ["presentmon2", "FrameTime", pm2.createParser],
    ["frameview", "MsBetweenPresents", frameview.createParser],
    ["ocat", "MsBetweenPresents", ocat.createParser],
    ["capframex", "//GameName=demo\nMsBetweenPresents", capframex.createParser],
    ["mangohud", "fps,frametime,cpu_load", mangohud.createParser],
  ] as const) {
    it(`${name}: an unobserved pair cannot establish pacing or one episode`, async () => {
      const rows = ["60", "NA", "120"].map((v) => name === "mangohud" ? `20,${v},5` : v);
      const series = await parseFileStreaming(new Blob([[header, ...rows].join("\n")]), create(), "gap.csv");
      const analysis = analyzeCapture(series);
      expect([...series.frameTimeMs]).toEqual([60, 120]);
      expect([...series.gapBefore!]).toEqual([0, 1]);
      expect(analysis.summary.masdMs).toBeNaN();
      expect(analysis.summary.pacingCoverage).toEqual({ observedPairs: 0, gapBoundaries: 1 });
      expect(analysis.summary.stutter.hitchCount).toBe(2);
      expect(slowEpisodes(analysis).map((e) => [e.frameCount, e.startsAfterGap, e.endsBeforeGap])).toEqual([[1, false, true], [1, true, false]]);
    });
  }

  it("rolling context stops at the gap while a selection retains context within its segment", () => {
    const series = generic.parse("ms\n10\n10\n10\nNA\n80\n", mapping);
    const full = analyzeCapture(series);
    expect(full.summary.masdMs).toBe(0);
    expect([...full.summary.stutter.isStutter]).toEqual([0, 0, 0, 0]);
    const selected = analyzeCapture(series, DEFAULT_STUTTER_OPTIONS, { startSec: 0.03, endSec: null });
    expect(selected.summary.pacingCoverage).toEqual({ observedPairs: 0, gapBoundaries: 0 });
    expect(slowEpisodes(selected)[0]).toMatchObject({ firstFrame: 4, firstSourceLine: 6, startsAfterGap: true });
    const report = buildJsonReport(selected.series, selected.summary, DEFAULT_STUTTER_OPTIONS, mapping, selected.selection);
    expect(report.analysis.continuity.gaps).toEqual([{ beforeFrame: 4, sourceLine: 6 }]);
    const uninterrupted = generic.parse("ms\n10\n10\n80\n10\n10\n", mapping);
    const justHitch = analyzeCapture(uninterrupted, DEFAULT_STUTTER_OPTIONS, { startSec: 0.02, endSec: 0.1 });
    expect(justHitch.summary.stutter.stutterEventCount).toBe(1);
  });

  it("timestamp missing values and clock restarts also break downstream adjacency", () => {
    for (const text of ["t\n0\n60\nNA\n300\n420\n", "t\n0\n60\n5\n125\n"]) {
      const s = generic.parse(text, { valueColumn: "t", valueKind: "timestamp_ms_cumulative" });
      expect([...s.frameTimeMs]).toEqual([60, 120]);
      expect(analyzeCapture(s).summary.masdMs).toBeNaN();
      expect(slowEpisodes(analyzeCapture(s))).toHaveLength(2);
    }
  });

  it("blank lines, missing optional telemetry, and zero frame times do not manufacture gaps", () => {
    const s = pm2.parse("FrameTime,CPUBusy,GPUBusy\n60,NA,3\n\n0,2,NA\n120,1,2\n");
    expect([...s.gapBefore!]).toEqual([0, 0, 0]);
    expect(analyzeCapture(s).summary.masdMs).toBe(90);
  });
});

describe("interleaved present streams", () => {
  const header = "Application,ProcessID,SwapChainAddress,FrameTime";
  const first = "game.exe,1,0x1,60";
  const last = "game.exe,1,0x1,120";
  it.each([
    ["overlay.exe,2,0x2,NA", 60], // No prior retained overlay frame needed.
    ["game.exe,1,0x2,NA", 60], // A second swap chain is a different stream.
    ["game.exe,1,0x1,NA", NaN],
    ["game.exe,,0x1,NA", NaN], // Cannot safely identify the damaged row.
    ["", 60],
  ])("%s affects only the stream it can be assigned to", (middle, expected) => {
    const s = pm2.parse([header, first, middle, last].join("\n"));
    expect(analyzeCapture(s).summary.masdMs).toBe(expected);
  });
  it("an unidentified row interrupts every previously observed stream until each resumes", () => {
    const s = [header, first, "overlay.exe,2,0x2,20", ",,,NA", last, "overlay.exe,2,0x2,30"].join("\n");
    for (const stream of ["1", "2"]) {
      const series = pm2.parse(s, "multi.csv", { stream });
      expect(analyzeCapture(series).summary.masdMs).toBeNaN();
    }
  });
});

it("trace separators preserve both endpoints, including equal-time observations", () => {
  const t = Float64Array.from([0.06, 0.06, 0.18]);
  const v = Float64Array.from([60, 0, 120]);
  const trace = traceData(t, [v], Uint8Array.from([0, 1, 0]));
  expect(trace.data).toEqual([[0.06, 0.06, 0.06, 0.18], [60, null, 0, 120]]);
  expect(trace.isolated).toEqual([0]);
});
