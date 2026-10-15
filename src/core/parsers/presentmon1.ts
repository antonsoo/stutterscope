/**
 * PresentMon 1.x CSV (legacy `Intel-PresentMon`/`GameTechDev/PresentMon`
 * console app, `--v1_metrics`, and the identical schema written by
 * PresentMon's own pre-2.0 releases).
 *
 * Column set verified against the actual CSV-writing code and a real
 * captured sample in the upstream repo (see `docs/formats.md` for exact
 * citations): `PresentMon/CsvOutput.cpp` and `Tests/Gold/test_case_0_v1.csv`
 * at github.com/GameTechDev/PresentMon (tag v1.10.0 / main).
 *
 * Header (base, no optional tracking flags):
 *   Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,
 *   Dropped,TimeInSeconds,msInPresentAPI,msBetweenPresents,AllowsTearing,
 *   PresentMode,msUntilRenderComplete,msUntilDisplayed,msBetweenDisplayChange,
 *   msFlipDelay,msUntilRenderStart,msGPUActive,msGPUVideoActive,msSinceInput,
 *   QPCTime
 *
 * The lower-case `msBetweenPresents` / `msInPresentAPI` spelling is the
 * signal that distinguishes this format from OCAT/CapFrameX/FrameView, which
 * all capitalize the `Ms` prefix.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { extraFieldsReason, indexHeader, LINE_BREAK, parseDroppedOrUnknown, parseFloatOrNull, parseFrameTimeOrNull, parseWarnings, SkippedRows, splitCsvLine } from "../csv.ts";
import type { FrameSeries, ParserOptions, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";
import { cumulativeSeconds, StreamTracker } from "../streams.ts";

export function sniff(sampleText: string): SniffResult {
  const firstLine = sampleText.split(LINE_BREAK, 1)[0] ?? "";
  const hasV1Markers =
    firstLine.includes("msBetweenPresents") && firstLine.includes("msInPresentAPI");
  // PID columns may be removed from an edited export; the v1 timing markers
  // and application column still identify it, and grouping has an app fallback.
  const hasApplication = firstLine.includes("Application");
  if (hasV1Markers && hasApplication) {
    return { format: "presentmon1", confidence: 0.98, reason: "header has msBetweenPresents/msInPresentAPI" };
  }
  return { format: "presentmon1", confidence: 0, reason: "header does not match PresentMon 1.x" };
}

class PresentMon1Parser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private application: string | undefined;
  private readonly skipped = new SkippedRows();
  private readonly frameTimeMs = new Float64Builder(4096);
  private readonly sourceLine = new Float64Builder(4096);
  private readonly dropped = new Uint8Builder(4096);
  private readonly gpuBusyMs = new Float64Builder(4096);
  private hasGpuColumn = false;
  private columns: string[] = [];
  private hasDropped = false;
  private readonly streams = new StreamTracker();
  private readonly options: ParserOptions;

  constructor(options: ParserOptions = {}) {
    this.options = options;
  }

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line, lineIndex + 1);
    if (this.header === null) {
      this.header = indexHeader(fields, lineIndex + 1);
      this.columns = fields.map((f) => f.trim());
      this.hasDropped = this.header.has("Dropped");
      this.hasGpuColumn = this.header.has("msGPUActive");
      this.streams.setHeader(this.header);
      return;
    }
    const widthProblem = extraFieldsReason(fields, this.columns);
    if (widthProblem) {
      this.streams.skipUnidentified();
      this.skipped.add(lineIndex, widthProblem);
      return;
    }
    const h = this.header;
    const get = (name: string): string | undefined => {
      const idx = h.get(name);
      return idx === undefined ? undefined : fields[idx];
    };
    const ft = parseFrameTimeOrNull(get("msBetweenPresents"));
    if (ft === null) {
      this.streams.skip(fields);
      this.skipped.add(lineIndex, "missing/invalid msBetweenPresents");
      return;
    }
    const identityProblem = this.streams.track(fields);
    if (identityProblem) {
      this.skipped.add(lineIndex, identityProblem);
      return;
    }
    this.frameTimeMs.push(ft);
    this.sourceLine.push(lineIndex + 1);
    if (this.hasDropped) this.dropped.push(parseDroppedOrUnknown(get("Dropped")));
    if (this.hasGpuColumn) {
      this.gpuBusyMs.push(parseFloatOrNull(get("msGPUActive")) ?? NaN);
    }
    if (this.application === undefined) {
      this.application = get("Application");
    }
  }

  finish(sourceFileName: string): FrameSeries {
    const { frameTimeMs, sourceLine, gapBefore, channels, streams, selected } = this.streams.select(
      {
        frameTimeMs: this.frameTimeMs.toArray(), sourceLine: this.sourceLine.toArray(),
        channels: {
          dropped: this.hasDropped ? this.dropped.toArray() : undefined,
          gpuBusyMs: this.hasGpuColumn ? this.gpuBusyMs.toArray() : undefined,
        },
      },
      this.options.stream,
    );
    return {
      meta: {
        format: "presentmon1",
        sourceFileName,
        application: selected?.application ?? this.application,
        warnings: parseWarnings(this.skipped, frameTimeMs.length),
        skippedRows: this.skipped.count,
        columns: this.columns,
        streams,
        selectedStream: selected?.id,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      sourceLine,
      gapBefore,
      timeSec: cumulativeSeconds(frameTimeMs),
      channels,
    };
  }
}

export function createParser(options: ParserOptions = {}): StreamingParser {
  return new PresentMon1Parser(options);
}

export function parse(text: string, fileName = "capture.csv", options: ParserOptions = {}): FrameSeries {
  return parseTextSync(text, createParser(options), fileName);
}
