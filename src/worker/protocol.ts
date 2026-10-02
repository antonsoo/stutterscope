import type { FrameSeries, ParseProgress, SourceFormat } from "../core/types.ts";
import type { GenericMapping, MappingGuess } from "../core/parsers/generic.ts";
import type { MetricsSummary, StutterOptions, HistogramBucket } from "../core/metrics.ts";

export interface ParseRequest {
  type: "parse";
  requestId: number;
  slot: "a" | "b";
  file: File;
  formatOverride?: SourceFormat;
  genericMapping?: GenericMapping;
  /** Which present stream to analyse; see `matchStream` in core/streams.ts. */
  stream?: string;
  stutterOptions?: StutterOptions;
}

export interface RecomputeRequest {
  type: "recompute";
  requestId: number;
  slot: "a" | "b";
  stutterOptions: StutterOptions;
}

export type WorkerRequest = ParseRequest | RecomputeRequest;

export interface NeedsMappingResponse {
  type: "needsMapping";
  requestId: number;
  slot: "a" | "b";
  header: string[];
  sniffedFormat: SourceFormat;
  /** The column and meaning to offer first, when the header makes them clear. */
  suggested?: MappingGuess;
}

export interface ProgressResponse {
  type: "progress";
  requestId: number;
  slot: "a" | "b";
  progress: ParseProgress;
}

export interface ChartData {
  sortedFrameTimeMs: Float64Array;
  percentileCurve: Array<{ p: number; frameTimeMs: number }>;
  histogram: HistogramBucket[];
  isStutter: Uint8Array;
}

export interface ResultResponse {
  type: "result";
  requestId: number;
  slot: "a" | "b";
  series: FrameSeries;
  summary: MetricsSummary;
  chart: ChartData;
}

export interface ErrorResponse {
  type: "error";
  requestId: number;
  slot: "a" | "b";
  message: string;
}

export type WorkerResponse = NeedsMappingResponse | ProgressResponse | ResultResponse | ErrorResponse;
