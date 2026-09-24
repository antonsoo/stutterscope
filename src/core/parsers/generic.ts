/**
 * Fallback for any CSV that isn't one of the recognized capture tools: the
 * user (or `--format generic:...` on the CLI) picks which column holds the
 * per-row value and what it means, and we derive frame times from that.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { indexHeader, parseFloatOrNull, splitCsvLine, stripBom } from "../csv.ts";
import type { FrameSeries, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync, parseFileStreaming } from "../stream.ts";
import type { ProgressCallback } from "../types.ts";

export type GenericValueKind = "frametime_ms" | "frametime_us" | "frametime_s" | "fps" | "timestamp_s_cumulative";

export const GENERIC_VALUE_KIND_LABELS: Record<GenericValueKind, string> = {
  frametime_ms: "Frame time (milliseconds)",
  frametime_us: "Frame time (microseconds)",
  frametime_s: "Frame time (seconds)",
  fps: "Instantaneous FPS",
  timestamp_s_cumulative: "Cumulative timestamp (seconds)",
};

export interface GenericMapping {
  valueColumn: string;
  valueKind: GenericValueKind;
  droppedColumn?: string;
}

/** Reads just the header row, for the column-picker UI. */
export function readHeader(sampleText: string): string[] {
  const firstLine = stripBom(sampleText).split(/\r?\n/, 1)[0] ?? "";
  return splitCsvLine(firstLine).map((f) => f.trim());
}

export function sniff(sampleText: string): SniffResult {
  const header = readHeader(sampleText);
  if (header.length >= 1) {
    return { format: "generic", confidence: 0.01, reason: "fallback: any CSV can be mapped manually" };
  }
  return { format: "generic", confidence: 0, reason: "empty file" };
}

function valueToFrameTimeMs(kind: GenericValueKind, value: number, previousTimestampSec: number | null): number | null {
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
      return previousTimestampSec === null ? null : (value - previousTimestampSec) * 1000;
  }
}

class GenericParser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private readonly warnings: string[] = [];
  private readonly frameTimeMs = new Float64Builder(4096);
  private readonly dropped = new Uint8Builder(4096);
  private hasDropped = false;
  private previousTimestampSec: number | null = null;
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
      this.warnings.push(`line ${lineIndex + 1}: missing/invalid ${this.mapping.valueColumn}, row skipped`);
      return;
    }
    if (this.mapping.valueKind === "timestamp_s_cumulative") {
      const ft = valueToFrameTimeMs(this.mapping.valueKind, value, this.previousTimestampSec);
      this.previousTimestampSec = value;
      if (ft === null) return; // first row: nothing to diff against yet
      this.frameTimeMs.push(ft);
    } else {
      const ft = valueToFrameTimeMs(this.mapping.valueKind, value, null);
      if (ft === null) {
        this.warnings.push(`line ${lineIndex + 1}: non-positive FPS value, row skipped`);
        return;
      }
      this.frameTimeMs.push(ft);
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
    if (frameTimeMs.length === 0) this.warnings.push("no data rows parsed");
    return {
      meta: {
        format: "generic",
        sourceFileName,
        warnings: this.warnings,
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
