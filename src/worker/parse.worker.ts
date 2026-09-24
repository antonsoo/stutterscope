/// <reference lib="webworker" />
/**
 * Off-main-thread parsing and metrics. Keeps the UI responsive on large
 * captures: the file is streamed in (see core/stream.ts), and the resulting
 * typed arrays are sent back as transferables (zero-copy) rather than
 * structured-cloned.
 */
import { detectFormat, createParserFor } from "../core/parsers/index.ts";
import { parseFileStreaming } from "../core/stream.ts";
import { computeMetricsSummary, detectStutter, frameTimeHistogram, percentileCurve, sortedCopy } from "../core/metrics.ts";
import { DEFAULT_STUTTER_OPTIONS } from "../core/metrics.ts";
import type { FrameSeries, SourceFormat } from "../core/types.ts";
import type { WorkerRequest, WorkerResponse, ChartData } from "./protocol.ts";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Cached parsed series per comparison slot, so threshold changes don't require re-parsing. */
const seriesCache = new Map<"a" | "b", FrameSeries>();

function buildChartData(series: FrameSeries, stutterOptions = DEFAULT_STUTTER_OPTIONS): ChartData {
  const sortedFrameTimeMs = sortedCopy(series.frameTimeMs);
  const stutter = detectStutter(series.frameTimeMs, stutterOptions);
  return {
    sortedFrameTimeMs,
    percentileCurve: percentileCurve(sortedFrameTimeMs, 300),
    histogram: frameTimeHistogram(series.frameTimeMs, 70),
    isStutter: stutter.isStutter,
  };
}

/**
 * Only the chart's derived buffers are transferred (zero-copy) — the
 * `series` itself stays owned by `seriesCache` so a later "recompute"
 * request (e.g. moving the stutter-threshold slider) still has valid,
 * non-detached typed arrays to work from. `series`'s own arrays are
 * structured-cloned instead, which costs a copy but keeps the cache correct.
 */
function chartTransferables(chart: ChartData): Transferable[] {
  return [chart.sortedFrameTimeMs.buffer, chart.isStutter.buffer];
}

async function handleParse(req: Extract<WorkerRequest, { type: "parse" }>): Promise<void> {
  const { requestId, slot, file, formatOverride, genericMapping, stutterOptions } = req;
  try {
    let format: SourceFormat;
    if (formatOverride) {
      format = formatOverride;
    } else {
      const sampleBlob = file.slice(0, 65536);
      const sampleText = await sampleBlob.text();
      const detection = detectFormat(sampleText);
      format = detection.best.format;
      if (format === "generic" && !genericMapping) {
        const header = sampleText.split(/\r?\n/, 1)[0]?.split(",").map((h) => h.trim()) ?? [];
        const response: WorkerResponse = { type: "needsMapping", requestId, slot, header, sniffedFormat: format };
        ctx.postMessage(response);
        return;
      }
    }

    const parser = createParserFor(format, genericMapping);
    const series = await parseFileStreaming(file, parser, file.name, (progress) => {
      const response: WorkerResponse = { type: "progress", requestId, slot, progress };
      ctx.postMessage(response);
    });

    seriesCache.set(slot, series);
    const summary = computeMetricsSummary(series, stutterOptions);
    const chart = buildChartData(series, stutterOptions);
    const response: WorkerResponse = { type: "result", requestId, slot, series, summary, chart };
    ctx.postMessage(response, chartTransferables(chart));
  } catch (err) {
    const response: WorkerResponse = {
      type: "error",
      requestId,
      slot,
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
}

function handleRecompute(req: Extract<WorkerRequest, { type: "recompute" }>): void {
  const { requestId, slot, stutterOptions } = req;
  const series = seriesCache.get(slot);
  if (!series) {
    const response: WorkerResponse = { type: "error", requestId, slot, message: "no cached series for this slot" };
    ctx.postMessage(response);
    return;
  }
  const summary = computeMetricsSummary(series, stutterOptions);
  const chart = buildChartData(series, stutterOptions);
  const response: WorkerResponse = { type: "result", requestId, slot, series, summary, chart };
  ctx.postMessage(response, chartTransferables(chart));
}

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type === "parse") void handleParse(req);
  else handleRecompute(req);
});
