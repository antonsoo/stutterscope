/**
 * Fallback for any CSV that isn't one of the recognized capture tools: the
 * user (or `--format generic:...` on the CLI) picks which column holds the
 * per-row value and what it means, and we derive frame times from that.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { indexHeader, LINE_BREAK, parseFloatOrNull, parseWarnings, SkippedRows, splitCsvLine, stripBom } from "../csv.ts";
import type { FrameSeries, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync, parseFileStreaming } from "../stream.ts";
import type { ProgressCallback } from "../types.ts";

export type GenericValueKind =
  | "frametime_ms"
  | "frametime_us"
  | "frametime_s"
  | "fps"
  | "timestamp_s_cumulative"
  | "timestamp_ms_cumulative";

export const GENERIC_VALUE_KIND_LABELS: Record<GenericValueKind, string> = {
  frametime_ms: "Frame time (milliseconds)",
  frametime_us: "Frame time (microseconds)",
  frametime_s: "Frame time (seconds)",
  fps: "Instantaneous FPS",
  timestamp_s_cumulative: "Cumulative timestamp (seconds)",
  timestamp_ms_cumulative: "Cumulative timestamp (milliseconds)",
};

function isCumulative(kind: GenericValueKind): boolean {
  return kind === "timestamp_s_cumulative" || kind === "timestamp_ms_cumulative";
}

export interface GenericMapping {
  valueColumn: string;
  valueKind: GenericValueKind;
  droppedColumn?: string;
}

/** Reads just the header row, for the column-picker UI. */
export function readHeader(sampleText: string): string[] {
  const firstLine = stripBom(sampleText).split(LINE_BREAK, 1)[0] ?? "";
  return splitCsvLine(firstLine).map((f) => f.trim());
}

export function sniff(sampleText: string): SniffResult {
  const header = readHeader(sampleText);
  if (header.length >= 1) {
    return { format: "generic", confidence: 0.01, reason: "fallback: any CSV can be mapped manually" };
  }
  return { format: "generic", confidence: 0, reason: "empty file" };
}

function valueToFrameTimeMs(kind: GenericValueKind, value: number, previousTimestamp: number | null): number | null {
  switch (kind) {
    case "frametime_ms":
      return value;
    case "frametime_us":
      return value / 1000;
    case "frametime_s":
      return value * 1000;
    case "fps":
      return value > 0 ? 1000 / value : null;
    case "timestamp_s_cumulative":
      return previousTimestamp === null ? null : (value - previousTimestamp) * 1000;
    case "timestamp_ms_cumulative":
      return previousTimestamp === null ? null : value - previousTimestamp;
  }
}

/** A guessed mapping, with the reason in words a person can check against their file. */
export interface MappingGuess {
  mapping: GenericMapping;
  /** e.g. `named like a frame time; "ms" in its name`. */
  reason: string;
}

type ColumnRole = "frametime" | "timestamp" | "fps";

/** How many data rows a guess looks at. */
const GUESS_ROWS = 200;

const UNIT_WORDS: Record<string, "ms" | "us" | "s"> = {
  ms: "ms",
  msec: "ms",
  msecs: "ms",
  millis: "ms",
  millisecond: "ms",
  milliseconds: "ms",
  us: "us",
  usec: "us",
  usecs: "us",
  micros: "us",
  microsecond: "us",
  microseconds: "us",
  s: "s",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
};

/** The unit a column's name states: a word of its own (`Time (ms)`, `frame_time_ms`) or a camel-case tail (`FrameTimeMs`). */
function unitFromName(name: string): "ms" | "us" | "s" | null {
  const words = name
    .replace(/\u00b5|\u03bc/g, "u") // micro sign, Greek mu
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  for (let i = words.length - 1; i >= 0; i--) {
    const unit = UNIT_WORDS[words[i]!];
    if (unit) return unit;
  }
  return null;
}

/**
 * What a column's name says it holds, and how sure the name is: 2 for a name that is the
 * thing itself (`frametime`, `FrameTime (ms)`, `fps`), 1 for one that only mentions it
 * (`gpu_frame_time`). Names are compared without case, spaces, punctuation or a unit.
 */
