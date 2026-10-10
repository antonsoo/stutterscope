import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { splitCsvLine } from "../../src/core/csv.ts";
import { createParserFor, detectFormat } from "../../src/core/parsers/index.ts";
import { guessMapping, readHeader } from "../../src/core/parsers/generic.ts";
import { parseTextSync, parseFileStreaming } from "../../src/core/stream.ts";
import { ParseError } from "../../src/core/types.ts";
import cases from "../../studies/csv-integrity/cases.json";

// These same files are replayed through the actual installed CLI in the study.
for (const specimen of cases) {
  it(`${specimen.id}: identical CSV boundaries in whole-text and streamed imports`, async () => {
    const text = readFileSync(new URL(`../../studies/csv-integrity/${specimen.file}`, import.meta.url), "utf8");
    const format = detectFormat(text).best.format;
    const mapping = { valueColumn: specimen.id === "generic-quoted-column" ? "frame, ms" : "frame_ms", valueKind: "frametime_ms" as const };
    const whole = () => parseTextSync(text, createParserFor(format, mapping), "capture.csv");
    // One byte per chunk crosses commas, doubled quotes, and record terminators.
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const blob = new Blob([text]);
    blob.stream = () => stream;
    if (specimen.expected === "rejected") {
      expect(whole).toThrow(ParseError);
      await expect(parseFileStreaming(blob, createParserFor(format, mapping), "capture.csv")).rejects.toThrow(ParseError);
    } else {
      const expected = whole();
      expect(expected.frameCount).toBe(specimen.frames);
      expect(Array.from(expected.frameTimeMs)).toEqual([10, 100]);
      expect(await parseFileStreaming(blob, createParserFor(format, mapping), "capture.csv")).toEqual(expected);
    }
    expect(stream.locked).toBe(false);
  });
}

it("reports physical line numbers through metadata, blank lines, and CRLF", () => {
  const text = '//GameName=A "quoted" title\r\n\r\nApplication,MsBetweenPresents, MsBetweenPresents \r\nx.exe,10,100';
  expect(() => parseTextSync(text, createParserFor("capframex"), "f.csv"))
    .toThrow('line 3: duplicate column "MsBetweenPresents" at columns 2 and 3');
});

it("rejects duplicate generic columns before offering a mapping", () => {
  const text = '"time", time \n10,100\n10,100\n';
  expect(() => readHeader(text)).toThrow('duplicate column "time"');
  expect(() => guessMapping(text)).toThrow('duplicate column "time"');
});

it("a sample cut inside a quoted field does not prevent format or column detection", () => {
  expect(detectFormat('Application,FrameTime,CPUBusy,GPUBusy\n"incomplete').best.format).toBe("presentmon2");
  expect(guessMapping('frame_ms,label\n10,"complete"\n12,"also complete"\n14,"cut here')?.mapping.valueColumn).toBe("frame_ms");
  expect(guessMapping('frame_ms,label\n10,"cut here')).toBeNull();
});

it("does not join adjacent quoted or unquoted fragments into a measurement", () => {
  for (const field of ['1"00"', '"1"00', '"1" "00"', '"""', 'x"y']) {
    expect(() => splitCsvLine(field)).toThrow(ParseError);
  }
  expect(splitCsvLine('"a,b","literal ""quote""", "100" \t,')).toEqual(['a,b', 'literal "quote"', ' 100 \t', '']);
});

it("cancels the remaining stream on a malformed record and preserves the parse error", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) { controller.enqueue(new TextEncoder().encode('frame_ms\n1"00"\n')); },
    cancel() { cancelled = true; throw new Error("secondary cleanup failure"); },
  });
  const file = new Blob(['frame_ms\n1"00"\n']);
  file.stream = () => stream;
  await expect(parseFileStreaming(file, createParserFor("generic", { valueColumn: "frame_ms", valueKind: "frametime_ms" }), "f.csv"))
    .rejects.toThrow("line 2: CSV field 1: unexpected quote");
  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
});
