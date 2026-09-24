import type { MetricsSummary } from "../core/metrics.ts";
import { fmtFps, fmtInt, fmtMs, fmtPct } from "./format.ts";

export interface Tile {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "warn" | "bad";
}

/** Builds the HUD tile set from one run's metrics. Order is the reading order a reviewer wants. */
export function buildTiles(summary: MetricsSummary): Tile[] {
  const tiles: Tile[] = [
    { label: "Average FPS", value: fmtFps(summary.averageFps), unit: "fps" },
    {
      label: "1% Low (percentile)",
      value: fmtFps(summary.onePercentLow.percentileMethodFps),
      unit: "fps",
      sub: "fps @ P99 frame time",
    },
    {
      label: "1% Low (slowest-mean)",
      value: fmtFps(summary.onePercentLow.meanOfSlowestMethodFps),
      unit: "fps",
      sub: "mean of slowest 1%",
    },
    {
      label: "0.1% Low (percentile)",
      value: fmtFps(summary.pointOnePercentLow.percentileMethodFps),
      unit: "fps",
    },
    {
      label: "0.1% Low (slowest-mean)",
      value: fmtFps(summary.pointOnePercentLow.meanOfSlowestMethodFps),
      unit: "fps",
    },
    { label: "P99 Frame Time", value: fmtMs(summary.percentilesMs.p99), unit: "ms" },
    { label: "P99.9 Frame Time", value: fmtMs(summary.percentilesMs.p999), unit: "ms" },
    {
      label: "Stutter Events",
      value: fmtInt(summary.stutter.stutterEventCount),
      sub: `${fmtPct(summary.stutter.stutterTimeFraction)} of capture time`,
      tone: summary.stutter.stutterEventCount > 0 ? "warn" : undefined,
    },
    {
      label: "Hitches (>50ms)",
      value: fmtInt(summary.stutter.hitchCount),
      sub: `${fmtPct(summary.stutter.hitchTimeFraction)} of capture time`,
      tone: summary.stutter.hitchCount > 0 ? "bad" : undefined,
    },
    { label: "Pacing (MASD)", value: fmtMs(summary.masdMs), unit: "ms", sub: "mean |Δ frame time|" },
  ];

  if (summary.dropped) {
    tiles.push({
      label: "Dropped Frames",
      value: fmtInt(summary.dropped.droppedCount),
      sub: fmtPct(summary.dropped.droppedFraction),
      tone: summary.dropped.droppedCount > 0 ? "warn" : undefined,
    });
  }

  if (summary.boundShare) {
    tiles.push({
      label: "CPU- / GPU-Bound",
      value: `${fmtPct(summary.boundShare.cpuBoundFraction, 0)} / ${fmtPct(summary.boundShare.gpuBoundFraction, 0)}`,
      sub: "share of frames by busier engine",
    });
  }

  if (summary.latency) {
    tiles.push({
      label: "Display Latency P99",
      value: fmtMs(summary.latency.p99),
      unit: "ms",
      sub: `mean ${fmtMs(summary.latency.meanMs)} ms`,
    });
  }

  return tiles;
}

export function renderTiles(container: HTMLElement, tiles: Tile[]): void {
  container.innerHTML = tiles
    .map(
      (t) => `
      <div class="tile">
        <div class="tile-label">${escapeHtml(t.label)}</div>
        <div class="tile-value${t.tone ? " " + t.tone : ""}">${escapeHtml(t.value)}${
          t.unit ? `<span class="tile-unit">${escapeHtml(t.unit)}</span>` : ""
        }</div>
        ${t.sub ? `<div class="tile-sub">${escapeHtml(t.sub)}</div>` : ""}
      </div>`,
    )
    .join("");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
