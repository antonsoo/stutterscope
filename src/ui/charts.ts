import uPlot from "uplot";
import { percentileOfSorted, sortedCopy } from "../core/metrics.ts";
import type { HistogramBucket, HistogramBucketPair } from "../core/metrics.ts";

const TRACE_A = "#7cffb2";
const TRACE_B = "#ffb454";
const STUTTER = "#ff4b5c";
const GRID = "#1c2a26";
const TEXT_DIM = "#7fa393";
// Distinct from the run-A/run-B/stutter hues above so P99/P99.9 markers
// never get mistaken for a second run's bars in comparison mode.
const MARKER_P99 = "#8fb8ff";
const MARKER_P999 = "#c792ea";

const baseAxis: Partial<uPlot.Axis> = {
  stroke: TEXT_DIM,
  grid: { stroke: GRID, width: 1 },
  ticks: { stroke: GRID, width: 1 },
  font: "11px JetBrains Mono, monospace",
};

/** Attaches wheel-to-zoom, drag-to-pan, and double-click-to-reset to a uPlot x-axis. */
function attachZoomPan(u: uPlot, fullXRange: () => [number, number]): void {
  const el = u.over;
  let isPanning = false;
  let panStartX = 0;
  let panStartMin = 0;
  let panStartMax = 0;

  el.addEventListener("dblclick", () => {
    const [min, max] = fullXRange();
    u.setScale("x", { min, max });
  });

  el.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      const scale = u.scales.x;
      if (!scale || scale.min == null || scale.max == null) return;
      const rect = el.getBoundingClientRect();
      const cursorFrac = (e.clientX - rect.left) / rect.width;
      const range = scale.max - scale.min;
      const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const newRange = range * zoomFactor;
      const cursorVal = scale.min + range * cursorFrac;
      const newMin = cursorVal - newRange * cursorFrac;
      const newMax = newMin + newRange;
      const [fullMin, fullMax] = fullXRange();
      u.setScale("x", { min: Math.max(fullMin, newMin), max: Math.min(fullMax, newMax) });
    },
    { passive: false },
  );

  el.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0 || !e.shiftKey) return; // plain drag remains uPlot's built-in select-to-zoom
    isPanning = true;
    panStartX = e.clientX;
    panStartMin = u.scales.x?.min ?? 0;
    panStartMax = u.scales.x?.max ?? 1;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isPanning) return;
    const rect = el.getBoundingClientRect();
    const range = panStartMax - panStartMin;
    const deltaFrac = (e.clientX - panStartX) / rect.width;
    const delta = -deltaFrac * range;
    u.setScale("x", { min: panStartMin + delta, max: panStartMax + delta });
  });
  window.addEventListener("mouseup", () => {
    isPanning = false;
  });

  // uPlot's own drag-select zooms by default (cursor.drag.x = true) and
  // clears the selection via the setSelect hook wired in chart options.
}

export interface TraceChartHandle {
  uplot: uPlot;
  destroy(): void;
}

export interface TraceChartControls extends TraceChartHandle {
  /** Switches between the robust-ceiling y-range (default) and the true data max. */
  setFullRange(full: boolean): void;
  isFullRange(): boolean;
}

/**
 * A handful of severe hitches can be 10-50x a capture's normal frame time,
 * which would otherwise set the y-axis max and flatten every frame under
 * ~5% of the plot height. Capping at `max(50ms, 1.5 * P99.9)` keeps the
 * normal pacing and moderate stutter visible by default; anything above the
 * cap is still drawn (see `drawOffScaleMarkers`), just clamped to the top
 * of the plot with its real value labeled.
 */
function robustYMax(frameTimeMs: Float64Array): number {
  if (frameTimeMs.length === 0) return 50;
  const sorted = sortedCopy(frameTimeMs);
  const p999 = percentileOfSorted(sorted, 99.9);
  const trueMax = sorted[sorted.length - 1]!;
  return Math.min(trueMax, Math.max(50, p999 * 1.5));
}

/**
 * Draws a small clamped marker + value label for any point above `yMax`,
 * at the top of the plot area directly over its x position. Runs as a
 * uPlot `draw` hook so it composites on top of the normal series paths.
 */
