/**
 * Minimal CSV line handling shared by every parser. Deliberately not a
 * general RFC 4180 engine: it supports the one thing real capture tools
 * actually emit (double-quoted fields that may contain commas, e.g. OCAT's
 * "Micro-Star International Co. Ltd. MPG Z390..." motherboard string) and
 * nothing more exotic.
 */

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

/**
 * Buffers arbitrary text chunks (as delivered by a stream reader) and yields
 * complete `\n`- or `\r\n`-terminated lines, carrying a partial line across
 * chunk boundaries. Call `finish()` once after the last chunk to flush any
 * trailing line that had no terminator.
 */
export class LineScanner {
  private carry = "";
  private sawFirstChunk = false;

  *feed(chunk: string): Generator<string> {
    // PresentMon (and most Windows tools) write a UTF-8 BOM at the very
    // start of the file. Left in place, it silently glues itself onto the
    // first character of the header's first column name, which then fails
    // every `header.get("Application")`-style lookup — so it's stripped
    // once, from the first chunk only, before any line-splitting happens.
    if (!this.sawFirstChunk) {
      this.sawFirstChunk = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    const combined = this.carry.length > 0 ? this.carry + chunk : chunk;
    let start = 0;
    for (;;) {
      const idx = combined.indexOf("\n", start);
      if (idx === -1) break;
      let end = idx;
      if (end > start && combined.charCodeAt(end - 1) === 13) end--; // strip trailing \r
      yield combined.slice(start, end);
      start = idx + 1;
    }
    this.carry = start < combined.length ? combined.slice(start) : "";
  }

  *finish(): Generator<string> {
    if (this.carry.length > 0) {
      yield this.carry.endsWith("\r") ? this.carry.slice(0, -1) : this.carry;
    }
    this.carry = "";
  }
}

/** Splits a whole in-memory string into lines. Used by tests and small files. */
export function splitLines(text: string): string[] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r\n|\n|\r/);
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

/** Builds a header-name -> column-index lookup, case-sensitive, first match wins. */
export function indexHeader(headerFields: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerFields.forEach((name, i) => {
    const trimmed = name.trim();
    if (!map.has(trimmed)) map.set(trimmed, i);
  });
  return map;
}
