import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as presentmon1 from "../../src/core/parsers/presentmon1.ts";
import * as presentmon2 from "../../src/core/parsers/presentmon2.ts";
import * as frameview from "../../src/core/parsers/frameview.ts";
import * as ocat from "../../src/core/parsers/ocat.ts";
import * as capframex from "../../src/core/parsers/capframex.ts";
import * as mangohud from "../../src/core/parsers/mangohud.ts";
import * as generic from "../../src/core/parsers/generic.ts";
import { detectFormat } from "../../src/core/parsers/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

function readFixture(...parts: string[]): string {
  return readFileSync(join(fixturesDir, ...parts), "utf-8");
}

const EXPECTED_FRAME_TIMES = [10, 10, 10, 40, 10];
const EXPECTED_SUM_MS = 80;

describe("presentmon1 parser", () => {
  const text = readFixture("presentmon1", "sample.csv");

  it("sniffs as presentmon1 with high confidence", () => {
    expect(presentmon1.sniff(text).confidence).toBeGreaterThan(0.9);
  });

  it("parses frame times, timeSec, dropped, and application", () => {
    const series = presentmon1.parse(text, "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(Array.from(series.frameTimeMs)).toEqual(EXPECTED_FRAME_TIMES);
    expect(series.timeSec[series.timeSec.length - 1]).toBeCloseTo(EXPECTED_SUM_MS / 1000, 10);
    expect(series.meta.application).toBe("demo.exe");
    expect(Array.from(series.channels.dropped!)).toEqual([0, 0, 1, 0, 0]);
    expect(series.channels.gpuBusyMs).toBeDefined();
  });
});

describe("presentmon2 parser", () => {
  const text = readFixture("presentmon2", "sample.csv");

  it("sniffs as presentmon2 with high confidence", () => {
    expect(presentmon2.sniff(text).confidence).toBeGreaterThan(0.9);
  });

  it("parses FrameTime, CPUBusy/GPUBusy, and derives dropped from DisplayedTime=NA", () => {
    const series = presentmon2.parse(text, "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(Array.from(series.frameTimeMs)).toEqual(EXPECTED_FRAME_TIMES);
    expect(Array.from(series.channels.dropped!)).toEqual([0, 0, 1, 0, 0]);
    expect(Array.from(series.channels.cpuBusyMs!)).toEqual([6, 3, 6, 6, 3]);
    expect(Array.from(series.channels.gpuBusyMs!)).toEqual([4, 8, 4, 4, 8]);
  });
});

describe("frameview parser", () => {
  const text = readFixture("frameview", "sample.csv");

  it("sniffs as frameview via GPU0Util(%)/CPUUtil(%) markers", () => {
    expect(frameview.sniff(text).confidence).toBeGreaterThan(0.9);
  });

  it("parses MsBetweenPresents, Dropped, and MsPCLatency", () => {
    const series = frameview.parse(text, "sample.csv");
    expect(Array.from(series.frameTimeMs)).toEqual(EXPECTED_FRAME_TIMES);
    expect(Array.from(series.channels.dropped!)).toEqual([0, 0, 1, 0, 0]);
    expect(Array.from(series.channels.displayLatencyMs!)).toEqual([25, 25, 25, 55, 25]);
  });
});

describe("ocat parser", () => {
  const text = readFixture("ocat", "sample.csv");

  it("sniffs as ocat", () => {
    expect(ocat.sniff(text).confidence).toBeGreaterThan(0);
  });

  it("parses ragged rows (hardware-info columns only on row 1)", () => {
    const series = ocat.parse(text, "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(Array.from(series.frameTimeMs)).toEqual(EXPECTED_FRAME_TIMES);
    expect(Array.from(series.channels.dropped!)).toEqual([0, 0, 1, 0, 0]);
  });
});

describe("capframex parser", () => {
  const text = readFixture("capframex", "sample_with_header.csv");

  it("sniffs as capframex via //key=value block", () => {
    expect(capframex.sniff(text).confidence).toBeGreaterThan(0.9);
  });

  it("parses the metadata block and the data rows", () => {
    const series = capframex.parse(text, "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(Array.from(series.frameTimeMs)).toEqual(EXPECTED_FRAME_TIMES);
    expect(series.meta.application).toBe("demo.exe");
  });
});

describe("mangohud parser", () => {
  it("skips the version/system-info preamble when present", () => {
    const text = readFixture("mangohud", "sample_versioned.csv");
    expect(mangohud.sniff(text).confidence).toBeGreaterThan(0.9);
    const series = mangohud.parse(text, "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(Array.from(series.frameTimeMs)).toEqual(EXPECTED_FRAME_TIMES);
  });

  it("parses a plain log with no preamble", () => {
    const text = readFixture("mangohud", "sample_plain.csv");
    const series = mangohud.parse(text, "sample.csv");
    expect(series.frameCount).toBe(2);
    expect(Array.from(series.frameTimeMs)).toEqual([10, 10]);
  });
});

describe("generic parser", () => {
  const text = readFixture("generic", "sample.csv");

  it("derives frame times from a cumulative timestamp column", () => {
    const series = generic.parse(text, { valueColumn: "time_s", valueKind: "timestamp_s_cumulative" }, "sample.csv");
    // 5 timestamps -> 4 diffs
    expect(series.frameCount).toBe(4);
    expect(Array.from(series.frameTimeMs).map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 10, 40, 10]);
  });

  it("derives frame times from an FPS column", () => {
    const series = generic.parse(text, { valueColumn: "fps", valueKind: "fps" }, "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(Array.from(series.frameTimeMs)).toEqual(EXPECTED_FRAME_TIMES);
  });
});

describe("format detector", () => {
  it("picks the right format for each fixture", () => {
    expect(detectFormat(readFixture("presentmon1", "sample.csv")).best.format).toBe("presentmon1");
    expect(detectFormat(readFixture("presentmon2", "sample.csv")).best.format).toBe("presentmon2");
    expect(detectFormat(readFixture("frameview", "sample.csv")).best.format).toBe("frameview");
    expect(detectFormat(readFixture("capframex", "sample_with_header.csv")).best.format).toBe("capframex");
    expect(detectFormat(readFixture("mangohud", "sample_plain.csv")).best.format).toBe("mangohud");
  });

  it("falls back to generic for an unrecognized CSV", () => {
    expect(detectFormat(readFixture("generic", "sample.csv")).best.format).toBe("generic");
  });
});

describe("robustness against bad input", () => {
  it("strips a leading UTF-8 BOM before reading the header (real PresentMon output has one)", () => {
    const withBom = "﻿" + readFixture("presentmon1", "sample.csv");
    const series = presentmon1.parse(withBom, "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(series.meta.application).toBe("demo.exe"); // only resolvable if "Application" was found in the header
  });

  it("does not throw on a completely empty file", () => {
    for (const parse of [presentmon1.parse, presentmon2.parse, frameview.parse, ocat.parse, mangohud.parse]) {
      const series = parse("", "empty.csv");
      expect(series.frameCount).toBe(0);
      expect(series.meta.warnings.length).toBeGreaterThan(0);
    }
  });

  it("does not throw on a header with no data rows", () => {
    const header = readFixture("presentmon1", "sample.csv").split("\n")[0];
    const series = presentmon1.parse(header!, "header-only.csv");
    expect(series.frameCount).toBe(0);
  });

  it("skips malformed rows (wrong column count, non-numeric value) without crashing the rest of the file", () => {
    const lines = readFixture("presentmon1", "sample.csv").split("\n");
    const header = lines[0]!;
    const goodRow = lines[1]!;
    const truncatedRow = "demo.exe,1000"; // far fewer fields than the header
    const nonNumericRow = goodRow.replace(/,10\.000,/, ",not-a-number,");
    const text = [header, goodRow, truncatedRow, nonNumericRow, goodRow].join("\n");

    const series = presentmon1.parse(text, "malformed.csv");
    expect(series.frameCount).toBe(2); // the two good rows
    expect(series.meta.warnings.length).toBeGreaterThanOrEqual(1); // at least the non-numeric row is flagged
  });

  it("handles a file with only a trailing newline and no rows", () => {
    const series = mangohud.parse("\n\n\n", "blank.csv");
    expect(series.frameCount).toBe(0);
    expect(series.meta.warnings.length).toBeGreaterThan(0);
  });
});
