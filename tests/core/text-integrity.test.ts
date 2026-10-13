import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeText } from "../../src/core/encoding.ts";
import { createParserFor } from "../../src/core/parsers/index.ts";
import { parseFileStreaming, parseTextSync } from "../../src/core/stream.ts";
import { ParseError } from "../../src/core/types.ts";
import cases from "../../studies/text-integrity/cases.json";

for (const specimen of cases) {
  it(`${specimen.id}: whole and chunked imports preserve text or reject it`, async () => {
    const bytes = readFileSync(new URL(`../../studies/text-integrity/${specimen.file}`, import.meta.url));
    const whole = () => parseTextSync(decodeText(bytes), createParserFor("ocat"), "capture.csv");
    let offset = 0;
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        if (offset === bytes.length) { controller.close(); return; }
        // Split both UTF-8 sequences and UTF-16 units/surrogate pairs across chunks.
        const end = Math.min(offset + 7, bytes.length);
        controller.enqueue(Uint8Array.from(bytes.subarray(offset, end)));
        offset = end;
      },
    });
    const file = new Blob([Uint8Array.from(bytes)]);
    file.stream = () => stream;
    if (specimen.expected === "rejected") {
      expect(whole).toThrow(ParseError);
      await expect(parseFileStreaming(file, createParserFor("ocat"), "capture.csv")).rejects.toThrow(/Invalid UTF-/);
    } else {
      const expected = whole();
      expect(expected.frameCount).toBe(specimen.frames);
      expect(expected.meta.streams).toHaveLength(specimen.streams!);
      expect(expected.meta.application).toBe(specimen.application);
      expect(await parseFileStreaming(file, createParserFor("ocat"), "capture.csv")).toEqual(expected);
      expect(() => decodeText(bytes.subarray(0, 65536), bytes.length > 65536)).not.toThrow();
    }
    expect(stream.locked).toBe(false);
  });
}

it("permits only an incomplete sample tail, not malformed bytes inside the sample", () => {
  expect(decodeText(Uint8Array.of(0x61, 0xf0, 0x9f), true)).toBe("a");
  expect(() => decodeText(Uint8Array.of(0x61, 0xf0, 0x9f))).toThrow("truncated");
  expect(() => decodeText(Uint8Array.of(0x61, 0xff, 0x62), true)).toThrow("Invalid UTF-8");
});

it("cancels unread bytes and releases the reader when decoding fails", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) { controller.enqueue(Uint8Array.of(0xff)); },
    cancel() { cancelled = true; throw new Error("cleanup failure"); },
  });
  const file = new Blob([Uint8Array.of(0xff)]);
  file.stream = () => stream;
  await expect(parseFileStreaming(file, createParserFor("ocat"), "capture.csv")).rejects.toThrow("Invalid UTF-8");
  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
});
