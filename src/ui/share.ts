import type { FrameSeries } from "../core/types.ts";
import { type MetricsSummary, type StutterOptions } from "../core/metrics.ts";
import { buildJsonReport, buildComparisonReport, type CaptureReport } from "../core/report.ts";
export { buildJsonReport } from "../core/report.ts";
import { selectFrames, type FrameSelection } from "../core/analysis.ts";
import type { GenericMapping } from "../core/parsers/generic.ts";
import { fmtCoverage, fmtFps, fmtInt, fmtMs, fmtPct } from "./format.ts";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


export function exportJson(series: FrameSeries, summary: MetricsSummary, options: StutterOptions, mapping?: GenericMapping, selection: FrameSelection = selectFrames(series).selection): void {
  const payload = buildJsonReport(series, summary, options, mapping, selection);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `stutterscope-${safeName(series.meta.sourceFileName)}.json`);
}

export function buildMarkdownTable(series: FrameSeries, summary: MetricsSummary, options: StutterOptions, mapping?: GenericMapping, selection: FrameSelection = selectFrames(series).selection): string {
  const rows: Array<[string, string]> = [
    ["Average FPS", fmtFps(summary.averageFps)],
    ["1% Low (percentile)", fmtFps(summary.onePercentLow.percentileMethodFps)],
    ["1% Low (slowest-mean)", fmtFps(summary.onePercentLow.meanOfSlowestMethodFps)],
    ["1% Low (time-weighted)", fmtFps(summary.onePercentLow.timeWeightedFps)],
    ["0.1% Low (percentile)", fmtFps(summary.pointOnePercentLow.percentileMethodFps)],
    ["0.1% Low (slowest-mean)", fmtFps(summary.pointOnePercentLow.meanOfSlowestMethodFps)],
    ["0.1% Low (time-weighted)", fmtFps(summary.pointOnePercentLow.timeWeightedFps)],
    ["P99 frame time (ms)", fmtMs(summary.percentilesMs.p99)],
    ["P99.9 frame time (ms)", fmtMs(summary.percentilesMs.p999)],
    ["Stutter events", fmtInt(summary.stutter.stutterEventCount)],
    [`Hitches (>${summary.stutter.hitchThresholdMs}ms)`, fmtInt(summary.stutter.hitchCount)],
    ["Pacing (MASD, ms)", Number.isFinite(summary.masdMs) ? fmtMs(summary.masdMs) : "Unavailable"],
    ["Pacing observations", `${fmtInt(summary.pacingCoverage.observedPairs)} adjacent pairs; ${fmtInt(summary.pacingCoverage.gapBoundaries)} gaps between analyzed frames`],
  ];
  const coverage = summary.telemetryCoverage;
  if (coverage.dropped) {
    rows.push(["Dropped frames", summary.dropped ? `${fmtInt(summary.dropped.droppedCount)} (${fmtPct(summary.dropped.droppedFraction)} of observed)` : "Unknown"]);
    rows.push(["Drop observations", fmtCoverage(coverage.dropped)]);
  }
  if (summary.boundShare) {
    rows.push(["CPU-bound frames", fmtPct(summary.boundShare.cpuBoundFraction)]);
    rows.push(["GPU-bound frames", fmtPct(summary.boundShare.gpuBoundFraction)]);
  }
  if (coverage.cpuGpuBusy) {
    if (!summary.boundShare) rows.push(["CPU/GPU busy share", "Unavailable"]);
    rows.push(["CPU/GPU observations", `${fmtCoverage(coverage.cpuGpuBusy)}; busy-time heuristic`]);
  }
  if (coverage.displayLatency) {
    rows.push(["Display latency P99 (ms)", summary.latency ? fmtMs(summary.latency.p99) : "Unavailable"]);
    rows.push(["Latency observations", fmtCoverage(coverage.displayLatency)]);
  }

  const header = `| Metric | ${escapeMd(series.meta.sourceFileName)} |\n| --- | --- |`;
  const body = rows.map(([k, v]) => `| ${escapeMd(k)} | ${escapeMd(v)} |`).join("\n");
  const context = [
    `Source format: ${series.meta.format}. Analyzed frames: ${fmtInt(series.frameCount)} of ${fmtInt(selection.sourceFrameCount)}.`,
    selectionText(selection),
    ...(series.meta.timingEvidence ? [escapeMd(series.meta.timingEvidence.note)] : []),
    `Detection: k = ${options.kMultiplier}, window radius = ${options.windowRadius}, hitch threshold > ${options.hitchThresholdMs} ms. Rolling context and episodes stop at source gaps; missing durations are unknown.`,
    ...(series.meta.selectedStream ? [`Selected stream: ${escapeMd(series.meta.selectedStream)} (${escapeMd(series.meta.application ?? "application not recorded")}). Other streams are excluded.`] : []),
    ...(mapping ? [`Column: ${escapeMd(mapping.valueColumn)}. Interpretation: ${mapping.valueKind}.`] : []),
    `Skipped rows: ${fmtInt(series.meta.skippedRows)}. Retained warning details: ${fmtInt(series.meta.warnings.length)}.`,
    ...series.meta.warnings.map((warning) => `- ${escapeMd(warning)}`),
    ...(series.meta.skippedRows > series.meta.warnings.length ? [`${fmtInt(series.meta.skippedRows - series.meta.warnings.length)} additional skipped rows have no retained warning detail.`] : []),
  ];
  return `${header}\n${body}\n\n${context.join("\n\n")}\n`;
}

