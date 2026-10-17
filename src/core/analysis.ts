import { computeMetricsSummary, DEFAULT_STUTTER_OPTIONS, detectStutter, frameDurationSec, summarizeStutter, type MetricsSummary, type StutterOptions } from "./metrics.ts";
import type { FrameSeries } from "./types.ts";

/** Bounds on accumulated usable frame time, in seconds. null means through the end. */
export interface AnalysisRange { startSec: number; endSec: number | null }

export interface FrameSelection {
  requested: AnalysisRange | null;
  timeBasis: "accumulated-frame-time";
  boundaryRule: "frame-end-in-(start,end];include-zero-at-origin";
  detectionContext: "full-stream";
  sourceFrameCount: number;
  sourceDurationSec: number;
  /** Zero-based, inclusive indices in the original selected present stream. */
  firstFrameIndex: number;
  lastFrameIndex: number;
  /** Actual coverage, including the entire first frame even if it straddles start. */
  startSec: number;
  endSec: number;
  durationSec: number;
  excludedBefore: number;
  excludedAfter: number;
}

export interface CaptureAnalysis {
  series: FrameSeries;
  selection: FrameSelection;
  summary: MetricsSummary;
}

/** First timestamp strictly greater than a boundary; equal endpoints stay in the preceding interval. */
function after(times: Float64Array, boundary: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const time = times[mid]!;
    const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(boundary));
    if (time <= boundary + tolerance) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function selectFrames(source: FrameSeries, range: AnalysisRange | null = null): { series: FrameSeries; selection: FrameSelection } {
  if (source.frameCount === 0) throw new RangeError("There are no frames to analyze.");
  if (range && (!Number.isFinite(range.startSec) || range.startSec < 0 ||
    (range.endSec !== null && (!Number.isFinite(range.endSec) || range.endSec <= range.startSec)))) {
    throw new RangeError("Start must be a finite number at least zero; end must be greater than start, or blank for the end of the capture.");
  }
  const start = range && range.startSec > 0 ? after(source.timeSec, range.startSec) : 0;
  const end = range?.endSec != null ? after(source.timeSec, range.endSec) : source.frameCount;
  if (end <= start) throw new RangeError("No frame ends in this interval. Widen the interval or choose Entire capture.");
  let series = source;
  if (start !== 0 || end !== source.frameCount) {
    const channels: FrameSeries["channels"] = {};
    for (const key of ["cpuBusyMs", "gpuBusyMs", "displayLatencyMs"] as const) {
      if (source.channels[key]) channels[key] = source.channels[key].slice(start, end);
    }
    if (source.channels.dropped) channels.dropped = source.channels.dropped.slice(start, end);
    // Copies keep a transferred interval independent of the cached source's buffers.
    series = {
      meta: source.meta,
      frameCount: end - start,
      frameTimeMs: source.frameTimeMs.slice(start, end),
      timeSec: source.timeSec.slice(start, end),
      sourceLine: source.sourceLine?.slice(start, end),
      sourceSample: source.sourceSample?.slice(start, end),
      gapBefore: source.gapBefore?.slice(start, end),
      channels,
    };
  }
  return { series, selection: {
    requested: range ? { ...range } : null,
    timeBasis: "accumulated-frame-time",
    boundaryRule: "frame-end-in-(start,end];include-zero-at-origin",
    detectionContext: "full-stream",
    sourceFrameCount: source.frameCount,
    sourceDurationSec: source.timeSec[source.frameCount - 1]!,
    firstFrameIndex: start,
    lastFrameIndex: end - 1,
    startSec: start > 0 ? source.timeSec[start - 1]! : 0,
    endSec: source.timeSec[end - 1]!,
    durationSec: frameDurationSec(series.frameTimeMs),
    excludedBefore: start,
    excludedAfter: source.frameCount - end,
  } };
}

export function analyzeCapture(source: FrameSeries, options: StutterOptions = DEFAULT_STUTTER_OPTIONS, range: AnalysisRange | null = null): CaptureAnalysis {
  const { series, selection } = selectFrames(source, range);
  const fullDetection = detectStutter(source.frameTimeMs, options, source.gapBefore);
  const stutter = series === source ? fullDetection : summarizeStutter(series.frameTimeMs,
    fullDetection.isStutter.slice(selection.firstFrameIndex, selection.lastFrameIndex + 1), options.hitchThresholdMs);
  return { series, selection, summary: computeMetricsSummary(series, options, stutter) };
}

/** Read editable controls without accepting an empty start as an accidental zero. */
export function readAnalysisRange(start: string, end: string): AnalysisRange {
  const startSec = start.trim() === "" ? NaN : Number(start);
  const endSec = end.trim() === "" ? null : Number(end);
  if (!Number.isFinite(startSec) || startSec < 0 || (endSec !== null && (!Number.isFinite(endSec) || endSec <= startSec))) {
    throw new RangeError("Enter a start of zero or more and an end greater than start. Leave end blank to include the rest of the capture.");
  }
  return { startSec, endSec };
}
