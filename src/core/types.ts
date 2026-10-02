/**
 * Core data model. A `FrameSeries` is the normalized, format-agnostic
 * representation every parser produces and every metric consumes.
 *
 * Convention: `frameTimeMs[i]` is the duration attributed to frame `i` (the
 * time between this present and the previous one, in milliseconds — the
 * quantity every supported tool calls "frame time" under one name or
 * another). `timeSec[i]` is the cumulative capture time up to and including
 * frame `i`, derived as a running sum of `frameTimeMs`, so it is internally
 * consistent even for formats whose own absolute-time column has coarser
 * precision than their frame-time column.
 */

export const SOURCE_FORMATS = [
  "presentmon1",
  "presentmon2",
  "frameview",
  "capframex",
  "mangohud",
  "ocat",
  "generic",
] as const;

export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const FORMAT_LABELS: Record<SourceFormat, string> = {
  presentmon1: "PresentMon 1.x",
  presentmon2: "PresentMon 2.x",
  frameview: "NVIDIA FrameView",
  capframex: "CapFrameX",
  mangohud: "MangoHud",
  ocat: "OCAT",
  generic: "Generic CSV",
};

/** Optional per-frame channels that not every format provides. */
export interface OptionalChannels {
  /** 1 = frame was not displayed (dropped, or superseded before scan-out), 0 = displayed. */
  dropped?: Uint8Array;
  cpuBusyMs?: Float64Array;
  gpuBusyMs?: Float64Array;
  /** Present-to-photon style latency, whatever the source format calls it. */
  displayLatencyMs?: Float64Array;
}

/**
 * One process's presents to one swap chain. Present-hook captures (PresentMon,
 * OCAT, CapFrameX, FrameView) record every process that presents unless told
 * otherwise; see `streams.ts`.
 */
export interface PresentStream {
  /** `processId:swapChain`, or the application name when the format has neither column. */
  id: string;
  application: string;
  processId: string;
  swapChain: string;
  frameCount: number;
}

export interface FrameSeriesMeta {
  format: SourceFormat;
  sourceFileName: string;
  /** Process/application name, if the capture recorded one. */
  application?: string;
  /**
   * Non-fatal issues encountered while parsing: one message for each of the
   * first skipped rows (`MAX_KEPT_WARNINGS` of them), and a note when no row
   * was usable at all.
   */
  warnings: string[];
  /** How many data rows were left out because their frame time was missing or unusable. */
  skippedRows: number;
  /** Column names actually present in the source file, for diagnostics. */
  columns: string[];
  /** Every present stream in the capture, busiest first (present-hook formats only). */
  streams?: PresentStream[];
  /** The id of the stream the series holds, when `streams` is set. */
  selectedStream?: string;
}

export interface FrameSeries {
  meta: FrameSeriesMeta;
  frameCount: number;
  frameTimeMs: Float64Array;
  timeSec: Float64Array;
  channels: OptionalChannels;
}

/** Options for a present-hook parser. */
export interface ParserOptions {
  /** Which present stream to analyse (see `matchStream`); by default the busiest non-compositor one. */
  stream?: string;
}

/** A parser's guess at whether a text blob matches its format. */
export interface SniffResult {
  format: SourceFormat;
  /** 0 = definitely not this format, 1 = unambiguous match. */
  confidence: number;
  reason: string;
}

export interface ParseProgress {
  rowsParsed: number;
  bytesRead: number;
  totalBytes: number;
}

export type ProgressCallback = (progress: ParseProgress) => void;

export interface ParseResult {
  series: FrameSeries;
  warnings: string[];
}

/**
 * A format's incremental parser state machine. `pushLine` is called once per
 * CSV record (including the header) in file order; `finish` is called once
 * at EOF to produce the normalized `FrameSeries`.
 */
export interface StreamingParser {
  pushLine(line: string, lineIndex: number): void;
  finish(sourceFileName: string): FrameSeries;
}

/** Raised for input that is structurally unparseable (not just a bad row). */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
