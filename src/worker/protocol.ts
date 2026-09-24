import type { FrameSeries, ParseProgress, SourceFormat } from "../core/types.ts";
import type { GenericMapping } from "../core/parsers/generic.ts";
import type { MetricsSummary, StutterOptions, HistogramBucket } from "../core/metrics.ts";

export interface ParseRequest {
  type: "parse";
  requestId: number;
  slot: "a" | "b";
  file: File;
  formatOverride?: SourceFormat;
  genericMapping?: GenericMapping;
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
