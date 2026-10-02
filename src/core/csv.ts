/**
 * Minimal CSV line handling shared by every parser. Deliberately not a
 * general RFC 4180 engine: it supports the one thing real capture tools
 * actually emit (double-quoted fields that may contain commas, e.g. OCAT's
 * "Micro-Star International Co. Ltd. MPG Z390..." motherboard string) and
 * nothing more exotic.
 */
import { ParseError } from "./types.ts";

/**
 * Strips a leading UTF-8 BOM, if present. Real PresentMon (and most
 * Windows tool) CSV output starts with one; left in place it glues onto
 * the first header column's name and breaks every lookup for it. Used
 * everywhere a raw text sample's first line is read directly (sniffing,
 * the generic-format column picker) in addition to `LineScanner`, which
 * strips it from the byte stream itself.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Splits one CSV record into fields, honoring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  if (line.indexOf('"') === -1) {
    // Fast path: the overwhelming majority of data rows have no quotes.
    return line.split(",");
  }
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** A line ends at LF, CRLF, or a CR on its own (the classic Mac ending some spreadsheet exports still write). */
export const LINE_BREAK = /\r\n|\n|\r/;

/**
 * The longest line accepted. A capture's rows are a few hundred characters
 * and its header a few thousand; a megabyte with no line break in it is a
 * minified JSON file or a binary one, and reading on would only buffer it.
 */
export const MAX_LINE_LENGTH = 1 << 20;

/**
 * Buffers arbitrary text chunks (as delivered by a stream reader) and yields
 * complete lines, carrying a partial line across chunk boundaries. A line
 * ends at `\n`, `\r\n` or a lone `\r`. Call `finish()` once after the last
 * chunk to flush any trailing line that had no terminator.
 */
export class LineScanner {
  // The unterminated tail of what has been fed, as the pieces it arrived in. They are joined
  // only when the line's end shows up: joining on every chunk would copy a long line once per
  // chunk.
  private pending: string[] = [];
  private pendingLength = 0;
  /** The last chunk ended in a CR. If the next one starts with LF, that LF is the same line break. */
  private afterCarriageReturn = false;
  private sawFirstChunk = false;

  *feed(chunk: string): Generator<string> {
    if (chunk.length === 0) return;
    if (!this.sawFirstChunk) {
      this.sawFirstChunk = true;
      chunk = stripBom(chunk);
    }
    let start = 0;
    if (this.afterCarriageReturn) {
      this.afterCarriageReturn = false;
      if (chunk.charCodeAt(0) === 10) start = 1;
    }
    // Each kind of break is searched for only once its last known position is behind `start`,
    // so a file with no CR in it is not rescanned for one on every line.
    let nextLf = chunk.indexOf("\n", start);
    let nextCr = chunk.indexOf("\r", start);
    for (;;) {
      if (nextLf !== -1 && nextLf < start) nextLf = chunk.indexOf("\n", start);
      if (nextCr !== -1 && nextCr < start) nextCr = chunk.indexOf("\r", start);
      if (nextLf === -1 && nextCr === -1) break;
      const end = nextCr === -1 || (nextLf !== -1 && nextLf < nextCr) ? nextLf : nextCr;
      yield this.take(chunk.slice(start, end));
      if (end === nextCr) {
        if (end + 1 === chunk.length) this.afterCarriageReturn = true;
        start = chunk.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
      } else {
        start = end + 1;
      }
    }
    if (start < chunk.length) this.hold(chunk.slice(start));
  }

  *finish(): Generator<string> {
    if (this.pending.length > 0) yield this.take("");
  }

  private hold(piece: string): void {
    this.pendingLength += piece.length;
    if (this.pendingLength > MAX_LINE_LENGTH) throw tooLong();
    this.pending.push(piece);
  }

  /** The line that `end` completes: whatever was pending, then `end`. */
  private take(end: string): string {
    if (this.pendingLength + end.length > MAX_LINE_LENGTH) throw tooLong();
    if (this.pending.length === 0) return end;
    this.pending.push(end);
    const line = this.pending.join("");
    this.pending = [];
    this.pendingLength = 0;
    return line;
  }
}

function tooLong(): ParseError {
  return new ParseError(
    `a line is longer than ${MAX_LINE_LENGTH.toLocaleString("en-US")} characters, so this is not a CSV capture`,
  );
}

/** Splits a whole in-memory string into lines. Used by tests and small files. */
export function splitLines(text: string): string[] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(LINE_BREAK);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Parses a float, treating "NA", "", and non-numeric text as `null`. */
export function parseFloatOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "NA" || trimmed === "N/A") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a frame-time cell. Besides what `parseFloatOrNull` refuses, a
 * negative value is no frame time: counted, it would subtract from the
 * capture's duration and raise its average FPS. Zero is kept. Timestamps
 * coarser than the frame rate produce it honestly, and those frames count.
 */
export function parseFrameTimeOrNull(value: string | undefined): number | null {
  const n = parseFloatOrNull(value);
  if (n === null || n < 0) return null;
  return n === 0 ? 0 : n; // "-0.0" is zero, not a frame time whose FPS is -Infinity
}

/** How many skipped-row messages a parse keeps. Every skipped row is counted; only the first ones are described. */
export const MAX_KEPT_WARNINGS = 50;

/**
 * The rows a parser left out. A capture read with the wrong column, or one
 * whose every row says NA, skips every row it has: kept as one message
 * each, two million of them are a couple of hundred megabytes that the web
 * app then copies between the worker and the page.
 */
export class SkippedRows {
  count = 0;
  readonly messages: string[] = [];

  add(lineIndex: number, reason: string): void {
    this.count++;
    if (this.messages.length < MAX_KEPT_WARNINGS) this.messages.push(`line ${lineIndex + 1}: ${reason}, row skipped`);
  }
}

/** A series' `meta.warnings`: the kept skipped-row messages, and a note when nothing was usable. */
export function parseWarnings(skipped: SkippedRows, frameCount: number): string[] {
  return frameCount === 0 ? [...skipped.messages, "no data rows parsed"] : skipped.messages;
}

/** Builds a header-name -> column-index lookup, case-sensitive, first match wins. */
export function indexHeader(headerFields: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerFields.forEach((name, i) => {
    const trimmed = name.trim();
    if (!map.has(trimmed)) map.set(trimmed, i);
  });
  return map;
}
