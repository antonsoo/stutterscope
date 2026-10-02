// What reaches the parsers is not always what the capture tool wrote: a file re-saved with
// other line endings or as UTF-16, a header with nothing under it, a workbook dropped in place
// of its CSV export, rows whose values no capture could contain.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LINE_BREAK, LineScanner, MAX_KEPT_WARNINGS, MAX_LINE_LENGTH, parseFrameTimeOrNull } from "../../src/core/csv.ts";
import { decodeText, detectEncoding, requireText } from "../../src/core/encoding.ts";
import { createParserFor, detectFormat } from "../../src/core/parsers/index.ts";
import * as generic from "../../src/core/parsers/generic.ts";
import * as mangohud from "../../src/core/parsers/mangohud.ts";
import * as presentmon2 from "../../src/core/parsers/presentmon2.ts";
import { parseFileStreaming, parseTextSync, requireFrames } from "../../src/core/stream.ts";
import { ParseError, type FrameSeries, type SourceFormat } from "../../src/core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]): string => readFileSync(join(here, "..", "fixtures", ...parts), "utf-8");

const FIXTURES: Array<[SourceFormat, string]> = [
  ["presentmon1", fixture("presentmon1", "sample.csv")],
  ["presentmon2", fixture("presentmon2", "sample.csv")],
  ["presentmon2", fixture("presentmon2", "multi-process.csv")],
  ["frameview", fixture("frameview", "sample.csv")],
  ["capframex", fixture("capframex", "sample_with_header.csv")],
  ["ocat", fixture("ocat", "sample.csv")],
  ["mangohud", fixture("mangohud", "sample_versioned.csv")],
  ["mangohud", fixture("mangohud", "sample_plain.csv")],
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), s | 1) + 0x6d2b79f5) >>> 0) / 4294967296);
}

function scan(chunks: string[]): string[] {
  const scanner = new LineScanner();
  const lines: string[] = [];
  for (const chunk of chunks) for (const line of scanner.feed(chunk)) lines.push(line);
  for (const line of scanner.finish()) lines.push(line);
  return lines;
}

/** Everything about a parsed series except the file name. */
function content(series: FrameSeries): unknown {
  const meta: Partial<FrameSeries["meta"]> = { ...series.meta };
  delete meta.sourceFileName;
  return {
    meta,
    frameTimeMs: Array.from(series.frameTimeMs),
    timeSec: Array.from(series.timeSec),
    dropped: series.channels.dropped && Array.from(series.channels.dropped),
    cpu: series.channels.cpuBusyMs && Array.from(series.channels.cpuBusyMs),
    gpu: series.channels.gpuBusyMs && Array.from(series.channels.gpuBusyMs),
    latency: series.channels.displayLatencyMs && Array.from(series.channels.displayLatencyMs),
  };
}

const parseAs = (format: SourceFormat, text: string): FrameSeries => parseTextSync(text, createParserFor(format), "f.csv");

