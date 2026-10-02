/**
 * Which encoding a capture's bytes are in. Capture tools write UTF-8, but a
 * capture is not always what the tool wrote: `PresentMon ... > run.csv` in
 * Windows PowerShell saves UTF-16LE, as does a spreadsheet's "Unicode text".
 * Both start with a byte-order mark, which is the only thing checked here;
 * UTF-16 without one is indistinguishable from damage and stays UTF-8.
 */
import { ParseError } from "./types.ts";

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";

export function detectEncoding(head: Uint8Array): TextEncoding {
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return "utf-16le";
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return "utf-16be";
  return "utf-8";
}

/** Decodes a whole file, or the sample of one that format detection reads. The byte-order mark is dropped. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder(detectEncoding(bytes)).decode(bytes);
}

/**
 * Refuses a file that cannot be a capture before any format is guessed at:
 * an empty one, and a binary one (a spreadsheet workbook, an archive), which
 * would otherwise reach the "which column holds the value?" step with a
 * header row of noise. A NUL character is the test: text has none, and a
 * binary format has one within its first few bytes.
 */
export function requireText(sample: string): void {
  if (!/\S/.test(sample)) throw new ParseError("the file is empty");
  if (sample.includes("\u0000")) {
    throw new ParseError("this is not a text file (a capture is a CSV, as UTF-8 or as UTF-16 with a byte-order mark)");
  }
}