function roleFromName(name: string): { role: ColumnRole; strength: 1 | 2 } | null {
  const key = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && UNIT_WORDS[w] === undefined && w !== "in")
    .join("");
  if (/^(frametimes?|frameduration|framedelta|deltatime|delta|dt|ft|msbetweenpresents|frame|perframe)$/.test(key)) {
    // "frame" and "perframe" are what is left of `frame_ms` and `ms_per_frame`.
    if (key === "frame" || key === "perframe") return unitFromName(name) ? { role: "frametime", strength: 2 } : null;
    return { role: "frametime", strength: 2 };
  }
  if (/^(fps|framerate|framespersecond|currentfps|instantfps)$/.test(key)) return { role: "fps", strength: 2 };
  if (/^(time|timestamp|elapsed|elapsedtime|t|timesincestart|runtime)$/.test(key)) return { role: "timestamp", strength: 2 };
  if (key.includes("frametime")) return { role: "frametime", strength: 1 };
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The kind of value a column holds, from its name and, where the name gives no unit, from
 * its values: games run between a few and a few thousand frames a second, so a frame time
 * near 0.016 is in seconds, near 16 in milliseconds and near 16,000 in microseconds.
 * Returns null when the values contradict the name (a "time" column that isn't a clock).
 */
function kindFor(role: ColumnRole, name: string, values: number[]): { kind: GenericValueKind; how: string } | null {
  if (role === "fps") {
    return median(values) > 0 ? { kind: "fps", how: "named like a frame rate" } : null;
  }
  const stated = unitFromName(name);
  if (role === "frametime") {
    const typical = median(values);
    if (!(typical > 0)) return null;
    const unit = stated ?? (typical < 0.5 ? "s" : typical < 1000 ? "ms" : "us");
    const how = stated ? `"${stated}" in its name` : `values around ${formatTypical(typical)}`;
    return { kind: `frametime_${unit}`, how: `named like a frame time; ${how}` };
  }
  // A clock: it has to keep going up.
  const steps: number[] = [];
  for (let i = 1; i < values.length; i++) steps.push(values[i]! - values[i - 1]!);
  if (steps.length === 0 || steps.some((d) => d < 0) || !steps.some((d) => d > 0)) return null;
  if (stated === "us") return null; // no such kind; say so rather than read it a thousand times off
  const typical = median(steps.filter((d) => d > 0));
  const unit = stated ?? (typical < 0.5 ? "s" : "ms");
  const how = stated ? `"${stated}" in its name` : `steps around ${formatTypical(typical)}`;
  return { kind: `timestamp_${unit}_cumulative`, how: `a clock that counts up; ${how}` };
}

function formatTypical(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toPrecision(2);
}

function sampleColumns(sampleText: string): { header: string[]; columns: number[][] } {
  const lines = stripBom(sampleText).split(LINE_BREAK);
  // The sample is the first chunk of the file, so its last line may be cut short.
  if (lines.length > 2) lines.pop();
  const header = splitCsvLine(lines[0] ?? "").map((f) => f.trim());
  const columns: number[][] = header.map(() => []);
  const rows = lines.slice(1, 1 + GUESS_ROWS).filter((line) => line.trim().length > 0);
  for (const line of rows) {
    const fields = splitCsvLine(line);
    for (let c = 0; c < header.length; c++) {
      const value = parseFloatOrNull(fields[c]);
      if (value !== null) columns[c]!.push(value);
    }
  }
  // A column counts if nearly every sampled row has a number in it.
  const needed = Math.max(2, Math.ceil(rows.length * 0.8));
  return { header, columns: columns.map((values) => (values.length >= needed ? values : [])) };
}

/**
 * Guesses which column holds the frame timing, and in what form, for a CSV that no capture
 * tool's parser recognized: a frame-time log from an engine or an overlay, a FRAPS
 * `frametimes.csv`, a spreadsheet. A column that states frame times is preferred to a clock
 * (which gives them by subtraction), and a clock to a frame rate, which is often an average.
 *
 * Returns null when no column's name says what it is, or when two say it equally well: a
 * wrong guess here is a report about the wrong numbers, so the caller should ask instead.
 */
export function guessMapping(sampleText: string): MappingGuess | null {
  const { header, columns } = sampleColumns(sampleText);
  const rank: Record<ColumnRole, number> = { frametime: 3, timestamp: 2, fps: 1 };
  let best: { score: number; guess: MappingGuess } | null = null;
  let tied = false;
  header.forEach((name, c) => {
    const values = columns[c]!;
    const named = roleFromName(name);
    if (!named || values.length === 0) return;
    const kind = kindFor(named.role, name, values);
    if (!kind) return;
    const score = rank[named.role] * 10 + named.strength;
    if (best === null || score > best.score) {
      best = { score, guess: { mapping: { valueColumn: name, valueKind: kind.kind }, reason: kind.how } };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  });
  const found = best as { score: number; guess: MappingGuess } | null;
  return found === null || tied ? null : found.guess;
}

/** The kind of value in one named column, for a caller that knows the column but not its unit. */
export function guessKind(sampleText: string, column: string): MappingGuess | null {
  const { header, columns } = sampleColumns(sampleText);
  const c = header.indexOf(column);
  if (c < 0) return null;
  const named = roleFromName(column);
  const values = columns[c]!;
  if (!named || values.length === 0) return null;
  const kind = kindFor(named.role, column, values);
  return kind ? { mapping: { valueColumn: column, valueKind: kind.kind }, reason: kind.how } : null;
}

class GenericParser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private readonly skipped = new SkippedRows();
  private readonly frameTimeMs = new Float64Builder(4096);
  private readonly dropped = new Uint8Builder(4096);
  private hasDropped = false;
  private previousTimestamp: number | null = null;
  private columns: string[] = [];
  private readonly mapping: GenericMapping;

  constructor(mapping: GenericMapping) {
    this.mapping = mapping;
  }

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line);
    if (this.header === null) {
      this.header = indexHeader(fields);
      this.columns = fields.map((f) => f.trim());
      this.hasDropped = this.mapping.droppedColumn !== undefined && this.header.has(this.mapping.droppedColumn);
      return;
    }
    const h = this.header;
    const valueIdx = h.get(this.mapping.valueColumn);
    const raw = valueIdx === undefined ? undefined : fields[valueIdx];
    const value = parseFloatOrNull(raw);
    if (value === null) {
      this.skipped.add(lineIndex, `missing/invalid ${this.mapping.valueColumn}`);
      return;
    }
    if (isCumulative(this.mapping.valueKind)) {
      const ft = valueToFrameTimeMs(this.mapping.valueKind, value, this.previousTimestamp);
      this.previousTimestamp = value;
      if (ft === null) return; // first row: nothing to diff against yet
      if (ft < 0) {
        // Two logs joined into one file, or a counter that wrapped. The row restarts the clock
        // (it is the next row's previous timestamp) and carries no frame time of its own.
        this.skipped.add(lineIndex, `${this.mapping.valueColumn} goes backwards`);
        return;
      }
      this.frameTimeMs.push(ft);
    } else {
      const ft = valueToFrameTimeMs(this.mapping.valueKind, value, null);
      if (ft === null) {
        this.skipped.add(lineIndex, "non-positive FPS value");
        return;
      }
      if (ft < 0) {
        this.skipped.add(lineIndex, `negative ${this.mapping.valueColumn}`);
        return;
      }
      this.frameTimeMs.push(ft === 0 ? 0 : ft);
    }
    if (this.hasDropped) {
      const dIdx = h.get(this.mapping.droppedColumn!);
      const dVal = dIdx === undefined ? undefined : fields[dIdx];
      this.dropped.push(parseFloatOrNull(dVal) === 1 ? 1 : 0);
    }
  }

  finish(sourceFileName: string): FrameSeries {
    const frameTimeMs = this.frameTimeMs.toArray();
    const timeSec = new Float64Array(frameTimeMs.length);
    let acc = 0;
    for (let i = 0; i < frameTimeMs.length; i++) {
      acc += frameTimeMs[i]! / 1000;
      timeSec[i] = acc;
    }
    return {
      meta: {
        format: "generic",
        sourceFileName,
        warnings: parseWarnings(this.skipped, frameTimeMs.length),
        skippedRows: this.skipped.count,
        columns: this.columns,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      timeSec,
      channels: { dropped: this.hasDropped ? this.dropped.toArray() : undefined },
    };
  }
}

export function createParser(mapping: GenericMapping): StreamingParser {
  return new GenericParser(mapping);
}

export function parse(text: string, mapping: GenericMapping, fileName = "capture.csv"): FrameSeries {
  return parseTextSync(text, createParser(mapping), fileName);
}

export function parseStreaming(
  file: Blob,
  mapping: GenericMapping,
  fileName: string,
  onProgress?: ProgressCallback,
): Promise<FrameSeries> {
  return parseFileStreaming(file, createParser(mapping), fileName, onProgress);
}
