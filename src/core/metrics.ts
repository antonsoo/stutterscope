/**
 * Pure metrics functions over a `FrameSeries`. Every formula here is also
 * written out in `docs/metrics.md`; keep the two in sync when changing
 * anything. Nothing in this file touches the DOM, a worker, or I/O, so it
 * can be imported directly by tests, the CLI, and the UI worker alike.
 */
import type { FrameSeries } from "./types.js";

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

/**
 * Linear-interpolation percentile, matching `numpy.percentile(..., method="linear")`
 * (also NumPy's default). `sorted` must already be ascending.
 */
export function percentileOfSorted(sorted: Float64Array | number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const index = (p / 100) * (n - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const frac = index - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * frac;
}

export function sortedCopy(values: Float64Array): Float64Array {
  const copy = values.slice();
  copy.sort();
  return copy;
}

export interface PercentileSet {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

/** Frame-time percentiles (milliseconds), computed once from a pre-sorted array. */
export function frameTimePercentiles(sortedFrameTimeMs: Float64Array): PercentileSet {
  return {
    p50: percentileOfSorted(sortedFrameTimeMs, 50),
    p90: percentileOfSorted(sortedFrameTimeMs, 90),
    p95: percentileOfSorted(sortedFrameTimeMs, 95),
    p99: percentileOfSorted(sortedFrameTimeMs, 99),
    p999: percentileOfSorted(sortedFrameTimeMs, 99.9),
  };
}

/**
 * A frame-time-vs-percentile curve, i.e. the data behind a "percentile
 * curve" chart: `points[i] = { p, frameTimeMs }` for `p` walking 0..100.
 * Point density increases near the tail (100th percentile) since that's
 * where stutter shows up and a uniform grid under-samples it.
 */
export function percentileCurve(
  sortedFrameTimeMs: Float64Array,
  pointCount = 400,
): Array<{ p: number; frameTimeMs: number }> {
  const points: Array<{ p: number; frameTimeMs: number }> = [];
  for (let i = 0; i < pointCount; i++) {
    const t = i / (pointCount - 1); // 0..1
    const p = 100 * (1 - (1 - t) ** 3); // biased toward p=100
    points.push({ p, frameTimeMs: percentileOfSorted(sortedFrameTimeMs, p) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Average FPS
// ---------------------------------------------------------------------------

/**
 * Average FPS = frame count / total elapsed time. NOT the arithmetic mean
 * of each frame's instantaneous FPS (`mean(1000 / frameTimeMs[i])`), which
 * over-weights short frames and reads noticeably higher whenever frame
 * times are uneven — the exact case this tool exists to surface.
 */
export function averageFps(series: FrameSeries): number {
  const totalSec = series.timeSec[series.timeSec.length - 1] ?? 0;
  if (totalSec <= 0) return NaN;
  return series.frameCount / totalSec;
}

/** The (misleading) mean-of-instantaneous-FPS figure, exposed only for comparison/education. */
export function meanOfInstantaneousFps(frameTimeMs: Float64Array): number {
  if (frameTimeMs.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < frameTimeMs.length; i++) sum += 1000 / frameTimeMs[i]!;
  return sum / frameTimeMs.length;
}

// ---------------------------------------------------------------------------
// 1% / 0.1% lows — two definitions that disagree by design
// ---------------------------------------------------------------------------

export interface LowFpsResult {
  /** fps = 1000 / percentile(frameTime, 99 or 99.9) — the frame-time value AT that percentile. */
  percentileMethodFps: number;
  /** fps = 1000 / mean(frame times of the slowest 1% or 0.1% of frames). */
  meanOfSlowestMethodFps: number;
}

/**
 * Two industry definitions of "1% low" / "0.1% low", both in wide use and
 * both reported here so users can see why tools disagree:
 *
 * - **Percentile method**: convert the P99 (or P99.9) frame time straight to
 *   FPS. This answers "how bad is frame time at the boundary of the worst
 *   1% of frames" — a single point on the distribution.
 * - **Mean-of-slowest-N% method**: average the frame times of the slowest 1%
 *   (or 0.1%) of frames, then convert to FPS. This answers "how bad are the
 *   worst frames on average" and is pulled further down by a heavy tail —
 *   a handful of huge hitches drag the mean down much more than they move
 *   a single percentile. When a capture has rare, severe stutters (e.g. one
 *   500 ms shader-compile stall in 10,000 frames), the two numbers can
 *   diverge sharply even though both are "correct" by their own definition.
 */
export function lowFps(sortedFrameTimeMsAscending: Float64Array, fraction: number): LowFpsResult {
  const n = sortedFrameTimeMsAscending.length;
  if (n === 0) return { percentileMethodFps: NaN, meanOfSlowestMethodFps: NaN };
  const percentile = 100 * (1 - fraction);
  const percentileFrameTime = percentileOfSorted(sortedFrameTimeMsAscending, percentile);

  const slowestCount = Math.max(1, Math.round(n * fraction));
  let sum = 0;
  for (let i = n - slowestCount; i < n; i++) sum += sortedFrameTimeMsAscending[i]!;
  const meanSlowest = sum / slowestCount;

  return {
    percentileMethodFps: 1000 / percentileFrameTime,
    meanOfSlowestMethodFps: 1000 / meanSlowest,
  };
}

export const onePercentLow = (sortedAsc: Float64Array): LowFpsResult => lowFps(sortedAsc, 0.01);
export const pointOnePercentLow = (sortedAsc: Float64Array): LowFpsResult => lowFps(sortedAsc, 0.001);

// ---------------------------------------------------------------------------
// Stutter / hitch detection
// ---------------------------------------------------------------------------

export interface StutterOptions {
  /** Frames either side of the center frame used for the rolling median. */
  windowRadius: number;
  /** A frame stutters if its frame time exceeds `k * rollingMedian`. */
  kMultiplier: number;
  /** A frame is a "hitch" if its frame time exceeds this, regardless of k. */
  hitchThresholdMs: number;
}

export const DEFAULT_STUTTER_OPTIONS: StutterOptions = {
  windowRadius: 10,
  kMultiplier: 2.0,
  hitchThresholdMs: 50,
};

export interface StutterResult {
  /** True for each frame flagged as a stutter event (frameTime > k * local median). */
  isStutter: Uint8Array;
  stutterEventCount: number;
  /** Sum of frame times (ms) for stutter-flagged frames. */
  totalStutterTimeMs: number;
  /** stutter time as a fraction of total capture time, 0..1. */
  stutterTimeFraction: number;
  hitchCount: number;
  totalHitchTimeMs: number;
  hitchTimeFraction: number;
}

/**
 * Rolling median over a centered window, computed with an insertion-sorted
 * buffer so each slide is O(window size) rather than an O(w log w) re-sort.
 * Window sizes here are small (tens of frames), so this stays well under a
 * millisecond per thousand frames even at broadcast capture lengths.
 */
function rollingMedian(values: Float64Array, radius: number): Float64Array {
  const n = values.length;
  const result = new Float64Array(n);
  if (n === 0) return result;
  const sorted: number[] = [];

  const insert = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    sorted.splice(lo, 0, v);
  };
  const remove = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    sorted.splice(lo, 1); // sorted[lo] === v, since v is known to be in the array
  };
  const medianOf = (): number => {
    const m = sorted.length;
    return m % 2 === 1 ? sorted[(m - 1) / 2]! : (sorted[m / 2 - 1]! + sorted[m / 2]!) / 2;
  };

  // Window for index i covers values[curStart..curEnd] inclusive; both edges
  // are advanced incrementally as i increases, so each step is O(window).
  let curStart = 0;
  let curEnd = -1;
  const initialEnd = Math.min(radius, n - 1);
  for (let j = 0; j <= initialEnd; j++) {
    insert(values[j]!);
    curEnd = j;
  }

  for (let i = 0; i < n; i++) {
    result[i] = medianOf();
    const newStart = Math.max(0, i + 1 - radius);
    const newEnd = Math.min(n - 1, i + 1 + radius);
    while (curStart < newStart) {
      remove(values[curStart]!);
      curStart++;
    }
    while (curEnd < newEnd) {
      curEnd++;
      insert(values[curEnd]!);
    }
  }
  return result;
}

export function detectStutter(
  frameTimeMs: Float64Array,
  options: StutterOptions = DEFAULT_STUTTER_OPTIONS,
): StutterResult {
  const n = frameTimeMs.length;
  const isStutter = new Uint8Array(n);
  let stutterEventCount = 0;
  let totalStutterTimeMs = 0;
  let hitchCount = 0;
  let totalHitchTimeMs = 0;
  let totalTimeMs = 0;

  const medians = rollingMedian(frameTimeMs, options.windowRadius);
  for (let i = 0; i < n; i++) {
    const ft = frameTimeMs[i]!;
    totalTimeMs += ft;
    if (medians[i]! > 0 && ft > options.kMultiplier * medians[i]!) {
      isStutter[i] = 1;
      stutterEventCount++;
      totalStutterTimeMs += ft;
    }
    if (ft > options.hitchThresholdMs) {
      hitchCount++;
      totalHitchTimeMs += ft;
    }
  }

  return {
    isStutter,
    stutterEventCount,
    totalStutterTimeMs,
    stutterTimeFraction: totalTimeMs > 0 ? totalStutterTimeMs / totalTimeMs : 0,
    hitchCount,
    totalHitchTimeMs,
    hitchTimeFraction: totalTimeMs > 0 ? totalHitchTimeMs / totalTimeMs : 0,
  };
}

// ---------------------------------------------------------------------------
// Frame-pacing variability
// ---------------------------------------------------------------------------

/**
 * Mean absolute successive difference: `mean(|frameTime[i] - frameTime[i-1]|)`.
 * A steady 60 fps capture with jitter-free pacing is close to 0 ms; a
 * capture alternating between fast and slow frames (common with VRR/vsync
 * mismatches) is high even if its average FPS looks fine.
 */
export function meanAbsoluteSuccessiveDifference(frameTimeMs: Float64Array): number {
  const n = frameTimeMs.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 1; i < n; i++) sum += Math.abs(frameTimeMs[i]! - frameTimeMs[i - 1]!);
  return sum / (n - 1);
}

// ---------------------------------------------------------------------------
// Dropped frames
// ---------------------------------------------------------------------------

export interface DroppedFramesResult {
  droppedCount: number;
  droppedFraction: number;
}

export function droppedFrames(series: FrameSeries): DroppedFramesResult | null {
  const dropped = series.channels.dropped;
  if (!dropped || dropped.length === 0) return null;
  let count = 0;
  for (let i = 0; i < dropped.length; i++) if (dropped[i] === 1) count++;
  return { droppedCount: count, droppedFraction: dropped.length > 0 ? count / dropped.length : 0 };
}

// ---------------------------------------------------------------------------
// CPU/GPU-bound share
// ---------------------------------------------------------------------------

export interface BoundShareResult {
  cpuBoundFrames: number;
  gpuBoundFrames: number;
  cpuBoundFraction: number;
  gpuBoundFraction: number;
}

/**
 * Classifies each frame as CPU- or GPU-bound by comparing `CPUBusy` and
 * `GPUBusy` (PresentMon 2.x only): whichever engine was busier for that
 * frame is treated as the bottleneck. This is a simplification — real
 * frames can be limited by sync waits or the display pipeline rather than
 * either engine — but it is the standard reviewer heuristic and requires no
 * additional instrumentation beyond what PresentMon 2.x already reports.
 */
export function boundShare(series: FrameSeries): BoundShareResult | null {
  const cpu = series.channels.cpuBusyMs;
  const gpu = series.channels.gpuBusyMs;
  if (!cpu || !gpu || cpu.length === 0 || gpu.length === 0) return null;
  let cpuBound = 0;
  let gpuBound = 0;
  const n = Math.min(cpu.length, gpu.length);
  for (let i = 0; i < n; i++) {
    if (cpu[i]! >= gpu[i]!) cpuBound++;
    else gpuBound++;
  }
  return {
    cpuBoundFrames: cpuBound,
    gpuBoundFrames: gpuBound,
    cpuBoundFraction: n > 0 ? cpuBound / n : 0,
    gpuBoundFraction: n > 0 ? gpuBound / n : 0,
  };
}

// ---------------------------------------------------------------------------
// Display latency
// ---------------------------------------------------------------------------

export interface LatencyResult {
  meanMs: number;
  p50: number;
  p90: number;
  p99: number;
}

export function displayLatency(series: FrameSeries): LatencyResult | null {
  const latency = series.channels.displayLatencyMs;
  if (!latency || latency.length === 0) return null;
  const clean = Array.from(latency).filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  clean.sort((a, b) => a - b);
  const sorted = Float64Array.from(clean);
  let sum = 0;
  for (const v of clean) sum += v;
  return {
    meanMs: sum / clean.length,
    p50: percentileOfSorted(sorted, 50),
    p90: percentileOfSorted(sorted, 90),
    p99: percentileOfSorted(sorted, 99),
  };
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export interface HistogramBucket {
  rangeStartMs: number;
  rangeEndMs: number;
  count: number;
}

export function frameTimeHistogram(frameTimeMs: Float64Array, bucketCount = 60): HistogramBucket[] {
  const n = frameTimeMs.length;
  if (n === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = frameTimeMs[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) max = min + 1;
  const width = (max - min) / bucketCount;
  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    rangeStartMs: min + i * width,
    rangeEndMs: min + (i + 1) * width,
    count: 0,
  }));
  for (let i = 0; i < n; i++) {
    const v = frameTimeMs[i]!;
    let idx = Math.floor((v - min) / width);
    if (idx >= bucketCount) idx = bucketCount - 1;
    if (idx < 0) idx = 0;
    buckets[idx]!.count++;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Aggregate summary
// ---------------------------------------------------------------------------

export interface MetricsSummary {
  frameCount: number;
  durationSec: number;
  averageFps: number;
  meanOfInstantaneousFps: number;
  percentilesMs: PercentileSet;
  onePercentLow: LowFpsResult;
  pointOnePercentLow: LowFpsResult;
  stutter: StutterResult;
  masdMs: number;
  dropped: DroppedFramesResult | null;
  boundShare: BoundShareResult | null;
  latency: LatencyResult | null;
}

export function computeMetricsSummary(
  series: FrameSeries,
  stutterOptions: StutterOptions = DEFAULT_STUTTER_OPTIONS,
): MetricsSummary {
  const sorted = sortedCopy(series.frameTimeMs);
  return {
    frameCount: series.frameCount,
    durationSec: series.timeSec[series.timeSec.length - 1] ?? 0,
    averageFps: averageFps(series),
    meanOfInstantaneousFps: meanOfInstantaneousFps(series.frameTimeMs),
    percentilesMs: frameTimePercentiles(sorted),
    onePercentLow: onePercentLow(sorted),
    pointOnePercentLow: pointOnePercentLow(sorted),
    stutter: detectStutter(series.frameTimeMs, stutterOptions),
    masdMs: meanAbsoluteSuccessiveDifference(series.frameTimeMs),
    dropped: droppedFrames(series),
    boundShare: boundShare(series),
    latency: displayLatency(series),
  };
}
