import { LineScanner } from "./csv.js";
import type { ParseProgress, ProgressCallback, StreamingParser, FrameSeries } from "./types.js";

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
  const decoder = new TextDecoder("utf-8");
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