function drawOffScaleMarkers(
  u: uPlot,
  timeSec: Float64Array,
  frameTimeMs: Float64Array,
  getYMax: () => number,
): void {
  const yMax = getYMax();
  const scaleX = u.scales.x;
  if (!scaleX || scaleX.min == null || scaleX.max == null) return;
  const ctx = u.ctx;
  const topY = u.valToPos(yMax, "y", true);
  ctx.save();
  ctx.fillStyle = STUTTER;
  ctx.font = "600 10px JetBrains Mono, monospace";
  ctx.textAlign = "center";
  let lastPx = -Infinity;
  for (let i = 0; i < frameTimeMs.length; i++) {
    const v = frameTimeMs[i]!;
    if (v <= yMax) continue;
    const t = timeSec[i]!;
    if (t < scaleX.min || t > scaleX.max) continue;
    const x = u.valToPos(t, "x", true);
    if (x - lastPx < 26) continue; // de-dupe overlapping labels when zoomed out
    lastPx = x;
    ctx.beginPath();
    ctx.moveTo(x, topY + 3);
    ctx.lineTo(x - 4, topY + 11);
    ctx.lineTo(x + 4, topY + 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillText(`↑ ${v.toFixed(0)}ms`, x, topY - 3);
  }
  ctx.restore();
}

export function createTraceChart(
  el: HTMLElement,
  timeSec: Float64Array,
  frameTimeMs: Float64Array,
  isStutter: Uint8Array,
): TraceChartControls {
  const stutterSeries = new Array<number | null>(frameTimeMs.length);
  for (let i = 0; i < frameTimeMs.length; i++) {
    stutterSeries[i] = isStutter[i] === 1 ? frameTimeMs[i]! : null;
  }

  const fullMin = timeSec.length > 0 ? timeSec[0]! : 0;
  const fullMax = timeSec.length > 0 ? timeSec[timeSec.length - 1]! : 1;
  let trueMax = 1;
  for (let i = 0; i < frameTimeMs.length; i++) if (frameTimeMs[i]! > trueMax) trueMax = frameTimeMs[i]!;
  const clampedMax = robustYMax(frameTimeMs);
  let currentYMax = clampedMax;
  let fullRange = false;

  const opts: uPlot.Options = {
    width: el.clientWidth || 600,
    height: 280,
    padding: [12, 12, 0, 0],
    cursor: { drag: { x: true, y: false, setScale: true } },
    scales: { x: { time: false } },
    series: [
      { label: "time" },
      { label: "frame time", stroke: TRACE_A, width: 1.3, points: { show: false } },
      {
        label: "stutter",
        stroke: STUTTER,
        width: 0,
        points: { show: true, size: 5, stroke: STUTTER, fill: STUTTER },
        paths: () => null,
      },
    ],
    axes: [
      { ...baseAxis, label: "time (s)" },
      { ...baseAxis, label: "frame time (ms)" },
    ],
    legend: { show: true },
    hooks: {
      draw: [(u) => drawOffScaleMarkers(u, timeSec, frameTimeMs, () => currentYMax)],
    },
  };

  const uplot = new uPlot(opts, [timeSec, frameTimeMs, stutterSeries], el);
  uplot.setScale("y", { min: 0, max: currentYMax });
  attachZoomPan(uplot, () => [fullMin, fullMax]);

  return {
    uplot,
    destroy: () => uplot.destroy(),
    isFullRange: () => fullRange,
    setFullRange: (full: boolean) => {
      fullRange = full;
      currentYMax = full ? Math.max(trueMax, 1) : clampedMax;
      uplot.setScale("y", { min: 0, max: currentYMax });
    },
  };
}

export function createFpsChart(el: HTMLElement, timeSec: Float64Array, frameTimeMs: Float64Array): TraceChartHandle {
  const fps = new Float64Array(frameTimeMs.length);
  for (let i = 0; i < frameTimeMs.length; i++) fps[i] = 1000 / frameTimeMs[i]!;
  const fullMin = timeSec.length > 0 ? timeSec[0]! : 0;
  const fullMax = timeSec.length > 0 ? timeSec[timeSec.length - 1]! : 1;

  const opts: uPlot.Options = {
    width: el.clientWidth || 600,
    height: 220,
    padding: [12, 12, 0, 0],
    cursor: { drag: { x: true, y: false, setScale: true } },
    scales: { x: { time: false } },
    series: [{ label: "time" }, { label: "fps", stroke: TRACE_A, width: 1.3, points: { show: false } }],
    axes: [
      { ...baseAxis, label: "time (s)" },
      { ...baseAxis, label: "fps" },
    ],
    legend: { show: true },
  };
  const uplot = new uPlot(opts, [timeSec, fps], el);
  attachZoomPan(uplot, () => [fullMin, fullMax]);
  return { uplot, destroy: () => uplot.destroy() };
}

export function createPercentileChart(
  el: HTMLElement,
  curveA: Array<{ p: number; frameTimeMs: number }>,
  curveB?: Array<{ p: number; frameTimeMs: number }>,
): TraceChartHandle {
  const x = curveA.map((pt) => pt.p);
  const yA = curveA.map((pt) => pt.frameTimeMs);
  const series: uPlot.Series[] = [{ label: "percentile" }, { label: "run A", stroke: TRACE_A, width: 1.6, points: { show: false } }];
  const data: (number[] | Float64Array)[] = [x, yA];
  if (curveB) {
    const yB = curveB.map((pt) => pt.frameTimeMs);
    series.push({ label: "run B", stroke: TRACE_B, width: 1.6, points: { show: false } });
    data.push(yB);
  }
  const opts: uPlot.Options = {
    width: el.clientWidth || 600,
    height: 220,
    padding: [12, 12, 0, 0],
    scales: { x: { time: false } },
    series,
    axes: [
      { ...baseAxis, label: "percentile" },
      { ...baseAxis, label: "frame time (ms)" },
    ],
    legend: { show: true },
  };
  const uplot = new uPlot(opts, data as uPlot.AlignedData, el);
  return { uplot, destroy: () => uplot.destroy() };
}

export interface HistogramMarkers {
  p99?: number;
  p999?: number;
}

const HIST_MARGIN = { left: 58, right: 8, top: 10, bottom: 32 };
const AXIS_FONT = "11px JetBrains Mono, monospace";

/** Resets a canvas's backing size for the current DPR and returns its 2D context. */
function prepareCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Draws the shared axis chrome (grid, ticks, labels, titles) and returns the plot-area rect. */
function drawHistogramFrame(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  minMs: number,
  maxMs: number,
  maxCount: number,
): { x: number; y: number; w: number; h: number } {
  const plot = {
    x: HIST_MARGIN.left,
    y: HIST_MARGIN.top,
    w: cssWidth - HIST_MARGIN.left - HIST_MARGIN.right,
    h: cssHeight - HIST_MARGIN.top - HIST_MARGIN.bottom,
  };

  ctx.font = AXIS_FONT;
  ctx.strokeStyle = GRID;
  ctx.fillStyle = TEXT_DIM;
  ctx.lineWidth = 1;

  // y-axis: 4 gridlines + count labels
  const yTicks = 4;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
    const y = plot.y + plot.h * (1 - frac);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillText(Math.round(maxCount * frac).toLocaleString(), plot.x - 4, y);
  }

  // x-axis: ~6 ticks with frame-time labels
  const xTicks = 6;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= xTicks; i++) {
    const frac = i / xTicks;
    const ms = minMs + (maxMs - minMs) * frac;
    const x = plot.x + plot.w * frac;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.strokeStyle = "rgba(28, 42, 38, 0.5)";
    ctx.stroke();
    ctx.fillText(ms.toFixed(ms < 10 ? 1 : 0), x, plot.y + plot.h + 6);
  }

  // axis titles
  ctx.textAlign = "center";
  ctx.fillText("frame time (ms)", plot.x + plot.w / 2, plot.y + plot.h + 20);
  ctx.save();
  ctx.translate(9, plot.y + plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("frames", 0, 0);
  ctx.restore();

  return plot;
}

