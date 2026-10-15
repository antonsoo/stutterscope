import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeCapture } from "../../src/core/analysis.ts";
import { createParserFor } from "../../src/core/parsers/index.ts";
import { parseFileStreaming, parseTextSync } from "../../src/core/stream.ts";
import type { SourceFormat } from "../../src/core/types.ts";
import type { GenericValueKind } from "../../src/core/parsers/generic.ts";

const root = new URL("../../studies/csv-width/", import.meta.url);
const cases = JSON.parse(readFileSync(new URL("cases.json", root), "utf8")) as {
  name: string; file: string; options: string[];
  expected: { frames: number; averageFps: number; skipped: number; hitches: number; gaps: number; pairs: number };
}[];

describe.each(cases)("$name CSV alignment", (item) => {
  const csv = readFileSync(new URL(item.file, root), "utf8");
  const format = item.options[1] as SourceFormat;
  const mapping = format === "generic" ? {
    valueColumn: item.options[3]!, valueKind: item.options[5]! as GenericValueKind,
  } : undefined;
  const parser = () => createParserFor(format, mapping);

  it("keeps observed frames and boundaries without interpreting shifted cells", async () => {
    for (const series of [parseTextSync(csv, parser(), "controlled.csv"),
      await parseFileStreaming(new Blob([csv]), parser(), "controlled.csv")]) {
      const { summary } = analyzeCapture(series);
      const expected = item.expected;
      expect(summary.frameCount).toBe(expected.frames);
      expect(summary.averageFps).toBeCloseTo(expected.averageFps, 12);
      expect(summary.stutter.hitchCount).toBe(expected.hitches);
      expect(summary.pacingCoverage).toMatchObject({ observedPairs: expected.pairs, gapBoundaries: expected.gaps });
      expect(series.meta.skippedRows).toBe(expected.skipped);
      expect(series.meta.warnings.some(w => w.includes("too many CSV fields"))).toBe(true);
      expect([...series.frameTimeMs]).not.toContain(1000);
    }
  });
});

it("a shifted record interrupts every existing stream without inventing another identity", () => {
  const csv = readFileSync(new URL("fixtures/unknown-stream.csv", root), "utf8");
  const series = parseTextSync(csv, createParserFor("presentmon2", undefined, { stream: "43" }), "mixed.csv");
  expect([...series.frameTimeMs]).toEqual([70, 140]);
  expect([...series.gapBefore!]).toEqual([0, 1]);
  expect(series.meta.streams).toHaveLength(2);
  expect(analyzeCapture(series).summary.pacingCoverage).toMatchObject({ observedPairs: 0, gapBoundaries: 1 });
});

it("retains quoted commas and shortened optional telemetry tails", () => {
  const csv = 'Application,ProcessID,SwapChainAddress,MsBetweenPresents,Motherboard,Comment\n'
    + 'game.exe,42,0x1,10,"board, with comma",first\n'
    + 'game.exe,42,0x1,10\ngame.exe,42,0x1,10\n';
  const series = parseTextSync(csv, createParserFor("ocat"), "native-shape.csv");
  expect(series.meta.warnings).toEqual([]);
  expect(series.meta.skippedRows).toBe(0);
  expect(analyzeCapture(series).summary).toMatchObject({ averageFps: 100, frameCount: 3, masdMs: 0 });
});
