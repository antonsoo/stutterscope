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
 * precision than their frame-time column. An interval view keeps these
 * original times; its duration is the sum of its selected frame durations,
 * not its last timestamp. This is accumulated usable frame time, not a
 * reconstruction of the source's wall clock or of missing rows.
 */

export const SOURCE_FORMATS = [
  "presentmon1",
  "presentmon2",
  "frameview",
  "capframex",
  "capframex-json",
  "mangohud",
  "ocat",
  "generic",
] as const;

export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const FORMAT_LABELS: Record<SourceFormat, string> = {
  presentmon1: "PresentMon 1.x",
  presentmon2: "PresentMon 2.x",
  frameview: "NVIDIA FrameView",
  capframex: "CapFrameX CSV",
  "capframex-json": "CapFrameX JSON",
  mangohud: "MangoHud",
  ocat: "OCAT",
  generic: "Generic CSV",
};

/** Optional per-frame channels that not every format provides. */
export interface OptionalChannels {
  /** 1 = not displayed, 0 = displayed, 2 = unknown. Absence means no source column. */
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
  /** `processId:swapChain`; without PID, `app:["application","swapChain"]`,
   * or the application name alone when there is no swap-chain column.
   * A capture with only a swap-chain column uses `:swapChain`. */
  id: string;
  application: string;
  processId: string;
  swapChain: string;
  frameCount: number;
}

export interface PresentClockWitness {
  /** One-based physical CSV lines, within the full selected source stream. */
  fromSourceLine: number;
  toSourceLine: number;
  elapsedMs: number;
  frameTimeMs: number;
  allowanceMs: number;
  kind: "unaccounted_interval" | "reversed_clock";
}

export interface PresentClockEvidence {
  witnesses: PresentClockWitness[];
  /** Bound retention, without losing the full gap-coordinate list. */
  omittedWitnesses: number;
}

export interface MangoHudClockWitness {
  /** One-based physical CSV lines; clocks describe logging, not missing frames. */
  fromSourceLine: number;
  toSourceLine: number;
  elapsedMs: number;
  frameTimeMs: number;
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
  /** How many data rows had unusable frame times or missing declared stream identities. */
  skippedRows: number;
  /** Column names actually present in the source file, for diagnostics. */
  columns: string[];
  /** Every present stream in the capture, busiest first (present-hook formats only). */
  streams?: PresentStream[];
  /** The id of the stream the series holds, when `streams` is set. */
  selectedStream?: string;
  /** Native TimeInSeconds contradicts uninterrupted retained presents. */
  presentClockGaps?: number;
  /** Native saved sessions: one selected recording, never concatenated runs. */
  nativeCapture?: {
    selectedRun: number; // one-based, matching --capture-run
    runs: Array<{ run: number; sampleCount: number }>;
    appVersion: string | null;
    frameTimePath: string;
    note: string;
  };
  presentClockEvidence?: PresentClockEvidence;
  /** A clock cross-check is evidence, not proof that every frame was recorded. */
  timingEvidence?: {
    kind: "mangohud-elapsed";
    status: "compatible" | "unverified";
    comparedIntervals: number;
    observedSpanSec: number | null;
    recordedFrameSpanSec: number | null;
    /** Local disagreements can be diluted or cancel in the full-capture sums. */
    discontinuousIntervals: number;
    witnesses: MangoHudClockWitness[];
    omittedWitnesses: number;
    note: string;
  };
}

export interface FrameSeries {
  meta: FrameSeriesMeta;
  frameCount: number;
  frameTimeMs: Float64Array;
  timeSec: Float64Array;
  /** One-based physical CSV line per frame. Absent for caller-created series. */
  sourceLine?: Float64Array;
  /** Zero-based index into native CaptureData.MsBetweenPresents; never a CSV line. */
  sourceSample?: Float64Array;
  /** 1 before a retained frame separated by unusable rows or native clock evidence.
   * Per selected stream; does not estimate missing frame counts or durations.
   * Absent for caller-created series that assume uninterrupted observations. */
  gapBefore?: Uint8Array;
  channels: OptionalChannels;
}

/** Options for a present-hook parser. */
export interface ParserOptions {
  /** Which present stream to analyse (see `matchStream`); by default the busiest non-compositor one. */
  stream?: string;
  /** One-based recording in a native CapFrameX saved session; defaults to the first. */
  captureRun?: number;
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
 * A format's input state machine. CSV drivers call `pushLine` once per
 * CSV record (including the header) in file order; `finish` is called once
 * at EOF to produce the normalized `FrameSeries`. Bounded document parsers
 * provide `pushChunk` instead and retain the complete decoded document.
 */
export interface StreamingParser {
  /** Bounded whole-document formats receive decoded chunks without CSV line limits. */
  pushChunk?(chunk: string): void;
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