function drawPercentileMarkers(
  ctx: CanvasRenderingContext2D,
  plot: { x: number; y: number; w: number; h: number },
  minMs: number,
  maxMs: number,
  markers: HistogramMarkers | undefined,
): void {
  if (!markers || maxMs <= minMs) return;
  const toX = (ms: number) => plot.x + ((ms - minMs) / (maxMs - minMs)) * plot.w;

  const points = (
    [
      markers.p99 !== undefined && markers.p99 >= minMs && markers.p99 <= maxMs
        ? { ms: markers.p99, label: "P99", color: MARKER_P99 }
        : null,
      markers.p999 !== undefined && markers.p999 >= minMs && markers.p999 <= maxMs
        ? { ms: markers.p999, label: "P99.9", color: MARKER_P999 }
        : null,
    ] as const
  ).filter((p): p is { ms: number; label: string; color: string } => p !== null);

  // P99 and P99.9 often sit only a few ms apart (a tight distribution) and
  // land on nearly the same pixel column; stack their labels instead of
  // overlapping them illegibly.
  const closeTogether = points.length === 2 && Math.abs(toX(points[0]!.ms) - toX(points[1]!.ms)) < 40;

  points.forEach((p, i) => {
    const x = toX(p.ms);
    ctx.save();
    ctx.strokeStyle = p.color;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = p.color;
    ctx.font = "600 10px JetBrains Mono, monospace";
    const nearRightEdge = x > plot.x + plot.w - 34;
    ctx.textAlign = nearRightEdge ? "right" : "left";
    ctx.textBaseline = "alphabetic";
    const labelY = plot.y + 10 + (closeTogether ? i * 12 : 0);
    ctx.fillText(p.label, x + (nearRightEdge ? -4 : 4), labelY);
    ctx.restore();
  });
}