describe("LineScanner", () => {
  it("splits on LF, CRLF and a lone CR, however the text is cut into chunks", () => {
    const random = rng(7);
    const pieces = ["a,b", "", "1,2,3", "x", "\n", "\r\n", "\r", "\n", "\r\n", "\r", "\r", "\n\n", "q"];
    for (let round = 0; round < 3000; round++) {
      let text = "";
      for (let k = 0, n = Math.floor(random() * 14); k < n; k++) text += pieces[Math.floor(random() * pieces.length)]!;
      const expected = text.split(LINE_BREAK);
      if (expected[expected.length - 1] === "") expected.pop();

      const chunks: string[] = [];
      for (let at = 0; at < text.length; ) {
        const size = random() < 0.5 ? 1 : 1 + Math.floor(random() * 6);
        chunks.push(text.slice(at, at + size));
        at += size;
      }
      if (random() < 0.3) chunks.splice(Math.floor(random() * (chunks.length + 1)), 0, "");
      expect(scan(chunks), JSON.stringify({ round, text, chunks })).toEqual(expected);
      expect(scan([text]), JSON.stringify({ round, text })).toEqual(expected);
    }
  });

  it("does not take the LF of a CRLF cut between two chunks for a second line break", () => {
    expect(scan(["a\r", "\nb\r", "\n"])).toEqual(["a", "b"]);
    expect(scan(["a\r", "b"])).toEqual(["a", "b"]);
    expect(scan(["a\r", "\rb"])).toEqual(["a", "", "b"]);
  });

  it("strips a byte-order mark from the first text it is given", () => {
    expect(scan(["", "﻿a,b\n1,2"])).toEqual(["a,b", "1,2"]);
  });

  it("refuses a line longer than the limit, whether it arrives whole or in pieces", () => {
    const long = "x".repeat(MAX_LINE_LENGTH + 1);
    expect(() => scan([`a,b\n${long}\n1,2`])).toThrow(ParseError);
    expect(() => scan([long])).toThrow(/longer than 1,048,576 characters/);
    const pieces = Array.from({ length: 2000 }, () => "y".repeat(1000));
    expect(() => scan(pieces)).toThrow(ParseError);
    expect(scan(["x".repeat(MAX_LINE_LENGTH), "\n", "ok"])).toHaveLength(2);
  });

  it("holds a long unterminated line without copying it on every chunk", () => {
    // 10,000 chunks of one line: joined on arrival, that is 5 GB of copying.
    const scanner = new LineScanner();
    const started = performance.now();
    let lines = 0;
    for (let i = 0; i < 10_000; i++) lines += [...scanner.feed("0123456789".repeat(10))].length;
    const last = [...scanner.finish()];
    expect(lines).toBe(0);
    expect(last[0]).toHaveLength(1_000_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("line endings", () => {
  for (const [format, text] of FIXTURES) {
    it(`${format}: CR-only and CRLF copies parse to the same series`, () => {
      const lf = text.replace(/\r\n/g, "\n");
      const expected = content(parseAs(format, lf));
      expect((expected as { frameTimeMs: number[] }).frameTimeMs.length).toBeGreaterThan(1);
      for (const ending of ["\r", "\r\n"]) {
        const copy = lf.replace(/\n/g, ending);
        expect(detectFormat(copy).best.format).toBe(format);
        expect(content(parseAs(format, copy))).toEqual(expected);
      }
    });
  }

  it("reads a generic CSV's header from a CR-only file", () => {
    expect(generic.readHeader("time,frametime\r0.1,16\r0.2,17\r")).toEqual(["time", "frametime"]);
  });
});

describe("encodings", () => {
  const utf16 = (text: string, bigEndian: boolean): Uint8Array => {
    const bytes = new Uint8Array(2 + text.length * 2);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xfeff, !bigEndian);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), !bigEndian);
    return bytes;
  };

  it("recognises UTF-16 by its byte-order mark and nothing else", () => {
    expect(detectEncoding(Uint8Array.of(0xff, 0xfe, 0x41, 0x00))).toBe("utf-16le");
    expect(detectEncoding(Uint8Array.of(0xfe, 0xff, 0x00, 0x41))).toBe("utf-16be");
    expect(detectEncoding(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41))).toBe("utf-8");
    expect(detectEncoding(Uint8Array.of(0x41, 0x00, 0x42, 0x00))).toBe("utf-8");
    expect(detectEncoding(Uint8Array.of(0xff))).toBe("utf-8");
    expect(detectEncoding(new Uint8Array(0))).toBe("utf-8");
  });

  for (const [format, text] of FIXTURES) {
    it(`${format}: a UTF-16 copy parses to the same series, read whole or streamed`, async () => {
      const expected = content(parseAs(format, text));
      for (const bigEndian of [false, true]) {
        const bytes = utf16(text, bigEndian);
        const decoded = decodeText(bytes);
        expect(detectFormat(decoded.slice(0, 65536)).best.format).toBe(format);
        expect(content(parseAs(format, decoded))).toEqual(expected);
        const streamed = await parseFileStreaming(new Blob([bytes.buffer as ArrayBuffer]), createParserFor(format), "f.csv");
        expect(content(streamed)).toEqual(expected);
      }
      const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
      expect(content(await parseFileStreaming(new Blob([withBom]), createParserFor(format), "f.csv"))).toEqual(expected);
    });
  }
});

describe("files that are not captures", () => {
  it("requireText refuses an empty file and a binary one", () => {
    expect(() => requireText("")).toThrow("the file is empty");
    expect(() => requireText(" \r\n\t\n")).toThrow("the file is empty");
    expect(() => requireText("PK\u0003\u0004\u0014\u0000\u0006\u0000")).toThrow(/not a text file/);
    // UTF-16 with no byte-order mark, read as UTF-8, is every other character NUL.
    expect(() => requireText("A\u0000p\u0000p\u0000")).toThrow(ParseError);
    expect(() => requireText("fps,frametime\n60,16.6\n")).not.toThrow();
  });

  it("requireFrames says what an empty series lacks", () => {
    const header = fixture("presentmon2", "sample.csv").split("\n")[0]!;
    expect(() => requireFrames(presentmon2.parse(header))).toThrow("the file has a header and no data rows");
    expect(() => requireFrames(presentmon2.parse(""))).toThrow("no header row found");
    // MangoHud's header is looked for, not assumed to be line 1: without it nothing is a header.
    expect(() => requireFrames(mangohud.parse("a,b,c\n1,2,3\n"))).toThrow("no header row found");
    expect(() => requireFrames(mangohud.parse("fps,frametime,cpu_load\n60,NA,1\n"))).toThrow(
      "its one data row has no usable frame time (line 2: missing/invalid frametime, row skipped)",
    );
    const na = "fps,frametime,cpu_load\n" + "60,NA,1\n".repeat(1234);
    expect(() => requireFrames(mangohud.parse(na))).toThrow(
      "none of its 1,234 data rows has a usable frame time (line 2: missing/invalid frametime, row skipped)",
    );
    expect(() => requireFrames(presentmon2.parse(na))).toThrow(/none of its 1,234 data rows .*missing\/invalid FrameTime/);
    try {
      requireFrames(mangohud.parse(na));
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
    }
    const good = presentmon2.parse(fixture("presentmon2", "sample.csv"));
    expect(requireFrames(good)).toBe(good);
  });
});

describe("skipped rows", () => {
  it("counts every skipped row and keeps only the first messages", () => {
    const rows = 100_000;
    const text = "fps,frametime,cpu_load\n60,16.6,1\n" + "60,NA,1\n".repeat(rows) + "60,16.6,1\n";
    const series = mangohud.parse(text);
    expect(series.frameCount).toBe(2);
    expect(series.meta.skippedRows).toBe(rows);
    expect(series.meta.warnings).toHaveLength(MAX_KEPT_WARNINGS);
    expect(series.meta.warnings[0]).toBe("line 3: missing/invalid frametime, row skipped");
    expect(series.meta.warnings[MAX_KEPT_WARNINGS - 1]).toBe(`line ${MAX_KEPT_WARNINGS + 2}: missing/invalid frametime, row skipped`);
  });

  it("is zero, with no warnings, for a clean capture", () => {
    for (const [format, text] of FIXTURES) {
      if (text.includes("dwm.exe")) continue; // multi-process.csv has one NA row by design
      const series = parseAs(format, text);
      expect(series.meta.skippedRows).toBe(0);
      expect(series.meta.warnings).toEqual([]);
    }
  });

  it("notes an empty result without counting it as a skipped row", () => {
    const series = mangohud.parse("fps,frametime,cpu_load\n");
    expect(series.meta.skippedRows).toBe(0);
    expect(series.meta.warnings).toEqual(["no data rows parsed"]);
  });
});

describe("frame times no capture could contain", () => {
  it("parseFrameTimeOrNull keeps zero and refuses a negative", () => {
    expect(parseFrameTimeOrNull("16.6")).toBe(16.6);
    expect(parseFrameTimeOrNull("0")).toBe(0);
    expect(Object.is(parseFrameTimeOrNull("-0.0"), 0)).toBe(true);
    expect(parseFrameTimeOrNull("-5")).toBeNull();
    expect(parseFrameTimeOrNull("-1e-9")).toBeNull();
    expect(parseFrameTimeOrNull("NA")).toBeNull();
    expect(parseFrameTimeOrNull(undefined)).toBeNull();
  });

  const columns: Record<string, string> = {
    presentmon1: "msBetweenPresents",
    presentmon2: "FrameTime",
    frameview: "MsBetweenPresents",
    capframex: "MsBetweenPresents",
    ocat: "MsBetweenPresents",
    mangohud: "frametime",
  };

  for (const [format, text] of FIXTURES) {
    if (text.includes("dwm.exe")) continue;
    it(`${format}: a row with a negative frame time is skipped, one with zero is kept`, () => {
      const lines = text.replace(/\r\n/g, "\n").split("\n");
      const headerAt = lines.findIndex((l) => l.split(",").map((c) => c.trim()).includes(columns[format]!));
      const column = lines[headerAt]!.split(",").map((c) => c.trim()).indexOf(columns[format]!);
      const set = (line: string, value: string): string => {
        const cells = line.split(",");
        cells[column] = value;
        return cells.join(",");
      };
      const clean = parseAs(format, lines.join("\n"));
      const first = lines[headerAt + 1]!;
      const edited = [...lines.slice(0, headerAt + 2), set(first, "-5"), set(first, "0"), set(first, "-0.0"), ...lines.slice(headerAt + 2)];
      const series = parseAs(format, edited.join("\n"));

      expect(series.frameCount).toBe(clean.frameCount + 2);
      expect(series.meta.skippedRows).toBe(1);
      expect(series.meta.warnings).toEqual([`line ${headerAt + 3}: missing/invalid ${columns[format]}, row skipped`]);
      expect(Array.from(series.frameTimeMs.slice(1, 3))).toEqual([0, 0]);
      expect(Object.is(series.frameTimeMs[2], 0)).toBe(true);
      expect(series.frameTimeMs.every((v) => v >= 0)).toBe(true);
      expect(series.timeSec[series.timeSec.length - 1]).toBeCloseTo(clean.timeSec[clean.timeSec.length - 1]!, 12);
      if (series.channels.dropped) expect(series.channels.dropped).toHaveLength(series.frameCount);
    });
  }

  it("generic: negative frame times and FPS values are skipped by name", () => {
    const text = "t,ft\n0,16\n1,-16\n2,0\n3,-0.0\n4,20\n";
    const ms = generic.parse(text, { valueColumn: "ft", valueKind: "frametime_ms" });
    expect(Array.from(ms.frameTimeMs)).toEqual([16, 0, 0, 20]);
    expect(Object.is(ms.frameTimeMs[2], 0)).toBe(true);
    expect(ms.meta.warnings).toEqual(["line 3: negative ft, row skipped"]);
    const fps = generic.parse(text, { valueColumn: "ft", valueKind: "fps" });
    expect(Array.from(fps.frameTimeMs)).toEqual([62.5, 50]);
    expect(fps.meta.skippedRows).toBe(3);
  });

  it("generic: a timestamp that goes backwards restarts the clock instead of counting negative time", () => {
    // Two logs in one file: 0.00..0.03, then a second run starting again at 0.00.
    const text = "t\n0.00\n0.01\n0.02\n0.03\n0.00\n0.02\n0.04\n";
    const series = generic.parse(text, { valueColumn: "t", valueKind: "timestamp_s_cumulative" });
    expect(Array.from(series.frameTimeMs).map((v) => Math.round(v))).toEqual([10, 10, 10, 20, 20]);
    expect(series.meta.warnings).toEqual(["line 6: t goes backwards, row skipped"]);
    expect(series.timeSec[series.timeSec.length - 1]).toBeCloseTo(0.07, 12);
    // Repeated timestamps (a clock coarser than the frame rate) are frames of no measured length.
    const coarse = generic.parse("t\n0.00\n0.00\n0.01\n0.01\n0.02\n", { valueColumn: "t", valueKind: "timestamp_s_cumulative" });
    expect(Array.from(coarse.frameTimeMs).map((v) => Math.round(v))).toEqual([0, 10, 0, 10]);
    expect(coarse.meta.skippedRows).toBe(0);
  });
});