export function exportMarkdown(series: FrameSeries, summary: MetricsSummary, options: StutterOptions, mapping?: GenericMapping, selection: FrameSelection = selectFrames(series).selection): void {
  const md = buildMarkdownTable(series, summary, options, mapping, selection);
  const blob = new Blob([md], { type: "text/markdown" });
  downloadBlob(blob, `stutterscope-${safeName(series.meta.sourceFileName)}.md`);
}

function escapeMd(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex -- Show controls as text in shared reports.
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\|[\]()*_`]/g, "\\$&");
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 60);
}

const CARD_W = 1200;
const CARD_H = 640;

export function renderReportCardCanvas(series: FrameSeries, summary: MetricsSummary, options: StutterOptions, selection: FrameSelection = selectFrames(series).selection): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0a0d0c";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // corner brackets
  ctx.strokeStyle = "#7cffb2";
  ctx.lineWidth = 3;
  const b = 28;
  ctx.beginPath();
  ctx.moveTo(24, 24 + b);
  ctx.lineTo(24, 24);
  ctx.lineTo(24 + b, 24);
  ctx.moveTo(CARD_W - 24 - b, CARD_H - 24);
  ctx.lineTo(CARD_W - 24, CARD_H - 24);
  ctx.lineTo(CARD_W - 24, CARD_H - 24 - b);
  ctx.stroke();

  ctx.fillStyle = "#e8f5ee";
  ctx.font = "700 30px 'JetBrains Mono', monospace";
  ctx.fillText("STUTTERSCOPE", 60, 76);
  ctx.fillStyle = "#7fa393";
  ctx.font = "400 15px 'JetBrains Mono', monospace";
  ctx.fillText(truncate(series.meta.sourceFileName, 70), 60, 104);

  // sparkline of frame time
  const spark = decimate(series.frameTimeMs, 400, series.gapBefore);
  const sparkX = 60;
  const sparkY = 140;
  const sparkW = CARD_W - 120;
  const sparkH = 120;
  const max = Math.max(...spark.map((p) => p.value), 1);
  ctx.strokeStyle = "#7cffb2";
  ctx.fillStyle = "#7cffb2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  spark.forEach((point, i) => {
    const x = sparkX + (i / Math.max(1, spark.length - 1)) * sparkW;
    const y = sparkY + sparkH - (point.value / max) * sparkH;
    if (i === 0 || point.gapBefore || spark[i - 1]!.gapAfter) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    if (point.gapBefore || point.gapAfter || spark[i + 1]?.gapBefore || spark[i - 1]?.gapAfter || spark.length === 1) ctx.fillRect(x - 1, y - 1, 2, 2);
  });
  ctx.stroke();
  ctx.strokeStyle = "#1c2a26";
  ctx.lineWidth = 1;
  ctx.strokeRect(sparkX, sparkY, sparkW, sparkH);

  // stat grid
  const stats: Array<[string, string]> = [
    ["AVG FPS", fmtFps(summary.averageFps)],
    ["1% LOW", fmtFps(summary.onePercentLow.percentileMethodFps)],
    ["0.1% LOW", fmtFps(summary.pointOnePercentLow.percentileMethodFps)],
    ["STUTTER EVENTS", fmtInt(summary.stutter.stutterEventCount)],
    ["P99 FRAME TIME", `${fmtMs(summary.percentilesMs.p99)} ms`],
    [`MASD (${fmtInt(summary.pacingCoverage.observedPairs)} PAIRS)`, Number.isFinite(summary.masdMs) ? `${fmtMs(summary.masdMs)} ms` : "Unavailable"],
  ];
  const colW = (CARD_W - 120) / 3;
  stats.forEach(([label, value], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = sparkX + col * colW;
    const y = sparkY + sparkH + 60 + row * 90;
    ctx.fillStyle = "#7fa393";
    ctx.font = "500 12px 'JetBrains Mono', monospace";
    ctx.fillText(label, x, y);
    ctx.fillStyle = "#7cffb2";
    ctx.font = "700 34px 'JetBrains Mono', monospace";
    ctx.fillText(value, x, y + 38);
  });

  ctx.fillStyle = "#7fa393";
  ctx.font = "400 14px 'JetBrains Mono', monospace";
  ctx.fillText(`Detection: k = ${options.kMultiplier}, radius = ${options.windowRadius}, hitch > ${options.hitchThresholdMs} ms`, 60, 492);
  ctx.fillText(`${fmtInt(series.frameCount)} frames analyzed; ${fmtInt(series.meta.skippedRows)} rows skipped. Warning details in JSON / Markdown.`, 60, 516);
  if (series.meta.selectedStream) ctx.fillText(truncate(`Selected stream: ${series.meta.selectedStream} (${series.meta.application ?? "application not recorded"})`, 105), 60, 540);

  ctx.fillText(truncate(selectionText(selection), 115), 60, 564);
  if (series.meta.timingEvidence) {
    ctx.font = "400 12px 'JetBrains Mono', monospace";
    ctx.fillText(`MangoHud assumes log_interval=0; clock coverage: ${series.meta.timingEvidence.status}.`, 60, 585);
  }

  ctx.fillStyle = "#7fa393";
  ctx.font = "400 12px 'JetBrains Mono', monospace";
  ctx.fillText(
    `Generated locally with stutterscope — antonsoo.github.io/stutterscope — ${new Date().toISOString().slice(0, 10)}`,
    60,
    CARD_H - 36,
  );

  return canvas;
}

function decimate(values: Float64Array, points: number, gapBefore?: Uint8Array): Array<{ value: number; gapBefore: boolean; gapAfter: boolean }> {
  const count = Math.min(values.length, points);
  const out: Array<{ value: number; gapBefore: boolean; gapAfter: boolean }> = [];
  const bucket = values.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let max = -Infinity;
    let gap = false;
    let internalGap = false;
    for (let j = start; j < end && j < values.length; j++) {
      if (values[j]! > max) max = values[j]!;
      if (gapBefore?.[j] === 1) {
        gap = true;
        if (j > start) internalGap = true;
      }
    }
    // A bucket spanning a gap cannot justify a connection on either side.
    out.push({ value: max, gapBefore: gap, gapAfter: internalGap });
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function exportReportCard(series: FrameSeries, summary: MetricsSummary, options: StutterOptions, selection: FrameSelection = selectFrames(series).selection): void {
  const canvas = renderReportCardCanvas(series, summary, options, selection);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `stutterscope-${safeName(series.meta.sourceFileName)}.png`);
  }, "image/png");
}

export function selectionText(selection: FrameSelection): string {
  const requested = selection.requested;
  const label = requested ? `Requested ${requested.startSec} to ${requested.endSec ?? "end"} s` : "Entire capture";
  return `${label}; frames ${selection.firstFrameIndex + 1}-${selection.lastFrameIndex + 1}; ${selection.durationSec.toFixed(6)} s of frame time. Detection uses full-stream neighbors.`;
}

export function exportComparisonJson(a: CaptureReport, b: CaptureReport): void {
  downloadBlob(new Blob([JSON.stringify(buildComparisonReport(a, b), null, 2)], { type: "application/json" }), "stutterscope-comparison.json");
}

export function exportComparisonMarkdown(a: string, b: string): void {
  downloadBlob(new Blob([`# Stutterscope comparison\n\nIndependently selected intervals; differences are descriptive, not a controlled hardware-performance claim.\n\n## Run A\n\n${a}\n## Run B\n\n${b}`], { type: "text/markdown" }), "stutterscope-comparison.md");
}
