import { LineScanner } from "./csv.ts";
import { detectEncoding } from "./encoding.ts";
import { ParseError, type ParseProgress, type ProgressCallback, type StreamingParser, type FrameSeries } from "./types.ts";

/**
 * Drives a `StreamingParser` from a `Blob`/`File` without ever materializing
 * the whole file as an array of lines: chunks come off `file.stream()`,
 * get decoded, and are split into lines on the fly by `LineScanner`. Peak
 * extra memory is one chunk plus whatever the parser itself accumulates
 * (its typed-array channel buffers), not a copy of the file as strings.
 *
 * This is what makes a 30-minute / 430k-row capture tractable in a Web
 * Worker: the only thing held in full is the final numeric output.
 */
export async function parseFileStreaming(
  file: Blob,
  parser: StreamingParser,
  fileName: string,
  onProgress?: ProgressCallback,
): Promise<FrameSeries> {
  const totalBytes = file.size;
  const reader = file.stream().getReader();
  // The encoding shows in the file's first two bytes, which may not be the first chunk's.
  const decoder = new TextDecoder(detectEncoding(new Uint8Array(await file.slice(0, 2).arrayBuffer())));
  const scanner = new LineScanner();

  let bytesRead = 0;
  let rowsParsed = 0;
  let lineIndex = 0;
  let lastReportedRows = 0;

  const report = (force: boolean) => {
    if (!onProgress) return;
    if (!force && rowsParsed - lastReportedRows < 5000) return;
    lastReportedRows = rowsParsed;
    const progress: ParseProgress = { rowsParsed, bytesRead, totalBytes };
    onProgress(progress);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of scanner.feed(chunk)) {
      if (line.length > 0) {
        parser.pushLine(line, lineIndex);
        rowsParsed++;
      }
      lineIndex++;
    }
    report(false);
  }
  const tail = decoder.decode(); // flush any pending multi-byte sequence
  if (tail.length > 0) {
    for (const line of scanner.feed(tail)) {
      if (line.length > 0) {
        parser.pushLine(line, lineIndex);
        rowsParsed++;
      }
      lineIndex++;
    }
  }
  for (const line of scanner.finish()) {
    if (line.length > 0) {
      parser.pushLine(line, lineIndex);
      rowsParsed++;
    }
    lineIndex++;
  }
  report(true);

  return parser.finish(fileName);
}

/**
 * Refuses a capture that parsed to no frames at all, saying why. Every
 * metric of an empty series is undefined, so the CLI and the web app would
 * otherwise answer a header-only file, or one read with the wrong column,
 * with a full report of dashes.
 */
export function requireFrames(series: FrameSeries): FrameSeries {
  if (series.frameCount > 0) return series;
  const { columns, skippedRows, warnings } = series.meta;
  if (columns.length === 0) throw new ParseError("no header row found");
  if (skippedRows === 0) throw new ParseError("the file has a header and no data rows");
  const rows =
    skippedRows === 1
      ? "its one data row has no usable frame time"
      : `none of its ${skippedRows.toLocaleString("en-US")} data rows has a usable frame time`;
  throw new ParseError(`${rows} (${warnings[0]})`);
}

/** Synchronous variant over an in-memory string, used by tests and the CLI. */
export function parseTextSync(text: string, parser: StreamingParser, fileName: string): FrameSeries {
  const scanner = new LineScanner();
  let lineIndex = 0;
  for (const line of scanner.feed(text)) {
    if (line.length > 0) parser.pushLine(line, lineIndex);
    lineIndex++;
  }
  for (const line of scanner.finish()) {
    if (line.length > 0) parser.pushLine(line, lineIndex);
    lineIndex++;
  }
  return parser.finish(fileName);
}
