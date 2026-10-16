import type { FrameSeries } from "./types.ts";
import { summaryForJson, type MetricsSummary, type StutterOptions } from "./metrics.ts";
import type { GenericMapping } from "./parsers/generic.ts";
import { selectFrames } from "./analysis.ts";
import { slowEpisodes } from "./episodes.ts";

export function buildJsonReport(series: FrameSeries, summary: MetricsSummary, options: StutterOptions, mapping?: GenericMapping, selection = selectFrames(series).selection) {
  const gaps: Array<{ beforeFrame: number; sourceLine: number | null }> = [];
  for (let i = 0; i < series.frameCount; i++) {
    if (series.gapBefore?.[i] === 1) gaps.push({ beforeFrame: selection.firstFrameIndex + i + 1, sourceLine: series.sourceLine?.[i] ?? null });
  }
  return {
    tool: "stutterscope",
    schemaVersion: 5,
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
      ...(series.meta.presentClockGaps ? { presentClockGaps: series.meta.presentClockGaps } : {}),
      ...(series.meta.presentClockEvidence ? { presentClockEvidence: {
        ...series.meta.presentClockEvidence, witnesses: series.meta.presentClockEvidence.witnesses.map(w => ({ ...w })),
      } } : {}),
      warnings: [...series.meta.warnings],
      omittedWarningDetails: Math.max(0, series.meta.skippedRows - series.meta.warnings.length),
      genericMapping: mapping ? { ...mapping } : null,
      timingEvidence: series.meta.timingEvidence ? { ...series.meta.timingEvidence } : null,
    },
    analysis: { stutterOptions: { ...options }, selection: { ...selection, requested: selection.requested ? { ...selection.requested } : null }, stutterIndexBasis: "selected-series-zero-based",
      continuity: { basis: "source-row-evidence", frameNumberBasis: "source-selected-stream-one-based", gaps } },
    episodes: slowEpisodes({ series, summary, selection }),
    metrics: summaryForJson(summary),
  };
}


export type CaptureReport = ReturnType<typeof buildJsonReport>;

export function buildComparisonReport(a: CaptureReport, b: CaptureReport) {
  return { tool: "stutterscope", schemaVersion: 5, kind: "comparison", generatedAt: new Date().toISOString(), runs: { a, b } };
}
