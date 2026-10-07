import type { FrameSeries } from "./types.ts";
import { summaryForJson, type MetricsSummary, type StutterOptions } from "./metrics.ts";
import type { GenericMapping } from "./parsers/generic.ts";
import { selectFrames } from "./analysis.ts";
import { slowEpisodes } from "./episodes.ts";

export function buildJsonReport(series: FrameSeries, summary: MetricsSummary, options: StutterOptions, mapping?: GenericMapping, selection = selectFrames(series).selection) {
  return {
    tool: "stutterscope",
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    source: {
      fileName: series.meta.sourceFileName,
      format: series.meta.format,
      application: series.meta.application ?? null,
      ...(series.meta.streams
        ? { stream: series.meta.selectedStream, streams: series.meta.streams.map((stream) => ({ ...stream })) }
        : {}),
      frameCount: selection.sourceFrameCount,
      durationSec: selection.sourceDurationSec,
      columns: [...series.meta.columns],
      skippedRows: series.meta.skippedRows,
      warnings: [...series.meta.warnings],
      omittedWarningDetails: Math.max(0, series.meta.skippedRows - series.meta.warnings.length),
      genericMapping: mapping ? { ...mapping } : null,
      timingEvidence: series.meta.timingEvidence ? { ...series.meta.timingEvidence } : null,
    },
    analysis: { stutterOptions: { ...options }, selection: { ...selection, requested: selection.requested ? { ...selection.requested } : null }, stutterIndexBasis: "selected-series-zero-based" },
    episodes: slowEpisodes({ series, summary, selection }),
    metrics: summaryForJson(summary),
  };
}


export type CaptureReport = ReturnType<typeof buildJsonReport>;

export function buildComparisonReport(a: CaptureReport, b: CaptureReport) {
  return { tool: "stutterscope", schemaVersion: 3, kind: "comparison", generatedAt: new Date().toISOString(), runs: { a, b } };
}