export function drawHistogram(canvas: HTMLCanvasElement, buckets: HistogramBucket[], markers?: HistogramMarkers): void {
  const { ctx, w: cssWidth, h: cssHeight } = prepareCanvas(canvas);
  if (buckets.length === 0) return;
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const minMs = buckets[0]!.rangeStartMs;
  const maxMs = buckets[buckets.length - 1]!.rangeEndMs;
  const plot = drawHistogramFrame(ctx, cssWidth, cssHeight, minMs, maxMs, maxCount);

  const barGap = 1;
  const barWidth = plot.w / buckets.length;
  ctx.fillStyle = TRACE_A;
  buckets.forEach((b, i) => {
    const h = (b.count / maxCount) * plot.h;
    ctx.fillRect(plot.x + i * barWidth, plot.y + plot.h - h, Math.max(1, barWidth - barGap), h);
  });

  drawPercentileMarkers(ctx, plot, minMs, maxMs, markers);
}

export function drawHistogramPair(
  canvas: HTMLCanvasElement,
  buckets: HistogramBucketPair[],
  markers?: HistogramMarkers,
): void {
  const { ctx, w: cssWidth, h: cssHeight } = prepareCanvas(canvas);
  if (buckets.length === 0) return;
  const maxCount = Math.max(...buckets.map((b) => Math.max(b.countA, b.countB)), 1);
  const minMs = buckets[0]!.rangeStartMs;
  const maxMs = buckets[buckets.length - 1]!.rangeEndMs;
  const plot = drawHistogramFrame(ctx, cssWidth, cssHeight, minMs, maxMs, maxCount);

  const barWidth = plot.w / buckets.length;
  buckets.forEach((b, i) => {
    const hA = (b.countA / maxCount) * plot.h;
    const hB = (b.countB / maxCount) * plot.h;
    ctx.fillStyle = TRACE_A + "aa";
    ctx.fillRect(plot.x + i * barWidth, plot.y + plot.h - hA, Math.max(1, barWidth / 2 - 1), hA);
    ctx.fillStyle = TRACE_B + "aa";
    ctx.fillRect(plot.x + i * barWidth + barWidth / 2, plot.y + plot.h - hB, Math.max(1, barWidth / 2 - 1), hB);
  });

  drawPercentileMarkers(ctx, plot, minMs, maxMs, markers);
}
