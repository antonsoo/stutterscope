import type { MetricsSummary } from "../core/metrics.ts";
import { fmtFps, fmtInt, fmtMs, fmtPct } from "./format.ts";

export interface Tile {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "warn" | "bad";
  /** Full definition, shown as a native tooltip (title=) since the label itself is short. */
  title: string;
}

export interface SecondaryRow {
  label: string;
  value: string;
}

export interface TileSet {
  /** Exactly 8, so the fixed 4-column grid always fills with no empty cells. */
  headline: Tile[];
  secondary: SecondaryRow[];
}

/**
 * Splits the metrics into a fixed 8-tile headline row (short HUD labels,
 * full definition on hover) plus a compact secondary table for everything
 * else. A previous version rendered every metric as an auto-fit tile grid,
 * which both truncated long labels and left a ragged, visibly-empty last
 * row whenever the tile count didn't divide evenly into the grid's column
 * count — this design can't do either, by construction.
 */
export function buildTiles(summary: MetricsSummary): TileSet {
  const hasDropped = summary.dropped !== null;

  const headline: Tile[] = [
    {
      label: "AVG FPS",
      title: "Average FPS: frame count ÷ total capture time (not the mean of each frame's instantaneous FPS)",
      value: fmtFps(summary.averageFps),
      unit: "fps",
    },
    {
      label: "1% LOW · P99",
      title: "1% low, percentile method: fps at the 99th-percentile frame time",
      value: fmtFps(summary.onePercentLow.percentileMethodFps),
      unit: "fps",
      sub: "P99 frame time",
    },
    {
      label: "0.1% LOW · P99.9",
      title: "0.1% low, percentile method: fps at the 99.9th-percentile frame time",
      value: fmtFps(summary.pointOnePercentLow.percentileMethodFps),
      unit: "fps",
      sub: "P99.9 frame time",
    },
    {
      label: "P99.9",
      title: "P99.9 frame time: the frame time at the 99.9th percentile",
      value: fmtMs(summary.percentilesMs.p999),
      unit: "ms",
      sub: "frame time",
    },
    {
      label: "STUTTER EVENTS",
      title: "Frames whose frame time exceeded k × the local rolling-median frame time",
      value: fmtInt(summary.stutter.stutterEventCount),
      sub: `${fmtPct(summary.stutter.stutterTimeFraction)} of time`,
      tone: summary.stutter.stutterEventCount > 0 ? "warn" : undefined,
    },
    {
      label: "HITCHES >50ms",
      title: "Frames whose frame time exceeded the fixed 50ms hitch threshold",
      value: fmtInt(summary.stutter.hitchCount),
      sub: `${fmtPct(summary.stutter.hitchTimeFraction)} of time`,
      tone: summary.stutter.hitchCount > 0 ? "bad" : undefined,
    },
    {
      label: "PACING · MASD",
      title: "Mean absolute successive difference: mean(|frame time[i] - frame time[i-1]|)",
      value: fmtMs(summary.masdMs),
      unit: "ms",
      sub: "mean |Δ|",
    },
    hasDropped
      ? {
          label: "DROPPED",
          title: "Frames the capture reported as dropped / not displayed",
          value: fmtInt(summary.dropped!.droppedCount),
          sub: fmtPct(summary.dropped!.droppedFraction),
          tone: summary.dropped!.droppedCount > 0 ? "warn" : undefined,
        }
      : {
          label: "P99",
          title: "P99 frame time: the frame time at the 99th percentile",
          value: fmtMs(summary.percentilesMs.p99),
          unit: "ms",
          sub: "frame time",
        },
  ];

  const secondary: SecondaryRow[] = [
    { label: "1% low, slowest-mean (AVG)", value: `${fmtFps(summary.onePercentLow.meanOfSlowestMethodFps)} fps` },
    {
      label: "0.1% low, slowest-mean (AVG)",
      value: `${fmtFps(summary.pointOnePercentLow.meanOfSlowestMethodFps)} fps`,
    },
  ];
  if (hasDropped) {
    secondary.push({ label: "P99 frame time", value: `${fmtMs(summary.percentilesMs.p99)} ms` });
  }
  if (summary.boundShare) {
    secondary.push({
      label: "CPU- / GPU-bound share",
      value: `${fmtPct(summary.boundShare.cpuBoundFraction, 0)} / ${fmtPct(summary.boundShare.gpuBoundFraction, 0)}`,
    });
  }
  if (summary.latency) {
    secondary.push({
      label: "Display latency, P99 (mean)",
      value: `${fmtMs(summary.latency.p99)} ms (${fmtMs(summary.latency.meanMs)} ms)`,
    });
  }

  return { headline, secondary };
}

export function renderTiles(container: HTMLElement, tiles: Tile[]): void {
  container.innerHTML = tiles
    .map(
      (t) => `
      <div class="tile" title="${escapeHtml(t.title)}">
        <div class="tile-label">${escapeHtml(t.label)}</div>
        <div class="tile-value${t.tone ? " " + t.tone : ""}">${escapeHtml(t.value)}${
          t.unit ? `<span class="tile-unit">${escapeHtml(t.unit)}</span>` : ""
        }</div>
        ${t.sub ? `<div class="tile-sub">${escapeHtml(t.sub)}</div>` : ""}
      </div>`,
    )
    .join("");
}

export function renderSecondaryTable(container: HTMLElement, rows: SecondaryRow[]): void {
  if (rows.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <table class="secondary-table">
      <tbody>
        ${rows
          .map(
            (r) => `<tr><td class="secondary-label">${escapeHtml(r.label)}</td><td class="secondary-value">${escapeHtml(r.value)}</td></tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
